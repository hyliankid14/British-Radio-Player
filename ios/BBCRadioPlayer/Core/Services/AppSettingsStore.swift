import Foundation
import SwiftUI
import UIKit

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

    private let defaults: UserDefaults
    private let playbackQualityKey = "playback_quality"
    private let appThemeKey = "app_theme"
    private let compactRowsKey = "compact_rows"
    private let stationSkipModeKey = "station_skip_mode"
    private let podcastArtworkModeKey = "podcast_artwork_mode"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.playbackQuality = PlaybackQuality(rawValue: defaults.string(forKey: playbackQualityKey) ?? "high") ?? .high
        self.appTheme = AppTheme(rawValue: defaults.string(forKey: appThemeKey) ?? "system") ?? .system
        self.compactRows = defaults.object(forKey: compactRowsKey) as? Bool ?? true
        self.stationSkipMode = StationSkipMode(rawValue: defaults.string(forKey: stationSkipModeKey) ?? "allStations") ?? .allStations
        self.podcastArtworkMode = PodcastArtworkMode(rawValue: defaults.string(forKey: podcastArtworkModeKey) ?? "episode") ?? .episode
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
            request.setValue("BBC-Radio-Player-iOS/\(appVersionString())", forHTTPHeaderField: "User-Agent")
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
}
