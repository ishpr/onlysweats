import { CHECKIN_AFTER_MIN, CHECKIN_BEFORE_MIN } from "./types";

export const DALLAS_TZ = "America/Chicago";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function zonedParts(date: Date, tz = DALLAS_TZ) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const obj: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") obj[p.type] = p.value;
  }
  return {
    year: Number(obj.year),
    month: Number(obj.month),
    day: Number(obj.day),
    hour: Number(obj.hour),
    minute: Number(obj.minute),
    weekday: obj.weekday ?? "Sun",
  };
}

export function dallasDow(date: Date): number {
  const w = zonedParts(date).weekday;
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(w);
}

function makeAt(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  for (const off of ["-05:00", "-06:00"] as const) {
    const dt = new Date(
      `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00${off}`,
    );
    const check = zonedParts(dt);
    if (
      check.year === year &&
      check.month === month &&
      check.day === day &&
      check.hour === hour
    ) {
      return dt;
    }
  }
  return new Date(
    `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00-05:00`,
  );
}

export function addDallasDays(from: Date, days: number) {
  const p = zonedParts(from);
  const utc = Date.UTC(p.year, p.month - 1, p.day + days, 12, 0, 0);
  const n = zonedParts(new Date(utc));
  return { year: n.year, month: n.month, day: n.day };
}

export function atDallas(
  from: Date,
  daysAhead: number,
  hour: number,
  minute: number,
): Date {
  const d = addDallasDays(from, daysAhead);
  return makeAt(d.year, d.month, d.day, hour, minute);
}

export function nextWeekday(
  from: Date,
  targetDow: number,
  hour: number,
  minute: number,
): Date {
  const current = dallasDow(from);
  let add = (targetDow - current + 7) % 7;
  let candidate = atDallas(from, add, hour, minute);
  if (candidate.getTime() <= from.getTime() + 10 * 60_000) {
    candidate = atDallas(from, add + 7, hour, minute);
  }
  return candidate;
}

export function formatTime(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: DALLAS_TZ,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatDay(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: DALLAS_TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

export function formatDayLong(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: DALLAS_TZ,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(iso));
}

export function formatWhen(iso: string, now = new Date()) {
  const start = new Date(iso);
  const a = zonedParts(start);
  const b = zonedParts(now);
  const sameDay =
    a.year === b.year && a.month === b.month && a.day === b.day;
  const tomorrow = addDallasDays(now, 1);
  const isTomorrow =
    a.year === tomorrow.year &&
    a.month === tomorrow.month &&
    a.day === tomorrow.day;
  const time = formatTime(iso);
  if (sameDay) return `Today · ${time}`;
  if (isTomorrow) return `Tomorrow · ${time}`;
  return `${formatDay(iso)} · ${time}`;
}

export function greeting(now = new Date()) {
  const hour = zonedParts(now).hour;
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function checkinBounds(startAt: string) {
  const start = new Date(startAt).getTime();
  return {
    from: start - CHECKIN_BEFORE_MIN * 60_000,
    to: start + CHECKIN_AFTER_MIN * 60_000,
    start,
  };
}

export function isInCheckinWindow(startAt: string, now = Date.now()) {
  const { from, to } = checkinBounds(startAt);
  return now >= from && now <= to;
}

export function minutesUntil(iso: string, now = Date.now()) {
  return Math.round((new Date(iso).getTime() - now) / 60_000);
}

export function formatDuration(min: number) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function formatSleep(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${pad(m)}m`;
}

export function cancelDeadline(startAt: string) {
  return new Date(new Date(startAt).getTime() - 12 * 60 * 60 * 1000);
}

export function isLateCancel(startAt: string, now = Date.now()) {
  return now >= cancelDeadline(startAt).getTime();
}

export function chatExpiresAt(startAt: string, durationMin: number) {
  return new Date(
    new Date(startAt).getTime() + (durationMin + 24 * 60) * 60_000,
  );
}
