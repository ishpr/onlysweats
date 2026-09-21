import Foundation

@main struct ZoneCueChecks {
  static func main() {
    let t = Date(timeIntervalSince1970: 1_700_000_000)
    var cue = ZoneCue()
    precondition(cue.evaluate(zoneIndex: 0, targetIndex: 1, sampleAt: t, now: t, running: true) == nil)
    precondition(cue.evaluate(zoneIndex: 0, targetIndex: 1, sampleAt: t, now: t.addingTimeInterval(10), running: true) == .below)
    precondition(cue.evaluate(zoneIndex: 0, targetIndex: 1, sampleAt: t, now: t.addingTimeInterval(11), running: true) == nil)
    // Pauses, missing readings, stale samples, and a disabled target reset the dwell.
    precondition(cue.evaluate(zoneIndex: 0, targetIndex: 1, sampleAt: t, now: t.addingTimeInterval(20), running: true) == nil)
    precondition(cue.evaluate(zoneIndex: 2, targetIndex: 1, sampleAt: t.addingTimeInterval(40), now: t.addingTimeInterval(40), running: false) == nil)
    precondition(cue.evaluate(zoneIndex: 2, targetIndex: nil, sampleAt: t.addingTimeInterval(40), now: t.addingTimeInterval(40), running: true) == nil)
    precondition(cue.evaluate(zoneIndex: 2, targetIndex: 1, sampleAt: t.addingTimeInterval(41), now: t.addingTimeInterval(40), running: true) == nil)
    precondition(cue.evaluate(zoneIndex: 2, targetIndex: 1, sampleAt: t.addingTimeInterval(40), now: t.addingTimeInterval(40), running: true) == nil)
    precondition(cue.evaluate(zoneIndex: 2, targetIndex: 1, sampleAt: t.addingTimeInterval(50), now: t.addingTimeInterval(50), running: true) == .above)
    precondition(cue.evaluate(zoneIndex: 1, targetIndex: 1, sampleAt: t.addingTimeInterval(80), now: t.addingTimeInterval(80), running: true) == nil)
    print("Offline Watch cue checks passed: dwell, cooldown, pause, missing/stale/future readings and disabled target.")
  }
}
