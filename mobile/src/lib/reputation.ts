import type { Person } from "./types";

/**
 * A track record in one line: what the server counted, nothing anyone wrote.
 * Blocks finished and people helped only appear once there's something to show —
 * they are counts, never a rate, so a zero is not a mark against anyone.
 */
export function reputationLine(p: Person): string {
  if (p.completedCount === 0) return "New on SamePace · no sessions yet";
  const parts = [
    `${p.completedCount} session${p.completedCount === 1 ? "" : "s"}`,
    `${p.onTimePct}% on time`,
    `${p.wouldJoinPct}% would join again`,
  ];
  if (p.blocksFinished > 0) {
    parts.push(`${p.blocksFinished} goal${p.blocksFinished === 1 ? "" : "s"} finished`);
  }
  if (p.helpedCount > 0) parts.push(`helped ${p.helpedCount} reach a goal`);
  return parts.join(" · ");
}
