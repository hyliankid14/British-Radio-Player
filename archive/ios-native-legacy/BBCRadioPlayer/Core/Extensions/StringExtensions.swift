import Foundation

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
