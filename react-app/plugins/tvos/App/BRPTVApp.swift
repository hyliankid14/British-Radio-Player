import SwiftUI

@main
struct BRPTVApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .onOpenURL { url in
                    handleDeepLink(url)
                }
        }
    }
    
    private func handleDeepLink(_ url: URL) {
        // e.g. bbcradioplayer://station/radio1 or bbcradioplayer://tab/guide
        let host = url.host ?? ""
        let pathComponents = url.pathComponents.filter { $0 != "/" }
        
        if host == "tab" {
            if let tabName = pathComponents.first {
                NotificationCenter.default.post(
                    name: Notification.Name("BRPTVOpenTab"),
                    object: nil,
                    userInfo: ["tab": tabName]
                )
            }
            if let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "q" })?.value {
                NotificationCenter.default.post(
                    name: Notification.Name("BRPTVSearch"),
                    object: nil,
                    userInfo: ["query": query]
                )
            }
            return
        }
        
        if host == "search" {
            NotificationCenter.default.post(
                name: Notification.Name("BRPTVOpenTab"),
                object: nil,
                userInfo: ["tab": "search"]
            )
            if let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "q" })?.value {
                NotificationCenter.default.post(
                    name: Notification.Name("BRPTVSearch"),
                    object: nil,
                    userInfo: ["query": query]
                )
            }
            return
        }
        
        if host == "guide-detail" || (host == "tab" && pathComponents.first == "guide-detail") {
            NotificationCenter.default.post(
                name: Notification.Name("BRPTVOpenTab"),
                object: nil,
                userInfo: ["tab": "guide"]
            )
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                NotificationCenter.default.post(
                    name: Notification.Name("BRPTVOpenGuideDetail"),
                    object: nil,
                    userInfo: nil
                )
            }
            return
        }
        
        if host == "action" {
            let actionName = pathComponents.first ?? ""
            DispatchQueue.main.async {
                switch actionName {
                case "play-pause", "toggle":
                    TVPlaybackController.shared.togglePlayPause()
                case "stop":
                    TVPlaybackController.shared.stop()
                case "next", "skip-forward":
                    TVPlaybackController.shared.playNext()
                case "prev", "previous", "skip-backward":
                    TVPlaybackController.shared.playPrevious()
                default:
                    break
                }
            }
            return
        }
        
        if host == "scroll" || (host == "home" && !pathComponents.isEmpty) {
            let section = pathComponents.first ?? "podcasts"
            NotificationCenter.default.post(
                name: Notification.Name("BRPTVOpenTab"),
                object: nil,
                userInfo: ["tab": "home"]
            )
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                let targetId = section.hasSuffix("_shelf") ? section : "\(section)_shelf"
                NotificationCenter.default.post(
                    name: Notification.Name("BRPTVScrollHome"),
                    object: nil,
                    userInfo: ["target": targetId]
                )
            }
            return
        }
        
        if host == "toggle-favourite" || host == "favourite" {
            if let stationId = pathComponents.first {
                TVFavouritesManager.shared.toggleFavourite(stationId)
            }
            return
        }
        
        if host == "toggle-subscription" || host == "subscribe" {
            if let podcastId = pathComponents.first {
                TVSubscriptionManager.shared.toggleSubscription(podcastId)
            }
            return
        }
        
        if host == "play-podcast" || host == "play-episode" {
            let podcastId = pathComponents.first ?? ""
            if let podcast = TVPodcastManager.shared.featuredPodcasts.first(where: { $0.id == podcastId }) {
                TVPodcastManager.shared.fetchEpisodes(for: podcast) { episodes in
                    if let firstEp = episodes.first {
                        DispatchQueue.main.async {
                            TVPlaybackController.shared.playEpisode(firstEp, podcast: podcast)
                            NotificationCenter.default.post(
                                name: Notification.Name("BRPTVOpenTab"),
                                object: nil,
                                userInfo: ["tab": "nowPlaying"]
                            )
                        }
                    }
                }
            }
            return
        }

        if host == "podcast" {
            if let podcastId = pathComponents.first {
                NotificationCenter.default.post(
                    name: Notification.Name("BRPTVOpenPodcast"),
                    object: nil,
                    userInfo: ["podcastId": podcastId]
                )
            }
            return
        }
        
        var targetStationId: String? = nil
        if host == "station" || host == "play" {
            targetStationId = pathComponents.first
        } else if !host.isEmpty {
            targetStationId = host
        }
        
        if let stationId = targetStationId {
            NotificationCenter.default.post(
                name: Notification.Name("BRPTVOpenStation"),
                object: nil,
                userInfo: ["stationId": stationId]
            )
        }
    }
    
    init() {
        syncIdentsToSharedContainer()
    }
    
    private func syncIdentsToSharedContainer() {
        guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.com.hyliankid14.bbcradioplayer") else { return }
        let identsDir = container.appendingPathComponent("idents", isDirectory: true)
        try? FileManager.default.createDirectory(at: identsDir, withIntermediateDirectories: true)
        
        if let resourcePath = Bundle.main.resourcePath,
           let files = try? FileManager.default.contentsOfDirectory(atPath: resourcePath) {
            for file in files where file.hasSuffix(".png") {
                let dest = identsDir.appendingPathComponent(file)
                if !FileManager.default.fileExists(atPath: dest.path) {
                    let src = URL(fileURLWithPath: resourcePath).appendingPathComponent(file)
                    try? FileManager.default.copyItem(at: src, to: dest)
                }
            }
        }
    }
}
