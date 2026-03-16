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
        // Initial implementation: read OPML and produce seed podcast data.
        // Full parity implementation will add disk caching, language filtering and FTS sync.
        guard let url = URL(string: "https://www.bbc.co.uk/radio/opml/bbc_podcast_opml.xml") else {
            return []
        }

        var request = URLRequest(url: url)
        request.timeoutInterval = 20

        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, (200..<300).contains(httpResponse.statusCode) else {
            throw URLError(.badServerResponse)
        }

        return OPMLPodcastParser.parse(data: data)
    }

    func fetchEpisodes(for podcast: Podcast) async throws -> [Episode] {
        var request = URLRequest(url: podcast.rssURL)
        request.timeoutInterval = 20

        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, (200..<300).contains(httpResponse.statusCode) else {
            throw URLError(.badServerResponse)
        }

        return try RSSPodcastParser.parseEpisodes(data: data, podcastID: podcast.id)
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

        guard
            let rssURLString = attributeDict["xmlUrl"],
            let rssURL = URL(string: rssURLString)
        else {
            return
        }

        let title = attributeDict["text"] ?? attributeDict["title"] ?? "BBC Podcast"
        let htmlURL = attributeDict["htmlUrl"].flatMap(URL.init(string:))
        let id = slug(from: title)

        podcasts.append(
            Podcast(
                id: id,
                title: title,
                description: "",
                rssURL: rssURL,
                htmlURL: htmlURL,
                imageURL: nil,
                genres: [],
                typicalDurationMins: 0
            )
        )
    }

    private func slug(from value: String) -> String {
        value
            .lowercased()
            .replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
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

        if name == "enclosure", let url = attributeDict["url"].flatMap(URL.init(string:)) {
            currentAudioURL = url
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
