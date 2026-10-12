import SwiftUI

@main
struct BRPWatchApp: App {
    init() {
        _ = WatchPlaybackController.shared
        _ = WatchConnectivityManager.shared
        _ = NowPlayingMetadata.shared
    }
    
    var body: some Scene {
        WindowGroup {
            ContentView()
                .onOpenURL { url in
                    handleDeepLink(url)
                }
        }
    }
    
    private func handleDeepLink(_ url: URL) {
        let host = url.host ?? ""
        let pathComponents = url.pathComponents.filter { $0 != "/" }
        
        if host == "voice" {
            let action = pathComponents.first ?? ""
            let queryItems = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems
            let queryParam = queryItems?.first(where: { $0.name == "name" || $0.name == "query" || $0.name == "q" })?.value ?? ""
            
            DispatchQueue.main.async {
                switch action {
                case "station":
                    let all = WatchStationCatalogue.allStations()
                    let q = queryParam.lowercased()
                    if let station = all.first(where: { $0.title.lowercased().contains(q) || $0.id.lowercased().contains(q) }) {
                        WatchPlaybackController.shared.playStation(station)
                    }
                case "podcast":
                    let allPods = WatchPodcastManager.shared.subscribedPodcasts
                    let q = queryParam.lowercased()
                    if let podcast = allPods.first(where: { $0.title.lowercased().contains(q) || $0.id.lowercased().contains(q) }) {
                        WatchPodcastManager.shared.fetchEpisodes(for: podcast) { episodes in
                            let unplayed = episodes.first(where: { !WatchSharedState.shared.isEpisodePlayed($0.id) }) ?? episodes.first
                            if let ep = unplayed {
                                DispatchQueue.main.async {
                                    WatchPlaybackController.shared.playEpisode(ep, podcast: podcast)
                                }
                            }
                        }
                    }
                case "random-podcast":
                    let allPods = WatchPodcastManager.shared.subscribedPodcasts
                    if let podcast = allPods.randomElement() {
                        WatchPodcastManager.shared.fetchEpisodes(for: podcast) { episodes in
                            let unplayed = episodes.first(where: { !WatchSharedState.shared.isEpisodePlayed($0.id) }) ?? episodes.first
                            if let ep = unplayed {
                                DispatchQueue.main.async {
                                    WatchPlaybackController.shared.playEpisode(ep, podcast: podcast)
                                }
                            }
                        }
                    }
                case "resume":
                    WatchPlaybackController.shared.resume()
                case "stop":
                    WatchPlaybackController.shared.stop()
                default:
                    break
                }
            }
            return
        }
        
        if host == "station" || host == "play" {
            let stationId = pathComponents.first ?? ""
            if let station = WatchStationCatalogue.findById(stationId) {
                DispatchQueue.main.async {
                    WatchPlaybackController.shared.playStation(station)
                }
            }
        }
    }
}
