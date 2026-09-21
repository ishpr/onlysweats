import Foundation
import HealthKit

/** Background delivery records only a change counter. No readings, cursors,
 * identity, or bearer tokens are persisted. Cloud sync needs a captured JS session. */
final class HealthChangeObserver {
  static let shared = HealthChangeObserver()
  static let changed = Notification.Name("SamePaceHealthChanged")
  private let store = HKHealthStore()
  private let defaults = UserDefaults.standard
  private let typesKey = "samepace.health.observer.types.v1"
  private let changeKey = "samepace.health.observer.change.v1"
  private let ackKey = "samepace.health.observer.ack.v1"
  private var queries: [HKObserverQuery] = []
  private var generation = 0
  var pendingChanges: Int { defaults.integer(forKey: changeKey) }

  func restore() {
    guard let types = defaults.stringArray(forKey: typesKey), !types.isEmpty else { return }
    configure(types: types, enabled: true) { _ in }
  }

  func configure(types: [String], enabled: Bool, completion: @escaping (Result<Void, Error>) -> Void) {
    generation += 1
    let version = generation
    queries.forEach { store.stop($0) }
    queries.removeAll()
    let previousTypes = defaults.stringArray(forKey: typesKey) ?? []
    defaults.removeObject(forKey: typesKey)
    for type in previousTypes where !enabled || !types.contains(type) {
      if let sample = try? HealthKitReader.sampleType(type) { store.disableBackgroundDelivery(for: sample) { _, _ in } }
    }
    guard enabled else { completion(.success(())); return }
    guard HKHealthStore.isHealthDataAvailable(), !types.isEmpty, types.count <= 10 else {
      completion(.failure(HealthImportError.invalidOptions)); return
    }
    do {
      let samples = try Array(Set(types)).map { try HealthKitReader.sampleType($0) }
      defaults.set(Array(Set(types)), forKey: typesKey)
      let group = DispatchGroup()
      var firstError: Error?
      for sample in samples {
        let query = HKObserverQuery(sampleType: sample, predicate: nil) { [weak self] _, done, error in
          guard let self else { done(); return }
          DispatchQueue.main.async {
            defer { done() }
            guard version == self.generation, error == nil else { return }
            self.defaults.set(self.pendingChanges + 1, forKey: self.changeKey)
            NotificationCenter.default.post(name: Self.changed, object: nil)
          }
        }
        queries.append(query)
        store.execute(query)
        group.enter()
        store.enableBackgroundDelivery(for: sample, frequency: .immediate) { success, error in
          DispatchQueue.main.async {
            if !success { firstError = error ?? HealthImportError.unavailable }
            group.leave()
          }
        }
      }
      group.notify(queue: .main) {
        guard version == self.generation else { completion(.success(())); return }
        if let error = firstError { completion(.failure(error)) }
        else { completion(.success(())) }
      }
    } catch { completion(.failure(error)) }
  }

  func acknowledge(_ revision: Int) {
    // A change arriving during an upload must remain pending.
    defaults.set(min(max(0, revision), pendingChanges), forKey: ackKey)
  }
}
