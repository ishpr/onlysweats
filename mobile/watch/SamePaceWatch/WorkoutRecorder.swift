import Foundation
import HealthKit
import WatchKit
import Combine

@MainActor
final class WorkoutRecorder: NSObject, ObservableObject {
  static let shared = WorkoutRecorder()
  @Published var state = "idle"
  @Published var heartRate: Double?
  @Published var heartRateAt: Date?
  @Published var distance: Double?
  @Published var energy: Double?
  @Published var elapsed: TimeInterval = 0
  @Published var zoneIndex: Int?
  @Published var zoneSource: String?
  @Published var cueText: String?
  @Published var errorText: String?
  @Published var saved = false
  @Published var mirrored = false
  @Published var targetZone = 0 // zero is deliberately off; 1...5 are source zones.
  private let store = HKHealthStore()
  private var session: HKWorkoutSession?
  private var builder: HKLiveWorkoutBuilder?
  private var timer: Timer?
  private var cue = ZoneCue()
  private var sessionId = UUID().uuidString
  private var activity = "other"
  private var startAt: Date?
  private var finishing = false
  private var collectionEnded = false

  func start(_ type: HKWorkoutActivityType) async {
    guard session == nil, state != "starting" else { return }
    state = "starting"; errorText = nil; saved = false
    heartRate = nil; heartRateAt = nil; distance = nil; energy = nil; elapsed = 0
    zoneIndex = nil; zoneSource = nil; cueText = nil
    do {
      guard HKHealthStore.isHealthDataAvailable() else { throw HealthImportErrorForWatch.unavailable }
      let read: Set<HKObjectType> = [.workoutType(), HKQuantityType(.heartRate), HKQuantityType(.activeEnergyBurned),
        HKQuantityType(.distanceWalkingRunning), HKQuantityType(.distanceCycling), HKQuantityType(.cyclingPower)]
      try await store.requestAuthorization(toShare: [.workoutType()], read: read)
      guard store.authorizationStatus(for: .workoutType()) == .sharingAuthorized else {
        throw NSError(domain: "SamePace", code: 1, userInfo: [NSLocalizedDescriptionKey: "Allow saving workouts in Health settings to record."])
      }
      let config = HKWorkoutConfiguration()
      config.activityType = type
      config.locationType = type == .traditionalStrengthTraining ? .indoor : .outdoor
      let session = try HKWorkoutSession(healthStore: store, configuration: config)
      attach(session)
      sessionId = UUID().uuidString; cue = ZoneCue(); collectionEnded = false
      activity = Self.activity(type)
      startAt = Date()
      // HealthKit owns the thresholds. Missing configuration stays unavailable.
#if compiler(>=6.4) && !SAMEPACE_HEALTH_LEGACY_SDK
      if #available(watchOS 27.0, *), let builder {
        if let configuration = try? await builder.zoneConfiguration(for: HKQuantityType(.heartRate)) {
          zoneSource = Self.source(configuration.source)
        }
      }
#endif
      session.startActivity(with: startAt)
      try await builder!.beginCollection(at: startAt!)
      do { try await session.startMirroringToCompanionDevice(); mirrored = true }
      catch { mirrored = false } // Recording must continue if the phone is offline.
      startTimer()
    } catch {
      errorText = error.localizedDescription
      session?.end(); builder?.discardWorkout(); clearSession(); state = "idle"
    }
  }

  func recover() async {
    guard session == nil else { return }
    do {
      guard let recovered = try await store.recoverActiveWorkoutSession() else { return }
      attach(recovered)
      startAt = recovered.startDate
      activity = Self.activity(recovered.workoutConfiguration.activityType)
      state = recovered.state == .paused ? "paused" : recovered.state == .stopped ? "saving" : "running"
      collectionEnded = false
      try? await recovered.startMirroringToCompanionDevice()
      if recovered.state == .stopped { await save() }
      else { startTimer(); refresh() }
    } catch { errorText = "Could not restore the recording. Open Health to check saved workouts." }
  }

  private func attach(_ session: HKWorkoutSession) {
    self.session = session
    builder = session.associatedWorkoutBuilder()
    session.delegate = self
    builder?.delegate = self
    builder?.dataSource = HKLiveWorkoutDataSource(healthStore: store, workoutConfiguration: session.workoutConfiguration)
  }
  func pauseOrResume() {
    if state == "running" { session?.pause() }
    else if state == "paused" { session?.resume() }
  }
  func finish() {
    guard state == "running" || state == "paused" else { return }
    state = "saving"
    session?.stopActivity(with: Date())
  }
  func retrySave() { Task { await save() } }
  private func save() async {
    guard !finishing, let builder, let session else { return }
    finishing = true; state = "saving"; errorText = nil
    do {
      if !collectionEnded {
        try await builder.endCollection(at: session.endDate ?? Date())
        collectionEnded = true
      }
      // nil without an error is successful when HealthKit cannot return a locked sample.
      _ = try await builder.finishWorkout()
      saved = true; state = "ended"
      await sendSnapshot()
      session.end(); clearSession()
    } catch {
      state = "save_failed"
      errorText = "Workout could not be saved. Keep the app open and retry."
    }
    finishing = false
  }
  private func clearSession() {
    timer?.invalidate(); timer = nil
    session = nil; builder = nil; mirrored = false
    heartRate = nil; heartRateAt = nil; zoneIndex = nil; cueText = nil
  }
  private func startTimer() {
    timer?.invalidate()
    timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
      Task { @MainActor in self?.refresh() }
    }
  }
  private func refresh() {
    guard let builder else { return }
    elapsed = builder.elapsedTime
    let now = Date()
    let heart = builder.statistics(for: HKQuantityType(.heartRate))
    let date = heart?.mostRecentQuantityDateInterval()?.end
    if let date, now.timeIntervalSince(date) >= 0, now.timeIntervalSince(date) <= 15, state == "running" {
      heartRate = heart?.mostRecentQuantity()?.doubleValue(for: .count().unitDivided(by: .minute()))
      heartRateAt = date
    } else { heartRate = nil; heartRateAt = nil; zoneIndex = nil }
#if compiler(>=6.4) && !SAMEPACE_HEALTH_LEGACY_SDK
    if #available(watchOS 27.0, *), let value = heartRate, let group = builder.zoneGroup(for: HKQuantityType(.heartRate)) {
      let unit = HKUnit.count().unitDivided(by: .minute())
      zoneIndex = group.configuration.zones.first { zone in
        (zone.minimum.map { value >= $0.doubleValue(for: unit) } ?? true) &&
        (zone.maximum.map { value < $0.doubleValue(for: unit) } ?? true)
      }?.index
      zoneSource = Self.source(group.configuration.source)
    }
#endif
    let distanceType: HKQuantityTypeIdentifier = activity == "ride" ? .distanceCycling : .distanceWalkingRunning
    distance = builder.statistics(for: HKQuantityType(distanceType))?.sumQuantity()?.doubleValue(for: .meter())
    energy = builder.statistics(for: HKQuantityType(.activeEnergyBurned))?.sumQuantity()?.doubleValue(for: .kilocalorie())
    if let direction = cue.evaluate(zoneIndex: zoneIndex, targetIndex: targetZone > 0 ? targetZone - 1 : nil,
                                    sampleAt: heartRateAt, now: now, running: state == "running") {
      cueText = direction == .below ? "Below your selected zone" : "Above your selected zone"
      WKInterfaceDevice.current().play(.notification)
    }
    if zoneIndex == targetZone - 1 || heartRate == nil || targetZone == 0 { cueText = nil }
    Task { await sendSnapshot() }
  }
  private func sendSnapshot() async {
    guard let session, let startAt else { return }
    let payload: [String: Any] = [
      "sessionId": sessionId, "state": state == "saving" || state == "save_failed" ? "stopped" : state,
      "activity": activity, "startAt": Self.iso(startAt), "elapsedSeconds": elapsed,
      "heartRateBpm": heartRate as Any? ?? NSNull(), "heartRateAt": heartRateAt.map(Self.iso) as Any? ?? NSNull(),
      "distanceMeters": distance as Any? ?? NSNull(), "activeEnergyKilocalories": energy as Any? ?? NSNull(),
      "zoneIndex": zoneIndex as Any? ?? NSNull(), "zoneSource": zoneSource as Any? ?? NSNull(),
    ]
    guard let data = try? JSONSerialization.data(withJSONObject: payload) else { return }
    do { try await session.sendToRemoteWorkoutSession(data: data); mirrored = true }
    catch { mirrored = false }
  }
  private static func iso(_ date: Date) -> String { ISO8601DateFormatter().string(from: date) }
  private static func activity(_ type: HKWorkoutActivityType) -> String {
    switch type { case .running: return "run"; case .walking: return "walk"; case .cycling: return "ride"; case .traditionalStrengthTraining: return "strength"; default: return "other" }
  }
#if compiler(>=6.4) && !SAMEPACE_HEALTH_LEGACY_SDK
  @available(watchOS 27.0, *)
  private static func source(_ source: HKWorkoutZoneConfiguration.Source) -> String {
    switch source { case .system: return "system"; case .user: return "user"; case .app: return "app"; @unknown default: return "unknown" }
  }
#endif
}
private enum HealthImportErrorForWatch: Error { case unavailable }

extension WorkoutRecorder: HKWorkoutSessionDelegate {
  nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState, from fromState: HKWorkoutSessionState, date: Date) {
    Task { @MainActor in
      guard workoutSession === self.session else { return }
      if toState == .stopped { await self.save() }
      else if toState == .running { self.state = "running" }
      else if toState == .paused { self.state = "paused"; self.heartRate = nil; self.zoneIndex = nil }
      self.refresh()
    }
  }
  nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
    Task { @MainActor in self.errorText = "Recording was interrupted. Try saving the workout."; self.state = "save_failed" }
  }
  nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didDisconnectFromRemoteDeviceWithError error: Error?) {
    Task { @MainActor in self.mirrored = false }
  }
}
extension WorkoutRecorder: HKLiveWorkoutBuilderDelegate {
  nonisolated func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {
    Task { @MainActor in self.refresh() }
  }
  nonisolated func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>) {
    Task { @MainActor in self.refresh() }
  }
#if compiler(>=6.4) && !SAMEPACE_HEALTH_LEGACY_SDK
  @available(watchOS 27.0, *)
  nonisolated func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didUpdateWorkoutZone zoneUpdate: HKLiveWorkoutZoneUpdate) {
    Task { @MainActor in
      guard zoneUpdate.zoneGroup?.configuration.quantityType == HKQuantityType(.heartRate) else { return }
      self.zoneIndex = zoneUpdate.currentZoneDuration?.zone.index
      self.zoneSource = zoneUpdate.zoneGroup.map { Self.source($0.configuration.source) }
      self.refresh()
    }
  }
#endif
}
