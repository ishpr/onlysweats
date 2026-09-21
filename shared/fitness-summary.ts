/** A subtotal of explicit member-entered values, never inferred from a plan. */
export type FitnessActivityMetric = {
  /** Null when no completed set supplies this value; a recorded zero remains zero. */
  value: number | null;
  /** Coverage out of completedSets. Other sets have not supplied this metric. */
  contributingSets: number;
};

export type FitnessActivityTotals = {
  completedSets: number;
  recordedReps: FitnessActivityMetric;
  recordedDurationSeconds: FitnessActivityMetric;
  /** Reps × explicitly recorded external load in kg. Excludes bodyweight and unknown load/reps. */
  knownExternalVolumeKg: FitnessActivityMetric;
};

export type FitnessActivityDay = FitnessActivityTotals & {
  /** Calendar date in timeZone, oldest first. */
  date: string;
  /** Exact local calendar-day boundaries, which need not be 24 hours apart. */
  startAt: string;
  endAt: string;
};

/** Private manual records only. HealthKit observations are deliberately separate. */
export type FitnessActivitySummary = {
  timeZone: string;
  /** Server time: records after this instant are excluded. */
  asOf: string;
  startAt: string;
  /** Next local midnight. asOf caps the current day's recorded activity. */
  endAt: string;
  daysWithActivity: number;
  totals: FitnessActivityTotals;
  /** Exactly seven local calendar days, attributed by each log/workout's start time. */
  days: FitnessActivityDay[];
};
