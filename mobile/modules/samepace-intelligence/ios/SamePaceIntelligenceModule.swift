import ExpoModulesCore
import UIKit

public final class SamePaceIntelligenceModule: Module {
  private let coordinator = IntelligenceCoordinator()
  private let privateCloud = PrivateCloudCoordinator()

  public func definition() -> ModuleDefinition {
    Name("SamePaceIntelligence")
    Events("onResponse", "onPccResponse")

    AsyncFunction("capability") { () -> String in
      let data = try JSONEncoder().encode(AppleIntelligenceEngine.capability())
      return String(data: data, encoding: .utf8) ?? "{}"
    }
    AsyncFunction("runRequest") { (request: String) async -> String in
      guard request.utf8.count <= 32_000 else {
        return IntelligenceResult(status: "error", reason: "invalid_input").json()
      }
      guard await MainActor.run(body: { UIApplication.shared.applicationState == .active }) else {
        return IntelligenceResult(status: "cancelled", reason: "cancelled").json()
      }
      // Parse only the opaque routing ID for progress events; no payload logging.
      let data = request.data(using: .utf8)
      let id = data.flatMap { try? JSONDecoder().decode(IntelligenceRequest.self, from: $0).requestId } ?? ""
      return await self.coordinator.run(request) { [weak self] text in
        self?.sendEvent("onResponse", ["requestId": id, "text": text])
      }
    }
    AsyncFunction("cancel") { (id: String) async in await self.coordinator.cancel(id) }
    AsyncFunction("pccCapability") { () -> String in PrivateCloudIntelligence.capability().json() }
    AsyncFunction("runPccRequest") { (request: String) async -> String in
      guard request.utf8.count <= 32_000 else { return PrivateCloudResult(status: "error", reason: "invalid_input").json() }
      guard await MainActor.run(body: { UIApplication.shared.applicationState == .active }) else {
        return PrivateCloudResult(status: "cancelled", reason: "cancelled").json()
      }
      let id = request.data(using: .utf8).flatMap { try? JSONDecoder().decode(PrivateCloudRequest.self, from: $0).requestId } ?? ""
      return await self.privateCloud.run(request) { [weak self] text in
        self?.sendEvent("onPccResponse", ["requestId": id, "text": text])
      }
    }
    AsyncFunction("cancelPcc") { (id: String) async in await self.privateCloud.cancel(id) }
    AsyncFunction("cancelAll") { () async in
      await self.coordinator.cancelAll()
      await self.privateCloud.cancelAll()
    }
    AsyncFunction("setNextSessionShortcut") { (url: String?, expiresAt: Double?) in
      let store = UserDefaults(suiteName: "group.app.samepace")
      if let url, let expiresAt, expiresAt.isFinite,
         expiresAt > Date().timeIntervalSince1970,
         url.range(of: "^samepace://session/[A-Za-z0-9_-]{1,100}$", options: .regularExpression) != nil {
        store?.set(url, forKey: "samepace.next-session.url")
        store?.set(expiresAt, forKey: "samepace.next-session.expires")
      } else {
        store?.removeObject(forKey: "samepace.next-session.url")
        store?.removeObject(forKey: "samepace.next-session.expires")
      }
    }
    OnAppEntersBackground { Task { await self.coordinator.cancelAll(); await self.privateCloud.cancelAll() } }
    OnDestroy { Task { await self.coordinator.cancelAll(); await self.privateCloud.cancelAll() } }
  }
}
