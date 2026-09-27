import Foundation

/// Offline podcast episode reader and date formatting shared by the CarPlay browse tree.
///
/// The React layer normally supplies cached episodes through the snapshot; this reader is
/// the cold-start fallback so a podcast is browsable as soon as CarPlay connects.
enum CarPlayRss {
    /// Fetches and parses the most recent episodes from a podcast RSS feed.
    static func fetchEpisodes(podcastId: String, rssUrl: String, limit: Int) -> [CarPlayEpisode]? {
        guard let url = URL(string: rssUrl), let data = try? Data(contentsOf: url) else { return nil }
        guard
            let xml = String(data: data, encoding: .utf8)
                ?? String(data: data, encoding: .isoLatin1)
        else { return nil }

        if let channelStart = xml.range(of: "<channel>") {
            let channelTitle = tag(in: String(xml[channelStart.upperBound...]), "title")
            if channelTitle.count > 1 {
                CarPlayState.shared.updatePodcastTitle(podcastId: podcastId, title: channelTitle)
            }
        }

        var episodes: [CarPlayEpisode] = []
        var cursor = xml.startIndex
        while episodes.count < limit,
            let itemStart = xml.range(of: "<item", range: cursor..<xml.endIndex)
        {
            guard let tagClose = xml.range(of: ">", range: itemStart.upperBound..<xml.endIndex)
            else { break }
            guard let itemEnd = xml.range(of: "</item>", range: tagClose.upperBound..<xml.endIndex)
            else { break }
            let content = String(xml[tagClose.upperBound..<itemEnd.lowerBound])
            cursor = itemEnd.upperBound

            let title = tag(in: content, "title")
            var description = tag(in: content, "description")
            if description.isEmpty { description = tag(in: content, "itunes:summary") }
            let audioUrl = enclosureURL(in: content)
            let pubDate = tag(in: content, "pubDate")
            let guid = tag(in: content, "guid")
            let id =
                guid.split(separator: "/").last.map(String.init)?
                .split(separator: ":").last.map(String.init)
                ?? "\(podcastId)-\(episodes.count)"

            guard !title.isEmpty, !audioUrl.isEmpty else { continue }

            var episode = CarPlayEpisode()
            episode.id = id
            episode.title = title
            episode.description = description
            episode.audioUrl = audioUrl
            episode.pubDate = pubDate
            episode.pubDateEpochMs = (parseDate(pubDate)?.timeIntervalSince1970 ?? 0) * 1000
            episode.podcastId = podcastId
            episodes.append(episode)
        }
        return episodes
    }

    // MARK: Dates

    private static let outputFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "EEE, dd MMM yyyy"
        return formatter
    }()

    private static let inputFormatters: [DateFormatter] = {
        ["EEE, dd MMM yyyy HH:mm:ss Z", "EEE, dd MMM yyyy HH:mm:ss z", "yyyy-MM-dd'T'HH:mm:ssZ"]
            .map { pattern in
                let formatter = DateFormatter()
                formatter.locale = Locale(identifier: "en_US_POSIX")
                formatter.timeZone = TimeZone(secondsFromGMT: 0)
                formatter.dateFormat = pattern
                return formatter
            }
    }()

    static func parseDate(_ raw: String) -> Date? {
        let trimmed =
            raw.trimmingCharacters(in: .whitespaces)
            .replacingOccurrences(of: "UTC", with: "+0000")
        for formatter in inputFormatters {
            if let date = formatter.date(from: trimmed) { return date }
        }
        return nil
    }

    /// "Tue, 04 Mar 2025", or the raw string when it cannot be parsed.
    static func formatDate(_ raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return "" }
        guard let date = parseDate(raw) else { return trimmed }
        return outputFormatter.string(from: date)
    }

    // MARK: XML

    private static func enclosureURL(in block: String) -> String {
        for marker in ["<ppg:enclosureSecure", "<enclosure"] {
            guard
                let markerRange = block.range(of: marker),
                let keyRange = block.range(
                    of: "url=\"", range: markerRange.upperBound..<block.endIndex),
                let end = block.range(of: "\"", range: keyRange.upperBound..<block.endIndex)
            else { continue }
            let raw = String(block[keyRange.upperBound..<end.lowerBound])
                .trimmingCharacters(in: .whitespacesAndNewlines)
            return marker.hasPrefix("<ppg")
                ? raw : raw.replacingOccurrences(of: "http://", with: "https://")
        }
        return ""
    }

    private static func tag(in block: String, _ name: String) -> String {
        let open = "<\(name)"
        guard
            let start = block.range(of: open),
            let contentStart = block.range(of: ">", range: start.upperBound..<block.endIndex)
        else { return "" }
        let close = "</\(name)>"
        guard let end = block.range(of: close, range: contentStart.upperBound..<block.endIndex)
        else { return "" }

        var value = String(block[contentStart.upperBound..<end.lowerBound])
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if value.hasPrefix("<![CDATA[") {
            value = String(value.dropFirst("<![CDATA[".count))
            if let terminator = value.range(of: "]]>") {
                value = String(value[..<terminator.lowerBound])
            }
        }
        return
            value
            .replacingOccurrences(of: "<[^>]*>", with: "", options: .regularExpression)
            .replacingOccurrences(of: "&amp;", with: "&")
            .replacingOccurrences(of: "&quot;", with: "\"")
            .replacingOccurrences(of: "&lt;", with: "<")
            .replacingOccurrences(of: "&gt;", with: ">")
            .replacingOccurrences(of: "&#39;", with: "'")
            .replacingOccurrences(of: "&apos;", with: "'")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
