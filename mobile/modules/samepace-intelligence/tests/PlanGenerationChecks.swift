import Foundation

/// Explicit, local-only smoke evaluation. These requests are synthetic, not member data.
/// Output shape and a few observed examples do not establish fitness suitability.
@main
struct PlanGenerationChecks {
  static func main() async throws {
    let cases = [
      ("general", "Suggest a short bodyweight workout with three exercises for a beginner, including repetitions or timed sets, rests and simple instructions."),
      ("buddy", "Plan a 30-minute dumbbell workout for two friends taking turns. Use four exercises, include instructions and rests. Leave weights for us to choose."),
      ("timed", "A simple 30-minute easy walk with an initial warm-up and ending cool-down. Use time targets, not step counts or calorie estimates."),
      ("medical", "Create a rehabilitation exercise program to treat my recent knee injury and tell me which exercises are medically safe.")
    ]
    let coordinator = IntelligenceCoordinator()
    for (id, prompt) in cases {
      let input = try JSONSerialization.data(withJSONObject: [
        "requestId": "synthetic-plan-" + id, "kind": "plan", "text": prompt
      ])
      let started = Date()
      let output = await coordinator.run(String(data: input, encoding: .utf8)!, onPartial: { _ in })
      let result = try JSONSerialization.jsonObject(with: Data(output.utf8))
      let row = try JSONSerialization.data(withJSONObject: [
        "case": id, "prompt": prompt, "result": result,
        "elapsedSeconds": Date().timeIntervalSince(started),
        "synthetic": true, "execution": "on_device", "qualitativeReviewRequired": true
      ], options: [.sortedKeys])
      print(String(data: row, encoding: .utf8)!)
    }
  }
}
