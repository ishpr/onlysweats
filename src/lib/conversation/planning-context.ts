/** Format member-entered pace in code before exposing it to a language model. */
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const pace = (seconds: unknown): string | null =>
  typeof seconds === "number" && Number.isSafeInteger(seconds) && seconds > 0
    ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
    : null;
function ability(value: unknown): unknown {
  if (!record(value) || value.kind !== "run") return value;
  const { paceMinSec, paceMaxSec, ...rest } = value;
  const minimum = pace(paceMinSec),
    maximum = pace(paceMaxSec);
  return {
    ...rest,
    pace: minimum !== null && maximum !== null ? `${minimum}–${maximum} min/mile` : null,
  };
}
/** Preserve all other authorized facts; this never reads or expands source data. */
export function formattedPlanningContext(value: unknown): unknown {
  if (!record(value)) return value;
  return {
    ...value,
    ...(record(value.preferences)
      ? { preferences: { ...value.preferences, ability: ability(value.preferences.ability) } }
      : {}),
    ...(Array.isArray(value.sessions)
      ? {
          sessions: value.sessions.map((session) =>
            record(session) ? { ...session, ability: ability(session.ability) } : session,
          ),
        }
      : {}),
  };
}
