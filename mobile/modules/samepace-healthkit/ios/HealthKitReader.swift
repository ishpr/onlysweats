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

/** No observer, background delivery, write permission, or persisted native cursor. */
final class HealthKitReader {
  private let store = HKHealthStore()

  func requestAuthorization(
    types: [String], completion: @escaping (Result<Void, Error>) -> Void
  ) throws {
    guard HKHealthStore.isHealthDataAvailable() else { throw HealthImportError.unavailable }
    guard !types.isEmpty, types.count <= 8 else { throw HealthImportError.invalidOptions }
    let readTypes = try Set(types.map { try sampleType($0) as HKObjectType })
    store.requestAuthorization(toShare: [], read: readTypes) { completed, error in
      if let error { completion(.failure(error)) }
      else if completed { completion(.success(())) }
      else { completion(.failure(HealthImportError.unavailable)) }
      // HealthKit deliberately does not disclose whether read access was denied.
    }
  }

  func readChanges(
    type: String, anchor: String?, sinceAt: String, limit: Int,
    completion: @escaping (Result<[String: Any], Error>) -> Void
  ) throws {
    guard HKHealthStore.isHealthDataAvailable() else { throw HealthImportError.unavailable }
    guard let since = Self.parseDate(sinceAt), (1...200).contains(limit) else {
      throw HealthImportError.invalidOptions
    }
    let queryType = try sampleType(type)
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
        let records = try samples.map { try Self.serialize($0, type: type) }
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

  private func sampleType(_ type: String) throws -> HKSampleType {
    switch type {
    case "workout": return HKObjectType.workoutType()
    case "sleep": return HKObjectType.categoryType(forIdentifier: .sleepAnalysis)!
    case "heart_rate": return HKObjectType.quantityType(forIdentifier: .heartRate)!
    case "resting_heart_rate": return HKObjectType.quantityType(forIdentifier: .restingHeartRate)!
    case "heart_rate_variability": return HKObjectType.quantityType(forIdentifier: .heartRateVariabilitySDNN)!
    case "steps": return HKObjectType.quantityType(forIdentifier: .stepCount)!
    case "distance": return HKObjectType.quantityType(forIdentifier: .distanceWalkingRunning)!
    case "active_energy": return HKObjectType.quantityType(forIdentifier: .activeEnergyBurned)!
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

  static func serialize(_ sample: HKSample, type: String) throws -> [String: Any] {
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
      case "heart_rate_variability": unit = .secondUnit(with: .milli); label = "ms"
      case "steps": unit = .count(); label = "count"
      case "distance": unit = .meter(); label = "m"
      case "active_energy": unit = .kilocalorie(); label = "kcal"
      default: throw HealthImportError.invalidRecord
      }
      guard quantity.quantity.is(compatibleWith: unit) else { throw HealthImportError.invalidRecord }
      result["value"] = try nonnegative(quantity.quantity.doubleValue(for: unit))
      result["unit"] = label
    } else { throw HealthImportError.invalidRecord }
    return result
  }

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
