import ExpoModulesCore
import HealthKit

struct HealthReadOptions: Record {
  @Field var type: String = ""
  @Field var anchor: String? = nil
  @Field var sinceAt: String = ""
  @Field var limit: Int = 200
  @Field var zoneTypes: [String] = []
}

public final class SamePaceHealthKitModule: Module {
  private let reader = HealthKitReader()
  private var notification: NSObjectProtocol?
  private var watchNotification: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("SamePaceHealthKit")
    Events("onHealthChange", "onWatchWorkout")
    OnCreate {
      if #available(iOS 17.0, *) {
        self.watchNotification = NotificationCenter.default.addObserver(forName: WatchWorkoutMirror.changed, object: nil, queue: .main) { [weak self] _ in
          self?.sendEvent("onWatchWorkout", ["snapshot": WatchWorkoutMirror.shared.snapshot as Any? ?? NSNull()])
        }
      }
      self.notification = NotificationCenter.default.addObserver(forName: HealthChangeObserver.changed, object: nil, queue: .main) { [weak self] _ in
        self?.sendEvent("onHealthChange", [:])
      }
    }
    OnDestroy {
      if let watchNotification = self.watchNotification { NotificationCenter.default.removeObserver(watchNotification) }
      if let notification = self.notification { NotificationCenter.default.removeObserver(notification) }
    }
    AsyncFunction("setWatchVisible") { (visible: Bool) in
      if #available(iOS 17.0, *) { WatchWorkoutMirror.shared.setVisible(visible) }
    }.runOnQueue(.main)
    AsyncFunction("watchSnapshot") { () -> [String: Any]? in
      if #available(iOS 17.0, *) { return WatchWorkoutMirror.shared.snapshot }
      return nil
    }.runOnQueue(.main)
    AsyncFunction("openWatch") { (activity: String, promise: Promise) in
      if #available(iOS 17.0, *) {
        WatchWorkoutMirror.shared.openWatch(activity: activity) { result in
          switch result { case .success: promise.resolve(nil); case .failure(let error): promise.reject(error) }
        }
      } else { promise.reject(HealthImportError.unavailable) }
    }.runOnQueue(.main)
    AsyncFunction("supportedTypes") { HealthKitReader.supportedTypes }
    AsyncFunction("setObservation") { (types: [String], enabled: Bool, promise: Promise) in
      HealthChangeObserver.shared.configure(types: types, enabled: enabled) { result in
        switch result {
        case .success: promise.resolve(nil)
        case .failure(let error): promise.reject(error)
        }
      }
    }.runOnQueue(.main)
    AsyncFunction("pendingChanges") { HealthChangeObserver.shared.pendingChanges }
    AsyncFunction("acknowledgeChanges") { (revision: Int) in HealthChangeObserver.shared.acknowledge(revision) }

    AsyncFunction("isAvailable") {
      HKHealthStore.isHealthDataAvailable()
    }

    AsyncFunction("requestAuthorization") { (types: [String], promise: Promise) in
      do {
        try self.reader.requestAuthorization(types: types) { result in
          switch result {
          case .success: promise.resolve(nil)
          case .failure(let error): promise.reject(error)
          }
        }
      } catch {
        promise.reject(error)
      }
    }.runOnQueue(.main)

    AsyncFunction("readChanges") { (options: HealthReadOptions, promise: Promise) in
      do {
        try self.reader.readChanges(
          type: options.type, anchor: options.anchor,
          sinceAt: options.sinceAt, limit: options.limit, zoneTypes: options.zoneTypes
        ) { result in
          switch result {
          case .success(let page): promise.resolve(page)
          case .failure(let error): promise.reject(error)
          }
        }
      } catch {
        promise.reject(error)
      }
    }
  }
}
