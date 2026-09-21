import ExpoModulesCore
import HealthKit

struct HealthReadOptions: Record {
  @Field var type: String = ""
  @Field var anchor: String? = nil
  @Field var sinceAt: String = ""
  @Field var limit: Int = 200
}

public final class SamePaceHealthKitModule: Module {
  private let reader = HealthKitReader()

  public func definition() -> ModuleDefinition {
    Name("SamePaceHealthKit")

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
          sinceAt: options.sinceAt, limit: options.limit
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
