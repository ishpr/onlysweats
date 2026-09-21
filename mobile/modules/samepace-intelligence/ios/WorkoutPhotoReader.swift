import Foundation
import ImageIO
import Vision

enum WorkoutPhotoReader {
  /// Reads only an explicitly picked, local, app-container image. No Photos
  /// library enumeration, remote URL loading, copies, caches, or upload.
  static func read(_ uri: String) async throws -> String {
    guard uri.utf8.count <= 4_096, let url = URL(string: uri), url.isFileURL,
          url.host == nil || url.host == "" || url.host == "localhost" else { throw IntelligenceFailure.imageUnavailable }
    let path = url.resolvingSymlinksInPath().standardizedFileURL.path
    let home = URL(fileURLWithPath: NSHomeDirectory()).resolvingSymlinksInPath().standardizedFileURL.path
    guard path.hasPrefix(home + "/") else { throw IntelligenceFailure.imageUnavailable }
    let properties = try url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
    guard properties.isRegularFile == true, let size = properties.fileSize, size > 0 else { throw IntelligenceFailure.imageUnavailable }
    guard size <= 25_000_000 else { throw IntelligenceFailure.imageTooLarge }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    let worker = Task.detached(priority: .userInitiated) {
      try Task.checkCancellation()
      guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
            let info = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
            let width = info[kCGImagePropertyPixelWidth] as? Int,
            let height = info[kCGImagePropertyPixelHeight] as? Int,
            width > 0, height > 0, Double(width) * Double(height) <= 80_000_000,
            let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
              kCGImageSourceCreateThumbnailFromImageAlways: true,
              kCGImageSourceCreateThumbnailWithTransform: true,
              kCGImageSourceThumbnailMaxPixelSize: 3_072,
              kCGImageSourceShouldCacheImmediately: true
            ] as CFDictionary) else { throw IntelligenceFailure.imageUnavailable }
      try Task.checkCancellation()
      try VNImageRequestHandler(cgImage: image).perform([request])
      try Task.checkCancellation()
      let observations = request.results ?? []
      guard observations.count <= 120 else { throw IntelligenceFailure.tooMuchText }
      // Low-confidence lines remain visible for editing, never silently promoted
      // to measured facts. Do not spell-correct units or weights with a language model.
      let text = observations.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
      guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw IntelligenceFailure.noText }
      guard text.count <= 4_000 else { throw IntelligenceFailure.tooMuchText }
      return text
    }
    return try await withTaskCancellationHandler(operation: { try await worker.value }, onCancel: {
      worker.cancel()
      request.cancel()
    })
  }
}
