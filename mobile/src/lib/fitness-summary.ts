/** Read on render so a foreground timezone change starts a separate summary query. */
export function fitnessTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** A calendar-day cache key, without assuming that a local day lasts 24 hours. */
export function fitnessCalendarDay(now: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

/** Server day keys already identify their calendar date; UTC prevents a second timezone shift. */
export function fitnessDayLabel(date: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(
    new Date(`${date}T12:00:00Z`),
  );
}

export function fitnessQuantity(value: number | null) {
  if (value === null) return "—";
  if (value > 0 && value < 0.01) return "<0.01";
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function fitnessRecordedTime(seconds: number | null) {
  if (seconds === null) return "—";
  const rounded = Math.round(seconds * 100) / 100;
  const minutes = Math.floor(rounded / 60);
  const remainder = Math.round((rounded % 60) * 100) / 100;
  if (minutes === 0) return `${fitnessQuantity(seconds)} sec`;
  return `${fitnessQuantity(minutes)} min${remainder > 0 ? ` ${fitnessQuantity(remainder)} sec` : ""}`;
}
