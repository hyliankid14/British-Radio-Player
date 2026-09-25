import Foundation

protocol PodcastRepository {
    func fetchPodcasts(forceRefresh: Bool) async throws -> [Podcast]
    func fetchEpisodes(for podcast: Podcast) async throws -> [Episode]
}

struct DefaultPodcastRepository: PodcastRepository {
    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    func fetchPodcasts(forceRefresh: Bool = false) async throws -> [Podcast] {
        guard let url = URL(string: "https://www.bbc.co.uk/radio/opml/bbc_podcast_opml.xml") else {
            throw URLError(.badURL)
        }

        var request = URLRequest(url: url)
        request.timeoutInterval = 20
        request.setValue("British Radio Player/1.0 (iOS)", forHTTPHeaderField: "User-Agent")
        request.setValue("application/xml,text/xml,application/rss+xml,*/*", forHTTPHeaderField: "Accept")

        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, (200..<300).contains(httpResponse.statusCode) else {
            throw URLError(.badServerResponse)
        }

        let podcasts = try await Task.detached(priority: .userInitiated) {
            OPMLPodcastParser.parse(data: data)
        }.value
        guard !podcasts.isEmpty else {
            throw URLError(.cannotParseResponse)
        }

        return podcasts
    }

    func fetchEpisodes(for podcast: Podcast) async throws -> [Episode] {
        var request = URLRequest(url: podcast.rssURL)
        request.timeoutInterval = 20
        request.setValue("British Radio Player/1.0 (iOS)", forHTTPHeaderField: "User-Agent")
        request.setValue("application/xml,text/xml,application/rss+xml,*/*", forHTTPHeaderField: "Accept")

        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, (200..<300).contains(httpResponse.statusCode) else {
            throw URLError(.badServerResponse)
        }

        return try await Task.detached(priority: .userInitiated) {
            try RSSPodcastParser.parseEpisodes(data: data, podcastID: podcast.id)
        }.value
    }
}

enum OPMLPodcastParser {
    static func parse(data: Data) -> [Podcast] {
        let parserDelegate = OPMLParserDelegate()
        let parser = XMLParser(data: data)
        parser.delegate = parserDelegate
        parser.parse()
        return parserDelegate.podcasts
    }
}

enum RSSPodcastParser {
    static func parseEpisodes(data: Data, podcastID: String) throws -> [Episode] {
        let parserDelegate = RSSParserDelegate(podcastID: podcastID)
        let parser = XMLParser(data: data)
        parser.delegate = parserDelegate
        parser.parse()
        return parserDelegate.episodes
    }
}

private final class OPMLParserDelegate: NSObject, XMLParserDelegate {
    private(set) var podcasts: [Podcast] = []
    private var seenIDs: Set<String> = []

    func parser(
        _ parser: XMLParser,
        didStartElement elementName: String,
        namespaceURI: String?,
        qualifiedName qName: String?,
        attributes attributeDict: [String: String] = [:]
    ) {
        guard elementName.lowercased() == "outline" else {
            return
        }

        let type = attributeDict["type"]?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
        let isRSSLikely = type.isEmpty || type == "rss"
        guard isRSSLikely else {
            return
        }

        guard
            let rssURLString = attributeDict["xmlUrl"]?.trimmingCharacters(in: .whitespacesAndNewlines),
            !rssURLString.isEmpty,
            let rssURL = httpsURL(from: rssURLString)
        else {
            return
        }

        let title = (attributeDict["text"] ?? attributeDict["title"] ?? "BBC Podcast")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let description = (attributeDict["description"] ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let id = extractPodcastID(from: rssURL.absoluteString)
        guard !seenIDs.contains(id) else {
            return
        }
        seenIDs.insert(id)

        let htmlURL = attributeDict["htmlUrl"].flatMap(httpsURL(from:))
        let imageURL = attributeDict["imageHref"].flatMap(httpsURL(from:))
        let genres = (attributeDict["bbcgenres"] ?? "")
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        let typicalDurationMins = Int(attributeDict["typicalDurationMins"] ?? "") ?? 0

        podcasts.append(
            Podcast(
                id: id,
                title: title,
                description: description,
                rssURL: rssURL,
                htmlURL: htmlURL,
                imageURL: imageURL,
                genres: genres,
                typicalDurationMins: typicalDurationMins
            )
        )
    }

    private func httpsURL(from value: String) -> URL? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return nil
        }
        let httpsString = trimmed.replacingOccurrences(of: "http://", with: "https://")
        return URL(string: httpsString)
    }

    private func extractPodcastID(from rssURL: String) -> String {
        if let url = URL(string: rssURL) {
            let fileName = url.lastPathComponent
            if fileName.lowercased().hasSuffix(".rss") {
                return String(fileName.dropLast(4))
            }
        }
        return rssURL
    }
}

private final class RSSParserDelegate: NSObject, XMLParserDelegate {
    private let podcastID: String

    private(set) var episodes: [Episode] = []

    private var inItem = false
    private var currentElement = ""
    private var currentTitle = ""
    private var currentDescription = ""
    private var currentPubDate = ""
    private var currentDuration = ""
    private var currentGUID = ""
    private var currentAudioURL: URL?
    private var currentImageURL: URL?

    init(podcastID: String) {
        self.podcastID = podcastID
    }

    func parser(
        _ parser: XMLParser,
        didStartElement elementName: String,
        namespaceURI: String?,
        qualifiedName qName: String?,
        attributes attributeDict: [String: String] = [:]
    ) {
        let name = (qName ?? elementName).lowercased()
        if name == "item" {
            inItem = true
            resetCurrentItem()
        }

        guard inItem else {
            return
        }

        currentElement = name

        if name == "enclosure", let rawURL = attributeDict["url"], let url = URL(string: rawURL) {
            currentAudioURL = url._normalisedSecureBBCMediaURL()
        }

        if (name == "media:content" || name == "content"),
            currentAudioURL == nil,
            let rawURL = attributeDict["url"],
            let url = URL(string: rawURL) {
            let typeHint = (attributeDict["type"] ?? "").lowercased()
            let pathHint = url.path.lowercased()
            if typeHint.contains("audio") || pathHint.hasSuffix(".mp3") || pathHint.hasSuffix(".m4a") {
                currentAudioURL = url._normalisedSecureBBCMediaURL()
            }
        }

        if (name == "itunes:image" || name == "image"),
            let href = attributeDict["href"] ?? attributeDict["url"],
            let url = URL(string: href) {
            currentImageURL = url
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        guard inItem else {
            return
        }

        switch currentElement {
        case "title":
            currentTitle += string
        case "description", "content:encoded":
            currentDescription += string
        case "pubdate":
            currentPubDate += string
        case "itunes:duration", "duration":
            currentDuration += string
        case "guid":
            currentGUID += string
        default:
            break
        }
    }

    func parser(
        _ parser: XMLParser,
        didEndElement elementName: String,
        namespaceURI: String?,
        qualifiedName qName: String?
    ) {
        let name = (qName ?? elementName).lowercased()
        if name == "item" {
            inItem = false
            flushCurrentItem()
        }
        currentElement = ""
    }

    private func flushCurrentItem() {
        guard let audioURL = currentAudioURL else {
            return
        }

        let title = currentTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        let description = currentDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        let pubDate = currentPubDate.trimmingCharacters(in: .whitespacesAndNewlines)
        let durationMins = parseDurationToMinutes(currentDuration)
        let trimmedGUID = currentGUID.trimmingCharacters(in: .whitespacesAndNewlines)
        let episodeID = trimmedGUID.isEmpty ? audioURL.absoluteString : trimmedGUID

        episodes.append(
            Episode(
                id: episodeID,
                title: title.isEmpty ? "Episode" : title,
                description: description,
                audioURL: audioURL,
                imageURL: currentImageURL,
                pubDate: pubDate,
                durationMins: durationMins,
                podcastID: podcastID
            )
        )
    }

    private func resetCurrentItem() {
        currentElement = ""
        currentTitle = ""
        currentDescription = ""
        currentPubDate = ""
        currentDuration = ""
        currentGUID = ""
        currentAudioURL = nil
        currentImageURL = nil
    }

    private func parseDurationToMinutes(_ value: String) -> Int {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            return 0
        }

        if let seconds = Int(trimmed) {
            return max(1, seconds / 60)
        }

        let components = trimmed.split(separator: ":").compactMap { Int($0) }
        if components.count == 3 {
            let totalSeconds = (components[0] * 3600) + (components[1] * 60) + components[2]
            return max(1, totalSeconds / 60)
        }
        if components.count == 2 {
            let totalSeconds = (components[0] * 60) + components[1]
            return max(1, totalSeconds / 60)
        }

        return 0
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
