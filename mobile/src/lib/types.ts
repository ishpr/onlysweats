/** Wire types for the SamePace API (PRD v0.3) — mirrors `docs/API.md` in the repo root. */
export type Activity = "run" | "walk" | "hike" | "ride" | "strength" | "mobility";
export type Gender = "woman" | "man" | "nonbinary" | null;
export type Experience = "new" | "regular" | "advanced";
export type Difficulty = "easy" | "moderate" | "hard";
export type Effort = "easy" | "brisk";

/** What the poster states about the workout — never about a body. */
export type Ability =
  | { kind: "run"; paceMinSec: number; paceMaxSec: number; miles: number }
  | { kind: "ride"; mphMin: number; mphMax: number; miles: number; surface: "road" | "gravel" }
  | { kind: "gym"; experience: Experience; focus: string }
  | { kind: "hike"; miles: number; gainFt: number; difficulty: Difficulty }
  | { kind: "walk"; effort: Effort; miles: number }
  | { kind: "open" };

/** My own level per activity, set once in my profile. */
export type MemberAbilities = {
  run?: { paceMinSec: number; paceMaxSec: number };
  ride?: { mphMin: number; mphMax: number };
  strength?: { experience: Experience };
  hike?: { difficulty: Difficulty };
  walk?: { effort: Effort };
};

export type BookingStatus =
  | "pending"
  | "confirmed"
  | "declined"
  | "cancelled"
  | "late_cancel"
  | "covered"
  | "completed"
  | "no_show"
  | "host_no_show"
  | "void";

export type Person = {
  id: string;
  name: string;
  handle: string;
  initials: string;
  neighborhood: string;
  memberSince: string;
  accent: "move" | "exercise" | "stand" | "fg";
  identityVerified: boolean;
  completedCount: number;
  onTimePct: number;
  wouldJoinPct: number;
  abilities: MemberAbilities;
};

export type Me = Person & {
  gender: Gender;
  creditCents: number;
  feesCents: number;
  strikes: number;
  frozenUntil: string | null;
  freeSessionsLeft: number;
  /** Set when SamePace has paused the account. Only the profile still loads. */
  suspended: { reason: string } | null;
  isAdmin: boolean;
};

export type ReportReason =
  "date_framing" | "harassment" | "unsafe" | "misrepresented" | "fake_or_spam" | "other";

export type ReportInput = {
  reportedId: string;
  reason: ReportReason;
  detail?: string;
  sessionId?: string;
  bookingId?: string;
  alsoBlock?: boolean;
};

export type Venue = {
  id: string;
  name: string;
  type: "trail" | "park" | "gym" | "track" | "road_start";
  neighborhood: string;
  lat: number;
  lng: number;
  image: string;
};

export type Session = {
  id: string;
  hostId: string;
  venueId: string;
  activity: Activity;
  title: string;
  detail: string;
  ability: Ability;
  abilityLabel: string;
  abilityFlex: "strict" | "flexible";
  /** Inside my range? `null` until I set my level for this activity. */
  fitsMe: boolean | null;
  routeUrl: string | null;
  startAt: string;
  durationMin: number;
  capacity: number;
  visibility: "public" | "unlisted";
  joinMode: "instant" | "approve";
  womenOnly: boolean;
  status: "open" | "cancelled" | "completed";
  /** Poster only. */
  code: string | null;
  codeRevealedAt: string | null;
  /** Poster only. */
  inviteCode?: string;
  seatsLeft: number;
  /** Exact meeting spot — poster and confirmed joiners only. */
  pinHint: string | null;
  seriesId: string | null;
  /** An open seat on someone else's standing slot — this occurrence only. */
  substituteSeat: boolean;
};

export type Booking = {
  id: string;
  sessionId: string;
  participantId: string;
  hostId: string;
  status: BookingStatus;
  substituteFor: string | null;
  createdAt: string;
  hostCheckedInAt: string | null;
  participantCheckedInAt: string | null;
  checkinMethod: "geo" | "code" | null;
  ratedByMe: boolean;
  chatOpen: boolean;
  /** A fee assessed to me on this booking, still standing. */
  myFeeCents: number;
  seriesId: string | null;
};

export type Series = {
  id: string;
  streak: number;
  memberIds: string[];
  title: string;
  activity: Activity;
  abilityLabel: string;
  venueId: string;
  nextSessionId: string | null;
  nextStartAt: string | null;
};

export type ChatMessage = {
  id: string;
  bookingId: string;
  fromId: string;
  text: string;
  createdAt: string;
};

export type PostSessionInput = Pick<
  Session,
  | "venueId"
  | "activity"
  | "title"
  | "detail"
  | "ability"
  | "abilityFlex"
  | "startAt"
  | "durationMin"
  | "capacity"
  | "visibility"
  | "joinMode"
  | "womenOnly"
>;

export type RatingInput = {
  showedUp: boolean;
  onTime: boolean;
  matchedListing: boolean;
  respectful: boolean;
  wouldJoinAgain: boolean;
};

export const ACTIVITIES: Record<Activity, { label: string }> = {
  run: { label: "Run" },
  ride: { label: "Ride" },
  strength: { label: "Gym" },
  hike: { label: "Hike" },
  walk: { label: "Walk" },
  mobility: { label: "Mobility" },
};

export const CHECKIN_BEFORE_MIN = 20;
export const CHECKIN_AFTER_MIN = 25;
export const GEOFENCE_M = 150;
