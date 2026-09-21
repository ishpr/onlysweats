import Foundation
import HealthKit

enum HealthImportError: LocalizedError {
  case unavailable, invalidType, invalidOptions, invalidAnchor, invalidRecord, missingAnchor

  var errorDescription: String? {
    switch self {
    case .unavailable: return "Apple Health is unavailable on this device."
    case .invalidType: return "This Apple Health data type is not supported."
    case .invalidOptions: return "The Apple Health query boundary or page limit is invalid."
    case .invalidAnchor: return "The Apple Health sync cursor is invalid. Reconnect explicitly to restart sync."
    case .invalidRecord: return "An Apple Health record could not be imported. The sync cursor was not advanced."
    case .missingAnchor: return "Apple Health did not return a sync cursor. Try syncing again."
    }
  }
}

/** Native reads never persist samples, anchors, or account credentials. */
final class HealthKitReader {
  private let store = HKHealthStore()

  func requestAuthorization(
    types: [String], completion: @escaping (Result<Void, Error>) -> Void
  ) throws {
    guard HKHealthStore.isHealthDataAvailable() else { throw HealthImportError.unavailable }
    guard !types.isEmpty, types.count <= Self.supportedTypes.count else { throw HealthImportError.invalidOptions }
    let readTypes = try Set(types.map { try Self.sampleType($0) as HKObjectType })
    store.requestAuthorization(toShare: [], read: readTypes) { completed, error in
      if let error { completion(.failure(error)) }
      else if completed { completion(.success(())) }
      else { completion(.failure(HealthImportError.unavailable)) }
      // HealthKit deliberately does not disclose whether read access was denied.
    }
  }

  func readChanges(
    type: String, anchor: String?, sinceAt: String, limit: Int, zoneTypes: [String] = [],
    completion: @escaping (Result<[String: Any], Error>) -> Void
  ) throws {
    guard HKHealthStore.isHealthDataAvailable() else { throw HealthImportError.unavailable }
    guard let since = Self.parseDate(sinceAt), (1...200).contains(limit) else {
      throw HealthImportError.invalidOptions
    }
    let queryType = try Self.sampleType(type)
    let previousAnchor = try Self.decodeAnchor(anchor)
    // This boundary must remain fixed between pages and later syncs.
    let predicate = HKQuery.predicateForSamples(withStart: since, end: nil, options: .strictStartDate)
    let query = HKAnchoredObjectQuery(
      type: queryType, predicate: predicate, anchor: previousAnchor, limit: limit
    ) { _, samples, deletions, nextAnchor, error in
      if let error { completion(.failure(error)); return }
      do {
        guard let nextAnchor else { throw HealthImportError.missingAnchor }
        let samples = samples ?? []
        let deletions = deletions ?? []
        // Never truncate a page then acknowledge its later cursor.
        guard samples.count + deletions.count <= limit else { throw HealthImportError.invalidRecord }
        let records = try samples.map { try Self.serialize($0, type: type, zoneTypes: zoneTypes) }
        completion(.success([
          "records": records,
          "deletedIds": deletions.map { $0.uuid.uuidString.lowercased() },
          "anchor": try Self.encodeAnchor(nextAnchor),
          // A full page may require one final empty query to establish completion.
          "hasMore": samples.count + deletions.count == limit,
        ]))
      } catch { completion(.failure(error)) }
    }
    store.execute(query)
  }

  static func sampleType(_ type: String) throws -> HKSampleType {
    switch type {
    case "workout": return HKObjectType.workoutType()
    case "sleep": return HKObjectType.categoryType(forIdentifier: .sleepAnalysis)!
    case "heart_rate": return HKObjectType.quantityType(forIdentifier: .heartRate)!
    case "resting_heart_rate": return HKObjectType.quantityType(forIdentifier: .restingHeartRate)!
    case "heart_rate_variability": return HKObjectType.quantityType(forIdentifier: .heartRateVariabilitySDNN)!
    case "heart_rate_variability_rmssd":
#if compiler(>=6.4) && !SAMEPACE_HEALTH_LEGACY_SDK
      if #available(iOS 27.0, *) { return HKObjectType.quantityType(forIdentifier: .heartRateVariabilityRMSSD)! }
#endif
      throw HealthImportError.invalidType
    case "cycling_power":
      if #available(iOS 17.0, *) { return HKObjectType.quantityType(forIdentifier: .cyclingPower)! }
      throw HealthImportError.invalidType
    case "steps": return HKObjectType.quantityType(forIdentifier: .stepCount)!
    case "distance": return HKObjectType.quantityType(forIdentifier: .distanceWalkingRunning)!
    case "active_energy": return HKObjectType.quantityType(forIdentifier: .activeEnergyBurned)!
    case "blood_glucose": return HKObjectType.quantityType(forIdentifier: .bloodGlucose)!
    default: throw HealthImportError.invalidType
    }
  }

  static func decodeAnchor(_ value: String?) throws -> HKQueryAnchor? {
    guard let value else { return nil }
    guard !value.isEmpty, value.utf8.count <= 16_384, let data = Data(base64Encoded: value) else {
      throw HealthImportError.invalidAnchor
    }
    do {
      guard let anchor = try NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: data) else {
        throw HealthImportError.invalidAnchor
      }
      return anchor
    } catch { throw HealthImportError.invalidAnchor }
  }

  static func encodeAnchor(_ anchor: HKQueryAnchor) throws -> String {
    try NSKeyedArchiver.archivedData(withRootObject: anchor, requiringSecureCoding: true).base64EncodedString()
  }

  private static func parseDate(_ value: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = formatter.date(from: value) { return date }
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.date(from: value)
  }

  static func serialize(_ sample: HKSample, type: String, zoneTypes: [String] = []) throws -> [String: Any] {
    guard sample.startDate.timeIntervalSince1970.isFinite,
          sample.endDate.timeIntervalSince1970.isFinite,
          sample.endDate >= sample.startDate else { throw HealthImportError.invalidRecord }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let source = sample.sourceRevision.source
    var result: [String: Any] = [
      "externalId": sample.uuid.uuidString.lowercased(), "type": type,
      "source": ["bundleId": source.bundleIdentifier, "name": source.name],
      "startAt": formatter.string(from: sample.startDate),
      "endAt": formatter.string(from: sample.endDate),
    ]

    if type == "workout", let workout = sample as? HKWorkout {
      result["activity"] = activity(workout.workoutActivityType)
      result["durationSeconds"] = try nonnegative(workout.duration)
      result["distanceMeters"] = try workoutDistance(workout).map { try nonnegative($0) } as Any? ?? NSNull()
      let energyType = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)!
      let energy = workout.statistics(for: energyType)?.sumQuantity()?.doubleValue(for: .kilocalorie())
      result["activeEnergyKilocalories"] = try energy.map { try nonnegative($0) } as Any? ?? NSNull()
#if compiler(>=6.4) && !SAMEPACE_HEALTH_LEGACY_SDK
      if #available(iOS 27.0, *) {
        result["zones"] = try zoneTypes.filter { $0 == "heart_rate" || $0 == "cycling_power" }.compactMap { metric -> [String: Any]? in
          let quantityType = try Self.sampleType(metric) as! HKQuantityType
          guard let group = workout.zoneGroup(for: quantityType) else { return nil }
          return try serializeZones(group, metric: metric)
        }
      }
#endif
    } else if type == "sleep", let sleep = sample as? HKCategorySample {
      switch HKCategoryValueSleepAnalysis(rawValue: sleep.value) {
      case .inBed: result["stage"] = "in_bed"
      case .asleepUnspecified: result["stage"] = "asleep_unspecified"
      case .awake: result["stage"] = "awake"
      case .asleepCore: result["stage"] = "core"
      case .asleepDeep: result["stage"] = "deep"
      case .asleepREM: result["stage"] = "rem"
      default: throw HealthImportError.invalidRecord
      }
    } else if let quantity = sample as? HKQuantitySample {
      let unit: HKUnit
      let label: String
      switch type {
      case "heart_rate", "resting_heart_rate": unit = .count().unitDivided(by: .minute()); label = "bpm"
      case "heart_rate_variability", "heart_rate_variability_rmssd": unit = .secondUnit(with: .milli); label = "ms"
      case "cycling_power": unit = .watt(); label = "W"
      case "steps": unit = .count(); label = "count"
      case "distance": unit = .meter(); label = "m"
      case "active_energy": unit = .kilocalorie(); label = "kcal"
      case "blood_glucose": unit = HKUnit.gramUnit(with: .milli).unitDivided(by: .literUnit(with: .deci)); label = "mg/dL"
      default: throw HealthImportError.invalidRecord
      }
      guard quantity.quantity.is(compatibleWith: unit) else { throw HealthImportError.invalidRecord }
      result["value"] = try nonnegative(quantity.quantity.doubleValue(for: unit))
      result["unit"] = label
    } else { throw HealthImportError.invalidRecord }
    return result
  }

  static var supportedTypes: [String] {
    var types = ["workout", "heart_rate", "resting_heart_rate", "heart_rate_variability", "sleep", "steps", "distance", "active_energy", "blood_glucose"]
    if #available(iOS 17.0, *) { types.append("cycling_power") }
#if compiler(>=6.4) && !SAMEPACE_HEALTH_LEGACY_SDK
    if #available(iOS 27.0, *) { types.append("heart_rate_variability_rmssd") }
#endif
    return types
  }

#if compiler(>=6.4) && !SAMEPACE_HEALTH_LEGACY_SDK
  @available(iOS 27.0, *)
  static func serializeZones(_ group: HKWorkoutZoneGroup, metric: String) throws -> [String: Any] {
    try serializeZoneConfiguration(group.configuration, metric: metric,
      durations: Dictionary(uniqueKeysWithValues: group.zoneDurations.map { ($0.zone.index, $0.duration) }))
  }

  @available(iOS 27.0, *)
  static func serializeZoneConfiguration(_ configuration: HKWorkoutZoneConfiguration, metric: String,
                                         durations: [Int: Double]) throws -> [String: Any] {
    let unit: HKUnit = metric == "heart_rate" ? .count().unitDivided(by: .minute()) : .watt()
    let source: String
    switch configuration.source {
    case .system: source = "system"
    case .user: source = "user"
    case .app: source = "app"
    @unknown default: throw HealthImportError.invalidRecord
    }
    let zones = try configuration.zones.map { zone -> [String: Any] in
      let duration = durations[zone.index]
      return ["index": zone.index,
        "minimum": try zone.minimum.map { try nonnegative($0.doubleValue(for: unit)) } as Any? ?? NSNull(),
        "maximum": try zone.maximum.map { try nonnegative($0.doubleValue(for: unit)) } as Any? ?? NSNull(),
        "durationSeconds": try duration.map { try nonnegative($0) } as Any? ?? NSNull()]
    }
    return ["metric": metric, "unit": metric == "heart_rate" ? "bpm" : "W", "source": source, "zones": zones]
  }

#endif
  private static func nonnegative(_ value: Double) throws -> Double {
    guard value.isFinite, value >= 0 else { throw HealthImportError.invalidRecord }
    return value
  }

  private static func activity(_ type: HKWorkoutActivityType) -> String {
    switch type {
    case .running: return "run"
    case .walking: return "walk"
    case .cycling: return "ride"
    case .hiking: return "hike"
    case .traditionalStrengthTraining, .functionalStrengthTraining: return "strength"
    case .flexibility, .yoga, .pilates, .taiChi: return "mobility"
    default: return "other"
    }
  }

  private static func workoutDistance(_ workout: HKWorkout) -> Double? {
    let identifier: HKQuantityTypeIdentifier
    switch workout.workoutActivityType {
    case .running, .walking, .hiking: identifier = .distanceWalkingRunning
    case .cycling: identifier = .distanceCycling
    case .swimming: identifier = .distanceSwimming
    case .wheelchairWalkPace, .wheelchairRunPace: identifier = .distanceWheelchair
    default: return nil
    }
    let type = HKQuantityType.quantityType(forIdentifier: identifier)!
    return workout.statistics(for: type)?.sumQuantity()?.doubleValue(for: .meter())
  }
}
