import Foundation

enum AudioQuality: String, Codable {
    case low = "low"
    case standard = "standard"
    case high = "high"
    
    var bitrate: String {
        switch self {
        case .low: return "48000"
        case .standard: return "128000"
        case .high: return "320000"
        }
    }
}

enum StationCategory: String, Codable {
    case national = "national"
    case regions = "regions"
    case local = "local"
}

struct WatchStation: Identifiable, Codable, Hashable {
    let id: String
    let title: String
    let serviceId: String
    let streamServiceIds: [String]
    let directStreamUrls: [String]?
    let logoUrl: String
    let category: StationCategory
}

struct WatchPodcast: Identifiable, Codable, Hashable {
    let id: String
    let title: String
    let rssUrl: String
    let imageUrl: String
}

struct WatchEpisode: Identifiable, Codable, Hashable {
    let id: String
    let title: String
    let podcastId: String
    let mediaUrl: String
    let duration: Int
}

struct WatchAppState: Codable {
    var favourite_ids: [String]?
    var favourite_order: [String]?
    var subscribed_podcast_ids: [String]?
    var has_subscription_snapshot: Bool?
    var played_episode_ids: [String]?
    var history_episode_ids: [String]?
    var history_meta_json: String?
    var episode_progress_json: String?
    var has_episode_snapshot: Bool?
    var lastfm_session_key: String?
    var lastfm_proxy_url: String?
    var lastfm_username: String?
    var lastfm_direct_enabled: Bool?
    var lastfm_broadcast_enabled: Bool?
    var lastfm_scrobble_podcasts: Bool?
}
