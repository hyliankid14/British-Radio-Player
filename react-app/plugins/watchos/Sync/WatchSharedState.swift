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
    var title: String
    let rssUrl: String
    var imageUrl: String
}

struct WatchEpisode: Identifiable, Codable, Hashable {
    let id: String
    let title: String
    let podcastId: String
    let mediaUrl: String
    let duration: Int
    var pubDate: String?
    var imageUrl: String?
}

struct WatchAppState: Codable {
    var favourite_ids: [String]?
    var favourite_order: [String]?
    var subscribed_podcast_ids: [String]?
    var subscribed_podcasts_json: String?
    var has_subscription_snapshot: Bool?
    var played_episode_ids: [String]?
    var unplayed_episode_ids: [String]?
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
    var scroll_mode: String?
    var analytics_enabled: Bool?
}

@Observable final class WatchPodcastManager: NSObject {
    static let shared = WatchPodcastManager()
    
    var subscribedPodcasts: [WatchPodcast] = []
    var isLoading: Bool = false
    var episodeCache: [String: [WatchEpisode]] = [:]
    var loadingEpisodesPodcastId: String? = nil
    
    private let opmlUrl = URL(string: "https://www.bbc.co.uk/radio/opml/bbc_podcast_opml.xml")!
    
    override private init() {
        super.init()
        loadPersistedPodcasts()
    }
    
    private func loadPersistedPodcasts() {
        if let data = UserDefaults.standard.data(forKey: "persisted_subscribed_podcasts"),
           let decoded = try? JSONDecoder().decode([WatchPodcast].self, from: data) {
            self.subscribedPodcasts = decoded
        }
    }
    
    private func persistPodcasts(_ list: [WatchPodcast]) {
        if let data = try? JSONEncoder().encode(list) {
            UserDefaults.standard.set(data, forKey: "persisted_subscribed_podcasts")
        }
    }
    
    func refreshSubscribedPodcasts(subscribedIds: [String], phonePodcastsJson: String?) {
        guard !subscribedIds.isEmpty else {
            DispatchQueue.main.async {
                self.subscribedPodcasts = []
                self.persistPodcasts([])
            }
            return
        }
        
        var resolved: [WatchPodcast] = []
        
        // 1. If phone sent rich podcast objects, parse them
        if let json = phonePodcastsJson, let data = json.data(using: .utf8),
           let phoneList = try? JSONDecoder().decode([WatchPodcast].self, from: data) {
            let phoneMap = Dictionary(phoneList.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
            for id in subscribedIds {
                if let p = phoneMap[id] {
                    resolved.append(p)
                }
            }
        }
        
        // 2. Check previously cached/persisted list for any missing ones
        let cachedMap = Dictionary(self.subscribedPodcasts.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        for id in subscribedIds {
            if !resolved.contains(where: { $0.id == id }), let cached = cachedMap[id] {
                resolved.append(cached)
            }
        }
        
        // 3. For any remaining missing ids, create fallback entries so they appear immediately
        for id in subscribedIds {
            if !resolved.contains(where: { $0.id == id }) {
                resolved.append(WatchPodcast(
                    id: id,
                    title: id,
                    rssUrl: "https://podcasts.files.bbci.co.uk/\(id).rss",
                    imageUrl: ""
                ))
            }
        }
        
        DispatchQueue.main.async {
            self.subscribedPodcasts = resolved
            self.persistPodcasts(resolved)
        }
        
        // 4. Fetch OPML to resolve any titles or artwork if needed
        let needsOpml = resolved.contains { $0.title == $0.id || $0.imageUrl.isEmpty }
        if needsOpml {
            fetchOpml(for: Set(subscribedIds))
        }
    }
    
    private func fetchOpml(for targetIds: Set<String>) {
        isLoading = true
        var request = URLRequest(url: opmlUrl)
        request.setValue("BBC Radio Player Watch/1.0", forHTTPHeaderField: "User-Agent")
        request.timeoutInterval = 15
        
        URLSession.shared.dataTask(with: request) { [weak self] data, _, error in
            guard let self = self, let data = data, error == nil else {
                DispatchQueue.main.async {
                    self?.isLoading = false
                }
                return
            }
            
            let parser = OpmlParser(targetIds: targetIds)
            let parsedPodcasts = parser.parse(data: data)
            
            DispatchQueue.main.async {
                self.isLoading = false
                guard !parsedPodcasts.isEmpty else { return }
                let opmlMap = Dictionary(parsedPodcasts.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
                
                var updated = self.subscribedPodcasts
                for i in 0..<updated.count {
                    if let found = opmlMap[updated[i].id] {
                        updated[i] = found
                    }
                }
                self.subscribedPodcasts = updated
                self.persistPodcasts(updated)
            }
        }.resume()
    }
    
    func fetchEpisodes(for podcast: WatchPodcast, completion: @escaping ([WatchEpisode]) -> Void) {
        if let cached = episodeCache[podcast.id], !cached.isEmpty {
            completion(cached)
        }
        
        guard let url = URL(string: podcast.rssUrl) else {
            completion([])
            return
        }
        
        loadingEpisodesPodcastId = podcast.id
        var request = URLRequest(url: url)
        request.setValue("BBC Radio Player Watch/1.0", forHTTPHeaderField: "User-Agent")
        request.timeoutInterval = 15
        
        URLSession.shared.dataTask(with: request) { [weak self] data, _, error in
            DispatchQueue.main.async {
                self?.loadingEpisodesPodcastId = nil
            }
            guard let self = self, let data = data, error == nil else {
                DispatchQueue.main.async {
                    completion(self?.episodeCache[podcast.id] ?? [])
                }
                return
            }
            
            let parser = RssEpisodeParser(podcastId: podcast.id)
            let episodes = parser.parse(data: data)
            
            DispatchQueue.main.async {
                if let chImg = parser.channelImageUrl, !chImg.isEmpty {
                    if let idx = self.subscribedPodcasts.firstIndex(where: { $0.id == podcast.id }) {
                        if self.subscribedPodcasts[idx].imageUrl.isEmpty {
                            self.subscribedPodcasts[idx].imageUrl = chImg
                            self.persistPodcasts(self.subscribedPodcasts)
                        }
                    }
                }
                if !episodes.isEmpty {
                    self.episodeCache[podcast.id] = episodes
                }
                completion(episodes.isEmpty ? (self.episodeCache[podcast.id] ?? []) : episodes)
            }
        }.resume()
    }
}

final class OpmlParser: NSObject, XMLParserDelegate {
    let targetIds: Set<String>
    var results: [WatchPodcast] = []
    
    init(targetIds: Set<String>) {
        self.targetIds = targetIds
    }
    
    func parse(data: Data) -> [WatchPodcast] {
        let parser = XMLParser(data: data)
        parser.delegate = self
        parser.parse()
        return results
    }
    
    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName qName: String?, attributes attributeDict: [String : String] = [:]) {
        if elementName.lowercased() == "outline" {
            guard let xmlUrl = attributeDict["xmlUrl"]?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !xmlUrl.isEmpty else { return }
            let httpsUrl = xmlUrl.replacingOccurrences(of: "http://", with: "https://")
            let id = extractPodcastId(from: httpsUrl)
            if !id.isEmpty && targetIds.contains(id) && !results.contains(where: { $0.id == id }) {
                let title = (attributeDict["text"] ?? attributeDict["title"] ?? "Podcast").trimmingCharacters(in: .whitespacesAndNewlines)
                var imageHref = attributeDict["imageHref"]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                imageHref = imageHref.replacingOccurrences(of: "http://", with: "https://")
                results.append(WatchPodcast(id: id, title: title, rssUrl: httpsUrl, imageUrl: imageHref))
            }
        }
    }
    
    private func extractPodcastId(from url: String) -> String {
        let last = (url as NSString).lastPathComponent
        return last.replacingOccurrences(of: ".rss", with: "").replacingOccurrences(of: ".xml", with: "")
    }
}

final class RssEpisodeParser: NSObject, XMLParserDelegate {
    let podcastId: String
    var episodes: [WatchEpisode] = []
    var channelImageUrl: String? = nil
    private var inItem = false
    private var currentElement = ""
    private var currentTitle = ""
    private var currentGuid = ""
    private var currentAudioUrl = ""
    private var currentDuration = 0
    private var currentPubDate = ""
    private var currentEpisodeImageUrl: String? = nil
    
    init(podcastId: String) {
        self.podcastId = podcastId
    }
    
    func parse(data: Data) -> [WatchEpisode] {
        let parser = XMLParser(data: data)
        parser.delegate = self
        parser.parse()
        return episodes
    }
    
    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName qName: String?, attributes attributeDict: [String : String] = [:]) {
        currentElement = elementName.lowercased()
        if currentElement == "item" {
            inItem = true
            currentTitle = ""
            currentGuid = ""
            currentAudioUrl = ""
            currentDuration = 0
            currentPubDate = ""
            currentEpisodeImageUrl = nil
        } else if inItem && currentElement == "enclosure" {
            if let url = attributeDict["url"], !url.isEmpty {
                let type = attributeDict["type"]?.lowercased() ?? ""
                if type.isEmpty || type.starts(with: "audio/") {
                    currentAudioUrl = url.replacingOccurrences(of: "http://", with: "https://")
                }
            }
        } else if elementName.lowercased() == "itunes:image" {
            if let href = attributeDict["href"], !href.isEmpty {
                let httpsHref = href.replacingOccurrences(of: "http://", with: "https://")
                if inItem {
                    currentEpisodeImageUrl = httpsHref
                } else {
                    channelImageUrl = httpsHref
                }
            }
        }
    }
    
    func parser(_ parser: XMLParser, foundCharacters string: String) {
        guard inItem else { return }
        switch currentElement {
        case "title": currentTitle += string
        case "guid": currentGuid += string
        case "pubdate": currentPubDate += string
        case "itunes:duration":
            let durStr = string.trimmingCharacters(in: .whitespacesAndNewlines)
            if let secs = Int(durStr) {
                currentDuration = secs
            }
        default: break
        }
    }
    
    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) {
        if elementName.lowercased() == "item" && inItem {
            inItem = false
            let cleanTitle = currentTitle.trimmingCharacters(in: .whitespacesAndNewlines)
            let cleanGuid = currentGuid.trimmingCharacters(in: .whitespacesAndNewlines)
            let id = cleanGuid.isEmpty ? "\(cleanTitle.hashValue)" : cleanGuid
            if !currentAudioUrl.isEmpty {
                episodes.append(WatchEpisode(
                    id: id,
                    title: cleanTitle.isEmpty ? "Episode" : cleanTitle,
                    podcastId: podcastId,
                    mediaUrl: currentAudioUrl,
                    duration: currentDuration,
                    pubDate: currentPubDate.trimmingCharacters(in: .whitespacesAndNewlines),
                    imageUrl: currentEpisodeImageUrl ?? channelImageUrl
                ))
            }
        }
        currentElement = ""
    }
}
