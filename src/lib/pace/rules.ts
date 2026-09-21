/**
 * SamePace rules (PRD v0.3 — membership) as pure functions: no I/O, and no clock
 * reads unless `now` is passed. The service layer loads rows, asks these what
 * should happen, then writes the answer inside one transaction.
 *
 * Nobody pays anybody. What costs money is not showing up — and the rules are the
 * same for the person who posted and the person who joined.
 */
import {
  ABILITY_KIND,
  CHECKIN_AFTER_MIN,
  CHECKIN_BEFORE_MIN,
  CLUSTER_TZ,
  GEOFENCE_M,
  type Ability,
  type Activity,
  type Difficulty,
  type Gender,
  type GoalKind,
  type MemberAbilities,
  type Visibility,
} from "./types.ts";

export const LATE_CANCEL_MS = 12 * 60 * 60_000;
export const LATE_CANCEL_FEE_CENTS = 500;
export const NO_SHOW_FEE_CENTS = 1000;
export const SHOW_UP_CREDIT_CENTS = 500;
/** A fee is held this long after the session so it can be disputed first. */
export const DISPUTE_HOLD_MS = 24 * 60 * 60_000;
export const CODE_TTL_MS = 10 * 60_000;
export const MIN_LEAD_TIME_MS = 30 * 60_000;
export const STRIKE_WINDOW_MS = 60 * 24 * 60 * 60_000;
export const STRIKES_TO_FREEZE = 2;
export const FREEZE_MS = 14 * 24 * 60 * 60_000;
export const CHAT_TTL_MS = 24 * 60 * 60_000;
/** Membership ($12/mo — an assumption under test) starts after this many sessions. */
export const FREE_SESSIONS = 2;
export const MEMBERSHIP_MONTHLY_CENTS = 1200;

export type RuleResult = { ok: true } | { ok: false; error: string };
const ok: RuleResult = { ok: true };
const no = (error: string): RuleResult => ({ ok: false, error });

// ── Ability ──────────────────────────────────────────────────────────────────

const inRange = (n: unknown, lo: number, hi: number) =>
  typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi;

/** Ability is required to post: a buddy at the wrong level is worse than none. */
export function validAbility(activity: Activity, a: Ability | null | undefined): RuleResult {
  if (!a || a.kind !== ABILITY_KIND[activity]) return no("Say what level this one is.");
  switch (a.kind) {
    case "run":
      if (!inRange(a.paceMinSec, 240, 1200) || !inRange(a.paceMaxSec, a.paceMinSec, 1200)) {
        return no("Give a pace range per mile.");
      }
      return inRange(a.miles, 0.5, 40) ? ok : no("Give a distance.");
    case "ride":
      if (!inRange(a.mphMin, 5, 40) || !inRange(a.mphMax, a.mphMin, 40)) {
        return no("Give an average speed range.");
      }
      return inRange(a.miles, 1, 200) ? ok : no("Give a distance.");
    case "gym":
      return a.focus.trim().length <= 60 ? ok : no("Keep the focus short.");
    case "hike":
      return inRange(a.miles, 0.5, 40) && inRange(a.gainFt, 0, 15000) ? ok : no("Give distance and gain.");
    case "walk":
      return inRange(a.miles, 0.5, 20) ? ok : no("Give a distance.");
    case "open":
      return ok;
  }
}

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** The line a card shows: "9:30–10:00 /mi · 5 mi". */
export function abilityLabel(a: Ability): string {
  switch (a.kind) {
    case "run":
      return `${mmss(a.paceMinSec)}–${mmss(a.paceMaxSec)} /mi · ${num(a.miles)} mi`;
    case "ride":
      return `${num(a.mphMin)}–${num(a.mphMax)} mph · ${num(a.miles)} mi · ${a.surface}`;
    case "gym":
      return a.focus.trim() ? `${cap(a.experience)} · ${a.focus.trim()}` : cap(a.experience);
    case "hike":
      return `${num(a.miles)} mi · ${a.gainFt.toLocaleString("en-US")} ft · ${a.difficulty}`;
    case "walk":
      return `${cap(a.effort)} · ${num(a.miles)} mi`;
    case "open":
      return "Open to all";
  }
}

const HARDNESS: Record<Difficulty, number> = { easy: 0, moderate: 1, hard: 2 };

/**
 * Does this session sit inside the member's own range? `null` = the member hasn't
 * said (so we can't hide anything from them). A flexible session fits everyone:
 * the poster has said they'll adjust.
 */
export function abilityFits(
  mine: MemberAbilities,
  session: Ability,
  flex: "strict" | "flexible",
): boolean | null {
  if (flex === "flexible" || session.kind === "open") return true;
  switch (session.kind) {
    case "run":
      return mine.run
        ? mine.run.paceMinSec <= session.paceMaxSec && session.paceMinSec <= mine.run.paceMaxSec
        : null;
    case "ride":
      return mine.ride
        ? mine.ride.mphMin <= session.mphMax && session.mphMin <= mine.ride.mphMax
        : null;
    case "gym":
      return mine.strength ? mine.strength.experience === session.experience : null;
    case "hike":
      return mine.hike ? HARDNESS[session.difficulty] <= HARDNESS[mine.hike.difficulty] : null;
    case "walk":
      return mine.walk ? mine.walk.effort === "brisk" || session.effort === "easy" : null;
  }
}

// ── Words ────────────────────────────────────────────────────────────────────

/**
 * PRD v0.3 §8: what a member writes stays about the workout. The list is the
 * PRD's, matched as whole words — "singletrack" passes, "single" doesn't — minus
 * "match" and "date": "match my pace" and "race date" are what people write here,
 * and the `date_framing` report covers the other meaning. One list to tune.
 */
export const BANNED_WORDS = [
  "tinder",
  "swipe",
  "spark",
  "gym crush",
  "crush",
  "single",
  "cute",
  "chemistry",
  "vibe",
] as const;

const BANNED = new RegExp(
  `(?<![\\p{L}\\p{N}])(${BANNED_WORDS.map((w) => w.replace(" ", "\\s+")).join("|")})(?![\\p{L}\\p{N}])`,
  "iu",
);

/** Workout terms that contain a banned word and mean nothing of the sort. */
const WORKOUT_TERMS = /single[-\s](leg|arm)/giu;

/** Checks every piece of text a member typed; names the word so they can fix it. */
export function cleanText(...texts: (string | null | undefined)[]): RuleResult {
  for (const text of texts) {
    const hit = text ? BANNED.exec(text.replace(WORKOUT_TERMS, "")) : null;
    if (hit) return no(`Keep it about the workout — “${hit[1].toLowerCase()}” can’t go in a listing.`);
  }
  return ok;
}

// ── Posting + joining ────────────────────────────────────────────────────────

export type PostInput = {
  title: string;
  detail?: string;
  activity: Activity;
  ability: Ability | null | undefined;
  startAt: number;
  capacity: number;
  womenOnly: boolean;
  visibility: Visibility;
};

/** A freeze covers public sessions only — people who know each other can still meet. */
const frozen = (until: number | null, visibility: Visibility, now: number) =>
  visibility === "public" && until !== null && until > now;

export function canPost(
  input: PostInput,
  poster: { gender: Gender; frozenUntil: number | null },
  now: number,
): RuleResult {
  if (!input.title.trim()) return no("Give it a title.");
  const words = cleanText(input.title, input.detail);
  if (!words.ok) return words;
  if (input.startAt < now + MIN_LEAD_TIME_MS) return no("Pick a start at least 30 minutes out.");
  if (!Number.isInteger(input.capacity) || input.capacity < 2 || input.capacity > 4) {
    return no("Sessions stay between 2 and 4 people.");
  }
  const ability = validAbility(input.activity, input.ability);
  if (!ability.ok) return ability;
  if (frozen(poster.frozenUntil, input.visibility, now)) {
    return no("Public sessions are paused for 14 days after two no-shows.");
  }
  if (input.womenOnly && poster.gender !== "woman") {
    return no("Women-only sessions are posted by women.");
  }
  return ok;
}

export type SessionFacts = {
  hostId: string;
  startAt: number;
  capacity: number;
  status: "open" | "cancelled" | "completed";
  womenOnly: boolean;
  visibility: Visibility;
};

export function canBook(
  session: SessionFacts,
  me: { id: string; gender: Gender; frozenUntil: number | null },
  seats: { taken: number; mineActive: boolean },
  now: number,
): RuleResult {
  if (session.hostId === me.id) return no("You posted this one.");
  if (session.status !== "open") return no("This session is closed.");
  if (now >= session.startAt) return no("This one already started.");
  if (seats.mineActive) return no("You’re already in.");
  if (session.womenOnly && me.gender !== "woman") return no("This session is women-only.");
  if (frozen(me.frozenUntil, session.visibility, now)) {
    return no("Public sessions are paused for 14 days after two no-shows.");
  }
  if (seats.taken >= session.capacity - 1) return no("It’s full.");
  return ok;
}

/** 12h+ ahead is free. Inside 12h costs $5 — unless a substitute takes the seat. */
export function cancelOutcome(
  status: string,
  startAt: number,
  now: number,
): { late: boolean; feeCents: number } {
  const late = status === "confirmed" && now >= startAt - LATE_CANCEL_MS;
  return { late, feeCents: late ? LATE_CANCEL_FEE_CENTS : 0 };
}

// ── Check-in ─────────────────────────────────────────────────────────────────

export function checkinWindow(startAt: number) {
  return {
    from: startAt - CHECKIN_BEFORE_MIN * 60_000,
    to: startAt + CHECKIN_AFTER_MIN * 60_000,
  };
}

export function inCheckinWindow(startAt: number, now: number) {
  const { from, to } = checkinWindow(startAt);
  return now >= from && now <= to;
}

/** Great-circle distance in metres. */
export function distanceM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function canGeoCheckIn(
  startAt: number,
  pin: { lat: number; lng: number },
  at: { lat: number; lng: number; accuracyM?: number },
  now: number,
): RuleResult {
  if (!inCheckinWindow(startAt, now)) return no("Outside the check-in window.");
  // A fix vaguer than the fence itself proves nothing — use the code instead.
  if (at.accuracyM !== undefined && at.accuracyM > GEOFENCE_M) {
    return no("GPS is too loose here. Use the session code.");
  }
  const d = distanceM(pin, at);
  if (d > GEOFENCE_M) return no(`You’re ${Math.round(d)} m out. Get inside 150 m.`);
  return ok;
}

export function canUseCode(
  session: { code: string; codeRevealedAt: number | null; startAt: number },
  entered: string,
  now: number,
): RuleResult {
  if (!inCheckinWindow(session.startAt, now)) return no("Outside the check-in window.");
  if (!session.codeRevealedAt) return no("The code hasn’t been revealed yet.");
  if (now - session.codeRevealedAt > CODE_TTL_MS) return no("Code expired. Ask for a new one.");
  if (entered.trim() !== session.code) return no("Code doesn’t match.");
  return ok;
}

// ── Settlement ───────────────────────────────────────────────────────────────

export type Settlement =
  | { status: "completed" }
  /** `absent` pays the fee and takes the strike; `present` gets the credit. */
  | { status: "no_show" | "host_no_show"; absent: "joiner" | "poster"; feeCents: number; creditCents: number }
  | { status: "void" }
  | null;

/**
 * Where a confirmed booking lands. Dual check-in completes immediately and costs
 * nothing; anything else waits for the window to close so a late arrival counts.
 * When neither side came, nobody was stood up — no fee, no strike.
 */
export function settle(
  booking: { hostCheckedIn: boolean; participantCheckedIn: boolean },
  startAt: number,
  now: number,
): Settlement {
  const { hostCheckedIn, participantCheckedIn } = booking;
  if (hostCheckedIn && participantCheckedIn) return { status: "completed" };
  if (now <= checkinWindow(startAt).to) return null;
  if (!hostCheckedIn && !participantCheckedIn) return { status: "void" };
  return {
    status: hostCheckedIn ? "no_show" : "host_no_show",
    absent: hostCheckedIn ? "joiner" : "poster",
    feeCents: NO_SHOW_FEE_CENTS,
    creditCents: SHOW_UP_CREDIT_CENTS,
  };
}

/** When a fee may actually be charged: 24h after the session, to allow a dispute. */
export const feeChargeableAt = (startAt: number, durationMin: number) =>
  startAt + durationMin * 60_000 + DISPUTE_HOLD_MS;

export function chatOpen(
  booking: { status: string },
  session: { startAt: number; durationMin: number },
  now: number,
): boolean {
  if (booking.status === "declined" || booking.status === "cancelled") return false;
  return now <= session.startAt + session.durationMin * 60_000 + CHAT_TTL_MS;
}

export function pct(yes: number, total: number): number {
  return total === 0 ? 100 : Math.round((yes / total) * 100);
}

// ── Standing slots ───────────────────────────────────────────────────────────

const wall = new Intl.DateTimeFormat("en-US", {
  timeZone: CLUSTER_TZ,
  hourCycle: "h23",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * "Same time next week": seven days on, at the same wall-clock time in the
 * cluster — so a 6:00 am slot stays 6:00 am across a daylight-saving change.
 */
export function nextOccurrence(startAt: number): number {
  const target = wall.format(new Date(startAt));
  const week = startAt + 7 * 24 * 60 * 60_000;
  for (const shift of [0, 60, -60]) {
    const candidate = week + shift * 60_000;
    if (wall.format(new Date(candidate)) === target) return candidate;
  }
  return week;
}

// ── Training blocks ──────────────────────────────────────────────────────────

export const BLOCK_MIN_WEEKS = 4;
export const BLOCK_MAX_WEEKS = 20;
export const BLOCK_MAX_SLOTS = 4;
/** Kept out of planned, to have finished a block. A guess under test. */
export const BLOCK_FINISH_PCT = 75;
/** A slot added to a block commits its other members, so they get time to skip it free. */
export const NEW_SLOT_LEAD_MS = 48 * 60 * 60_000;

const day = new Intl.DateTimeFormat("en-CA", {
  timeZone: CLUSTER_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The calendar date in the cluster, as `YYYY-MM-DD`. */
export const clusterDate = (at: number): string => day.format(new Date(at));

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60_000;
const dayNumber = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);

/** Whole days from one calendar date to another. */
export const daysBetween = (from: string, to: string) => dayNumber(to) - dayNumber(from);

/** Which activities a goal makes sense for. Absent = any. */
const GOAL_ACTIVITIES: Partial<Record<GoalKind, Activity[]>> = {
  race_5k: ["run", "walk"],
  race_10k: ["run", "walk"],
  race_half: ["run", "walk"],
  race_marathon: ["run", "walk"],
  ride_century: ["ride"],
  hike_trip: ["hike"],
};

const GOAL_NAMES: Record<GoalKind, string> = {
  race_5k: "5k",
  race_10k: "10k",
  race_half: "Half marathon",
  race_marathon: "Marathon",
  ride_century: "Century ride",
  hike_trip: "Hiking trip",
  event_other: "Event",
  consistency: "Consistency",
};

export type BlockInput = {
  activity: Activity;
  goalKind: GoalKind;
  eventName: string | null | undefined;
  startsOn: string;
  goalDate: string;
};

export function validBlock(input: BlockInput): RuleResult {
  if (!DATE.test(input.goalDate) || Number.isNaN(dayNumber(input.goalDate))) {
    return no("Pick the goal date.");
  }
  const fits = GOAL_ACTIVITIES[input.goalKind];
  if (fits && !fits.includes(input.activity)) return no("That goal doesn’t go with this activity.");
  const name = input.eventName?.trim() ?? "";
  const words = cleanText(name);
  if (!words.ok) return words;
  if (input.goalKind === "consistency" && name) return no("A consistency goal doesn’t take an event name.");
  if (input.goalKind === "event_other" && !name) return no("Name the event.");
  if (name.length > 60) return no("Keep the event name short.");
  const days = daysBetween(input.startsOn, input.goalDate);
  if (days < BLOCK_MIN_WEEKS * 7) return no("A training block runs at least 4 weeks.");
  if (days > BLOCK_MAX_WEEKS * 7) return no("A training block runs at most 20 weeks.");
  return ok;
}

export const blockWeeks = (startsOn: string, goalDate: string) =>
  Math.ceil(daysBetween(startsOn, goalDate) / 7);

/** "Week 6 of 16": 1-based, and it stays on the last week once the date has passed. */
export function blockWeek(startsOn: string, goalDate: string, today: string): number {
  const week = Math.floor(daysBetween(startsOn, today) / 7) + 1;
  return Math.min(Math.max(week, 1), blockWeeks(startsOn, goalDate));
}

/** "Dallas Marathon", "Marathon", or "3× a week for 12 weeks". */
export function goalLabel(
  goalKind: GoalKind,
  eventName: string | null,
  slotsPerWeek: number,
  weeks: number,
): string {
  if (goalKind === "consistency") return `${slotsPerWeek}× a week for ${weeks} weeks`;
  return eventName?.trim() || GOAL_NAMES[goalKind];
}

/** One occurrence of a block's slots, from one member's side. */
export type Occurrence = {
  startAt: number;
  /** I checked in, by fence or code. */
  checkedIn: boolean;
  /** Someone called the session off… */
  calledOff: boolean;
  /** …and it was me. */
  calledOffByMe: boolean;
  /** I posted it and nobody else held a seat: there was no one to show up for. */
  stoodAlone: boolean;
  /** The session's stated distance, 0 when the activity has none. */
  miles: number;
};

/**
 * Sessions kept out of sessions planned — all of it from check-ins the server
 * already verifies. A week someone else called off isn't held against me; one I
 * called off, or skipped with notice, is planned and not kept. `keptMiles` is the
 * stated distance of the sessions I checked in to — planned, never measured.
 */
export function plannedAndKept(
  occurrences: Occurrence[],
  now: number,
): { planned: number; kept: number; keptMiles: number } {
  let planned = 0;
  let kept = 0;
  let keptMiles = 0;
  for (const o of occurrences) {
    if (o.checkedIn) {
      planned += 1;
      kept += 1;
      keptMiles += o.miles;
      continue;
    }
    if (o.calledOff ? !o.calledOffByMe : o.stoodAlone) continue;
    // Still open for check-in: not a miss yet.
    if (!o.calledOff && now <= checkinWindow(o.startAt).to) continue;
    planned += 1;
  }
  return { planned, kept, keptMiles: Math.round(keptMiles * 10) / 10 };
}

export const blockFinished = (p: { planned: number; kept: number }) =>
  p.planned > 0 && p.kept * 100 >= p.planned * BLOCK_FINISH_PCT;

/** Too late to join once fewer than four weeks remain — the shortest a block can be. */
export const BLOCK_JOIN_MIN_DAYS = BLOCK_MIN_WEEKS * 7;
/** A posted block nobody has joined by now is called off. */
export const FORMING_GRACE_DAYS = 14;
/** A posted block's first sessions start inside this many days. */
export const BLOCK_FIRST_WEEK_DAYS = 14;

export type BlockFacts = {
  status: "forming" | "active" | "closing" | "ended";
  visibility: Visibility;
  womenOnly: boolean;
  capacity: number;
  goalDate: string;
};

/** A block still takes new regulars: running, a seat open, four weeks or more to go. */
export const blockJoinable = (block: BlockFacts, members: number, today: string) =>
  (block.status === "forming" || block.status === "active") &&
  members < block.capacity &&
  daysBetween(today, block.goalDate) >= BLOCK_JOIN_MIN_DAYS;

/** Joining a block is joining every slot in it, as a regular. */
export function canJoinBlock(
  block: BlockFacts,
  me: { gender: Gender; frozenUntil: number | null },
  facts: { members: number; isMember: boolean },
  now: number,
): RuleResult {
  if (facts.isMember) return no("You’re already in.");
  if (block.status !== "forming" && block.status !== "active") {
    return no("This training block has finished.");
  }
  if (daysBetween(clusterDate(now), block.goalDate) < BLOCK_JOIN_MIN_DAYS) {
    return no("Fewer than four weeks are left — too late to join this one.");
  }
  if (block.womenOnly && me.gender !== "woman") return no("This training block is women-only.");
  if (frozen(me.frozenUntil, block.visibility, now)) {
    return no("Public sessions are paused for 14 days after two no-shows.");
  }
  if (facts.members >= block.capacity) return no("It’s full.");
  return ok;
}

// ── The end of a block ───────────────────────────────────────────────────────

/** Finishers may credit their buddies for this many days after the goal date. */
export const CREDIT_WINDOW_DAYS = 7;
/** A buddy is creditable after this many sessions where both checked in. */
export const CREDIT_MIN_SHARED = 3;
/** Members have this long to keep a finished block's slots; after that they end. */
export const KEEP_SLOTS_DAYS = 14;

/**
 * "Helped me stick to it?" — from someone who finished, while the block is
 * closing. A count on a profile can only go up, so there is never a reason to
 * avoid a buddy who might not make it.
 */
export function canGiveCredits(
  block: { status: BlockFacts["status"]; goalDate: string },
  giver: { finished: boolean | null; answered: boolean },
  today: string,
): RuleResult {
  if (block.status !== "closing" || daysBetween(block.goalDate, today) > CREDIT_WINDOW_DAYS) {
    return no("The week for this has passed.");
  }
  if (!giver.finished) return no("This is for members who finished the block.");
  if (giver.answered) return no("You’ve already answered.");
  return ok;
}

/** Who was there: everyone with enough sessions where both of us checked in. */
export function creditable(
  me: string,
  sessions: { checkedIn: string[] }[],
  min = CREDIT_MIN_SHARED,
): string[] {
  const shared = new Map<string, number>();
  for (const s of sessions) {
    if (!s.checkedIn.includes(me)) continue;
    for (const other of new Set(s.checkedIn)) {
      if (other !== me) shared.set(other, (shared.get(other) ?? 0) + 1);
    }
  }
  return [...shared].filter(([, n]) => n >= min).map(([id]) => id).sort();
}

/** A finished block's slots can still be kept, or carried into the next block. */
export const slotsUndecided = (goalDate: string, today: string) =>
  today > goalDate && daysBetween(goalDate, today) <= KEEP_SLOTS_DAYS;

// ── Verification ─────────────────────────────────────────────────────────────

export type VerificationTier = "member" | "government_id";

export type Verified = {
  /** Phone number and selfie liveness. */
  member: boolean;
  governmentId: boolean;
  /** A report about this member was acted on: ID before any more public sessions. */
  idRequired: boolean;
};

/**
 * What a member still has to verify before posting or joining this — or `null`.
 * Public sessions take a verified phone and face. Women-only takes a government
 * ID: it makes a member accountable, it is not a test of who is a woman — that
 * stays what the member says it is. An invite from someone you know takes
 * nothing, the same way a two-strike freeze doesn't reach it.
 */
export function verificationNeeded(
  v: Verified,
  what: { visibility: Visibility; womenOnly: boolean },
  enforced: boolean,
): VerificationTier | null {
  if (!enforced) return null;
  if (what.visibility === "public" && !v.member) return "member";
  if ((what.womenOnly || (what.visibility === "public" && v.idRequired)) && !v.governmentId) {
    return "government_id";
  }
  return null;
}

export const VERIFY_COPY: Record<VerificationTier, string> = {
  member: "Verify your phone and face first. It takes about a minute, once.",
  government_id: "This takes a government ID check first. It takes a couple of minutes, once.",
};
