import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { SiteShell } from "@/components/site/site-shell";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";
import { SITE } from "@/lib/site";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [{ title: `Admin — ${SITE.name}` }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: Admin,
});

// ── API ──────────────────────────────────────────────────────────────────────

type Person = { id: string; name: string; handle: string; neighborhood: string };
type Overview = {
  members: number;
  suspended: number;
  upcomingSessions: number;
  completedSeats: number;
  noShows: number;
  openReports: number;
  feesAssessedCents: number;
};
type ReportStatus = "open" | "actioned" | "dismissed";
type Report = {
  id: string;
  reason: string;
  detail: string;
  status: ReportStatus;
  resolution: string | null;
  resolvedBy: string | null;
  createdAt: string;
  reporterId: string;
  reportedId: string;
  reportsAgainst: number;
  reportedSuspended: boolean;
  session: { id: string; title: string; activity: string; startAt: string; status: string } | null;
  messages: { fromId: string; text: string; createdAt: string }[];
};
type Member = {
  person: Person;
  suspended: { at: string; reason: string } | null;
  frozenUntil: string | null;
  feesCents: number;
  strikes: number;
  reportsAgainst: number;
  reportsFiled: number;
  upcomingSessions: number;
  joinedAt: string;
};
type Action = {
  id: string;
  adminEmail: string;
  action: string;
  profileId: string | null;
  sessionId: string | null;
  note: string;
  createdAt: string;
};
type ResolveAction = "dismiss" | "suspend" | "remove_session" | "suspend_and_remove";

class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function api<T>(path: string, init: { method?: string; json?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: init.method ?? "GET",
    credentials: "same-origin",
    headers: init.json === undefined ? undefined : { "content-type": "application/json" },
    body: init.json === undefined ? undefined : JSON.stringify(init.json),
  });
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? "Something went wrong.");
  return data as T;
}

const REASONS: Record<string, string> = {
  date_framing: "Made it feel like a date",
  harassment: "Harassment or unwanted contact",
  unsafe: "Felt unsafe",
  misrepresented: "Not what was posted",
  fake_or_spam: "Fake profile or spam",
  other: "Something else",
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const focus =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stand";
const inputClass = `min-h-11 w-full rounded-2xl border border-fg/10 bg-bg-raised px-4 text-[15px] text-fg placeholder:text-faint ${focus}`;

// ── Page ─────────────────────────────────────────────────────────────────────

type Gate = "loading" | "signed-out" | "not-admin" | "admin";

function Admin() {
  const [gate, setGate] = useState<Gate>("loading");

  const check = useCallback(async () => {
    try {
      const me = await api<{ isAdmin: boolean }>("/me");
      setGate(me.isAdmin ? "admin" : "not-admin");
    } catch (err) {
      setGate(err instanceof ApiError && err.status === 401 ? "signed-out" : "not-admin");
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  return (
    <SiteShell>
      <div className="flex flex-col gap-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-widest text-accent">Admin</p>
            <h1 className="text-3xl font-semibold tracking-tight text-fg">Safety queue</h1>
          </div>
          {(gate === "admin" || gate === "not-admin") && (
            <Button
              variant="soft"
              className={focus}
              onClick={() => void authClient.signOut().then(() => setGate("signed-out"))}
            >
              Sign out
            </Button>
          )}
        </header>

        {gate === "loading" && <p className="text-muted">Loading…</p>}
        {gate === "signed-out" && <SignIn onDone={check} />}
        {gate === "not-admin" && (
          // Deliberately says nothing about who is allowed.
          <p role="alert" className="text-muted">
            This account can’t open this page.
          </p>
        )}
        {gate === "admin" && <Console />}
      </div>
    </SiteShell>
  );
}

// ── Sign in ──────────────────────────────────────────────────────────────────

type AuthConfig = { google: { webClientId: string } | null; password: boolean };
type GoogleId = {
  initialize: (o: { client_id: string; callback: (r: { credential: string }) => void }) => void;
  renderButton: (el: HTMLElement, o: Record<string, string>) => void;
};

function SignIn({ onDone }: { onDone: () => Promise<void> }) {
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const googleButton = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Before Apple + Google sign-in ships, the endpoint doesn't exist: passwords only.
    api<AuthConfig>("/auth-config")
      .then(setConfig)
      .catch(() => setConfig({ google: null, password: true }));
  }, []);

  const clientId = config?.google?.webClientId;
  useEffect(() => {
    if (!clientId) return;
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => {
      const id = (window as unknown as { google?: { accounts: { id: GoogleId } } }).google?.accounts.id;
      if (!id || !googleButton.current) return;
      id.initialize({
        client_id: clientId,
        callback: ({ credential }) => {
          setError("");
          void authClient.signIn
            .social({ provider: "google", idToken: { token: credential } })
            .then(({ error: failed }) => (failed ? setError(failed.message ?? "Sign-in failed.") : onDone()));
        },
      });
      id.renderButton(googleButton.current, { theme: "filled_black", size: "large", shape: "pill" });
    };
    script.onerror = () => setError("Couldn’t load Google sign-in.");
    document.head.appendChild(script);
    return () => script.remove();
  }, [clientId, onDone]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    const { error: failed } = await authClient.signIn.email({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    setBusy(false);
    if (failed) return setError(failed.message ?? "Sign-in failed.");
    await onDone();
  }

  if (!config) return <p className="text-muted">Loading…</p>;
  return (
    <Panel title="Sign in">
      {clientId && <div ref={googleButton} />}
      {config.password && (
        <form onSubmit={submit} className="flex max-w-sm flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm text-muted">
            Email
            <input name="email" type="email" autoComplete="email" required className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted">
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className={inputClass}
            />
          </label>
          <Button type="submit" disabled={busy} className={focus}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </Panel>
  );
}

// ── Console ──────────────────────────────────────────────────────────────────

function Console() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [status, setStatus] = useState<ReportStatus>("open");
  const [queue, setQueue] = useState<{ reports: Report[]; people: Person[] } | null>(null);
  const [actions, setActions] = useState<Action[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [o, q, a] = await Promise.all([
        api<Overview>("/admin/overview"),
        api<{ reports: Report[]; people: Person[] }>(`/admin/reports?status=${status}`),
        api<{ actions: Action[] }>("/admin/actions"),
      ]);
      setOverview(o);
      setQueue(q);
      setActions(a.actions);
      setError("");
    } catch (err) {
      setError((err as Error).message);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const names = new Map((queue?.people ?? []).map((p) => [p.id, p]));

  return (
    <>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      {overview && (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Open reports" value={overview.openReports} />
          <Stat label="Members" value={overview.members} />
          <Stat label="Paused" value={overview.suspended} />
          <Stat label="Upcoming sessions" value={overview.upcomingSessions} />
          <Stat label="Completed seats" value={overview.completedSeats} />
          <Stat label="No-shows" value={overview.noShows} />
          <Stat label="Fees assessed" value={usd(overview.feesAssessedCents)} />
        </dl>
      )}

      <Panel title="Reports">
        <div role="tablist" aria-label="Report status" className="flex flex-wrap gap-2">
          {(["open", "actioned", "dismissed"] as const).map((s) => (
            <Button
              key={s}
              role="tab"
              aria-selected={status === s}
              variant={status === s ? "primary" : "soft"}
              className={`capitalize ${focus}`}
              onClick={() => setStatus(s)}
            >
              {s}
            </Button>
          ))}
        </div>
        {queue?.reports.length === 0 && <p className="text-muted">Nothing here.</p>}
        <ul className="flex flex-col gap-4">
          {queue?.reports.map((r) => (
            <li key={r.id}>
              <ReportCard report={r} names={names} onChanged={load} />
            </li>
          ))}
        </ul>
      </Panel>

      <Members onChanged={load} />

      <Panel title="Audit log">
        {actions.length === 0 && <p className="text-muted">No admin actions yet.</p>}
        <ul className="flex flex-col divide-y divide-fg/10">
          {actions.map((a) => (
            <li key={a.id} className="flex flex-col gap-1 py-3 text-sm">
              <span className="text-fg">
                {a.action.replaceAll("_", " ")}
                {a.note ? ` — ${a.note}` : ""}
              </span>
              <span className="text-faint">
                {a.adminEmail} · {when(a.createdAt)}
                {a.profileId ? ` · member ${a.profileId}` : ""}
                {a.sessionId ? ` · session ${a.sessionId}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}

function ReportCard({
  report: r,
  names,
  onChanged,
}: {
  report: Report;
  names: Map<string, Person>;
  onChanged: () => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reporter = names.get(r.reporterId);
  const reported = names.get(r.reportedId);

  async function resolve(action: ResolveAction) {
    const destructive = action !== "dismiss";
    if (destructive && !window.confirm(`${action.replaceAll("_", " ")} — are you sure?`)) return;
    setBusy(true);
    setError("");
    try {
      await api(`/admin/reports/${r.id}/resolve`, { method: "POST", json: { action, note } });
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="flex flex-col gap-3 rounded-3xl border border-fg/10 bg-bg-raised p-5">
      <header className="flex flex-col gap-1">
        <h3 className="text-lg font-semibold text-fg">{REASONS[r.reason] ?? r.reason}</h3>
        <p className="text-sm text-muted">
          {reporter?.name ?? r.reporterId} reported{" "}
          <strong className="text-fg">{reported?.name ?? r.reportedId}</strong> · {when(r.createdAt)}
        </p>
        <p className="text-sm text-faint">
          {r.reportsAgainst} report{r.reportsAgainst === 1 ? "" : "s"} against this member
          {r.reportedSuspended ? " · currently paused" : ""}
        </p>
      </header>

      {r.detail && <p className="whitespace-pre-wrap text-[15px] leading-6 text-fg">{r.detail}</p>}
      {r.session && (
        <p className="text-sm text-muted">
          Session: {r.session.title} · {r.session.activity} · {when(r.session.startAt)} ·{" "}
          {r.session.status}
        </p>
      )}

      {r.messages.length > 0 && (
        <details className="rounded-2xl border border-fg/10 p-3">
          <summary className={`min-h-11 cursor-pointer content-center text-sm text-muted ${focus}`}>
            Thread ({r.messages.length} messages)
          </summary>
          <ul className="flex flex-col gap-2 pt-2 text-sm">
            {r.messages.map((m, i) => (
              <li key={i}>
                <span className="text-faint">{names.get(m.fromId)?.name ?? "Member"}: </span>
                <span className="text-fg">{m.text}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {r.status === "open" ? (
        <>
          <label className="flex flex-col gap-1 text-sm text-muted">
            Note (shown to the member if you pause them)
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={1000}
              className={inputClass}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button variant="soft" disabled={busy} className={focus} onClick={() => void resolve("dismiss")}>
              Dismiss
            </Button>
            {r.session && (
              <Button
                variant="soft"
                disabled={busy}
                className={focus}
                onClick={() => void resolve("remove_session")}
              >
                Take session down
              </Button>
            )}
            <Button variant="danger" disabled={busy} className={focus} onClick={() => void resolve("suspend")}>
              Pause member
            </Button>
            {r.session && (
              <Button
                variant="danger"
                disabled={busy}
                className={focus}
                onClick={() => void resolve("suspend_and_remove")}
              >
                Pause and take down
              </Button>
            )}
          </div>
        </>
      ) : (
        <p className="text-sm text-muted">
          {r.resolution} · {r.resolvedBy}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </article>
  );
}

function Members({ onChanged }: { onChanged: () => Promise<void> }) {
  const [q, setQ] = useState("");
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState("");

  const search = useCallback(async (term: string) => {
    try {
      const res = await api<{ members: Member[] }>(`/admin/members?q=${encodeURIComponent(term)}`);
      setMembers(res.members);
      setError("");
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  async function toggle(m: Member) {
    try {
      if (m.suspended) {
        await api(`/admin/members/${m.person.id}/unsuspend`, { method: "POST", json: {} });
      } else {
        const note = window.prompt(`Why pause ${m.person.name}? They will see this.`);
        if (!note?.trim()) return;
        await api(`/admin/members/${m.person.id}/suspend`, { method: "POST", json: { note } });
      }
      await Promise.all([search(q), onChanged()]);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Panel title="Members">
      <form
        role="search"
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void search(q);
        }}
      >
        <label className="sr-only" htmlFor="member-search">
          Find a member by name or handle
        </label>
        <input
          id="member-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name or handle"
          className={`${inputClass} max-w-sm`}
        />
        <Button type="submit" variant="soft" className={focus}>
          Search
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {members?.length === 0 && <p className="text-muted">No one by that name.</p>}
      <ul className="flex flex-col divide-y divide-fg/10">
        {members?.map((m) => (
          <li key={m.person.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="flex flex-col gap-1">
              <span className="font-medium text-fg">
                {m.person.name} <span className="text-faint">@{m.person.handle}</span>
              </span>
              <span className="text-sm text-muted">
                Joined {when(m.joinedAt)} · {m.strikes} strikes · {usd(m.feesCents)} fees ·{" "}
                {m.reportsAgainst} reports against · {m.reportsFiled} filed · {m.upcomingSessions}{" "}
                upcoming
              </span>
              {m.suspended && (
                <span className="text-sm text-danger">
                  Paused {when(m.suspended.at)} — {m.suspended.reason}
                </span>
              )}
            </div>
            <Button
              variant={m.suspended ? "soft" : "danger"}
              className={focus}
              onClick={() => void toggle(m)}
            >
              {m.suspended ? "Lift pause" : "Pause"}
            </Button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold tracking-tight text-fg">{title}</h2>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-3xl border border-fg/10 bg-bg-raised p-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-2xl font-semibold tracking-tight text-fg">{value}</dd>
    </div>
  );
}
