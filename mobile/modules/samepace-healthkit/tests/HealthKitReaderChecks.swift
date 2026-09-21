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

#if compiler(>=6.4) && !SAMEPACE_HEALTH_LEGACY_SDK
    if #available(iOS 27.0, *) {
      let rmssd = HKQuantitySample(type: .quantityType(forIdentifier: .heartRateVariabilityRMSSD)!,
        quantity: HKQuantity(unit: .second(), doubleValue: 0.035), start: start, end: start)
      let record = try HealthKitReader.serialize(rmssd, type: "heart_rate_variability_rmssd")
      precondition(record["value"] as? Double == 35)
      precondition(record["type"] as? String == "heart_rate_variability_rmssd")
      let config = try HKWorkoutZoneConfiguration(quantityType: .quantityType(forIdentifier: .heartRate)!,
        zoneBoundaries: [120.0, 140.0, 160.0, 180.0].map { HKQuantity(unit: .count().unitDivided(by: .minute()), doubleValue: $0) })
      precondition(config.zones.count == 5)
      precondition(config.zones[0].minimum == nil)
      precondition(config.zones[4].maximum == nil)
      precondition(config.source == .app)
      let zoneRecord = try HealthKitReader.serializeZoneConfiguration(config, metric: "heart_rate", durations: [0: 0, 1: 120])
      let zones = zoneRecord["zones"] as! [[String: Any]]
      precondition(zoneRecord["source"] as? String == "app")
      precondition(zoneRecord["unit"] as? String == "bpm")
      precondition(zones[0]["minimum"] is NSNull)
      precondition(zones[0]["maximum"] as? Double == 120)
      precondition(zones[0]["durationSeconds"] as? Double == 0)
      precondition(zones[1]["minimum"] as? Double == 120)
      precondition(zones[1]["durationSeconds"] as? Double == 120)
      precondition(zones[2]["durationSeconds"] is NSNull)
      precondition(zones[4]["maximum"] is NSNull)
      precondition(JSONSerialization.isValidJSONObject(zoneRecord))
    }

#endif
    let glucose = HKQuantitySample(type: .quantityType(forIdentifier: .bloodGlucose)!,
      quantity: HKQuantity(unit: HKUnit.gramUnit(with: .milli).unitDivided(by: .literUnit(with: .deci)), doubleValue: 98),
      start: start, end: start)
    let glucoseRecord = try HealthKitReader.serialize(glucose, type: "blood_glucose")
    precondition(glucoseRecord["value"] as? Double == 98)
    precondition(glucoseRecord["unit"] as? String == "mg/dL")
    precondition(HealthKitReader.supportedTypes.contains("blood_glucose"))

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
