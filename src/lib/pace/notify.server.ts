/**
 * Notifications (server-only). `enqueue` runs inside the transaction that caused
 * it; `deliverDue` pushes whatever is owed through Expo's push service afterwards,
 * and the cron sweeps up anything a request didn't get to. The same rows are the
 * app's activity list, so a member who turned push off still sees what happened.
 *
 * Imports nothing from the service layer — the service layer imports this.
 */
import type { Sql } from "../db.ts";
import { CLUSTER_TZ } from "./types.ts";

export type NotifyCategory = "sessions" | "messages" | "reminders" | "substitutes" | "account";
export type NotifyPrefs = Record<Exclude<NotifyCategory, "account">, boolean>;
export const DEFAULT_PREFS: NotifyPrefs = {
  sessions: true,
  messages: true,
  reminders: true,
  substitutes: true,
};

export type NotificationInput = {
  profileId: string;
  kind: string;
  category: NotifyCategory;
  title: string;
  body: string;
  /** In-app route the tap opens, e.g. `/thread/bk_…`. */
  url?: string;
  sessionId?: string;
  bookingId?: string;
  /** Set for anything a schedule might try twice. */
  dedupeKey?: string;
};

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const MAX_ATTEMPTS = 3;
const at = (n: number) => new Date(n).toISOString();
const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;

export const isExpoToken = (token: string) => /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token);

/** "6:30 PM" in the cluster's timezone — what a reminder should say. */
export const clockTime = (when: number | Date | string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: CLUSTER_TZ,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(when));

/** "Sat 6:30 PM" in the cluster's timezone. */
export const dayAndTime = (when: number | Date | string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: CLUSTER_TZ,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(when));

export async function firstName(sql: Sql, profileId: string): Promise<string> {
  const [row] = await sql<{ name: string }>`select name from profiles where id = ${profileId}`;
  return row?.name.trim().split(/\s+/)[0] || "Someone";
}

export async function enqueue(tx: Sql, n: NotificationInput, now = Date.now()) {
  await tx`
    insert into notifications (id, profile_id, kind, category, title, body, url, session_id,
      booking_id, dedupe_key, created_at)
    values (${newId("ntf")}, ${n.profileId}, ${n.kind}, ${n.category}, ${n.title.slice(0, 120)},
      ${n.body.slice(0, 400)}, ${n.url ?? null}, ${n.sessionId ?? null}, ${n.bookingId ?? null},
      ${n.dedupeKey ?? null}, ${at(now)})
    on conflict (dedupe_key) do nothing`;
}

// ── Devices ──────────────────────────────────────────────────────────────────

export async function registerDevice(
  sql: Sql,
  userId: string,
  input: { token: string; platform: "ios" | "android" },
  now = Date.now(),
) {
  // A phone that changes hands (or accounts) moves with its token.
  await sql`
    insert into push_devices (token, profile_id, platform, created_at, last_seen_at)
    values (${input.token}, ${userId}, ${input.platform}, ${at(now)}, ${at(now)})
    on conflict (token) do update set
      profile_id = excluded.profile_id, platform = excluded.platform,
      last_seen_at = excluded.last_seen_at, disabled_at = null`;
}

export async function removeDevice(sql: Sql, userId: string, token: string) {
  await sql`delete from push_devices where token = ${token} and profile_id = ${userId}`;
}

// ── Activity list ────────────────────────────────────────────────────────────

export type NotificationDTO = {
  id: string;
  kind: string;
  title: string;
  body: string;
  url: string | null;
  createdAt: string;
  read: boolean;
};

export async function listNotifications(
  sql: Sql,
  userId: string,
): Promise<{ notifications: NotificationDTO[]; unread: number }> {
  const rows = await sql<{
    id: string;
    kind: string;
    title: string;
    body: string;
    url: string | null;
    created_at: Date;
    read_at: Date | null;
  }>`
    select id, kind, title, body, url, created_at, read_at from notifications
    where profile_id = ${userId} and created_at > now() - interval '30 days'
    order by created_at desc, id limit 100`;
  return {
    notifications: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      body: r.body,
      url: r.url,
      createdAt: new Date(r.created_at).toISOString(),
      read: Boolean(r.read_at),
    })),
    unread: rows.filter((r) => !r.read_at).length,
  };
}

export async function markAllRead(sql: Sql, userId: string, now = Date.now()) {
  await sql`
    update notifications set read_at = ${at(now)} where profile_id = ${userId} and read_at is null`;
}

// ── Delivery ─────────────────────────────────────────────────────────────────

type Fetch = (url: string, init: RequestInit) => Promise<Response>;
type Ticket = { status: "ok"; id: string } | { status: "error"; details?: { error?: string } };

function expoHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
  };
  // Only needed when "enhanced security" is switched on for the Expo project.
  const access = process.env.EXPO_ACCESS_TOKEN?.trim();
  if (access) headers.authorization = `Bearer ${access}`;
  return headers;
}

const MINUTE = 60_000;
const LEASE_MS = 5 * MINUTE;
const RECEIPT_LIFETIME = 24 * 60 * MINUTE;
const retryDelay = (attempt: number) => Math.min(60 * MINUTE, MINUTE * 2 ** (attempt - 1));
const permanentErrors = new Set([
  "DeviceNotRegistered",
  "MessageTooBig",
  "MismatchSenderId",
  "InvalidCredentials",
]);

type Delivery = {
  id: string;
  notification_id: string;
  token: string;
  attempts: number;
  title: string;
  body: string;
  url: string | null;
  category: NotifyCategory;
  unread: number;
};

/** Atomically turn notification rows into a durable device outbox. */
async function prepareDeliveries(sql: Sql, now: number) {
  await sql.transaction(async (tx) => {
    const rows = await tx<{ id: string }>`
      select id from notifications where sent_at is null
        and created_at > ${at(now - 60 * MINUTE)}
      order by created_at limit 100 for update skip locked`;
    if (!rows.length) return;
    const ids = rows.map((row) => row.id);
    // Preferences and device ownership are also rechecked when retrying below.
    await tx.query(
      `
      insert into push_deliveries (id, notification_id, token, next_attempt_at)
      select 'pd_' || md5(n.id || ':' || d.token), n.id, d.token, $2
      from notifications n join profiles p on p.id = n.profile_id
      join push_devices d on d.profile_id = p.id and d.disabled_at is null
      where n.id = any($1) and p.deleted_at is null
        and (n.category = 'account' or (p.suspended_at is null
          and coalesce((p.notify ->> n.category)::boolean, true)))
      on conflict (notification_id, token) do nothing`,
      [ids, at(now)],
    );
    // sent_at means expanded/handled; delivery state lives on the device rows.
    await tx.query("update notifications set sent_at = $2 where id = any($1)", [ids, at(now)]);
  });
}

async function failDelivery(
  sql: Sql,
  id: string,
  attempts: number,
  error: string,
  now: number,
  retryable = true,
) {
  const retry = retryable && attempts < MAX_ATTEMPTS;
  await sql`
    update push_deliveries set state = ${retry ? "pending" : "failed"},
      next_attempt_at = ${at(now + retryDelay(attempts))}, lease_until = null,
      last_error = ${error}
    where id = ${id} and state in ('sending', 'ticket') and attempts = ${attempts}`;
}

/**
 * Claim at most 100 device deliveries per request, after fan-out. Successes stay
 * on their own ticket, so a failure on another device cannot replay them. Leases
 * recover interrupted workers; calls that fail before returning a ticket remain
 * at-least-once because Expo does not offer an idempotent send API.
 */
export async function deliverDue(
  sql: Sql,
  opts: { fetch?: Fetch; now?: number } = {},
): Promise<{ sent: number; failed: number }> {
  const send = opts.fetch ?? (globalThis.fetch as Fetch);
  const now = opts.now ?? Date.now();
  await prepareDeliveries(sql, now);
  await sql`
    update push_deliveries set state = 'failed', lease_until = null, last_error = 'AttemptsExhausted'
    where state = 'sending' and lease_until <= ${at(now)} and attempts >= ${MAX_ATTEMPTS}`;
  let sent = 0;
  let failed = 0;
  // Bound a sweep's work; anything remaining stays durable for the next sweep.
  for (let batch = 0; batch < 6; batch += 1) {
    // Account switches, preference changes, and dead-token responses can happen
    // while a preceding batch is in flight. Recheck before every batch.
    await sql`
      update push_deliveries d set state = 'failed', lease_until = null,
        last_error = 'RecipientUnavailable'
      where d.state in ('pending', 'sending') and (d.lease_until is null or d.lease_until <= ${at(now)})
        and not exists (
          select 1 from notifications n join profiles p on p.id = n.profile_id
          join push_devices device on device.profile_id = p.id and device.token = d.token
          where n.id = d.notification_id and device.disabled_at is null and p.deleted_at is null
            and (n.category = 'account' or (p.suspended_at is null
              and coalesce((p.notify ->> n.category)::boolean, true))))`;
    const messages = await sql<Delivery>`
      with claimed as (
        update push_deliveries set state = 'sending', attempts = attempts + 1,
          lease_until = ${at(now + LEASE_MS)}
        where id in (
          select d.id from push_deliveries d
          where ((d.state = 'pending' and d.next_attempt_at <= ${at(now)})
            or (d.state = 'sending' and d.lease_until <= ${at(now)})) and d.attempts < ${MAX_ATTEMPTS}
            and exists (
              select 1 from notifications n join profiles p on p.id = n.profile_id
              join push_devices device on device.profile_id = p.id and device.token = d.token
              where n.id = d.notification_id and device.disabled_at is null and p.deleted_at is null
                and (n.category = 'account' or (p.suspended_at is null
                  and coalesce((p.notify ->> n.category)::boolean, true))))
          order by d.next_attempt_at, d.id limit 100 for update of d skip locked)
        returning *)
      select c.*, n.title, n.body, n.url, n.category,
        (select count(*) from notifications where profile_id = n.profile_id and read_at is null) as unread
      from claimed c join notifications n on n.id = c.notification_id`;
    if (!messages.length) break;
    let data: Ticket[];
    let requestError: string | undefined;
    let retryable = true;
    try {
      const res = await send(EXPO_PUSH_URL, {
        method: "POST",
        headers: expoHeaders(),
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify(
          messages.map((m) => ({
            to: m.token,
            title: m.title,
            body: m.body,
            sound: "default",
            channelId: m.category,
            badge: Number(m.unread),
            priority: "high",
            // Coalesce a retry when a network disconnect hides the first ticket.
            collapseId: m.notification_id,
            tag: m.notification_id,
            data: { url: m.url, notificationId: m.notification_id },
          })),
        ),
      });
      if (!res.ok) {
        requestError = `HTTP${res.status}`;
        retryable = res.status === 429 || res.status >= 500;
        data = [];
      } else {
        const body = (await res.json()) as { data?: Ticket[] };
        data = Array.isArray(body.data) ? body.data : [];
      }
    } catch {
      // Do not log provider bodies or tokens.
      requestError = "NetworkOrInvalidResponse";
      data = [];
    }
    // Persist each accepted ticket with its state in one transaction. A storage
    // failure must surface, not cause previously accepted devices to be reset.
    await sql.transaction(async (tx) => {
      for (let i = 0; i < messages.length; i += 1) {
        const m = messages[i];
        const ticket = data[i];
        if (ticket?.status === "ok" && typeof ticket.id === "string" && ticket.id) {
          const updated = await tx`
            update push_deliveries set state = 'ticket', lease_until = null, last_error = null
            where id = ${m.id} and state = 'sending' and attempts = ${m.attempts} returning id`;
          if (updated.length) {
            await tx`
              insert into push_tickets (id, token, delivery_id, created_at, next_check_at)
              values (${ticket.id}, ${m.token}, ${m.id}, ${at(now)}, ${at(now + 15 * MINUTE)})
              on conflict (id) do nothing`;
          }
          sent += 1;
        } else {
          failed += 1;
          const error =
            requestError ??
            (ticket?.status === "error" ? ticket.details?.error : undefined) ??
            "MissingTicket";
          if (error === "DeviceNotRegistered") {
            await tx`update push_devices set disabled_at = ${at(now)} where token = ${m.token}`;
          }
          await failDelivery(
            tx,
            m.id,
            m.attempts,
            error,
            now,
            retryable && !permanentErrors.has(error),
          );
        }
      }
    });
  }
  return { sent, failed };
}

/**
 * Retain unresolved receipts and fetch failures until Expo's 24-hour expiry.
 * Only a confirmed retryable error queues a resend; absent receipts never do.
 */
export async function checkReceipts(
  sql: Sql,
  opts: { fetch?: Fetch; now?: number } = {},
): Promise<number> {
  const send = opts.fetch ?? (globalThis.fetch as Fetch);
  const now = opts.now ?? Date.now();
  await sql.transaction(async (tx) => {
    await tx`
      update push_deliveries set state = 'failed', last_error = 'ReceiptExpired'
      where state = 'ticket' and id in (
        select delivery_id from push_tickets where created_at <= ${at(now - RECEIPT_LIFETIME)})`;
    await tx`delete from push_tickets where created_at <= ${at(now - RECEIPT_LIFETIME)}`;
  });
  const due = await sql<{ id: string; token: string; delivery_id: string | null; checks: number }>`
    update push_tickets set next_check_at = ${at(now + LEASE_MS)}, checks = checks + 1
    where id in (select id from push_tickets
      where next_check_at <= ${at(now)} and created_at <= ${at(now - 15 * MINUTE)}
      order by next_check_at limit 300 for update skip locked)
    returning id, token, delivery_id, checks`;
  if (!due.length) return 0;
  let data: Record<string, { status?: string; details?: { error?: string } }> = {};
  try {
    const res = await send(EXPO_RECEIPTS_URL, {
      method: "POST",
      headers: expoHeaders(),
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ ids: due.map((t) => t.id) }),
    });
    if (res.ok) {
      const body = (await res.json()) as { data?: typeof data };
      if (body.data && typeof body.data === "object" && !Array.isArray(body.data)) data = body.data;
    }
  } catch {
    // Unresolved tickets are rescheduled below, including malformed responses.
  }
  let disabled = 0;
  await sql.transaction(async (tx) => {
    for (const t of due) {
      const receipt = data[t.id];
      if (receipt?.status !== "ok" && receipt?.status !== "error") {
        await tx`update push_tickets set next_check_at = ${at(now + Math.max(LEASE_MS, retryDelay(t.checks)))}
          where id = ${t.id} and checks = ${t.checks}`;
        continue;
      }
      // The receipt lease may have expired while this worker waited. Lock in
      // the same order as expiry/send (delivery, then ticket), and consume only
      // this claim's generation before changing either delivery or device state.
      const [delivery] = t.delivery_id
        ? await tx<{ attempts: number }>`
            select attempts from push_deliveries where id = ${t.delivery_id} for update`
        : [];
      const claimed = await tx`
        delete from push_tickets where id = ${t.id} and checks = ${t.checks} returning id`;
      if (!claimed.length) continue;
      if (receipt.status === "ok") {
        await tx`update push_deliveries set state = 'delivered', last_error = null
          where id = ${t.delivery_id} and state = 'ticket'`;
      } else {
        const error = receipt.details?.error ?? "ProviderError";
        if (error === "DeviceNotRegistered") {
          await tx`update push_devices set disabled_at = ${at(now)} where token = ${t.token}`;
          disabled += 1;
        }
        if (delivery)
          await failDelivery(
            tx,
            t.delivery_id!,
            delivery.attempts,
            error,
            now,
            !permanentErrors.has(error),
          );
      }
    }
  });
  return disabled;
}

// ── Scheduled: reminders ─────────────────────────────────────────────────────

/**
 * Two nudges per confirmed seat, each sent once: about an hour out, and when
 * check-in opens. Runs from the cron, every ten minutes.
 */
export async function enqueueReminders(sql: Sql, now = Date.now()): Promise<number> {
  const rows = await sql<{
    booking_id: string;
    session_id: string;
    host_id: string;
    participant_id: string;
    title: string;
    start_at: Date;
    venue: string;
  }>`
    select b.id as booking_id, s.id as session_id, s.host_id, b.participant_id, s.title,
      s.start_at, v.name as venue
    from bookings b
    join sessions s on s.id = b.session_id
    join venues v on v.id = s.venue_id
    where b.status = 'confirmed' and s.status = 'open'
      and s.start_at > ${at(now - 25 * 60_000)} and s.start_at <= ${at(now + 60 * 60_000)}`;
  let n = 0;
  for (const r of rows) {
    const startAt = new Date(r.start_at).getTime();
    const open = now >= startAt - 20 * 60_000;
    for (const profileId of [r.host_id, r.participant_id]) {
      await enqueue(
        sql,
        open
          ? {
              profileId,
              kind: "checkin_open",
              category: "reminders",
              title: "Check-in is open",
              body: `${r.title} at ${r.venue}. Check in when you’re at the pin — it closes 25 minutes after the start.`,
              url: `/live/${r.booking_id}`,
              sessionId: r.session_id,
              bookingId: r.booking_id,
              // One per session for the poster, however many seats are filled.
              dedupeKey: `checkin:${r.session_id}:${profileId}`,
            }
          : {
              profileId,
              kind: "starts_soon",
              category: "reminders",
              title: `${clockTime(startAt)} today: ${r.title}`,
              body: `${r.venue}. Can’t make it? Cancelling now costs $5 unless someone takes the seat — a no-show is $10 and a strike.`,
              url: `/session/${r.session_id}`,
              sessionId: r.session_id,
              bookingId: r.booking_id,
              dedupeKey: `soon:${r.session_id}:${profileId}`,
            },
        now,
      );
      n += 1;
    }
  }
  return n;
}
