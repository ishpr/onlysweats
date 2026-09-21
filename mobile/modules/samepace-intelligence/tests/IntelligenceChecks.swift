import Foundation
import CoreGraphics
import CoreText
import ImageIO
import UniformTypeIdentifiers

@main
struct IntelligenceChecks {
  static func check(_ condition: @autoclosure () -> Bool, _ message: String) {
    precondition(condition(), message)
  }

  static func main() async throws {
    let source = "Bench press 3x8 at 40 kg. 3 sets, 8 reps. Total 30 minutes."
    check(WorkoutEvidenceParser.count("3x8", in: source, role: "sets") == 3, "set scheme")
    check(WorkoutEvidenceParser.count("3x8", in: source, role: "reps") == 8, "rep scheme")
    check(WorkoutEvidenceParser.count("3 sets", in: source, role: "sets") == 3, "explicit sets")
    check(WorkoutEvidenceParser.load("40 kg", in: source).0 == 40, "explicit load")
    check(WorkoutEvidenceParser.load("40 kg", in: source).1 == "kg", "explicit unit")
    check(WorkoutEvidenceParser.duration("30 minutes", in: source) == 30, "explicit duration")
    check(WorkoutEvidenceParser.duration("1.5 hours", in: "Walk for 1.5 hours") == 90, "code arithmetic")
    check(WorkoutEvidenceParser.load("50 kg", in: "Lift 150 kg").0 == nil, "numeric substring")
    check(WorkoutEvidenceParser.load("40 kg", in: "Lift -40 kg").0 == nil, "stripped negative")
    check(WorkoutEvidenceParser.load("250 kg", in: "Lift 1,250 kg").0 == nil, "grouping substring")
    check(WorkoutEvidenceParser.count("3 sets", in: "13 sets", role: "sets") == nil, "count substring")
    check(WorkoutEvidenceParser.load("80", in: "Bench 80").0 == nil, "missing unit")
    check(WorkoutEvidenceParser.load("bodyweight", in: "Use bodyweight").1 == "bodyweight", "bodyweight remains unmeasured")
    check(WorkoutEvidenceParser.load("bodyweight", in: "Use bodyweight").0 == nil, "no invented body mass")
    check(WorkoutEvidenceParser.literal("Run", in: "Lift") == nil, "new title rejected")
    check(WorkoutEvidenceParser.count("999 sets", in: "999 sets", role: "sets") == nil, "bounded set count")
    check(WorkoutEvidenceParser.duration("8 hours", in: "8 hours") == nil, "bounded duration")
    let blank = WorkoutEvidenceParser.blank(source: "photo", text: "Walk")
    check(blank.startedAt == nil && blank.activity == nil && blank.exercises.isEmpty && blank.intent == "unclear", "manual fallback")
    let summary = WorkoutRecapInput(activity: "run", durationSeconds: 600, distanceMeters: nil,
      averageHeartRateBpm: nil, activeEnergyKcal: nil, memberNote: nil)
    let facts = try WorkoutEvidenceParser.recapFacts(summary)
    check(facts.count == 2 && !facts.contains(where: { $0.contains("heart") }), "missing measures remain missing")
    let coordinator = IntelligenceCoordinator()
    let invalid = await coordinator.run("{}", onPartial: { _ in preconditionFailure("unexpected progress") })
    check(invalid.contains("invalid_input"), "invalid native request")
    await coordinator.cancel("cancel-before-dispatch")
    let cancelled = await coordinator.run("{\"requestId\":\"cancel-before-dispatch\",\"kind\":\"chat\",\"text\":\"Hi\"}", onPartial: { _ in preconditionFailure("cancelled request emitted text") })
    check(cancelled.contains("cancelled"), "bridge cancellation ordering")
    let pcc = PrivateCloudCoordinator()
    let denied = await pcc.run("{\"requestId\":\"pcc-denied\",\"text\":\"Hi\",\"history\":[],\"allowAppleCloud\":false}", onPartial: { _ in preconditionFailure("unauthorized cloud request") })
    check(denied.contains("cloud_consent_required"), "explicit PCC authorization required")
    await pcc.cancel("pcc-cancelled")
    let pccCancelled = await pcc.run("{\"requestId\":\"pcc-cancelled\",\"text\":\"Hi\",\"history\":[],\"allowAppleCloud\":true}", onPartial: { _ in preconditionFailure("cancelled PCC request emitted text") })
    check(pccCancelled.contains("cancelled"), "PCC bridge cancellation ordering")
    #if !SAMEPACE_PCC_ENTITLEMENT_ENABLED
    check(PrivateCloudIntelligence.capability().reason == "entitlement_not_configured", "PCC disabled by default")
    let unconfigured = await pcc.run("{\"requestId\":\"pcc-disabled\",\"text\":\"Hi\",\"history\":[],\"allowAppleCloud\":true}", onPartial: { _ in preconditionFailure("unconfigured PCC emitted text") })
    check(unconfigured.contains("entitlement_not_configured"), "no PCC request without provisioned build")
    #endif
    do {
      _ = try await WorkoutPhotoReader.read("https://example.com/image.jpg")
      preconditionFailure("remote URL accepted")
    } catch IntelligenceFailure.imageUnavailable { }
    do {
      _ = try await WorkoutPhotoReader.read("file:///etc/passwd")
      preconditionFailure("outside container accepted")
    } catch IntelligenceFailure.imageUnavailable { }

    // Actual Vision OCR on an ephemeral generated image, never a member photo.
    let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("samepace-intelligence-test-" + UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let imageURL = directory.appendingPathComponent("synthetic.png")
    let context = CGContext(data: nil, width: 1600, height: 240, bitsPerComponent: 8, bytesPerRow: 0,
      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    context.setFillColor(CGColor(gray: 1, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: 1600, height: 240))
    let line = CTLineCreateWithAttributedString(NSAttributedString(string: "Bench press 3x8 40 kg", attributes: [
      NSAttributedString.Key(kCTFontAttributeName as String): CTFontCreateWithName("Helvetica" as CFString, 64, nil),
      NSAttributedString.Key(kCTForegroundColorAttributeName as String): CGColor(gray: 0, alpha: 1)
    ]))
    context.textPosition = CGPoint(x: 40, y: 100)
    CTLineDraw(line, context)
    let destination = CGImageDestinationCreateWithURL(imageURL as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(destination, context.makeImage()!, nil)
    check(CGImageDestinationFinalize(destination), "synthetic image generation")
    let recognized = try await WorkoutPhotoReader.read(imageURL.absoluteString)
    check(recognized.lowercased().contains("bench press") && recognized.contains("40 kg"), "actual synthetic Vision recognition")
    print("Intelligence checks passed: evidence bounds, missing facts, cancellation, disabled PCC, file access, and synthetic Vision OCR. No language-model inference performed.")
  }
}
