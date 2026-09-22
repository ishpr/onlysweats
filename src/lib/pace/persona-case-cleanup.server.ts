import { randomUUID } from "node:crypto";
import type { Sql } from "../db.ts";

type Env = Record<string, string | undefined>;
type Environment = "sandbox" | "production";
type Deps = { env?: Env; fetch?: typeof fetch };
const API = "https://api.withpersona.com/api/v1";
const DAY = 86_400_000;
const iso = (now: number) => new Date(now).toISOString();
const inquiryId = (id: unknown): id is string =>
  typeof id === "string" && /^inq_[A-Za-z0-9_-]{1,200}$/.test(id);
const caseId = (id: unknown): id is string =>
  typeof id === "string" && /^case_[A-Za-z0-9_-]{1,200}$/.test(id);
const environmentOf = (key: string): Environment | null =>
  /^persona_sandbox_[A-Za-z0-9_-]+$/.test(key)
    ? "sandbox"
    : /^persona_production_[A-Za-z0-9_-]+$/.test(key)
      ? "production"
      : null;

function config(env: Env, expected?: Environment) {
  const apiKey = env.PERSONA_CASE_CLEANUP_API_KEY?.trim() ?? "";
  const environment = environmentOf(apiKey);
  const inquiryKey = env.PERSONA_API_KEY?.trim() ?? "";
  const templates = [
    ...new Set(
      (env.PERSONA_CASE_TEMPLATE_IDS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
  const production =
    env.VERCEL_ENV === "production" ||
    (env.NODE_ENV === "production" && env.VERCEL_ENV !== "preview");
  if (
    !environment ||
    environment !== environmentOf(inquiryKey) ||
    apiKey === inquiryKey ||
    (expected && expected !== environment) ||
    (production && environment !== "production") ||
    !templates.length ||
    templates.length > 8 ||
    templates.some((id) => !/^ctmpl_[A-Za-z0-9_-]{1,200}$/.test(id))
  )
    return null;
  return { apiKey, environment, templates };
}

/** Configuration gate only; live permission and template acceptance remain required. */
export function personaCaseCleanupConfigured(env: Env, expected?: Environment) {
  return config(env, expected) !== null;
}

export async function queuePersonaCaseCleanup(
  sql: Sql,
  ref: string,
  environment: Environment | null,
  now = Date.now(),
) {
  if (!inquiryId(ref)) throw new Error("Invalid inquiry cleanup reference.");
  await sql`insert into persona_case_cleanup_jobs(provider_ref,provider_environment,state,review_reason,next_attempt_at,created_at,updated_at)
    values (${ref},${environment},${environment ? "queued" : "review_required"},${environment ? null : "unknown_provider_environment"},${iso(now)},${iso(now)},${iso(now)})
    on conflict(provider_ref) do nothing`;
}

type CaseResource = {
  type?: string;
  id?: string;
  attributes?: { "redacted-at"?: string | null };
  relationships?: {
    inquiries?: { data?: { id?: string; type?: string }[] };
    accounts?: { data?: { id?: string; type?: string }[] };
    "case-template"?: { data?: { id?: string; type?: string } | null };
  };
};
class ReviewRequired extends Error {}
class BudgetExpired extends Error {}
type ProviderContext = { organizationId: string; environmentId: string };

function validateCase(
  value: CaseResource | undefined,
  ref: string,
  templates: string[],
  expectedId?: string,
) {
  const r = value?.relationships;
  if (
    value?.type !== "case" ||
    !caseId(value.id) ||
    (expectedId && value.id !== expectedId) ||
    !Array.isArray(r?.inquiries?.data) ||
    r.inquiries.data.length !== 1 ||
    r.inquiries.data[0]?.type !== "inquiry" ||
    r.inquiries.data[0].id !== ref ||
    !Array.isArray(r.accounts?.data) ||
    r.accounts.data.length !== 0 ||
    r["case-template"]?.data?.type !== "case-template" ||
    !templates.includes(r["case-template"].data.id ?? "")
  )
    throw new ReviewRequired("unexpected_case_binding");
  return value as CaseResource & { id: string };
}

/** Bounded reads; never retains or logs provider payloads, Case fields or identity. */
async function request(
  cfg: NonNullable<ReturnType<typeof config>>,
  doFetch: typeof fetch,
  method: "GET" | "DELETE",
  path: string,
  deadline: number,
  expectedContext?: ProviderContext,
) {
  const remaining = deadline - Date.now();
  if (remaining <= 100) throw new BudgetExpired();
  const response = await doFetch(`${API}${path}`, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(Math.min(5000, remaining)),
    headers: {
      authorization: `Bearer ${cfg.apiKey}`,
      accept: "application/json",
      "persona-version": "2023-01-05",
      "key-inflection": "kebab",
    },
  });
  // A 404 is not positive redaction evidence: the credential might have lost scope.
  if (!response.ok) throw new Error("case_provider_unavailable");
  const context = {
    organizationId: response.headers.get("persona-organization-id") ?? "",
    environmentId: response.headers.get("persona-environment-id") ?? "",
  };
  if (!context.organizationId || !context.environmentId)
    throw new ReviewRequired("provider_context_missing");
  if (
    expectedContext &&
    (context.organizationId !== expectedContext.organizationId ||
      context.environmentId !== expectedContext.environmentId)
  )
    throw new ReviewRequired("provider_context_mismatch");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("case_provider_response_missing");
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.length;
    if (length > 256 * 1024) {
      await reader.cancel();
      throw new Error("case_provider_response_too_large");
    }
    chunks.push(part.value);
  }
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
    data?: CaseResource | CaseResource[];
    links?: { next?: string | null };
  };
  return { ...body, context };
}

const sparse = new URLSearchParams({
  "fields[case]": "redacted-at,inquiries,accounts,case-template",
}).toString();

/**
 * Up to two leased inquiries and four Cases per invocation, with a 20-second
 * wall budget. Completed receipts retain only opaque refs and rescan daily to
 * catch delayed Case creation. No automatic receipt expiry is safe until the
 * provider's maximum workflow/retention delay has been accepted operationally.
 */
export async function retryPersonaCaseCleanup(
  sql: Sql,
  now = Date.now(),
  { env = process.env, fetch: doFetch = fetch }: Deps = {},
  refs?: string[],
) {
  const result = { verified: 0, redacted: 0, failed: 0, reviewRequired: 0 };
  const cfg = config(env);
  if (!cfg) return result;
  const deadline = Date.now() + 20_000;
  let remainingCases = 4;
  for (let n = 0; n < 2 && remainingCases > 0 && Date.now() < deadline; n++) {
    const token = randomUUID();
    const [job] = await sql<{ provider_ref: string; cursor_ref: string | null; attempts: number }>`
      update persona_case_cleanup_jobs set state='processing',attempts=attempts+1,
        lease_token=${token},lease_until=${iso(now + 60_000)},updated_at=${iso(now)}
      where provider_ref in (select provider_ref from persona_case_cleanup_jobs
        where provider_environment=${cfg.environment} and state<>'review_required' and next_attempt_at<=${iso(now)}
          and (state<>'processing' or lease_until<=${iso(now)})
          and (${refs ?? null}::text[] is null or provider_ref=any(${refs ?? null}))
        order by next_attempt_at,provider_ref for update skip locked limit 1)
      returning provider_ref,cursor_ref,attempts`;
    if (!job) break;
    try {
      if (!inquiryId(job.provider_ref) || (job.cursor_ref && !caseId(job.cursor_ref)))
        throw new ReviewRequired("invalid_cleanup_reference");
      // Prefixes alone cannot distinguish two organizations or custom sandboxes.
      // Verify the exact inquiry using its runtime key, then require every Case
      // response to come from that same provider organization and environment.
      const inquiry = await request(
        { ...cfg, apiKey: env.PERSONA_API_KEY!.trim() },
        doFetch,
        "GET",
        `/inquiries/${job.provider_ref}?fields[inquiry]=redacted-at`,
        deadline,
      );
      if (
        Array.isArray(inquiry.data) ||
        inquiry.data?.type !== "inquiry" ||
        inquiry.data.id !== job.provider_ref
      )
        throw new ReviewRequired("unexpected_inquiry_binding");
      const query = new URLSearchParams({
        "filter[inquiry-id]": job.provider_ref,
        "page[size]": String(Math.min(2, remainingCases)),
      });
      if (job.cursor_ref) query.set("page[after]", job.cursor_ref);
      const page = await request(
        cfg,
        doFetch,
        "GET",
        `/cases?${query}&${sparse}`,
        deadline,
        inquiry.context,
      );
      if (
        !Array.isArray(page.data) ||
        page.data.length > Math.min(2, remainingCases) ||
        !page.links ||
        !Object.hasOwn(page.links, "next") ||
        (page.links?.next != null && typeof page.links.next !== "string")
      )
        throw new ReviewRequired("invalid_case_page");
      const seen = new Set<string>();
      for (const candidate of page.data) {
        const item = validateCase(candidate, job.provider_ref, cfg.templates);
        if (seen.has(item.id) || item.id === job.cursor_ref)
          throw new ReviewRequired("invalid_case_cursor");
        seen.add(item.id);
        remainingCases--;
        // A lost lease may read, but must not initiate new destructive work.
        const owned =
          await sql`select provider_ref from persona_case_cleanup_jobs where provider_ref=${job.provider_ref} and lease_token=${token} and state='processing'`;
        if (!owned.length) break;
        const response = await request(
          cfg,
          doFetch,
          "GET",
          `/cases/${item.id}?${sparse}`,
          deadline,
          inquiry.context,
        );
        const fresh = validateCase(
          response.data as CaseResource,
          job.provider_ref,
          cfg.templates,
          item.id,
        );
        if (!fresh.attributes?.["redacted-at"]) {
          await request(
            cfg,
            doFetch,
            "DELETE",
            `/cases/${item.id}?${sparse}`,
            deadline,
            inquiry.context,
          );
          const confirmed = await request(
            cfg,
            doFetch,
            "GET",
            `/cases/${item.id}?${sparse}`,
            deadline,
            inquiry.context,
          );
          const final = validateCase(
            confirmed.data as CaseResource,
            job.provider_ref,
            cfg.templates,
            item.id,
          );
          if (!Number.isFinite(Date.parse(final.attributes?.["redacted-at"] ?? "")))
            throw new Error("case_redaction_unconfirmed");
          result.redacted++;
        } else if (!Number.isFinite(Date.parse(fresh.attributes["redacted-at"])))
          throw new ReviewRequired("invalid_redaction_timestamp");
      }
      const hasMore = Boolean(page.links?.next);
      const cursor = hasMore ? page.data.at(-1)?.id : null;
      if (hasMore && !caseId(cursor)) throw new ReviewRequired("invalid_case_cursor");
      const updated =
        await sql`update persona_case_cleanup_jobs set state=${hasMore ? "queued" : "monitoring"},cursor_ref=${cursor ?? null},
        next_attempt_at=${iso(now + (hasMore ? 60_000 : DAY))},last_verified_at=case when ${hasMore} then last_verified_at else ${iso(now)} end,
        lease_token=null,lease_until=null,review_reason=null,updated_at=${iso(now)}
        where provider_ref=${job.provider_ref} and lease_token=${token} returning provider_ref`;
      if (updated.length && !hasMore) result.verified++;
    } catch (error) {
      const review = error instanceof ReviewRequired;
      const budget = error instanceof BudgetExpired;
      const delay = budget ? 60_000 : Math.min(DAY, 60_000 * 2 ** Math.min(job.attempts, 10));
      const updated =
        await sql`update persona_case_cleanup_jobs set state=${review ? "review_required" : budget ? "queued" : "failed"},
        next_attempt_at=${iso(now + delay)},lease_token=null,lease_until=null,
        review_reason=${review ? error.message : null},updated_at=${iso(now)}
        where provider_ref=${job.provider_ref} and lease_token=${token} returning provider_ref`;
      if (updated.length && review) result.reviewRequired++;
      else if (updated.length && !budget) result.failed++;
    }
  }
  return result;
}
