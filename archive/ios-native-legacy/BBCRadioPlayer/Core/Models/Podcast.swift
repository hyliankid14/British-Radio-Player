import Foundation

struct Podcast: Identifiable, Codable, Equatable, Hashable {
    let id: String
    let title: String
    let description: String
    let rssURL: URL
    let htmlURL: URL?
    let imageURL: URL?
    let genres: [String]
    let typicalDurationMins: Int
}

struct Episode: Identifiable, Codable, Equatable {
    let id: String
    let title: String
    let description: String
    let audioURL: URL
    let imageURL: URL?
    let pubDate: String
    let durationMins: Int
    let podcastID: String
}

struct PodcastFilter: Equatable {
    var genres: Set<String> = []
    var minDuration: Int = 0
    var maxDuration: Int = 300
    var searchQuery: String = ""
}

// MARK: - String Extensions
extension String {
    /// Removes HTML tags and decodes HTML entities
    var stripHTMLTags: String {
        var result = self
        
        // Remove HTML tags
        result = result.replacingOccurrences(
            of: "<[^>]+>",
            with: "",
            options: .regularExpression
        )
        
        // Decode common HTML entities
        let entities: [String: String] = [
            "&amp;": "&",
            "&lt;": "<",
            "&gt;": ">",
            "&quot;": "\"",
            "&apos;": "'",
            "&nbsp;": " ",
            "&#39;": "'",
            "&hellip;": "…",
            "&mdash;": "—",
            "&ndash;": "–",
            "&bull;": "•"
        ]
        
        for (entity, character) in entities {
            result = result.replacingOccurrences(of: entity, with: character)
        }
        
        // Remove extra whitespace
        result = result.trimmingCharacters(in: .whitespacesAndNewlines)
        result = result.replacingOccurrences(of: "  +", with: " ", options: .regularExpression)
        
        return result
    }
}

