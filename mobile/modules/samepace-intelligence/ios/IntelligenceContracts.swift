import Foundation

struct IntelligenceCapability: Codable, Sendable {
  var available: Bool
  var reason: String?
  var photoTextRecognition = true
  var execution = "on_device"
}

struct IntelligenceHistory: Codable, Sendable {
  let role: String
  let text: String
}

struct WorkoutRecapInput: Codable, Sendable {
  let activity: String
  let durationSeconds: Double?
  let distanceMeters: Double?
  let averageHeartRateBpm: Double?
  let activeEnergyKcal: Double?
  let memberNote: String?
}

struct IntelligenceRequest: Codable, Sendable {
  let requestId: String
  let kind: String
  let text: String?
  let imageUri: String?
  let history: [IntelligenceHistory]?
  let summary: WorkoutRecapInput?
}

struct WorkoutDraftExercise: Codable, Sendable {
  let name: String
  let sets: Int?
  let reps: Int?
  let weight: Double?
  let unit: String?
}

struct LocalWorkoutDraft: Encodable, Sendable {
  let source: String
  let sourceText: String
  var title: String?
  var activity: String?
  var intent: String = "unclear"
  // Dates are never invented from an undated image or an ambiguous note.
  var startedAt: String? = nil
  var durationMin: Double?
  var note: String
  var exercises: [WorkoutDraftExercise] = []
  let requiresReview = true
}

struct IntelligenceResult: Encodable, Sendable {
  var status: String
  var reason: String?
  var text: String?
  var draft: LocalWorkoutDraft?
  var modelUsed = false
  let execution = "on_device"

  func json() -> String {
    guard let data = try? JSONEncoder().encode(self), let value = String(data: data, encoding: .utf8) else {
      return "{\"status\":\"error\",\"reason\":\"unavailable\",\"execution\":\"on_device\"}"
    }
    return value
  }
}

enum IntelligenceFailure: Error {
  case invalidInput, imageUnavailable, imageTooLarge, noText, tooMuchText, timedOut
  var code: String {
    switch self {
    case .invalidInput: return "invalid_input"
    case .imageUnavailable: return "image_unavailable"
    case .imageTooLarge: return "image_too_large"
    case .noText: return "no_text"
    case .tooMuchText: return "too_much_text"
    case .timedOut: return "timeout"
    }
  }
}

/// Model-supplied numbers are never used. Code parses a literal quoted span only
/// after verifying it exists in the source. Role selection remains an editable inference.
enum WorkoutEvidenceParser {
  static func literal(_ quote: String, in source: String, max: Int = 120) -> String? {
    let value = quote.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !value.isEmpty, value.count <= max, source.contains(value) else { return nil }
    return value
  }

  private static func matches(_ pattern: String, _ value: String) -> [String]? {
    guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]),
          let match = regex.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)),
          match.range.length == (value as NSString).length else { return nil }
    return (1..<match.numberOfRanges).map { index in
      guard let range = Range(match.range(at: index), in: value) else { return "" }
      return String(value[range])
    }
  }

  private static func numericLiteral(_ quote: String, in source: String) -> String? {
    guard let value = literal(quote, in: source, max: 60) else { return nil }
    // A substring of 150 kg is not evidence for 50 kg; nor may a minus sign or
    // decimal/group separator be stripped from a value before parsing it.
    let pattern = "(?<![\\p{L}\\p{N}.,+\\-])" + NSRegularExpression.escapedPattern(for: value) + "(?![\\p{L}\\p{N}])"
    guard source.range(of: pattern, options: .regularExpression) != nil else { return nil }
    return value
  }

  static func count(_ quote: String, in source: String, role: String) -> Int? {
    guard let value = numericLiteral(quote, in: source) else { return nil }
    let word = role == "sets" ? "sets?" : "reps?|repetitions?"
    var candidate = matches("\\s*(\\d{1,3})\\s*(?:\(word))\\s*", value)?.first
    if candidate == nil, let scheme = matches("\\s*(\\d{1,3})\\s*[x×]\\s*(\\d{1,3})\\s*", value) {
      candidate = scheme[role == "sets" ? 0 : 1]
    }
    guard let candidate, let number = Int(candidate), number > 0,
          number <= (role == "sets" ? 30 : 500) else { return nil }
    return number
  }

  static func load(_ quote: String, in source: String) -> (Double?, String?) {
    guard let value = numericLiteral(quote, in: source) else { return (nil, nil) }
    if ["bodyweight", "body weight"].contains(value.lowercased()) { return (nil, "bodyweight") }
    guard let parts = matches("\\s*(\\d{1,4}(?:\\.\\d{1,2})?)\\s*(kg|kgs|kilograms?|lb|lbs|pounds?)\\s*", value),
          let weight = Double(parts[0]), weight.isFinite, weight >= 0, weight <= 2_000 else { return (nil, nil) }
    return (weight, parts[1].lowercased().hasPrefix("k") ? "kg" : "lb")
  }

  static func duration(_ quote: String, in source: String) -> Double? {
    guard let value = numericLiteral(quote, in: source),
          let parts = matches("\\s*(\\d{1,3}(?:\\.\\d{1,2})?)\\s*(minutes?|mins?|hours?|hrs?|seconds?|secs?)\\s*", value),
          let number = Double(parts[0]), number > 0 else { return nil }
    let unit = parts[1].lowercased()
    let minutes = unit.hasPrefix("h") ? number * 60 : unit.hasPrefix("s") ? number / 60 : number
    return minutes <= 360 ? minutes : nil
  }

  static func blank(source: String, text: String) -> LocalWorkoutDraft {
    LocalWorkoutDraft(source: source, sourceText: text, note: text)
  }

  static func recapFacts(_ input: WorkoutRecapInput) throws -> [String] {
    guard ["run", "ride", "walk", "hike", "strength", "mobility", "other"].contains(input.activity),
          (input.memberNote?.count ?? 0) <= 1000 else { throw IntelligenceFailure.invalidInput }
    var facts = ["Activity: \(input.activity)."]
    let values: [(Double?, Double, String)] = [
      (input.durationSeconds, 86_400, "Duration in seconds"),
      (input.distanceMeters, 1_000_000, "Distance in meters"),
      (input.averageHeartRateBpm, 300, "Recorded average heart rate in bpm"),
      (input.activeEnergyKcal, 30_000, "Recorded active energy in kcal")
    ]
    for (value, ceiling, label) in values {
      if let value {
        guard value.isFinite, value >= 0, value <= ceiling else { throw IntelligenceFailure.invalidInput }
        facts.append("\(label): \(value.formatted(.number.precision(.fractionLength(0...2)))).")
      }
    }
    return facts
  }
}
