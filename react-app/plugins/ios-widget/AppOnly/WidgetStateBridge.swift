import CryptoKit
import Foundation
import UIKit
import WidgetKit

/// Mirrors the widget snapshot the React layer writes into its own cache into the App Group
/// container the WidgetKit extension reads.
///
/// The React layer cannot write to the shared container itself, so it follows the same
/// pattern the CarPlay scene uses: a small JSON file in the app's cache directory, plus a
/// counter in `NSUserDefaults` so the native side can watch for changes without pulling
/// state through the React Native bridge on every keystroke.
final class WidgetStateBridge: @unchecked Sendable {
    static let shared = WidgetStateBridge()

    /// Bumped by the React layer after every widget snapshot write.
    static let revisionKey = "widget_snapshot_revision"
    private static let cacheDirectoryName = "widget"
    private static let stateFileName = "state.json"
    private static let catalogueFileName = "catalogue.json"

    private let queue = DispatchQueue(label: "com.hyliankid14.bbcradioplayer.widget-state")
    private var lastRevision = -1
    private var started = false

    private init() {}

    func start() {
        guard !started else { return }
        started = true
        NotificationCenter.default.addObserver(
            forName: UserDefaults.didChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.syncIfChanged()
        }
        syncIfChanged()
    }

    /// Copies the React snapshot across, downloading artwork when the show has changed.
    private func syncIfChanged() {
        let revision = UserDefaults.standard.integer(forKey: Self.revisionKey)
        guard revision != lastRevision else { return }
        lastRevision = revision
        queue.async { [weak self] in
            self?.performSync()
        }
    }

    private func performSync() {
        guard
            let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
        else { return }
        let directory = caches.appendingPathComponent(Self.cacheDirectoryName, isDirectory: true)

        if let data = try? Data(contentsOf: directory.appendingPathComponent(Self.catalogueFileName)),
           let stations = try? JSONDecoder().decode([WidgetSharedState.Station].self, from: data) {
            WidgetSharedState.saveStations(stations)
        }

        guard
            let data = try? Data(contentsOf: directory.appendingPathComponent(Self.stateFileName)),
            let snapshot = try? JSONDecoder().decode(Snapshot.self, from: data)
        else { return }

        WidgetSharedState.saveState(
            WidgetSharedState.State(
                stationId: snapshot.stationId,
                stationTitle: snapshot.stationTitle,
                showLine: snapshot.showLine,
                isPlaying: snapshot.isPlaying,
                artworkFile: snapshot.artworkUrl.flatMap { cacheArtwork($0) }
            )
        )
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// Downloads show artwork into the shared container. Widget extensions have no network
    /// access, so the app has to do it: the widget can only ever show what was cached here.
    private func cacheArtwork(_ urlString: String) -> String? {
        guard
            let remote = URL(string: urlString),
            let directory = WidgetSharedState.directory(WidgetSharedState.artworkDirectoryName)
        else { return nil }

        // Keyed by URL so a show that keeps its artwork is downloaded once, not on every push.
        let digest = SHA256.hash(data: Data(urlString.utf8))
        let fileName = digest.compactMap { String(format: "%02x", $0) }.joined() + ".jpg"
        let destination = directory.appendingPathComponent(fileName)

        if FileManager.default.fileExists(atPath: destination.path) {
            pruneArtwork(keeping: fileName)
            return fileName
        }

        guard let data = try? Data(contentsOf: remote),
              let image = UIImage(data: data),
              let encoded = image.jpegData(compressionQuality: 0.7)
        else { return nil }

        try? encoded.write(to: destination, options: .atomic)
        pruneArtwork(keeping: fileName)
        return fileName
    }

    /// Keeps one artwork file, because a widget only ever shows the show that is playing now.
    private func pruneArtwork(keeping fileName: String) {
        guard let directory = WidgetSharedState.directory(WidgetSharedState.artworkDirectoryName),
              let entries = try? FileManager.default.contentsOfDirectory(
                at: directory,
                includingPropertiesForKeys: nil
              )
        else { return }
        for entry in entries where entry.lastPathComponent != fileName {
            try? FileManager.default.removeItem(at: entry)
        }
    }

    /// What the React layer writes. The artwork is a URL here because only the app can
    /// fetch it; the shared model stores the file name it becomes.
    private struct Snapshot: Decodable {
        let stationId: String
        let stationTitle: String
        let showLine: String
        let isPlaying: Bool
        let artworkUrl: String?
    }
}
