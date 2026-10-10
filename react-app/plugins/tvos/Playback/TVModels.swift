import Foundation

enum TVAudioQuality: String, CaseIterable, Codable, Identifiable {
    case low = "low"
    case standard = "standard"
    case high = "high"
    
    var id: String { rawValue }
    
    var displayName: String {
        switch self {
        case .low: return "Low Data (48 kbps)"
        case .standard: return "Standard (128 kbps)"
        case .high: return "High Fidelity (320 kbps)"
        }
    }
    
    var bitrate: String {
        switch self {
        case .low: return "48000"
        case .standard: return "128000"
        case .high: return "320000"
        }
    }
}

enum TVStationCategory: String, CaseIterable, Codable, Identifiable {
    case national = "national"
    case regions = "regions"
    case local = "local"
    
    var id: String { rawValue }
    
    var title: String {
        switch self {
        case .national: return "National"
        case .regions: return "Regional"
        case .local: return "Local Radio"
        }
    }
}

struct TVStation: Identifiable, Codable, Hashable {
    let id: String
    let title: String
    let serviceId: String
    let streamServiceIds: [String]
    let directStreamUrls: [String]?
    let logoUrl: String
    let category: TVStationCategory
    var tagline: String? = nil
}

struct TVPodcast: Identifiable, Codable, Hashable {
    let id: String
    var title: String
    let rssUrl: String
    var imageUrl: String
    var author: String? = nil
    var description: String? = nil
    var genre: String? = nil
}

struct TVEpisode: Identifiable, Codable, Hashable {
    let id: String
    let title: String
    let podcastId: String
    let mediaUrl: String
    let duration: Int
    var pubDate: String?
    var imageUrl: String?
    var summary: String? = nil
}
