import type { HealthRecord } from "../../../../shared/health";
import type { FitnessExportPage, FitnessExportRecord } from "../../../../shared/fitness";
import type { ApiSession } from "../session-transport";

/** Never produce a partial export, or retain page data in a shared query cache. */
export async function collectExportPages<T>(options: {
  read: (cursor: string | null) => Promise<{ records: T[]; nextCursor: string | null }>;
  isCurrent: () => boolean;
  onProgress?: (count: number) => void;
}) {
  const records: T[] = [];
  const visited = new Set<string>();
  let cursor: string | null = null;
  let size = 0;
  do {
    if (!options.isCurrent()) throw new Error("Export cancelled because your session changed.");
    const page = await options.read(cursor);
    if (!options.isCurrent()) throw new Error("Export cancelled because your session changed.");
    size += JSON.stringify(page.records).length * 2;
    if (size > 100 * 1024 * 1024)
      throw new Error(
        "This export is too large to prepare on this device. No partial file was saved.",
      );
    records.push(...page.records);
    options.onProgress?.(records.length);
    cursor = page.nextCursor;
    if (cursor !== null) {
      if (visited.has(cursor)) throw new Error("The export could not finish. Please try again.");
      visited.add(cursor);
    }
  } while (cursor !== null);
  return records;
}

export async function prepareHealthExport(
  session: ApiSession,
  signal: AbortSignal,
  progress?: (count: number) => void,
) {
  const isCurrent = () => session.isCurrent() && !signal.aborted;
  const records = await collectExportPages<HealthRecord>({
    read: (cursor) =>
      session.request(
        `/health/export?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        { signal },
      ),
    isCurrent,
    onProgress: progress,
  });
  if (!isCurrent()) throw new Error("Export cancelled.");
  return JSON.stringify(
    { format: "samepace.apple-health.v1", exportedAt: new Date().toISOString(), records },
    null,
    2,
  );
}

export async function prepareFitnessExport(session: ApiSession, signal: AbortSignal) {
  let consent: FitnessExportPage["consent"] | null = null;
  let pilotConsent: FitnessExportPage["pilotConsent"] | null = null;
  const records = await collectExportPages<FitnessExportRecord>({
    read: async (cursor) => {
      const page = await session.request<FitnessExportPage>(
        `/fitness/export?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        { signal },
      );
      consent = page.consent;
      pilotConsent = page.pilotConsent;
      return page;
    },
    isCurrent: () => session.isCurrent() && !signal.aborted,
  });
  return JSON.stringify(
    {
      format: "samepace.fitness.v1",
      exportedAt: new Date().toISOString(),
      consent,
      pilotConsent,
      records,
    },
    null,
    2,
  );
}
