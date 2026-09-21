import AppIntents
import Foundation

/// These shortcuts only open a signed-in app screen. They cannot write health
/// records, accept terms, grant consent, send messages, or confirm attendance.
@available(iOS 18.0, *)
struct OpenSamePaceAssistantIntent: AppIntent {
  static var title: LocalizedStringResource = "Open workout assistant"
  static var description = IntentDescription("Open your private SamePace assistant to review a workout idea.")
  static var openAppWhenRun = true
  func perform() async throws -> some IntentResult & OpensIntent {
    .result(opensIntent: OpenURLIntent(URL(string: "samepace://assistant")!))
  }
}

@available(iOS 18.0, *)
struct OpenSamePaceNextSessionIntent: AppIntent {
  static var title: LocalizedStringResource = "Open next SamePace workout"
  static var description = IntentDescription("Open your next known workout, or your sessions when there is no current shortcut snapshot.")
  static var openAppWhenRun = true
  func perform() async throws -> some IntentResult & OpensIntent {
    let store = UserDefaults(suiteName: "group.app.samepace")
    let raw = store?.string(forKey: "samepace.next-session.url") ?? ""
    let expires = store?.double(forKey: "samepace.next-session.expires") ?? 0
    let valid = raw.range(of: "^samepace://session/[A-Za-z0-9_-]{1,100}$", options: .regularExpression) != nil
    let target = valid && expires > Date().timeIntervalSince1970 ? raw : "samepace://sessions"
    return .result(opensIntent: OpenURLIntent(URL(string: target)!))
  }
}

@available(iOS 18.0, *)
struct CaptureSamePaceWorkoutDraftIntent: AppIntent {
  static var title: LocalizedStringResource = "Draft workout from a picture"
  static var description = IntentDescription("Open SamePace to choose a workout picture, read its text on your device, and review a draft. Nothing is uploaded or saved automatically.")
  static var openAppWhenRun = true
  func perform() async throws -> some IntentResult & OpensIntent {
    .result(opensIntent: OpenURLIntent(URL(string: "samepace://assistant?capture=photo")!))
  }
}

@available(iOS 18.0, *)
struct SamePaceAppShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(intent: OpenSamePaceAssistantIntent(), phrases: [
      "Open my assistant in \(.applicationName)", "Plan a workout with \(.applicationName)"
    ], shortTitle: "Workout assistant", systemImageName: "bubble.left.and.bubble.right")
    AppShortcut(intent: OpenSamePaceNextSessionIntent(), phrases: [
      "Open my next workout in \(.applicationName)"
    ], shortTitle: "Next workout", systemImageName: "figure.run")
    AppShortcut(intent: CaptureSamePaceWorkoutDraftIntent(), phrases: [
      "Draft a workout from a picture in \(.applicationName)"
    ], shortTitle: "Picture to draft", systemImageName: "text.viewfinder")
  }
  static var shortcutTileColor: ShortcutTileColor = .lime
}
