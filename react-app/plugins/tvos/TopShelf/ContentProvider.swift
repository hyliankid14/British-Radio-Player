import Foundation
import TVServices

class ContentProvider: TVTopShelfContentProvider {
    
    // Known curated podcasts catalogue
    private let curatedPodcasts: [(id: String, title: String, imageUrl: String)] = [
        ("p07h19zz", "Americast", "https://ichef.bbci.co.uk/images/ic/624x624/p0k99j29.jpg"),
        ("p04d42rc", "CrowdScience", "https://ichef.bbci.co.uk/images/ic/624x624/p0p7qtn7.jpg"),
        ("p0ns1h35", "Here for the History", "https://ichef.bbci.co.uk/images/ic/624x624/p0p3vdz4.jpg"),
        ("p02pc9pj", "Friday Night Comedy", "https://ichef.bbci.co.uk/images/ic/624x624/p0lbr5kr.jpg"),
        ("p05299nl", "Newscast", "https://ichef.bbci.co.uk/images/ic/624x624/p0l7jnc6.jpg"),
        ("p02nq0lx", "The Documentary", "https://ichef.bbci.co.uk/images/ic/624x624/p0p8d4hv.jpg"),
        ("p004t1hd", "Witness History", "https://ichef.bbci.co.uk/images/ic/624x624/p0kt82ds.jpg"),
        ("p002vsxs", "Business Daily", "https://ichef.bbci.co.uk/images/ic/624x624/p0l9wqb4.jpg"),
        ("b006qykl", "In Our Time", "https://ichef.bbci.co.uk/images/ic/624x624/p0p8dsw0.jpg"),
        ("b006qpgr", "The Archers", "https://ichef.bbci.co.uk/images/ic/624x624/p0m1pyhc.jpg"),
        ("p02pc9ny", "5 Live Science", "https://ichef.bbci.co.uk/images/ic/624x624/p0d8lrz7.jpg")
    ]
    
    // Featured stations database
    private let allStations: [(id: String, name: String)] = [
        ("radio1", "Radio 1"),
        ("1xtra", "Radio 1Xtra"),
        ("radio1dance", "Radio 1 Dance"),
        ("radio1anthems", "Radio 1 Anthems"),
        ("radio2", "Radio 2"),
        ("radio3", "Radio 3"),
        ("radio3unwind", "Radio 3 Unwind"),
        ("radio4", "Radio 4"),
        ("radio4extra", "Radio 4 Extra"),
        ("radio5live", "Radio 5 Live"),
        ("radio5livesportsextra", "Radio 5 Sports Extra"),
        ("radio6", "Radio 6 Music"),
        ("radio6indieforever", "Radio 6 Indie Forever"),
        ("worldservice", "World Service"),
        ("livenews", "Live News"),
        ("asiannetwork", "Asian Network"),
        ("radioscotland", "Radio Scotland"),
        ("radiowales", "Radio Wales"),
        ("radioulster", "Radio Ulster")
    ]
    
    private func identImageUrl(for stationId: String) -> URL? {
        // 1. Check Top Shelf bundle resources
        if let bundleUrl = Bundle.main.url(forResource: stationId, withExtension: "png") {
            return bundleUrl
        }
        
        // 2. Check main app bundle (BRPTV.app)
        let mainAppBundleUrl = Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent()
        let mainAppIdent = mainAppBundleUrl.appendingPathComponent("\(stationId).png")
        if FileManager.default.fileExists(atPath: mainAppIdent.path) {
            return mainAppIdent
        }
        
        // 3. Check shared App Group container
        if let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.com.hyliankid14.bbcradioplayer") {
            let identsDirCandidate = container.appendingPathComponent("idents/\(stationId).png")
            if FileManager.default.fileExists(atPath: identsDirCandidate.path) {
                return identsDirCandidate
            }
            let rootCandidate = container.appendingPathComponent("\(stationId).png")
            if FileManager.default.fileExists(atPath: rootCandidate.path) {
                return rootCandidate
            }
        }
        
        return nil
    }
    
    override func loadTopShelfContent() async -> TVTopShelfContent? {
        let appGroup = UserDefaults(suiteName: "group.com.hyliankid14.bbcradioplayer") ?? UserDefaults.standard
        
        var sections: [TVTopShelfItemCollection<TVTopShelfSectionedItem>] = []
        
        // MARK: - 1. FIRST ROW: Stations (with custom IDENTS)
        let favIds = appGroup.stringArray(forKey: "cached_favourite_ids") ?? []
        
        let stationsToShow: [(id: String, name: String)]
        let stationShelfTitle: String
        
        if !favIds.isEmpty {
            let mappedFavs = favIds.compactMap { id in allStations.first(where: { $0.id == id }) }
            if !mappedFavs.isEmpty {
                stationsToShow = mappedFavs
                stationShelfTitle = "Favourite Stations"
            } else {
                stationsToShow = Array(allStations.prefix(6))
                stationShelfTitle = "Live Radio Networks"
            }
        } else {
            stationsToShow = Array(allStations.prefix(6))
            stationShelfTitle = "Live Radio Networks"
        }
        
        let stationItems: [TVTopShelfSectionedItem] = stationsToShow.compactMap { station in
            guard let playUrl = URL(string: "bbcradioplayer://station/\(station.id)") else { return nil }
            guard let identUrl = identImageUrl(for: station.id) else { return nil }
            
            let item = TVTopShelfSectionedItem(identifier: "station_\(station.id)")
            item.title = station.name
            item.setImageURL(identUrl, for: .screenScale1x)
            item.setImageURL(identUrl, for: .screenScale2x)
            item.imageShape = .square
            
            let playAction = TVTopShelfAction(url: playUrl)
            item.playAction = playAction
            item.displayAction = playAction
            
            return item
        }
        
        if !stationItems.isEmpty {
            let stationCollection = TVTopShelfItemCollection(items: stationItems)
            stationCollection.title = stationShelfTitle
            sections.append(stationCollection)
        }
        
        // MARK: - 2. SECOND ROW: Subscribed Podcasts
        let subIds = appGroup.stringArray(forKey: "cached_subscribed_podcast_ids") ?? []
        
        var cachedMeta: [String: [String: String]] = [:]
        if let metaDict = appGroup.dictionary(forKey: "cached_subscribed_podcasts_meta") as? [String: [String: String]] {
            cachedMeta = metaDict
        }
        
        var podcastsToShow: [(id: String, title: String, imageUrl: String)] = []
        
        for subId in subIds {
            if let meta = cachedMeta[subId], let title = meta["title"], let img = meta["imageUrl"] {
                podcastsToShow.append((id: subId, title: title, imageUrl: img))
            } else if let curated = curatedPodcasts.first(where: { $0.id == subId }) {
                podcastsToShow.append(curated)
            }
        }
        
        let podcastShelfTitle: String
        if !podcastsToShow.isEmpty {
            podcastShelfTitle = "Subscribed Podcasts"
        } else {
            // Fallback to top curated podcasts if user has not subscribed yet
            podcastsToShow = Array(curatedPodcasts.prefix(6))
            podcastShelfTitle = "Podcasts"
        }
        
        let podcastItems: [TVTopShelfSectionedItem] = podcastsToShow.compactMap { podcast in
            guard let playUrl = URL(string: "bbcradioplayer://play-podcast/\(podcast.id)"),
                  let displayUrl = URL(string: "bbcradioplayer://podcast/\(podcast.id)"),
                  let imgUrl = URL(string: podcast.imageUrl) else { return nil }
            
            let item = TVTopShelfSectionedItem(identifier: "podcast_\(podcast.id)")
            item.title = podcast.title
            item.setImageURL(imgUrl, for: .screenScale1x)
            item.setImageURL(imgUrl, for: .screenScale2x)
            item.imageShape = .square
            item.playAction = TVTopShelfAction(url: playUrl)
            item.displayAction = TVTopShelfAction(url: displayUrl)
            return item
        }
        
        if !podcastItems.isEmpty {
            let podcastCollection = TVTopShelfItemCollection(items: podcastItems)
            podcastCollection.title = podcastShelfTitle
            sections.append(podcastCollection)
        }
        
        return TVTopShelfSectionedContent(sections: sections)
    }
}
