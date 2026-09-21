import ExpoModulesCore
import UIKit

public final class HealthAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    // HealthKit may launch the app for an observer before the JS bridge exists.
    HealthChangeObserver.shared.restore()
    if #available(iOS 17.0, *) { WatchWorkoutMirror.shared.register() }
    return true
  }
}
