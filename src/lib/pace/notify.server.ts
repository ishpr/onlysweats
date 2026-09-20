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
const json = <T>(v: unknown): T => (typeof v === "string" ? JSON.parse(v) : v) as T;

export const isExpoToken = (token: string) => /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token);

/** "6:30 PM" in the cluster's timezone — what a reminder should say. */
export const clockTime = (when: number | Date | string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: CLUSTER_TZ, hour: "numeric", minute: "2-digit" }).format(
    new Date(when),
  );

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

/**
 * Push everything owed. Rows are claimed first (`skip locked`), so two requests
 * finishing together never double-send; a failed call hands them back for the
 * next sweep, up to three tries. Members who muted a category, or have no
 * device, are simply marked done — the activity list still has the row.
 */
export async function deliverDue(
  sql: Sql,
  opts: { fetch?: Fetch; now?: number } = {},
): Promise<{ sent: number; failed: number }> {
  const send = opts.fetch ?? (globalThis.fetch as Fetch);
  const now = opts.now ?? Date.now();
  const claimed = await sql<{
    id: string;
    profile_id: string;
    category: NotifyCategory;
    title: string;
    body: string;
    url: string | null;
  }>`
    update notifications set sent_at = ${at(now)}, attempts = attempts + 1
    where id in (
      select id from notifications
      where sent_at is null and attempts < ${MAX_ATTEMPTS} and created_at > ${at(now - 60 * 60_000)}
      order by created_at limit 100 for update skip locked)
    returning id, profile_id, category, title, body, url`;
  if (claimed.length === 0) return { sent: 0, failed: 0 };

  const owners = [...new Set(claimed.map((n) => n.profile_id))];
  const devices = await sql.query<{ token: string; profile_id: string }>(
    "select token, profile_id from push_devices where profile_id = any($1) and disabled_at is null",
    [owners],
  );
  const prefRows = await sql.query<{ id: string; notify: unknown; gone: boolean }>(
    `select id, notify, (deleted_at is not null or suspended_at is not null) as gone
     from profiles where id = any($1)`,
    [owners],
  );
  const prefs = new Map(prefRows.map((p) => [p.id, p]));

  const unreadRows = await sql.query<{ profile_id: string; n: number }>(
    `select profile_id, count(*) as n from notifications
     where profile_id = any($1) and read_at is null group by profile_id`,
    [owners],
  );
  const unread = new Map(unreadRows.map((r) => [r.profile_id, Number(r.n)]));

  const messages: { to: string; notificationId: string; payload: Record<string, unknown> }[] = [];
  for (const n of claimed) {
    const owner = prefs.get(n.profile_id);
    if (!owner || (owner.gone && n.category !== "account")) continue;
    const wants = { ...DEFAULT_PREFS, ...(json<Partial<NotifyPrefs>>(owner.notify) ?? {}) };
    if (n.category !== "account" && !wants[n.category]) continue;
    for (const d of devices.filter((x) => x.profile_id === n.profile_id)) {
      messages.push({
        to: d.token,
        notificationId: n.id,
        payload: {
          to: d.token,
          title: n.title,
          body: n.body,
          sound: "default",
          // Android: one channel per kind (the app creates them). iOS: the icon badge.
          channelId: n.category,
          badge: unread.get(n.profile_id) ?? 1,
          priority: "high",
          data: { url: n.url, notificationId: n.id },
        },
      });
    }
  }
  if (messages.length === 0) return { sent: 0, failed: 0 };

  try {
    const res = await send(EXPO_PUSH_URL, {
      method: "POST",
      headers: expoHeaders(),
      body: JSON.stringify(messages.map((m) => m.payload)),
    });
    if (!res.ok) throw new Error(`Expo push answered ${res.status}`);
    const { data } = (await res.json()) as { data: Ticket[] };
    let failed = 0;
    for (let i = 0; i < messages.length; i += 1) {
      const ticket = data[i];
      if (ticket?.status === "ok") {
        await sql`
          insert into push_tickets (id, token) values (${ticket.id}, ${messages[i].to})
          on conflict (id) do nothing`;
      } else {
        failed += 1;
        if (ticket?.details?.error === "DeviceNotRegistered") {
          await sql`update push_devices set disabled_at = ${at(now)} where token = ${messages[i].to}`;
        }
      }
    }
    return { sent: messages.length - failed, failed };
  } catch (err) {
    console.error("[push] send failed", err);
    await sql.query("update notifications set sent_at = null where id = any($1)", [
      [...new Set(messages.map((m) => m.notificationId))],
    ]);
    return { sent: 0, failed: messages.length };
  }
}

/**
 * Expo only learns a token is dead when Apple or Google says so, minutes later.
 * Read those receipts and stop sending to uninstalled apps.
 */
export async function checkReceipts(
  sql: Sql,
  opts: { fetch?: Fetch; now?: number } = {},
): Promise<number> {
  const send = opts.fetch ?? (globalThis.fetch as Fetch);
  const now = opts.now ?? Date.now();
  const due = await sql<{ id: string; token: string }>`
    select id, token from push_tickets where created_at < ${at(now - 15 * 60_000)} limit 300`;
  if (due.length === 0) return 0;
  let disabled = 0;
  try {
    const res = await send(EXPO_RECEIPTS_URL, {
      method: "POST",
      headers: expoHeaders(),
      body: JSON.stringify({ ids: due.map((t) => t.id) }),
    });
    if (!res.ok) throw new Error(`Expo receipts answered ${res.status}`);
    const { data } = (await res.json()) as {
      data: Record<string, { status: string; details?: { error?: string } }>;
    };
    for (const t of due) {
      if (data[t.id]?.details?.error === "DeviceNotRegistered") {
        await sql`update push_devices set disabled_at = ${at(now)} where token = ${t.token}`;
        disabled += 1;
      }
    }
  } catch (err) {
    console.error("[push] receipts failed", err);
  }
  // Receipts live a day at Expo; either way these tickets are finished with.
  await sql.query("delete from push_tickets where id = any($1)", [due.map((t) => t.id)]);
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
