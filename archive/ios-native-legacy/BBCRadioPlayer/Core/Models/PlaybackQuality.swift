import Foundation

enum PlaybackQuality: String, CaseIterable, Codable {
    case auto = "Auto"
    case high = "High"
    case low = "Low"

    var bitrate: String {
        switch self {
        case .auto:
            // Auto will be determined at runtime based on network conditions
            return "0" // Placeholder, actual selection happens in player
        case .high:
            return "320000"
        case .low:
            return "128000"
        }
    }

    var displayName: String {
        switch self {
        case .auto:
            return "Auto (based on network)"
        case .high:
            return "High (320 kbps)"
        case .low:
            return "Low (128 kbps)"
        }
    }
}
