import Foundation
import Observation

@Observable final class TVPodcastManager {
    static let shared = TVPodcastManager()
    
    var featuredPodcasts: [TVPodcast] = []
    var isLoading: Bool = false
    var episodesByPodcast: [String: [TVEpisode]] = [:]
    
    private var catalogPodcasts: [TVPodcast] = []
    private var popularIds: [String] = []
    private var activeParsers: [String: TVPodcastRSSParser] = [:]
    
    private init() {
        loadCuratedPodcasts()
        fetchPopularPodcasts()
        fetchLiveCatalog()
    }
    
    func loadCuratedPodcasts() {
        // Pre-sorted by popularity snapshot with verified high-res artwork
        featuredPodcasts = [
            TVPodcast(
                id: "p07h19zz",
                title: "Americast",
                rssUrl: "https://podcasts.files.bbci.co.uk/p07h19zz.rss",
                imageUrl: "https://ichef.bbci.co.uk/images/ic/624x624/p0k99j29.jpg",
                author: "BBC News",
                description: "Authoritative, insightful coverage of US politics and culture.",
                genre: "News & Politics"
            ),
            TVPodcast(
                id: "p04d42rc",
                title: "CrowdScience",
                rssUrl: "https://podcasts.files.bbci.co.uk/p04d42rc.rss",
                imageUrl: "https://ichef.bbci.co.uk/images/ic/624x624/p0p7qtn7.jpg",
                author: "BBC World Service",
                description: "We take your questions about life, Earth and the universe to researchers hunting for answers.",
                genre: "Science"
            ),
            TVPodcast(
                id: "p0ns1h35",
                title: "Here for the History",
                rssUrl: "https://podcasts.files.bbci.co.uk/p0ns1h35.rss",
                imageUrl: "https://ichef.bbci.co.uk/images/ic/624x624/p0p3vdz4.jpg",
                author: "BBC Sounds",
                description: "Alice Loxton and Ben Henderson reveal surprising moments in history.",
                genre: "History"
            ),
            TVPodcast(
                id: "p02pc9pj",
                title: "Friday Night Comedy from BBC Radio 4",
                rssUrl: "https://podcasts.files.bbci.co.uk/p02pc9pj.rss",
                imageUrl: "https://ichef.bbci.co.uk/images/ic/624x624/p0lbr5kr.jpg",
                author: "BBC Radio 4",
                description: "Topical comedy from the sharpest satirical minds in the business.",
                genre: "Comedy"
            ),
            TVPodcast(
                id: "p05299nl",
                title: "Newscast",
                rssUrl: "https://podcasts.files.bbci.co.uk/p05299nl.rss",
                imageUrl: "https://ichef.bbci.co.uk/images/ic/624x624/p0l7jnc6.jpg",
                author: "BBC News",
                description: "The BBC's daily news podcast covering the latest political analysis and UK stories.",
                genre: "News & Politics"
            ),
            TVPodcast(
                id: "p02nq0lx",
                title: "The Documentary Podcast",
                rssUrl: "https://podcasts.files.bbci.co.uk/p02nq0lx.rss",
                imageUrl: "https://ichef.bbci.co.uk/images/ic/624x624/p0p8d4hv.jpg",
                author: "BBC World Service",
                description: "The best documentaries from the BBC World Service. Hear the voices shaping our world.",
                genre: "Documentaries"
            ),
            TVPodcast(
                id: "p004t1hd",
                title: "Witness History",
                rssUrl: "https://podcasts.files.bbci.co.uk/p004t1hd.rss",
                imageUrl: "https://ichef.bbci.co.uk/images/ic/624x624/p0kt82ds.jpg",
                author: "BBC World Service",
                description: "History as told by the people who were there.",
                genre: "History"
            ),
            TVPodcast(
                id: "p002vsxs",
                title: "Business Daily",
                rssUrl: "https://podcasts.files.bbci.co.uk/p002vsxs.rss",
                imageUrl: "https://ichef.bbci.co.uk/images/ic/624x624/p0l9wqb4.jpg",
                author: "BBC World Service",
                description: "The daily drama of money, economics and global work from the BBC.",
                genre: "Business & News"
            ),
            TVPodcast(
                id: "b006qykl",
                title: "In Our Time",
                rssUrl: "https://podcasts.files.bbci.co.uk/b006qykl.rss",
                imageUrl: "https://ichef.bbci.co.uk/images/ic/624x624/p0p8dsw0.jpg",
                author: "BBC Radio 4",
                description: "In Our Time explores the ideas, people and discoveries that have shaped our world.",
                genre: "History & Ideas"
            ),
            TVPodcast(
                id: "b006qpgr",
                title: "The Archers",
                rssUrl: "https://podcasts.files.bbci.co.uk/b006qpgr.rss",
                imageUrl: "https://ichef.bbci.co.uk/images/ic/624x624/p0m1pyhc.jpg",
                author: "BBC Radio 4",
                description: "Contemporary drama in a rural setting.",
                genre: "Drama"
            ),
            TVPodcast(
                id: "p02pc9ny",
                title: "5 Live Science",
                rssUrl: "https://podcasts.files.bbci.co.uk/p02pc9ny.rss",
                imageUrl: "https://ichef.bbci.co.uk/images/ic/624x624/p0d8lrz7.jpg",
                author: "BBC Radio 5 Live",
                description: "The Naked Scientists with the hottest science news stories and analysis.",
                genre: "Science"
            )
        ]
    }
    
    // Fetch popular podcasts ranking from server snapshot
    func fetchPopularPodcasts() {
        guard let url = URL(string: "https://bbc-radio.shai.website/data/popular-podcasts.json") else { return }
        
        var request = URLRequest(url: url, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 10)
        request.setValue("British Radio Player/1.0", forHTTPHeaderField: "User-Agent")
        
        URLSession.shared.dataTask(with: request) { [weak self] data, _, error in
            guard let self = self, let data = data, error == nil else { return }
            
            struct PopularData: Codable {
                struct Entry: Codable {
                    let id: String
                    let name: String
                    let plays: Int
                }
                let popular_podcasts: [Entry]
            }
            
            if let decoded = try? JSONDecoder().decode(PopularData.self, from: data) {
                DispatchQueue.main.async {
                    self.popularIds = decoded.popular_podcasts.map { $0.id }
                    self.updatePopularList()
                }
            }
        }.resume()
    }
    
    // Fetch live BBC OPML to update artwork & catalog with latest official feeds
    func fetchLiveCatalog() {
        guard let url = URL(string: "https://podcasts.files.bbci.co.uk/podcasts.opml") else { return }
        
        var request = URLRequest(url: url, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 15)
        request.setValue("British Radio Player/1.0", forHTTPHeaderField: "User-Agent")
        
        URLSession.shared.dataTask(with: request) { [weak self] data, _, error in
            guard let self = self, let data = data, error == nil else { return }
            
            let parser = TVPodcastOPMLParser()
            parser.parse(data: data) { podcasts in
                guard !podcasts.isEmpty else { return }
                DispatchQueue.main.async {
                    self.catalogPodcasts = podcasts
                    // Update our featured list with refreshed images and descriptions
                    for opmlPod in podcasts {
                        if let idx = self.featuredPodcasts.firstIndex(where: { $0.id == opmlPod.id || $0.title.lowercased() == opmlPod.title.lowercased() }) {
                            self.featuredPodcasts[idx].imageUrl = opmlPod.imageUrl
                            self.featuredPodcasts[idx].description = opmlPod.description ?? self.featuredPodcasts[idx].description
                        }
                    }
                    self.updatePopularList()
                }
            }
        }.resume()
    }
    
    private func updatePopularList() {
        guard !popularIds.isEmpty else { return }
        
        var ordered: [TVPodcast] = []
        var seenIds = Set<String>()
        
        // 1. Add podcasts matching popularIds in exact popularity order
        for popId in popularIds {
            if let existing = self.featuredPodcasts.first(where: { $0.id == popId }) {
                if seenIds.insert(existing.id).inserted {
                    ordered.append(existing)
                }
            } else if let fromCatalog = self.catalogPodcasts.first(where: { $0.id == popId }) {
                if seenIds.insert(fromCatalog.id).inserted {
                    ordered.append(fromCatalog)
                }
            }
        }
        
        // 2. Append any remaining curated podcasts
        for pod in self.featuredPodcasts {
            if seenIds.insert(pod.id).inserted {
                ordered.append(pod)
            }
        }
        
        self.featuredPodcasts = ordered
    }
    
    func podcast(with id: String) -> TVPodcast? {
        if let existing = featuredPodcasts.first(where: { $0.id == id }) {
            return existing
        }
        if let catalog = catalogPodcasts.first(where: { $0.id == id }) {
            return catalog
        }
        return nil
    }
    
    func subscribedPodcasts() -> [TVPodcast] {
        let subIds = TVSubscriptionManager.shared.subscribedPodcastIds
        var result: [TVPodcast] = []
        for subId in subIds {
            if let pod = podcast(with: subId) {
                result.append(pod)
            }
        }
        return result
    }
    
    func allSearchablePodcasts() -> [TVPodcast] {
        var results: [TVPodcast] = []
        var seenIds = Set<String>()
        for pod in featuredPodcasts {
            if seenIds.insert(pod.id).inserted {
                results.append(pod)
            }
        }
        for pod in catalogPodcasts {
            if seenIds.insert(pod.id).inserted {
                results.append(pod)
            }
        }
        return results
    }
    
    func searchPodcasts(matching query: String) -> [TVPodcast] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return [] }
        return allSearchablePodcasts().filter { pod in
            pod.title.lowercased().contains(q) ||
            pod.description?.lowercased().contains(q) == true ||
            pod.genre?.lowercased().contains(q) == true ||
            pod.author?.lowercased().contains(q) == true
        }
    }
    
    func searchRemotePodcasts(matching query: String, completion: @escaping ([TVPodcast]) -> Void) {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else {
            completion([])
            return
        }
        guard let encoded = trimmed.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
              let url = URL(string: "https://bbc-radio.shai.website/search/podcasts?q=\(encoded)&limit=30") else {
            completion([])
            return
        }
        
        var request = URLRequest(url: url, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 8)
        request.setValue("British Radio Player/1.0", forHTTPHeaderField: "User-Agent")
        
        URLSession.shared.dataTask(with: request) { [weak self] data, _, error in
            guard let self = self, let data = data, error == nil else {
                completion([])
                return
            }
            
            struct SearchResultItem: Codable {
                let podcastId: String
                let title: String
                let description: String?
            }
            
            do {
                let items = try JSONDecoder().decode([SearchResultItem].self, from: data)
                var resultPodcasts: [TVPodcast] = []
                for item in items {
                    if let existing = self.podcast(with: item.podcastId) {
                        resultPodcasts.append(existing)
                    } else {
                        let cleanDesc = item.description?.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression) ?? ""
                        let newPod = TVPodcast(
                            id: item.podcastId,
                            title: item.title,
                            rssUrl: "https://podcasts.files.bbci.co.uk/\(item.podcastId).rss",
                            imageUrl: "https://ichef.bbci.co.uk/images/ic/624x624/\(item.podcastId).jpg",
                            author: "BBC",
                            description: cleanDesc,
                            genre: "Podcasts"
                        )
                        resultPodcasts.append(newPod)
                    }
                }
                DispatchQueue.main.async {
                    completion(resultPodcasts)
                }
            } catch {
                completion([])
            }
        }.resume()
    }
    
    func fetchEpisodes(for podcast: TVPodcast, completion: @escaping ([TVEpisode]) -> Void) {
        if let cached = episodesByPodcast[podcast.id], !cached.isEmpty {
            completion(cached)
            return
        }
        
        var feedUrlString = podcast.rssUrl
        if feedUrlString.isEmpty || !feedUrlString.starts(with: "http") {
            feedUrlString = "https://podcasts.files.bbci.co.uk/\(podcast.id).rss"
        } else if feedUrlString.starts(with: "http://") {
            feedUrlString = feedUrlString.replacingOccurrences(of: "http://", with: "https://")
        }
        
        guard let url = URL(string: feedUrlString) else {
            completion([])
            return
        }
        
        isLoading = true
        let parser = TVPodcastRSSParser(podcastId: podcast.id, fallbackImageUrl: podcast.imageUrl)
        activeParsers[podcast.id] = parser
        
        parser.parseFeed(url: url) { [weak self] (episodes, channelImage) in
            DispatchQueue.main.async {
                self?.isLoading = false
                self?.activeParsers.removeValue(forKey: podcast.id)
                self?.episodesByPodcast[podcast.id] = episodes
                
                // If channel image was extracted from the feed, update the podcast object
                if let freshImage = channelImage, !freshImage.isEmpty {
                    if let idx = self?.featuredPodcasts.firstIndex(where: { $0.id == podcast.id }) {
                        self?.featuredPodcasts[idx].imageUrl = freshImage
                    }
                }
                
                completion(episodes)
            }
        }
    }
}

// MARK: - Fast OPML Parser for BBC Podcast Catalog

final class TVPodcastOPMLParser: NSObject, XMLParserDelegate {
    private var completion: (([TVPodcast]) -> Void)?
    private var results: [TVPodcast] = []
    
    func parse(data: Data, completion: @escaping ([TVPodcast]) -> Void) {
        self.completion = completion
        let xmlParser = XMLParser(data: data)
        xmlParser.delegate = self
        xmlParser.parse()
    }
    
    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName qName: String?, attributes attributeDict: [String : String] = [:]) {
        guard elementName == "outline" else { return }
        
        let type = attributeDict["type"]?.lowercased() ?? ""
        guard type == "rss" || attributeDict["xmlUrl"] != nil else { return }
        
        let xmlUrl = attributeDict["xmlUrl"]?.replacingOccurrences(of: "http://", with: "https://") ?? ""
        guard !xmlUrl.isEmpty else { return }
        
        var id = attributeDict["keyname"] ?? ""
        if id.isEmpty {
            if let last = xmlUrl.split(separator: "/").last {
                id = String(last.replacingOccurrences(of: ".rss", with: ""))
            }
        }
        guard !id.isEmpty else { return }
        
        let title = attributeDict["text"] ?? ""
        let desc = attributeDict["description"] ?? ""
        let rawImage = attributeDict["imageHref"] ?? attributeDict["image"] ?? ""
        let image = rawImage
            .replacingOccurrences(of: "http://", with: "https://")
            .replacingOccurrences(of: "/304x304/", with: "/624x624/")
        let genre = attributeDict["bbcgenres"] ?? ""
        
        if !image.isEmpty {
            let podcast = TVPodcast(
                id: id,
                title: title,
                rssUrl: xmlUrl,
                imageUrl: image,
                author: "BBC",
                description: desc,
                genre: genre
            )
            results.append(podcast)
        }
    }
    
    func parserDidEndDocument(_ parser: XMLParser) {
        completion?(results)
    }
    
    func parser(_ parser: XMLParser, parseErrorOccurred parseError: Error) {
        completion?(results)
    }
}

// MARK: - RSS Feed Parser with Image and Episode Extraction

final class TVPodcastRSSParser: NSObject, XMLParserDelegate {
    private let podcastId: String
    private let fallbackImageUrl: String
    private var completion: (([TVEpisode], String?) -> Void)?
    
    private var episodes: [TVEpisode] = []
    private var channelImage: String? = nil
    private var currentElement = ""
    private var currentTitle = ""
    private var currentLink = ""
    private var currentPubDate = ""
    private var currentSummary = ""
    private var currentEnclosureUrl = ""
    private var currentDurationStr = ""
    private var currentItemImage: String? = nil
    private var isInsideItem = false
    
    init(podcastId: String, fallbackImageUrl: String) {
        self.podcastId = podcastId
        self.fallbackImageUrl = fallbackImageUrl
    }
    
    func parseFeed(url: URL, completion: @escaping ([TVEpisode], String?) -> Void) {
        self.completion = completion
        
        var request = URLRequest(url: url, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 15)
        request.setValue("British Radio Player/1.0", forHTTPHeaderField: "User-Agent")
        
        URLSession.shared.dataTask(with: request) { [self] data, _, error in
            guard let data = data, error == nil else {
                completion([], nil)
                return
            }
            
            let xmlParser = XMLParser(data: data)
            xmlParser.delegate = self
            xmlParser.parse()
        }.resume()
    }
    
    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName qName: String?, attributes attributeDict: [String : String] = [:]) {
        currentElement = elementName
        if elementName == "item" {
            isInsideItem = true
            currentTitle = ""
            currentLink = ""
            currentPubDate = ""
            currentSummary = ""
            currentEnclosureUrl = ""
            currentDurationStr = ""
            currentItemImage = nil
        } else if isInsideItem && (elementName == "enclosure" || elementName == "ppg:enclosureSecure" || elementName.hasSuffix("enclosure") || elementName.hasSuffix("enclosureSecure")) {
            if let url = attributeDict["url"] {
                let secureUrl = url.replacingOccurrences(of: "http://", with: "https://")
                if currentEnclosureUrl.isEmpty || elementName.contains("Secure") {
                    currentEnclosureUrl = secureUrl
                }
            }
        } else if elementName == "itunes:image" {
            if let href = attributeDict["href"] {
                let secure = href.replacingOccurrences(of: "http://", with: "https://")
                if isInsideItem {
                    currentItemImage = secure
                } else if channelImage == nil {
                    channelImage = secure
                }
            }
        }
    }
    
    func parser(_ parser: XMLParser, foundCDATA CDATABlock: Data) {
        if let string = String(data: CDATABlock, encoding: .utf8) {
            self.parser(parser, foundCharacters: string)
        }
    }
    
    func parser(_ parser: XMLParser, foundCharacters string: String) {
        guard isInsideItem else {
            if currentElement == "url" && channelImage == nil {
                channelImage = string.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "http://", with: "https://")
            }
            return
        }
        switch currentElement {
        case "title": currentTitle += string
        case "pubDate": currentPubDate += string
        case "description", "itunes:summary": currentSummary += string
        case "itunes:duration": currentDurationStr += string
        default: break
        }
    }
    
    private func cleanHtml(_ text: String) -> String {
        return text
            .replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression, range: nil)
            .replacingOccurrences(of: "&amp;", with: "&")
            .replacingOccurrences(of: "&quot;", with: "\"")
            .replacingOccurrences(of: "&#39;", with: "'")
            .replacingOccurrences(of: "&lt;", with: "<")
            .replacingOccurrences(of: "&gt;", with: ">")
            .replacingOccurrences(of: "&nbsp;", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func cleanDate(_ text: String) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let parts = trimmed.components(separatedBy: " ")
        if parts.count >= 4 {
            return parts[0...3].joined(separator: " ")
        }
        return trimmed
    }

    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) {
        if elementName == "item" {
            isInsideItem = false
            let id = "\(podcastId)_\(episodes.count)"
            let duration = Int(currentDurationStr.trimmingCharacters(in: .whitespacesAndNewlines)) ?? 1800
            let effectiveImage = currentItemImage ?? channelImage ?? fallbackImageUrl
            
            if !currentEnclosureUrl.isEmpty {
                let episode = TVEpisode(
                    id: id,
                    title: cleanHtml(currentTitle),
                    podcastId: podcastId,
                    mediaUrl: currentEnclosureUrl,
                    duration: duration,
                    pubDate: cleanDate(currentPubDate),
                    imageUrl: effectiveImage,
                    summary: cleanHtml(currentSummary)
                )
                episodes.append(episode)
            }
        }
    }
    
    func parserDidEndDocument(_ parser: XMLParser) {
        completion?(episodes, channelImage)
    }
    
    func parser(_ parser: XMLParser, parseErrorOccurred parseError: Error) {
        completion?(episodes, channelImage)
    }
}
