/**
 * The choices offered when stating a level. Ranges, not single numbers: a buddy
 * "around 9:45" is a range in practice, and ranges are what get matched.
 */
import type { Ability, Activity, Difficulty, Effort, Experience, MemberAbilities } from "./types";

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

export const PACE_BANDS: [number, number][] = [
  [420, 450],
  [450, 480],
  [480, 510],
  [510, 540],
  [540, 570],
  [570, 600],
  [600, 660],
  [660, 720],
  [720, 780],
];
export const paceLabel = ([lo, hi]: [number, number]) => `${mmss(lo)}–${mmss(hi)}`;

export const SPEED_BANDS: [number, number][] = [
  [12, 14],
  [14, 16],
  [16, 18],
  [18, 20],
  [20, 23],
];
export const speedLabel = ([lo, hi]: [number, number]) => `${lo}–${hi} mph`;

export const RUN_MILES = [3, 4, 5, 6, 8, 10, 13];
export const RIDE_MILES = [15, 25, 40, 60];
export const HIKE_MILES = [3, 5, 6, 8, 10];
export const HIKE_GAIN = [300, 600, 1200, 2000, 3000];
export const WALK_MILES = [2, 3, 4, 5];
export const GYM_FOCUS = ["Full body", "Upper body", "Lower body", "Push", "Pull", "Cardio"];
export const EXPERIENCE: Experience[] = ["new", "regular", "advanced"];
export const DIFFICULTY: Difficulty[] = ["easy", "moderate", "hard"];
export const EFFORT: Effort[] = ["easy", "brisk"];

export const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** The preset band nearest the middle of a range, so a picker always has a selection. */
function snap(bands: [number, number][], lo: number, hi: number): [number, number] {
  const mid = (lo + hi) / 2;
  return bands.reduce((best, b) =>
    Math.abs((b[0] + b[1]) / 2 - mid) < Math.abs((best[0] + best[1]) / 2 - mid) ? b : best,
  );
}

/** A starting level for a new post — my own level when I've set one. */
export function defaultAbility(activity: Activity, mine: MemberAbilities = {}): Ability {
  switch (activity) {
    case "run": {
      const [paceMinSec, paceMaxSec] = snap(
        PACE_BANDS,
        mine.run?.paceMinSec ?? 570,
        mine.run?.paceMaxSec ?? 600,
      );
      return { kind: "run", paceMinSec, paceMaxSec, miles: 5 };
    }
    case "ride": {
      const [mphMin, mphMax] = snap(SPEED_BANDS, mine.ride?.mphMin ?? 14, mine.ride?.mphMax ?? 16);
      return { kind: "ride", mphMin, mphMax, miles: 25, surface: "road" };
    }
    case "strength":
      return {
        kind: "gym",
        experience: mine.strength?.experience ?? "regular",
        focus: "Full body",
      };
    case "hike":
      return {
        kind: "hike",
        miles: 5,
        gainFt: 600,
        difficulty: mine.hike?.difficulty ?? "moderate",
      };
    case "walk":
      return { kind: "walk", effort: mine.walk?.effort ?? "brisk", miles: 3 };
    case "mobility":
      return { kind: "open" };
  }
}

/** My level for one activity, in words — or null when I haven't said. */
export function myLevelLabel(activity: Activity, mine: MemberAbilities): string | null {
  switch (activity) {
    case "run":
      return mine.run ? `${paceLabel([mine.run.paceMinSec, mine.run.paceMaxSec])} /mi` : null;
    case "ride":
      return mine.ride ? speedLabel([mine.ride.mphMin, mine.ride.mphMax]) : null;
    case "strength":
      return mine.strength ? cap(mine.strength.experience) : null;
    case "hike":
      return mine.hike ? `Up to ${mine.hike.difficulty}` : null;
    case "walk":
      return mine.walk ? cap(mine.walk.effort) : null;
    case "mobility":
      return "Open to all";
  }
}

const mmssLabel = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

/** A session's level in words — the same wording the server puts on a listing. */
export function abilityLabel(a: Ability): string {
  switch (a.kind) {
    case "run":
      return `${mmssLabel(a.paceMinSec)}–${mmssLabel(a.paceMaxSec)} /mi · ${a.miles} mi`;
    case "ride":
      return `${a.mphMin}–${a.mphMax} mph · ${a.miles} mi · ${a.surface}`;
    case "gym":
      return a.focus.trim() ? `${cap(a.experience)} · ${a.focus.trim()}` : cap(a.experience);
    case "hike":
      return `${a.miles} mi · ${a.gainFt.toLocaleString("en-US")} ft · ${a.difficulty}`;
    case "walk":
      return `${cap(a.effort)} · ${a.miles} mi`;
    case "open":
      return "Open to all";
  }
}
