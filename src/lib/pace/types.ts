/**
 * SamePace domain types (PRD v0.3). The API's own vocabulary — deliberately not
 * shared with the web prototype's `src/lib/types.ts`, which still models the
 * retired per-seat-payment product.
 */
export type Activity = "run" | "walk" | "hike" | "ride" | "strength" | "mobility";
export type Gender = "woman" | "man" | "nonbinary" | null;
export type VenueType = "trail" | "park" | "gym" | "track" | "road_start";
export type Visibility = "public" | "unlisted";
export type JoinMode = "instant" | "approve";
export type CheckinMethod = "geo" | "code";
export type Accent = "move" | "exercise" | "stand" | "fg";

export type Experience = "new" | "regular" | "advanced";
export type Difficulty = "easy" | "moderate" | "hard";
export type Effort = "easy" | "brisk";

/**
 * What the poster states about the workout — a number or a plain word, never a
 * description of a body, never rated by other members.
 */
export type Ability =
  | { kind: "run"; paceMinSec: number; paceMaxSec: number; miles: number }
  | { kind: "ride"; mphMin: number; mphMax: number; miles: number; surface: "road" | "gravel" }
  | { kind: "gym"; experience: Experience; focus: string }
  | { kind: "hike"; miles: number; gainFt: number; difficulty: Difficulty }
  | { kind: "walk"; effort: Effort; miles: number }
  | { kind: "open" };

/** Which ability shape each activity takes. */
export const ABILITY_KIND: Record<Activity, Ability["kind"]> = {
  run: "run",
  ride: "ride",
  strength: "gym",
  hike: "hike",
  walk: "walk",
  mobility: "open",
};

/** A member's own level per activity, set once in their profile. */
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
  /** Cancelled inside 12h: $5 fee unless a substitute covers the seat. */
  | "late_cancel"
  /** A late cancel whose seat a substitute took — costs nothing. */
  | "covered"
  | "completed"
  /** The joiner never checked in. */
  | "no_show"
  /** The poster never checked in. */
  | "host_no_show"
  /** Nobody checked in. */
  | "void";

/** What a training block is aimed at. A short fixed list — never free text. */
export const GOAL_KINDS = [
  "race_5k",
  "race_10k",
  "race_half",
  "race_marathon",
  "ride_century",
  "hike_trip",
  "event_other",
  "consistency",
] as const;
export type GoalKind = (typeof GOAL_KINDS)[number];
export type TrainingBlockStatus = "forming" | "active" | "closing" | "ended";

export type Person = {
  id: string;
  name: string;
  handle: string;
  initials: string;
  neighborhood: string;
  memberSince: string;
  accent: Accent;
  identityVerified: boolean;
  completedCount: number;
  onTimePct: number;
  wouldJoinPct: number;
  /** Training blocks finished: kept 75% of the sessions they had. */
  blocksFinished: number;
  /** Distinct members who said this person helped them stick to a block. */
  helpedCount: number;
  abilities: MemberAbilities;
};

export type Venue = {
  id: string;
  name: string;
  type: VenueType;
  neighborhood: string;
  lat: number;
  lng: number;
  image: string;
  hint: string;
};

export type ChatMessage = {
  id: string;
  bookingId: string;
  fromId: string;
  text: string;
  createdAt: string;
};

export const CHECKIN_BEFORE_MIN = 20;
export const CHECKIN_AFTER_MIN = 25;
export const GEOFENCE_M = 150;
export const CLUSTER_TZ = "America/Chicago";
