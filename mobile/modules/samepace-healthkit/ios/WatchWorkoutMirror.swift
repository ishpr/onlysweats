import Foundation
import HealthKit

/** Paired-device HealthKit channel only. No network, cloud upload, or durable readings. */
@available(iOS 17.0, *)
final class WatchWorkoutMirror: NSObject, HKWorkoutSessionDelegate {
  static let shared = WatchWorkoutMirror()
  static let changed = Notification.Name("SamePaceWatchWorkoutChanged")
  private let store = HKHealthStore()
  private var session: HKWorkoutSession?
  private(set) var snapshot: [String: Any]?
  private var visible = false
  func register() {
    store.workoutSessionMirroringStartHandler = { [weak self] session in
      DispatchQueue.main.async {
        self?.session = session
        session.delegate = self
        self?.snapshot = nil
      }
    }
  }
  func setVisible(_ value: Bool) {
    visible = value
    snapshot = nil
    NotificationCenter.default.post(name: Self.changed, object: nil)
  }
  func openWatch(activity: String, completion: @escaping (Result<Void, Error>) -> Void) {
    let configuration = HKWorkoutConfiguration()
    switch activity {
    case "run": configuration.activityType = .running
    case "walk": configuration.activityType = .walking
    case "ride": configuration.activityType = .cycling
    case "strength": configuration.activityType = .traditionalStrengthTraining
    default: completion(.failure(HealthImportError.invalidOptions)); return
    }
    configuration.locationType = activity == "strength" ? .indoor : .outdoor
    store.startWatchApp(with: configuration) { success, error in
      if success { completion(.success(())) }
      else { completion(.failure(error ?? HealthImportError.unavailable)) }
    }
  }
  func workoutSession(_ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState, from fromState: HKWorkoutSessionState, date: Date) {
    if toState == .ended || toState == .stopped { clear(workoutSession) }
  }
  func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) { clear(workoutSession) }
  func workoutSession(_ workoutSession: HKWorkoutSession, didDisconnectFromRemoteDeviceWithError error: Error?) { clear(workoutSession) }
  private func clear(_ incoming: HKWorkoutSession) {
    DispatchQueue.main.async {
      guard self.session === incoming else { return }
      self.snapshot = nil
      NotificationCenter.default.post(name: Self.changed, object: nil)
    }
  }
  func workoutSession(_ workoutSession: HKWorkoutSession, didReceiveDataFromRemoteWorkoutSession data: [Data]) {
    DispatchQueue.main.async {
      guard self.visible, self.session === workoutSession else { return }
      for payload in data where payload.count <= 4096 {
        guard var decoded = try? JSONSerialization.jsonObject(with: payload) as? [String: Any],
              let sessionId = decoded["sessionId"] as? String, UUID(uuidString: sessionId) != nil,
              let state = decoded["state"] as? String, ["running", "paused", "stopped", "ended"].contains(state),
              let activity = decoded["activity"] as? String, ["run", "walk", "ride", "strength", "other"].contains(activity),
              let startAt = decoded["startAt"] as? String, ISO8601DateFormatter().date(from: startAt) != nil,
              let elapsed = decoded["elapsedSeconds"] as? Double, elapsed.isFinite, elapsed >= 0, elapsed <= 7 * 86400 else { continue }
        guard ["heartRateBpm", "distanceMeters", "activeEnergyKilocalories", "zoneIndex"].allSatisfy({ key in
          decoded[key] is NSNull || (decoded[key] as? Double).map { $0.isFinite && $0 >= 0 } == true
        }) else { continue }
        decoded["receivedAt"] = ISO8601DateFormatter().string(from: Date())
        self.snapshot = state == "ended" || state == "stopped" ? nil : decoded
        NotificationCenter.default.post(name: Self.changed, object: nil)
      }
    }
  }
}
