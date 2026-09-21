import { CHECKIN_AFTER_MIN, CHECKIN_BEFORE_MIN } from "./types";

/** The launch cluster keeps one clock, wherever the phone thinks it is. */
export const CLUSTER_TZ = "America/Chicago";

const fmt = (opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-US", { timeZone: CLUSTER_TZ, ...opts });

const dayKey = fmt({ year: "numeric", month: "2-digit", day: "2-digit" });
const time = fmt({ hour: "numeric", minute: "2-digit" });
const day = fmt({ weekday: "short", month: "short", day: "numeric" });
const dayLong = fmt({ weekday: "long", month: "long", day: "numeric" });
const hour24 = fmt({ hour: "2-digit", hourCycle: "h23" });

export const formatTime = (iso: string | number) => time.format(new Date(iso));
export const formatDayLong = (iso: string) => dayLong.format(new Date(iso));
export const clusterHour = (iso: string) => Number(hour24.format(new Date(iso)));

export function formatWhen(iso: string, now = new Date()) {
  const start = new Date(iso);
  const key = dayKey.format(start);
  if (key === dayKey.format(now)) return `Today · ${formatTime(iso)}`;
  if (key === dayKey.format(new Date(now.getTime() + 24 * 3600_000))) {
    return `Tomorrow · ${formatTime(iso)}`;
  }
  return `${day.format(start)} · ${formatTime(iso)}`;
}

export function greeting(now = new Date()) {
  const h = Number(hour24.format(now));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function formatDuration(min: number) {
  if (min < 60) return `${min} min`;
  const m = min % 60;
  return m ? `${Math.floor(min / 60)}h ${m}m` : `${min / 60}h`;
}

export const formatUsd = (cents: number) =>
  cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;

export function checkinWindow(startAt: string) {
  const start = new Date(startAt).getTime();
  return { from: start - CHECKIN_BEFORE_MIN * 60_000, to: start + CHECKIN_AFTER_MIN * 60_000 };
}

export function inCheckinWindow(startAt: string, now = Date.now()) {
  const { from, to } = checkinWindow(startAt);
  return now >= from && now <= to;
}

export const isLateCancel = (startAt: string, now = Date.now()) =>
  now >= new Date(startAt).getTime() - 12 * 3600_000;

/** Nobody pays to join. What costs money is not showing up. */
export const POLICY_LINE =
  "Free to join. Cancel 12 hours ahead at no cost. Inside 12 hours it’s $5 — waived if someone takes your seat. A no-show is $10 and a strike.";

/**
 * A wall-clock time in the cluster, `days` from today, as an instant. Tries both
 * Central offsets and keeps the one that round-trips (DST-safe).
 */
export function atCluster(days: number, hour: number, minute: number, now = new Date()): Date {
  const [m, d, y] = dayKey.format(new Date(now.getTime() + days * 24 * 3600_000)).split("/");
  const p = (n: number) => String(n).padStart(2, "0");
  for (const off of ["-05:00", "-06:00"]) {
    const dt = new Date(`${y}-${m}-${d}T${p(hour)}:${p(minute)}:00${off}`);
    if (clusterHour(dt.toISOString()) === hour) return dt;
  }
  return new Date(`${y}-${m}-${d}T${p(hour)}:${p(minute)}:00-05:00`);
}

/** The cluster's calendar date `days` from today, as the API's `YYYY-MM-DD`. */
export function clusterDate(days = 0, now = new Date()): string {
  const [m, d, y] = dayKey.format(new Date(now.getTime() + days * 24 * 3600_000)).split("/");
  return `${y}-${m}-${d}`;
}

const dateOnly = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "short",
  month: "short",
  day: "numeric",
});

/** "Sun, Dec 13" from a `YYYY-MM-DD` — a calendar date has no time zone to shift it. */
export const formatDate = (date: string) => dateOnly.format(new Date(`${date}T00:00:00Z`));

/** Whole days from today (in the cluster) to a `YYYY-MM-DD`. */
export const daysUntil = (date: string, now = new Date()) =>
  Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${clusterDate(0, now)}T00:00:00Z`)) / 86_400_000,
  );

export function dayLabel(days: number, now = new Date()) {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return day.format(new Date(now.getTime() + days * 24 * 3600_000));
}

/** Great-circle distance in metres — display only; the server decides check-in. */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6_371_000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
