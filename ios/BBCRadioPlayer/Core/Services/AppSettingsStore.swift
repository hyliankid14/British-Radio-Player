import Foundation

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
