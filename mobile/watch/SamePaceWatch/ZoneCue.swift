import Foundation

/** Deterministic, offline cue. No zone, stale sensor, or paused session means silence. */
struct ZoneCue {
  enum Direction: String { case below, above }
  private var candidate: Direction?
  private var since: Date?
  private var lastCue: Date?
  mutating func evaluate(zoneIndex: Int?, targetIndex: Int?, sampleAt: Date?, now: Date, running: Bool) -> Direction? {
    guard running, let zoneIndex, let targetIndex, let sampleAt,
          now.timeIntervalSince(sampleAt) >= 0, now.timeIntervalSince(sampleAt) <= 15 else {
      candidate = nil; since = nil; return nil
    }
    let direction: Direction? = zoneIndex < targetIndex ? .below : zoneIndex > targetIndex ? .above : nil
    guard let direction else { candidate = nil; since = nil; return nil }
    if candidate != direction { candidate = direction; since = now; return nil }
    guard let since, now.timeIntervalSince(since) >= 10,
          lastCue.map({ now.timeIntervalSince($0) >= 30 }) ?? true else { return nil }
    lastCue = now
    return direction
  }
}
