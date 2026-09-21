import Foundation
import HealthKit

// Executable serialization checks. These fixtures are never saved to HealthKit.
@main
struct HealthKitReaderChecks {
  static func main() throws {
    let start = Date(timeIntervalSince1970: 1_700_000_000)
    let end = start.addingTimeInterval(600)

    let hrv = HKQuantitySample(
      type: .quantityType(forIdentifier: .heartRateVariabilitySDNN)!,
      quantity: HKQuantity(unit: .second(), doubleValue: 0.048), start: start, end: start
    )
    let hrvRecord = try HealthKitReader.serialize(hrv, type: "heart_rate_variability")
    precondition(hrvRecord["value"] as? Double == 48)
    precondition(hrvRecord["unit"] as? String == "ms")
    precondition(hrvRecord["externalId"] as? String == hrv.uuid.uuidString.lowercased())

    let heartRate = HKQuantitySample(
      type: .quantityType(forIdentifier: .heartRate)!,
      quantity: HKQuantity(unit: .count().unitDivided(by: .second()), doubleValue: 2),
      start: start, end: start
    )
    let heartRateRecord = try HealthKitReader.serialize(heartRate, type: "heart_rate")
    precondition(heartRateRecord["value"] as? Double == 120)
    precondition(heartRateRecord["unit"] as? String == "bpm")

    let workout = HKWorkout(
      activityType: .running, start: start, end: end, duration: 420,
      totalEnergyBurned: nil, totalDistance: nil, metadata: nil
    )
    let workoutRecord = try HealthKitReader.serialize(workout, type: "workout")
    precondition(workoutRecord["durationSeconds"] as? Double == 420)
    precondition(workoutRecord["activity"] as? String == "run")
    precondition(workoutRecord["distanceMeters"] is NSNull)
    precondition(workoutRecord["activeEnergyKilocalories"] is NSNull)
    precondition(JSONSerialization.isValidJSONObject(workoutRecord))

    let sleep = HKCategorySample(
      type: .categoryType(forIdentifier: .sleepAnalysis)!,
      value: HKCategoryValueSleepAnalysis.asleepREM.rawValue, start: start, end: end
    )
    let sleepRecord = try HealthKitReader.serialize(sleep, type: "sleep")
    precondition(sleepRecord["stage"] as? String == "rem")

    let encoded = try HealthKitReader.encodeAnchor(HKQueryAnchor(fromValue: 42))
    let decoded = try HealthKitReader.decodeAnchor(encoded)
    let initial = try HealthKitReader.decodeAnchor(nil)
    precondition(decoded == HKQueryAnchor(fromValue: 42))
    precondition(initial == nil)
    for invalid in ["", "not base64", Data("wrong archive".utf8).base64EncodedString()] {
      do {
        _ = try HealthKitReader.decodeAnchor(invalid)
        preconditionFailure("Malformed anchors must fail instead of resetting sync.")
      } catch HealthImportError.invalidAnchor { }
    }
    do {
      _ = try HealthKitReader.serialize(heartRate, type: "workout")
      preconditionFailure("Unexpected record types must fail instead of dropping data.")
    } catch HealthImportError.invalidRecord { }
    print("HealthKit serialization checks passed: units, identity, duration, missing data, sleep, secure anchors, invalid records.")
  }
}
