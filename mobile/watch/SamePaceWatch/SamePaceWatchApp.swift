import SwiftUI
import HealthKit
import WatchKit

@main
struct SamePaceWatchApp: App {
  @WKApplicationDelegateAdaptor(WatchDelegate.self) var delegate
  @StateObject private var recorder = WorkoutRecorder.shared
  var body: some Scene {
    WindowGroup { WorkoutView(recorder: recorder).task { await recorder.recover() } }
  }
}
final class WatchDelegate: NSObject, WKApplicationDelegate {
  func handleActiveWorkoutRecovery() { Task { @MainActor in await WorkoutRecorder.shared.recover() } }
  func handle(_ workoutConfiguration: HKWorkoutConfiguration) {
    // Opening from the phone never silently starts a recording. The Watch user taps Start.
  }
}
struct WorkoutView: View {
  @ObservedObject var recorder: WorkoutRecorder
  @State private var activity: HKWorkoutActivityType = .running
  @State private var confirmFinish = false
  var body: some View {
    ScrollView {
      VStack(spacing: 10) {
        Text("SamePace").font(.headline)
        if recorder.state == "idle" || recorder.state == "ended" {
          if recorder.saved { Text("Saved to Apple Health").foregroundStyle(.green) }
          Picker("Activity", selection: $activity) {
            Text("Run").tag(HKWorkoutActivityType.running)
            Text("Walk").tag(HKWorkoutActivityType.walking)
            Text("Ride").tag(HKWorkoutActivityType.cycling)
            Text("Strength").tag(HKWorkoutActivityType.traditionalStrengthTraining)
          }
#if compiler(>=6.4) && !SAMEPACE_HEALTH_LEGACY_SDK
          if #available(watchOS 27.0, *) {
            Picker("Heart-rate cue", selection: $recorder.targetZone) {
              Text("Off").tag(0)
              ForEach(1...5, id: \.self) { Text("Zone \($0)").tag($0) }
            }
          }
#endif
          Text("Saves a workout to Apple Health. Your iPhone imports only the data you connect in SamePace.").font(.footnote)
          Button("Start workout") { Task { await recorder.start(activity) } }.buttonStyle(.borderedProminent)
        } else {
          Text(recorder.state == "paused" ? "Paused" : recorder.state == "running" ? "Recording" : "Saving…")
          Text(Duration.seconds(recorder.elapsed).formatted(.time(pattern: .minuteSecond))).font(.title2).monospacedDigit()
          Text(recorder.heartRate.map { "\(Int($0.rounded())) bpm" } ?? "Heart rate unavailable")
          if let distance = recorder.distance { Text(String(format: "%.2f km", distance / 1000)) }
          if let energy = recorder.energy { Text("\(Int(energy.rounded())) active kcal") }
          if let zone = recorder.zoneIndex { Text("Zone \(zone + 1)") }
          else { Text("Zone unavailable").font(.footnote) }
          if let cue = recorder.cueText { Text(cue).foregroundStyle(.orange) }
          Text(recorder.mirrored ? "Connected to iPhone" : "Recording on Watch").font(.footnote)
          if recorder.state == "running" || recorder.state == "paused" {
            Button(recorder.state == "paused" ? "Resume" : "Pause") { recorder.pauseOrResume() }
            Button("Finish") { confirmFinish = true }.tint(.red)
          }
          if recorder.state == "save_failed" { Button("Retry save") { recorder.retrySave() } }
        }
        if let error = recorder.errorText { Text(error).foregroundStyle(.red).font(.footnote) }
      }.padding()
    }
    .confirmationDialog("Finish and save this workout?", isPresented: $confirmFinish) {
      Button("Finish and save") { recorder.finish() }
      Button("Keep recording", role: .cancel) {}
    }
  }
}
