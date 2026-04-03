import Foundation
import SwiftUI
import UIKit
import UserNotifications

private final class HTTPSRedirectUpgradeDelegate: NSObject, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(request._upgradingToSecureTransport())
    }
}

enum AppTheme: String, CaseIterable {
    case system
    case light
    case dark

    var displayName: String {
        switch self {
        case .system:
            return "System"
        case .light:
            return "Light"
        case .dark:
            return "Dark"
        }
    }
}

enum StationSkipMode: String, CaseIterable {
    case allStations
    case favouritesOnly

    var displayName: String {
        switch self {
        case .allStations:
            return "All stations"
        case .favouritesOnly:
            return "Favourites only"
        }
    }
}

enum PodcastArtworkMode: String, CaseIterable {
    case episode
    case podcast

    var displayName: String {
        switch self {
        case .episode:
            return "Episode artwork"
        case .podcast:
            return "Podcast artwork"
        }
    }
}

enum AutoDownloadLimit: Int, CaseIterable, Identifiable {
    case one = 1
    case two = 2
    case three = 3
    case five = 5
    case ten = 10

    var id: Int { rawValue }

    var displayName: String {
        "\(rawValue) latest episodes"
    }
}

enum AutoplayNextEpisode: String, CaseIterable {
    case allPodcasts = "all_podcasts"
    case subscriptionsOnly = "subscriptions_only"
    case none = "none"

    var displayName: String {
        switch self {
        case .allPodcasts:
            return "All podcasts"
        case .subscriptionsOnly:
            return "Subscriptions only"
        case .none:
            return "None"
        }
    }
}

final class AppSettingsStore: ObservableObject {
    @Published var playbackQuality: PlaybackQuality {
        didSet { defaults.set(playbackQuality.rawValue, forKey: playbackQualityKey) }
    }

    @Published var appTheme: AppTheme {
        didSet { defaults.set(appTheme.rawValue, forKey: appThemeKey) }
    }

    @Published var compactRows: Bool {
        didSet { defaults.set(compactRows, forKey: compactRowsKey) }
    }

    @Published var stationSkipMode: StationSkipMode {
        didSet { defaults.set(stationSkipMode.rawValue, forKey: stationSkipModeKey) }
    }

    @Published var podcastArtworkMode: PodcastArtworkMode {
        didSet { defaults.set(podcastArtworkMode.rawValue, forKey: podcastArtworkModeKey) }
    }

    @Published var episodeIndexAutoUpdatesEnabled: Bool {
        didSet { defaults.set(episodeIndexAutoUpdatesEnabled, forKey: episodeIndexAutoUpdatesEnabledKey) }
    }

    @Published var episodeIndexLastUpdated: Date? {
        didSet {
            if let episodeIndexLastUpdated {
                defaults.set(episodeIndexLastUpdated, forKey: episodeIndexLastUpdatedKey)
            } else {
                defaults.removeObject(forKey: episodeIndexLastUpdatedKey)
            }
        }
    }

    @Published var autoDownloadSavedEpisodes: Bool {
        didSet { defaults.set(autoDownloadSavedEpisodes, forKey: autoDownloadSavedEpisodesKey) }
    }

    @Published var autoDownloadSubscribedPodcasts: Bool {
        didSet { defaults.set(autoDownloadSubscribedPodcasts, forKey: autoDownloadSubscribedPodcastsKey) }
    }

    @Published var autoDownloadLimit: AutoDownloadLimit {
        didSet { defaults.set(autoDownloadLimit.rawValue, forKey: autoDownloadLimitKey) }
    }

    @Published var autoplayNextEpisode: AutoplayNextEpisode {
        didSet { defaults.set(autoplayNextEpisode.rawValue, forKey: autoplayNextEpisodeKey) }
    }

    private let defaults: UserDefaults
    private let playbackQualityKey = "playback_quality"
    private let appThemeKey = "app_theme"
    private let compactRowsKey = "compact_rows"
    private let stationSkipModeKey = "station_skip_mode"
    private let podcastArtworkModeKey = "podcast_artwork_mode"
    private let episodeIndexAutoUpdatesEnabledKey = "episode_index_auto_update"
    private let episodeIndexLastUpdatedKey = "episode_index_last_updated"
    private let autoDownloadSavedEpisodesKey = "auto_download_saved_episodes"
    private let autoDownloadSubscribedPodcastsKey = "auto_download_subscribed_podcasts"
    private let autoDownloadLimitKey = "auto_download_limit"
    private let autoplayNextEpisodeKey = "autoplay_next_episode"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.playbackQuality = PlaybackQuality(rawValue: defaults.string(forKey: playbackQualityKey) ?? "high") ?? .high
        self.appTheme = AppTheme(rawValue: defaults.string(forKey: appThemeKey) ?? "system") ?? .system
        self.compactRows = defaults.object(forKey: compactRowsKey) as? Bool ?? true
        self.stationSkipMode = StationSkipMode(rawValue: defaults.string(forKey: stationSkipModeKey) ?? "allStations") ?? .allStations
        self.podcastArtworkMode = PodcastArtworkMode(rawValue: defaults.string(forKey: podcastArtworkModeKey) ?? "episode") ?? .episode
        self.episodeIndexAutoUpdatesEnabled = defaults.object(forKey: episodeIndexAutoUpdatesEnabledKey) as? Bool ?? true
        self.episodeIndexLastUpdated = defaults.object(forKey: episodeIndexLastUpdatedKey) as? Date
        self.autoDownloadSavedEpisodes = defaults.object(forKey: autoDownloadSavedEpisodesKey) as? Bool ?? false
        self.autoDownloadSubscribedPodcasts = defaults.object(forKey: autoDownloadSubscribedPodcastsKey) as? Bool ?? false
        self.autoDownloadLimit = AutoDownloadLimit(rawValue: defaults.integer(forKey: autoDownloadLimitKey)) ?? .one
        self.autoplayNextEpisode = AutoplayNextEpisode(rawValue: defaults.string(forKey: autoplayNextEpisodeKey) ?? "none") ?? .none
    }
}

enum EpisodeDownloadStatus: Equatable {
    case notDownloaded
    case downloading
    case downloaded(URL)
    case failed(String)
}

private struct DownloadedEpisodeRecord: Codable, Equatable {
    let episodeID: String
    let sourceAudioURLString: String
    let localFileName: String
    let episodeTitle: String
    let podcastTitle: String?
    let createdAt: Date
}

@MainActor
final class EpisodeDownloadService: ObservableObject {
    @Published private(set) var downloadedEpisodeCount: Int = 0

    private let defaults: UserDefaults
    private let session: URLSession
    private let fileManager: FileManager
    private let redirectUpgradeDelegate = HTTPSRedirectUpgradeDelegate()
    private var recordsByEpisodeID: [String: DownloadedEpisodeRecord] = [:]
    private var activeEpisodeIDs: Set<String> = []
    private var failureMessagesByEpisodeID: [String: String] = [:]

    private static let recordsKey = "downloaded_episode_records"
    private static let downloadsFolderName = "Episode Downloads"

    init(
        defaults: UserDefaults = .standard,
        session: URLSession = .shared,
        fileManager: FileManager = .default
    ) {
        self.defaults = defaults
        self.session = session
        self.fileManager = fileManager
        loadRecords()
    }

    func status(for episode: Episode) -> EpisodeDownloadStatus {
        if activeEpisodeIDs.contains(episode.id) {
            return .downloading
        }

        if let record = downloadedRecord(for: episode),
           let fileURL = localFileURL(for: record) {
            return .downloaded(fileURL)
        }

        if let message = failureMessagesByEpisodeID[episode.id], !message.isEmpty {
            return .failed(message)
        }

        return .notDownloaded
    }

    func localFileURL(for episode: Episode) -> URL? {
        guard let record = downloadedRecord(for: episode) else { return nil }
        return localFileURL(for: record)
    }

    func downloadEpisode(_ episode: Episode, podcastTitle: String?) async -> Bool {
        if case .downloaded = status(for: episode) {
            return true
        }
        guard !activeEpisodeIDs.contains(episode.id) else {
            return false
        }

        activeEpisodeIDs.insert(episode.id)
        failureMessagesByEpisodeID[episode.id] = nil
        objectWillChange.send()

        defer {
            activeEpisodeIDs.remove(episode.id)
            objectWillChange.send()
        }

        do {
            let downloadsDirectory = try ensureDownloadsDirectory()
            let destinationURL = downloadsDirectory.appendingPathComponent(fileName(for: episode))
            let secureSourceURL = episode.audioURL._normalisedSecureBBCMediaURL()

            var request = URLRequest(url: secureSourceURL)
            request.timeoutInterval = 120
            request.setValue("British Radio Player/1.0 (iOS)", forHTTPHeaderField: "User-Agent")
            request.setValue("audio/mpeg,audio/*,*/*", forHTTPHeaderField: "Accept")

            do {
                let (temporaryURL, response) = try await session.download(for: request, delegate: redirectUpgradeDelegate)
                guard let httpResponse = response as? HTTPURLResponse,
                      (200..<300).contains(httpResponse.statusCode) else {
                    throw URLError(.badServerResponse)
                }

                if fileManager.fileExists(atPath: destinationURL.path) {
                    try fileManager.removeItem(at: destinationURL)
                }
                try fileManager.moveItem(at: temporaryURL, to: destinationURL)
            } catch {
                let (data, response) = try await session.data(for: request, delegate: redirectUpgradeDelegate)
                guard let httpResponse = response as? HTTPURLResponse,
                      (200..<300).contains(httpResponse.statusCode),
                      !data.isEmpty else {
                    throw error
                }

                if fileManager.fileExists(atPath: destinationURL.path) {
                    try fileManager.removeItem(at: destinationURL)
                }
                try data.write(to: destinationURL, options: .atomic)
            }

            let record = DownloadedEpisodeRecord(
                episodeID: episode.id,
                sourceAudioURLString: episode.audioURL.absoluteString,
                localFileName: destinationURL.lastPathComponent,
                episodeTitle: episode.title,
                podcastTitle: podcastTitle,
                createdAt: Date()
            )

            recordsByEpisodeID[episode.id] = record
            persistRecords()
            downloadedEpisodeCount = recordsByEpisodeID.count
            return true
        } catch {
            failureMessagesByEpisodeID[episode.id] = error.localizedDescription
            return false
        }
    }

    func deleteDownload(for episode: Episode) {
        guard let record = downloadedRecord(for: episode) else { return }
        deleteRecord(record)
    }

    func deleteDownload(episodeID: String) {
        guard let record = recordsByEpisodeID[episodeID] else { return }
        deleteRecord(record)
    }

    func deleteAllDownloads() {
        let records = Array(recordsByEpisodeID.values)
        records.forEach(deleteRecord)
        failureMessagesByEpisodeID.removeAll()
    }

    func scheduleSavedEpisodeDownloads(_ snapshots: [SavedEpisodeSnapshot]) {
        let pendingEpisodes = snapshots.compactMap { snapshot -> (Episode, String?)? in
            guard let episode = snapshot.asEpisode else { return nil }
            guard case .notDownloaded = status(for: episode) else { return nil }
            return (episode, snapshot.podcastTitle)
        }

        guard !pendingEpisodes.isEmpty else { return }

        Task { @MainActor [weak self] in
            guard let self else { return }
            for (episode, podcastTitle) in pendingEpisodes {
                _ = await self.downloadEpisode(episode, podcastTitle: podcastTitle)
            }
        }
    }

    func scheduleSubscribedPodcastDownloads(
        _ snapshots: [SavedPodcastSnapshot],
        podcastRepository: any PodcastRepository,
        limit: Int
    ) {
        let podcasts = snapshots.compactMap(\._asPodcastDownloadSeed)
        guard !podcasts.isEmpty else { return }
        let clampedLimit = max(1, limit)

        Task { @MainActor [weak self] in
            guard let self else { return }

            for (podcast, podcastTitle) in podcasts {
                let episodes: [Episode]
                do {
                    episodes = try await podcastRepository.fetchEpisodes(for: podcast)
                } catch {
                    continue
                }

                let latestEpisodes = episodes
                    .sorted(by: { self.parseEpisodeDate($0.pubDate) > self.parseEpisodeDate($1.pubDate) })
                    .prefix(clampedLimit)

                for episode in latestEpisodes {
                    if case .notDownloaded = self.status(for: episode) {
                        _ = await self.downloadEpisode(episode, podcastTitle: podcastTitle)
                    }
                }
            }
        }
    }

    private func loadRecords() {
        guard let data = defaults.data(forKey: Self.recordsKey),
              let decodedRecords = try? JSONDecoder().decode([DownloadedEpisodeRecord].self, from: data) else {
            downloadedEpisodeCount = 0
            return
        }

        let validRecords = decodedRecords.filter { record in
            localFileURL(for: record) != nil
        }

        recordsByEpisodeID = Dictionary(uniqueKeysWithValues: validRecords.map { ($0.episodeID, $0) })
        downloadedEpisodeCount = recordsByEpisodeID.count
        if validRecords.count != decodedRecords.count {
            persistRecords()
        }
    }

    private func persistRecords() {
        let records = recordsByEpisodeID.values.sorted { lhs, rhs in
            lhs.createdAt > rhs.createdAt
        }
        if let data = try? JSONEncoder().encode(records) {
            defaults.set(data, forKey: Self.recordsKey)
        }
    }

    private func downloadedRecord(for episode: Episode) -> DownloadedEpisodeRecord? {
        if let record = recordsByEpisodeID[episode.id], localFileURL(for: record) != nil {
            return record
        }

        return recordsByEpisodeID.values.first(where: { record in
            record.sourceAudioURLString == episode.audioURL.absoluteString && localFileURL(for: record) != nil
        })
    }

    private func localFileURL(for record: DownloadedEpisodeRecord) -> URL? {
        let fileURL = downloadsDirectoryURL().appendingPathComponent(record.localFileName)
        return fileManager.fileExists(atPath: fileURL.path) ? fileURL : nil
    }

    private func ensureDownloadsDirectory() throws -> URL {
        let directoryURL = downloadsDirectoryURL()
        if !fileManager.fileExists(atPath: directoryURL.path) {
            try fileManager.createDirectory(at: directoryURL, withIntermediateDirectories: true)
        }
        return directoryURL
    }

    private func downloadsDirectoryURL() -> URL {
        let documentsDirectory = fileManager.urls(for: .documentDirectory, in: .userDomainMask).first ?? fileManager.temporaryDirectory
        return documentsDirectory.appendingPathComponent(Self.downloadsFolderName, isDirectory: true)
    }

    private func deleteRecord(_ record: DownloadedEpisodeRecord) {
        if let fileURL = localFileURL(for: record) {
            try? fileManager.removeItem(at: fileURL)
        }
        recordsByEpisodeID[record.episodeID] = nil
        failureMessagesByEpisodeID[record.episodeID] = nil
        persistRecords()
        downloadedEpisodeCount = recordsByEpisodeID.count
        objectWillChange.send()
    }

    private func fileName(for episode: Episode) -> String {
        let extensionComponent = episode.audioURL.pathExtension.isEmpty ? "mp3" : episode.audioURL.pathExtension
        let safeTitle = sanitisedFileComponent(episode.title)
        let discriminator = stableDiscriminator(for: episode.id)
        return "\(safeTitle)-\(discriminator).\(extensionComponent)"
    }

    private func sanitisedFileComponent(_ value: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(.whitespaces)
        let filteredScalars = value.unicodeScalars.map { scalar in
            allowed.contains(scalar) ? Character(scalar) : " "
        }
        let filtered = String(filteredScalars)
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "\\s+", with: "-", options: .regularExpression)
        return filtered.isEmpty ? "episode" : filtered.prefix(60).description
    }

    private func stableDiscriminator(for value: String) -> String {
        let hash = value.unicodeScalars.reduce(UInt64(5381)) { partialResult, scalar in
            ((partialResult << 5) &+ partialResult) &+ UInt64(scalar.value)
        }
        return String(hash, radix: 16)
    }

    private func parseEpisodeDate(_ dateString: String) -> Date {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")

        let formats = [
            "EEE, dd MMM yyyy HH:mm:ss Z",
            "EEE, dd MMM yyyy HH:mm:ss zzz",
            "yyyy-MM-dd'T'HH:mm:ssZ",
            "yyyy-MM-dd'T'HH:mm:ss.SSSZ",
            "yyyy-MM-dd"
        ]

        for format in formats {
            formatter.dateFormat = format
            if let date = formatter.date(from: dateString) {
                return date
            }
        }

        return .distantPast
    }
}

private extension URL {
    func _normalisedSecureBBCMediaURL() -> URL {
        var value = absoluteString
        if value.hasPrefix("http://") {
            value = "https://" + value.dropFirst("http://".count)
        }
        value = value.replacingOccurrences(of: "/proto/http/", with: "/proto/https/")
        return URL(string: value) ?? self
    }
}

private extension URLRequest {
    func _upgradingToSecureTransport() -> URLRequest {
        guard let url else { return self }
        let secureURL = url._normalisedSecureBBCMediaURL()
        guard secureURL != url else { return self }
        var upgraded = self
        upgraded.url = secureURL
        return upgraded
    }
}

private extension SavedPodcastSnapshot {
    var _asPodcastDownloadSeed: (Podcast, String)? {
        guard let podcast = asPodcast else { return nil }
        return (podcast, title)
    }
}

final class PrivacyAnalyticsService: ObservableObject {
    private let defaults: UserDefaults
    private let session: URLSession

    private let enabledKey = "analytics_enabled"
    private let firstRunShownKey = "analytics_first_run"

    private let analyticsEndpoint = "https://raspberrypi.tailc23afa.ts.net:8443/event"

    @Published var isEnabled: Bool {
        didSet {
            defaults.set(isEnabled, forKey: enabledKey)
        }
    }

    init(defaults: UserDefaults = .standard, session: URLSession = .shared) {
        self.defaults = defaults
        self.session = session
        self.isEnabled = defaults.bool(forKey: enabledKey)
    }

    var shouldShowOptInDialog: Bool {
        defaults.object(forKey: firstRunShownKey) == nil
    }

    func markOptInDialogShown() {
        defaults.set(true, forKey: firstRunShownKey)
    }

    func trackStationPlay(stationID: String, stationName: String?) async {
        guard isEnabled else { return }

        var event: [String: Any] = [
            "event": "station_play",
            "station_id": stationID,
            "date": utcISO8601Timestamp(),
            "app_version": appVersionString(),
            "platform": "ios"
        ]
        if let stationName, !stationName.isEmpty {
            event["station_name"] = stationName
        }

        await sendEvent(event)
    }

    func trackEpisodePlay(
        podcastID: String,
        episodeID: String,
        episodeTitle: String?,
        podcastTitle: String?
    ) async {
        guard isEnabled else { return }

        var event: [String: Any] = [
            "event": "episode_play",
            "podcast_id": podcastID,
            "episode_id": episodeID,
            "date": utcISO8601Timestamp(),
            "app_version": appVersionString(),
            "platform": "ios"
        ]
        if let podcastTitle, !podcastTitle.isEmpty {
            event["podcast_title"] = podcastTitle
        }
        if let episodeTitle, !episodeTitle.isEmpty {
            event["episode_title"] = episodeTitle
        }

        await sendEvent(event)
    }

    private func sendEvent(_ event: [String: Any]) async {
        guard let url = URL(string: analyticsEndpoint) else { return }

        do {
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.timeoutInterval = 5
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("British-Radio-Player-iOS/\(appVersionString())", forHTTPHeaderField: "User-Agent")
            request.httpBody = try JSONSerialization.data(withJSONObject: event)

            _ = try await session.data(for: request)
        } catch {
            // Keep this intentionally silent. Analytics failures must never affect playback.
        }
    }

    private func utcISO8601Timestamp() -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss'Z'"
        return formatter.string(from: Date())
    }

    private func appVersionString() -> String {
        let short = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown"
#if DEBUG
        return "\(short)-debug"
#else
        return short
#endif
    }
}

final class PodcastNotificationService {
    private let defaults: UserDefaults
    private let lastSeenKeyPrefix = "podcast_last_episode_id_"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func requestAuthorisation() async {
        _ = try? await UNUserNotificationCenter.current()
            .requestAuthorization(options: [.alert, .sound])
    }

    func isAuthorised() async -> Bool {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        return settings.authorizationStatus == .authorized
    }

    /// Check podcasts that have notifications enabled; fire a local notification if a new
    /// episode has appeared since the last known episode ID.
    func checkForNewEpisodes(
        podcastRepository: any PodcastRepository,
        favoritesStore: FavoritesStore
    ) async {
        let notifIDs = await MainActor.run { favoritesStore.notificationsEnabledIDs }
        guard !notifIDs.isEmpty else { return }
        guard await isAuthorised() else { return }

        for podcastID in notifIDs {
            let snapshot = await MainActor.run { favoritesStore.subscribedPodcastSnapshotsByID[podcastID] }
            guard let snapshot, let podcast = snapshot.asPodcast else { continue }

            let episodes: [Episode]
            do {
                episodes = try await podcastRepository.fetchEpisodes(for: podcast)
            } catch {
                continue
            }

            guard let latest = episodes.sorted(by: { $0.pubDate > $1.pubDate }).first else { continue }

            let key = lastSeenKeyPrefix + podcastID
            let lastSeenID = defaults.string(forKey: key)

            if lastSeenID == nil {
                // Seed on first run — do not notify
                defaults.set(latest.id, forKey: key)
                continue
            }

            if lastSeenID != latest.id {
                sendNotification(podcastTitle: snapshot.title, episodeTitle: latest.title, podcastID: podcastID)
                defaults.set(latest.id, forKey: key)
            }
        }
    }

    private func sendNotification(podcastTitle: String, episodeTitle: String, podcastID: String) {
        let content = UNMutableNotificationContent()
        content.title = podcastTitle.isEmpty ? "New episode" : podcastTitle
        content.body = episodeTitle.isEmpty ? "A new episode has been released." : episodeTitle
        content.sound = .default

        let request = UNNotificationRequest(
            identifier: "podcast-new-\(podcastID)",
            content: content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(request) { _ in }
    }
}

extension Color {
    static var brandText: Color {
        Color(
            uiColor: UIColor { trait in
                if trait.userInterfaceStyle == .dark {
                    return UIColor(red: 0.56, green: 0.76, blue: 1.00, alpha: 1.0)
                }
                return UIColor(red: 0.04, green: 0.41, blue: 0.89, alpha: 1.0)
            }
        )
    }

    static var subtitleText: Color {
        Color(
            uiColor: UIColor { trait in
                if trait.userInterfaceStyle == .dark {
                    return UIColor(white: 0.65, alpha: 1.0)  // lighter grey for readability on dark backgrounds
                }
                return UIColor.secondaryLabel
            }
        )
    }
}
