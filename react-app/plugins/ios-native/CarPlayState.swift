import Foundation

// MARK: - Snapshot models
//
// Mirrors the JSON produced by `buildAutoSnapshot` in `src/auto/autoSnapshot.ts`, which
// is the same payload the Android Auto service consumes.

struct CarPlayStationRecord: Codable, Identifiable {
    let id: String
    let title: String
    let serviceId: String
    let streamServiceIds: [String]
    let directStreamUrls: [String]
    let logoUrl: String
    let category: String

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        title = (try? container.decode(String.self, forKey: .title)) ?? id
        serviceId = (try? container.decode(String.self, forKey: .serviceId)) ?? ""
        streamServiceIds = (try? container.decode([String].self, forKey: .streamServiceIds)) ?? []
        directStreamUrls = (try? container.decode([String].self, forKey: .directStreamUrls)) ?? []
        logoUrl = (try? container.decode(String.self, forKey: .logoUrl)) ?? ""
        category = (try? container.decode(String.self, forKey: .category)) ?? ""
    }
}

struct CarPlayEpisode: Codable {
    var id: String = ""
    var title: String = ""
    var description: String = ""
    var imageUrl: String = ""
    var audioUrl: String = ""
    var pubDate: String = ""
    var pubDateEpochMs: Double = 0
    var durationMins: Double = 0
    var podcastId: String = ""
    var podcastTitle: String = ""
    var podcastImageUrl: String = ""
    var localFilePath: String?

    init() {}

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? container.decode(String.self, forKey: .id)) ?? ""
        title = (try? container.decode(String.self, forKey: .title)) ?? ""
        description = (try? container.decode(String.self, forKey: .description)) ?? ""
        imageUrl = (try? container.decode(String.self, forKey: .imageUrl)) ?? ""
        audioUrl = (try? container.decode(String.self, forKey: .audioUrl)) ?? ""
        pubDate = (try? container.decode(String.self, forKey: .pubDate)) ?? ""
        pubDateEpochMs = (try? container.decode(Double.self, forKey: .pubDateEpochMs)) ?? 0
        durationMins = (try? container.decode(Double.self, forKey: .durationMins)) ?? 0
        podcastId = (try? container.decode(String.self, forKey: .podcastId)) ?? ""
        podcastTitle = (try? container.decode(String.self, forKey: .podcastTitle)) ?? ""
        podcastImageUrl = (try? container.decode(String.self, forKey: .podcastImageUrl)) ?? ""
        localFilePath = try? container.decodeIfPresent(String.self, forKey: .localFilePath)
    }
}

struct CarPlayPodcast: Codable {
    let id: String
    var title: String = ""
    var description: String = ""
    var rssUrl: String = ""
    var imageUrl: String = ""
    var genres: [String] = []
    var typicalDurationMins: Double = 0
    var latestUpdateMs: Double = 0

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        title = (try? container.decode(String.self, forKey: .title)) ?? id
        description = (try? container.decode(String.self, forKey: .description)) ?? ""
        rssUrl = (try? container.decode(String.self, forKey: .rssUrl)) ?? ""
        imageUrl = (try? container.decode(String.self, forKey: .imageUrl)) ?? ""
        genres = (try? container.decode([String].self, forKey: .genres)) ?? []
        typicalDurationMins = (try? container.decode(Double.self, forKey: .typicalDurationMins)) ?? 0
        latestUpdateMs = (try? container.decode(Double.self, forKey: .latestUpdateMs)) ?? 0
    }
}

struct CarPlayPlaylist: Codable {
    let id: String
    let name: String
    let isDefault: Bool
    var entries: [CarPlayEpisode] = []
}

/// The most recent station or podcast episode the listener started, used to resume in the car.
struct CarPlayLastPlayed: Codable {
    var kind: String = "station"
    var id: String = ""
    var podcastId: String = ""
    var atMs: Double = 0

    var isEpisode: Bool { kind == "episode" }

    init(kind: String = "station", id: String = "", podcastId: String = "", atMs: Double = 0) {
        self.kind = kind == "episode" ? "episode" : "station"
        self.id = id
        self.podcastId = podcastId
        self.atMs = atMs
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        kind = (try? container.decode(String.self, forKey: .kind)) == "episode" ? "episode" : "station"
        id = (try? container.decode(String.self, forKey: .id)) ?? ""
        podcastId = (try? container.decode(String.self, forKey: .podcastId)) ?? ""
        atMs = (try? container.decode(Double.self, forKey: .atMs)) ?? 0
    }
}

struct CarPlaySnapshot: Codable {
    var version: Int = 0
    var generatedAtMs: Double = 0
    var stations: [CarPlayStationRecord] = []
    var favorites: [String] = []
    var audioQuality: String = "HIGH"
    var geoBlocked: Bool = false
    var startupPage: String = "all_stations"
    var scrollMode: String = "all"
    var podcastArtwork: String = "episode"
    var autoplayNext: String = "none"
    var hidePlayedInPlaylists: Bool = false
    var carplayStation: String = ""
    var carplayAutoResume: Bool = true
    var carplayHidePlayed: Bool = false
    var lastStationId: String = ""
    /// Most recently started item; preferred over `lastStationId` when resuming in the car.
    var lastPlayed: CarPlayLastPlayed?
    var subscriptions: [CarPlayPodcast] = []
    var subscribedIds: [String] = []
    var catalog: [CarPlayPodcast] = []
    var podcastSort: String = "most_recently_updated"
    var podcastManualOrder: [String] = []
    var podcastTags: [String: [String]] = [:]
    var episodes: [String: [CarPlayEpisode]] = [:]
    var playlists: [CarPlayPlaylist] = []
    var downloads: [CarPlayEpisode] = []
    var history: [CarPlayEpisode] = []
    var playedIds: [String] = []
    var progress: [String: Double] = [:]
    var lastPlayedEpoch: [String: Double] = [:]
    var analyticsEnabled: Bool = false
    var phonePlaybackActive: Bool = false

    static let empty = CarPlaySnapshot()
}

/// Native overrides layered on top of the snapshot so a change made in the car is
/// visible immediately, before the React layer reconciles it.
private struct CarPlayOverlay: Codable {
    var favorites: [String]?
    var subscribedIds: [String]?
    var history: [CarPlayEpisode]?
    var playedIds: [String]?
    var progress: [String: Double]?
    var lastPlayedEpoch: [String: Double]?
    var savedEpisodes: [CarPlayEpisode]?
    var lastPlayed: CarPlayLastPlayed?
}

// MARK: - State store

/// Shared state for the CarPlay experience, mirroring the Android `AutoState` store.
///
/// The React application is the single source of truth. It writes `snapshot.json` into
/// the shared caches directory and bumps `carplay_snapshot_revision` in `NSUserDefaults`;
/// this store reads it so CarPlay can browse and play even before the phone UI is shown.
/// Mutations performed in the car (favourite toggles, subscribe, save, played markers,
/// playback start/stop) are appended to `mutations.json` for the React layer to drain.
/// All mutable state is guarded by `lock`, so the store is safe to read from the
/// background queues that fetch show info and podcast feeds.
final class CarPlayState: @unchecked Sendable {
    static let shared = CarPlayState()

    /// Posted on the main queue whenever native state changes.
    static let didChangeNotification = Notification.Name("CarPlayStateDidChange")

    private static let directoryName = "carplay"
    private static let snapshotFileName = "snapshot.json"
    private static let mutationsFileName = "mutations.json"
    private static let overlayFileName = "overlay.json"
    private static let revisionKey = "carplay_snapshot_revision"
    private static let maxMutations = 200
    private static let maxHistory = 20

    private let lock = NSRecursiveLock()
    private let fileManager = FileManager.default

    private var cachedSnapshot: CarPlaySnapshot?
    private var cachedOverlay: CarPlayOverlay?
    private var cachedRevision: Int = -1

    private init() {}

    // MARK: Paths

    private var directoryURL: URL? {
        guard let caches = fileManager.urls(for: .cachesDirectory, in: .userDomainMask).first
        else { return nil }
        return caches.appendingPathComponent(Self.directoryName, isDirectory: true)
    }

    private var snapshotURL: URL? {
        directoryURL?.appendingPathComponent(Self.snapshotFileName, isDirectory: false)
    }

    // MARK: Snapshot

    /// Re-reads the snapshot when the React layer has pushed a newer revision.
    /// Returns true when new state was loaded.
    @discardableResult
    func reloadIfStale() -> Bool {
        let revision = UserDefaults.standard.integer(forKey: Self.revisionKey)
        lock.lock()
        defer { lock.unlock() }
        guard revision != cachedRevision else { return false }
        cachedRevision = revision
        guard let url = snapshotURL, let data = try? Data(contentsOf: url) else { return false }
        // A partially written file must never wipe usable state.
        guard let snapshot = try? JSONDecoder().decode(CarPlaySnapshot.self, from: data) else {
            return false
        }
        cachedSnapshot = snapshot
        return true
    }

    var snapshot: CarPlaySnapshot {
        reloadIfStale()
        lock.lock()
        defer { lock.unlock() }
        return cachedSnapshot ?? .empty
    }

    // MARK: Overlay

    private var overlay: CarPlayOverlay {
        lock.lock()
        defer { lock.unlock() }
        if let cached = cachedOverlay { return cached }
        let loaded = Self.decodeOverlay()
        cachedOverlay = loaded
        return loaded
    }

    private func updateOverlay(_ mutate: (inout CarPlayOverlay) -> Void) {
        lock.lock()
        defer { lock.unlock() }
        var current = cachedOverlay ?? Self.decodeOverlay()
        mutate(&current)
        cachedOverlay = current
        guard let url = overlayURL, let data = try? JSONEncoder().encode(current) else { return }
        try? data.write(to: url, options: .atomic)
    }

    private var overlayURL: URL? {
        directoryURL?.appendingPathComponent(Self.overlayFileName, isDirectory: false)
    }

    private static func decodeOverlay() -> CarPlayOverlay {
        guard
            let url = mutationsDirectory()?.appendingPathComponent(overlayFileName),
            let data = try? Data(contentsOf: url)
        else { return CarPlayOverlay() }
        return (try? JSONDecoder().decode(CarPlayOverlay.self, from: data)) ?? CarPlayOverlay()
    }

    private func effectiveList(_ keyPath: KeyPath<CarPlayOverlay, [String]?>) -> [String] {
        let overlayValue = overlay[keyPath: keyPath]
        if let overlayValue = overlayValue { return overlayValue }
        let snapshot = snapshot
        switch keyPath {
        case \CarPlayOverlay.favorites: return snapshot.favorites
        case \CarPlayOverlay.subscribedIds: return snapshot.subscribedIds
        case \CarPlayOverlay.playedIds: return snapshot.playedIds
        default: return []
        }
    }

    private func effectiveProgress(_ keyPath: KeyPath<CarPlayOverlay, [String: Double]?>)
        -> [String: Double] {
        let overlayValue = overlay[keyPath: keyPath]
        if let overlayValue = overlayValue { return overlayValue }
        let snapshot = snapshot
        switch keyPath {
        case \CarPlayOverlay.progress: return snapshot.progress
        case \CarPlayOverlay.lastPlayedEpoch: return snapshot.lastPlayedEpoch
        default: return [:]
        }
    }

    // MARK: Mutations (native -> React)

    /// Only these change what the browse tree should show, and they are all triggered
    /// from the now-playing screen, where rebuilding the root template is safe. Progress
    /// and playback telemetry deliberately do not notify: resetting the root template
    /// would throw the driver out of whatever list they are reading.
    private static let browseAffectingMutations: Set<String> = [
        "favoriteToggled", "subscribeToggled", "savedToggled"
    ]

    /// Appends a mutation record for the React layer to drain and reconcile.
    func addMutation(type: String, payload: [String: Any]) {
        let record: [String: Any] = [
            "type": type,
            "atMs": Date().timeIntervalSince1970 * 1000,
            "payload": payload
        ]
        lock.lock()
        var existing = Self.readMutations()
        existing.append(record)
        if existing.count > Self.maxMutations {
            existing = Array(existing.suffix(Self.maxMutations))
        }
        Self.writeMutations(existing)
        lock.unlock()
        if Self.browseAffectingMutations.contains(type) { notifyChanged() }
    }

    private static func mutationsDirectory() -> URL? {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?
            .appendingPathComponent(directoryName, isDirectory: true)
    }

    private static func readMutations() -> [[String: Any]] {
        guard
            let url = mutationsDirectory()?.appendingPathComponent(mutationsFileName),
            let data = try? Data(contentsOf: url)
        else { return [] }
        let parsed = try? JSONSerialization.jsonObject(with: data)
        return (parsed as? [[String: Any]]) ?? []
    }

    private static func writeMutations(_ records: [[String: Any]]) {
        guard
            let directory = mutationsDirectory(),
            JSONSerialization.isValidJSONObject(records),
            let data = try? JSONSerialization.data(withJSONObject: records)
        else { return }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try? data.write(
            to: directory.appendingPathComponent(mutationsFileName), options: .atomic)
    }

    private func notifyChanged() {
        DispatchQueue.main.async {
            NotificationCenter.default.post(name: Self.didChangeNotification, object: nil)
        }
    }

    // MARK: Settings

    func settingString(_ key: String, fallback: String = "") -> String {
        let snapshot = snapshot
        switch key {
        case "audioQuality": return snapshot.audioQuality.isEmpty ? fallback : snapshot.audioQuality
        case "startupPage": return snapshot.startupPage.isEmpty ? fallback : snapshot.startupPage
        case "scrollMode": return snapshot.scrollMode.isEmpty ? fallback : snapshot.scrollMode
        case "podcastArtwork":
            return snapshot.podcastArtwork.isEmpty ? fallback : snapshot.podcastArtwork
        case "autoplayNext": return snapshot.autoplayNext.isEmpty ? fallback : snapshot.autoplayNext
        case "podcastSort": return snapshot.podcastSort.isEmpty ? fallback : snapshot.podcastSort
        case "carplayStation":
            return snapshot.carplayStation.isEmpty ? fallback : snapshot.carplayStation
        case "lastStationId": return snapshot.lastStationId.isEmpty ? fallback : snapshot.lastStationId
        default: return fallback
        }
    }

    func settingBool(_ key: String, fallback: Bool = false) -> Bool {
        let snapshot = snapshot
        switch key {
        case "geoBlocked": return snapshot.geoBlocked
        case "hidePlayedInPlaylists": return snapshot.hidePlayedInPlaylists
        case "carplayAutoResume": return snapshot.carplayAutoResume
        case "carplayHidePlayed": return snapshot.carplayHidePlayed
        case "phonePlaybackActive": return snapshot.phonePlaybackActive
        case "analyticsEnabled": return snapshot.analyticsEnabled
        default: return fallback
        }
    }

    // MARK: Favourites

    var favorites: [String] { effectiveList(\.favorites) }

    @discardableResult
    func toggleFavorite(stationId: String) -> Bool {
        guard !stationId.isEmpty else { return false }
        var current = favorites
        let isFavorite: Bool
        if let index = current.firstIndex(of: stationId) {
            current.remove(at: index)
            isFavorite = false
        } else {
            current.append(stationId)
            isFavorite = true
        }
        updateOverlay { $0.favorites = current }
        addMutation(type: "favoriteToggled", payload: ["stationId": stationId, "favorite": isFavorite])
        return isFavorite
    }

    // MARK: Subscriptions

    var subscribedIds: [String] { effectiveList(\.subscribedIds) }

    var subscriptions: [CarPlayPodcast] { snapshot.subscriptions }

    /// Complete podcast catalogue from the index, available even when unsubscribed.
    var catalog: [CarPlayPodcast] { snapshot.catalog }

    func isSubscribed(podcastId: String) -> Bool {
        let ids = subscribedIds
        if !ids.isEmpty { return ids.contains(podcastId) }
        return subscriptions.contains { $0.id == podcastId }
    }

    func setSubscribed(podcastId: String, subscribed: Bool) {
        guard !podcastId.isEmpty else { return }
        var current = effectiveList(\.subscribedIds)
        if subscribed {
            if !current.contains(podcastId) { current.append(podcastId) }
        } else {
            current.removeAll { $0 == podcastId }
        }
        updateOverlay { $0.subscribedIds = current }
        addMutation(type: "subscribeToggled", payload: ["podcastId": podcastId, "subscribed": subscribed])
    }

    // MARK: Episodes

    func episodes(podcastId: String) -> [CarPlayEpisode] { snapshot.episodes[podcastId] ?? [] }

    func saveEpisodes(podcastId: String, episodes: [CarPlayEpisode]) {
        lock.lock()
        if var current = cachedSnapshot {
            current.episodes[podcastId] = episodes
            writeSnapshot(current)
        }
        lock.unlock()
    }

    func updatePodcastTitle(podcastId: String, title: String) {
        guard !title.isEmpty, title != podcastId else { return }
        lock.lock()
        defer { lock.unlock() }
        guard var current = cachedSnapshot else { return }
        var changed = false
        for index in current.subscriptions.indices
        where current.subscriptions[index].id == podcastId {
            if current.subscriptions[index].title.isEmpty
                || current.subscriptions[index].title == podcastId {
                current.subscriptions[index].title = title
                changed = true
            }
        }
        if changed { writeSnapshot(current) }
    }

    private func writeSnapshot(_ snapshot: CarPlaySnapshot) {
        guard let url = snapshotURL,
            let data = try? JSONEncoder().encode(snapshot)
        else { return }
        try? data.write(to: url, options: .atomic)
        cachedSnapshot = snapshot
    }

    func findPodcast(podcastId: String) -> CarPlayPodcast? {
        guard !podcastId.isEmpty else { return nil }
        return subscriptions.first { $0.id == podcastId } ?? catalog.first { $0.id == podcastId }
    }

    /// Resolves an episode id from any list the car can reach.
    func findEpisode(episodeId: String) -> CarPlayEpisode? {
        guard !episodeId.isEmpty else { return nil }
        for (podcastId, episodes) in snapshot.episodes {
            if let episode = episodes.first(where: { $0.id == episodeId }) {
                return enrich(episode, podcastId: podcastId)
            }
        }
        for playlist in snapshot.playlists {
            if let episode = playlist.entries.first(where: { $0.id == episodeId }) { return episode }
        }
        if let episode = snapshot.downloads.first(where: { $0.id == episodeId }) { return episode }
        return snapshot.history.first { $0.id == episodeId }
    }

    func enrich(_ episode: CarPlayEpisode, podcastId: String) -> CarPlayEpisode {
        var result = episode
        if result.podcastId.isEmpty { result.podcastId = podcastId }
        if result.podcastTitle.isEmpty, let podcast = subscriptions.first(where: { $0.id == podcastId }) {
            result.podcastTitle = podcast.title
            if result.podcastImageUrl.isEmpty { result.podcastImageUrl = podcast.imageUrl }
        }
        return result
    }

    // MARK: Playlists

    var playlists: [CarPlayPlaylist] { snapshot.playlists }

    func playlistEntries(playlistId: String) -> [CarPlayEpisode] {
        snapshot.playlists.first { $0.id == playlistId }?.entries ?? []
    }

    var downloads: [CarPlayEpisode] { snapshot.downloads }

    func isEpisodeSaved(episodeId: String) -> Bool {
        guard !episodeId.isEmpty else { return false }
        if let overlaid = overlay.savedEpisodes {
            return overlaid.contains { $0.id == episodeId }
        }
        return playlistEntries(playlistId: "saved").contains { $0.id == episodeId }
    }

    /// Saves or unsaves an episode, updating the overlay so the list changes at once.
    func setEpisodeSaved(_ episode: CarPlayEpisode, saved: Bool) {
        guard !episode.id.isEmpty else { return }
        var current = overlay.savedEpisodes ?? playlistEntries(playlistId: "saved")
        current.removeAll { $0.id == episode.id }
        if saved { current.insert(episode, at: 0) }
        updateOverlay { $0.savedEpisodes = current }
        addMutation(
            type: "savedToggled",
            payload: ["saved": saved, "entry": CarPlayState.jsonObject(for: episode)]
        )
    }

    // MARK: History

    var history: [CarPlayEpisode] {
        if let overlaid = overlay.history { return overlaid }
        return snapshot.history
    }

    func addHistory(_ episode: CarPlayEpisode) {
        guard !episode.id.isEmpty else { return }
        var current = history.filter { $0.id != episode.id }
        current.insert(episode, at: 0)
        let trimmed = Array(current.prefix(Self.maxHistory))
        updateOverlay { $0.history = trimmed }
        addMutation(type: "podcastHistoryAdded", payload: CarPlayState.jsonObject(for: episode))
    }

    // MARK: Last played

    /// The resume target. The overlay carries a change made in the car, but React is
    /// authoritative once it has pushed a record at least as recent as that change, so the
    /// newer timestamp wins instead of the overlay shadowing phone playback forever.
    var lastPlayedItem: CarPlayLastPlayed? {
        let overlaid = overlay.lastPlayed.flatMap { $0.id.isEmpty ? nil : $0 }
        let fromSnapshot = snapshot.lastPlayed.flatMap { $0.id.isEmpty ? nil : $0 }
        guard let overlaid = overlaid else { return fromSnapshot }
        guard let fromSnapshot = fromSnapshot else { return overlaid }
        return fromSnapshot.atMs >= overlaid.atMs ? fromSnapshot : overlaid
    }

    /// Records the item the car just started, in the overlay and as a mutation for React.
    func setLastPlayed(kind: String, id: String, podcastId: String = "") {
        guard !id.isEmpty else { return }
        let record = CarPlayLastPlayed(
            kind: kind == "episode" ? "episode" : "station",
            id: id,
            podcastId: podcastId,
            atMs: Date().timeIntervalSince1970 * 1000
        )
        updateOverlay { $0.lastPlayed = record }
        addMutation(
            type: "lastPlayed",
            payload: [
                "kind": record.kind,
                "id": record.id,
                "podcastId": record.podcastId,
                "atMs": record.atMs
            ]
        )
    }

    // MARK: Played / progress

    func isPlayed(episodeId: String) -> Bool {
        effectiveList(\.playedIds).contains(episodeId)
    }

    func markPlayed(episodeId: String, podcastId: String?, pubDateEpochMs: Double?) {
        guard !episodeId.isEmpty else { return }
        var current = effectiveList(\.playedIds)
        let newly = !current.contains(episodeId)
        if newly {
            current.append(episodeId)
            updateOverlay { $0.playedIds = current }
            // Completing an episode clears any saved resume position.
            removeProgress(episodeId: episodeId)
        }
        if let pubDateEpochMs = pubDateEpochMs, pubDateEpochMs > 0, let podcastId = podcastId,
            !podcastId.isEmpty {
            var epochs = effectiveProgress(\.lastPlayedEpoch)
            if pubDateEpochMs > (epochs[podcastId] ?? 0) {
                epochs[podcastId] = pubDateEpochMs
                updateOverlay { $0.lastPlayedEpoch = epochs }
            }
        }
        if newly {
            addMutation(
                type: "episodePlayed",
                payload: [
                    "episodeId": episodeId,
                    "podcastId": podcastId ?? "",
                    "pubDateEpochMs": pubDateEpochMs ?? 0,
                    "played": true
                ]
            )
        }
    }

    func progress(episodeId: String) -> Double {
        effectiveProgress(\.progress)[episodeId] ?? 0
    }

    func setProgress(episodeId: String, positionMs: Double) {
        guard positionMs > 0 else { return }
        var current = effectiveProgress(\.progress)
        current[episodeId] = positionMs
        updateOverlay { $0.progress = current }
    }

    private func removeProgress(episodeId: String) {
        var current = effectiveProgress(\.progress)
        current.removeValue(forKey: episodeId)
        updateOverlay { $0.progress = current }
    }

    func lastPlayedEpoch(podcastId: String) -> Double {
        effectiveProgress(\.lastPlayedEpoch)[podcastId] ?? 0
    }

    // MARK: Helpers

    /// Re-serialises a Codable episode into a JSON dictionary for the mutation queue.
    static func jsonObject(for episode: CarPlayEpisode) -> [String: Any] {
        let data = (try? JSONEncoder().encode(episode)) ?? Data()
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    }
}
