export type Activity =
  | "run"
  | "walk"
  | "hike"
  | "ride"
  | "strength"
  | "mobility";

export type VenueType = "trail" | "park" | "gym_lobby";
export type Visibility = "public" | "unlisted";
export type JoinMode = "instant" | "approve";
export type SessionStatus =
  | "open"
  | "full"
  | "live"
  | "completed"
  | "cancelled";
export type CheckinMethod = "geo" | "code";
export type Accent = "move" | "exercise" | "stand" | "fg";

export type Person = {
  id: string;
  name: string;
  handle: string;
  initials: string;
  neighborhood: string;
  memberSince: string;
  isLead: boolean;
  bio: string;
  accent: Accent;
  identityVerified: boolean;
  completedCount: number;
  onTimePct: number;
  wouldJoinPct: number;
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

export type Session = {
  id: string;
  hostId: string;
  venueId: string;
  activity: Activity;
  title: string;
  detail: string;
  startAt: string;
  durationMin: number;
  capacity: number;
  priceCents: number;
  visibility: Visibility;
  joinMode: JoinMode;
  womenOnly: boolean;
  hostAttestsPaidOk: boolean;
  status: SessionStatus;
  code: string;
  codeRevealedAt: string | null;
  seedSlot?: string;
};

export type BookingStatus =
  | "pending"
  | "confirmed"
  | "declined"
  | "cancelled"
  | "completed"
  | "no_show"
  | "host_no_show";

export type Booking = {
  id: string;
  sessionId: string;
  participantId: string;
  status: BookingStatus;
  authorizedCents: number;
  capturedCents: number;
  createdAt: string;
  hostCheckedInAt: string | null;
  participantCheckedInAt: string | null;
  checkinMethod: CheckinMethod | null;
  ratedByParticipant: boolean;
  ratedByHost: boolean;
};

export type ChatMessage = {
  id: string;
  bookingId: string;
  fromId: string;
  text: string;
  createdAt: string;
};

export type Rating = {
  id: string;
  bookingId: string;
  fromId: string;
  toId: string;
  showedUp: boolean;
  onTime: boolean;
  matchedListing: boolean;
  respectful: boolean;
  wouldJoinAgain: boolean;
};

export type HealthWorkout = {
  id: string;
  source: "fitness" | "pace";
  activity: Activity;
  title: string;
  at: string;
  minutes: number;
  kcal: number;
  avgHr?: number;
  distanceKm?: number;
};

export type HealthSnapshot = {
  connected: boolean;
  moveKcal: number;
  moveGoal: number;
  exerciseMin: number;
  exerciseGoal: number;
  standHours: number;
  standGoal: number;
  sleepMin: number;
  hrvMs: number;
  rhr: number;
  vo2: number;
  recoveryPct: number;
  moveWeek: number[];
  workouts: HealthWorkout[];
};

export type PacePrefs = {
  womenOnlySearch: boolean;
  shareHealth: boolean;
};

export const ACTIVITIES: Record<
  Activity,
  { label: string; ring: Accent; verb: string }
> = {
  run: { label: "Run", ring: "exercise", verb: "Run" },
  walk: { label: "Walk", ring: "stand", verb: "Walk" },
  hike: { label: "Hike", ring: "move", verb: "Hike" },
  ride: { label: "Ride", ring: "stand", verb: "Ride" },
  strength: { label: "Strength", ring: "move", verb: "Lift" },
  mobility: { label: "Mobility", ring: "fg", verb: "Move" },
};

export const ME_ID = "me";
export const TAKE_RATE = 0.18;
export const REPEAT_TAKE = 0.1;
export const CHECKIN_BEFORE_MIN = 20;
export const CHECKIN_AFTER_MIN = 25;
export const GEOFENCE_M = 150;
