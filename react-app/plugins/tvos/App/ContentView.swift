import SwiftUI

enum TVTab: String, Hashable {
    case home
    case stations
    case guide
    case podcasts
    case nowPlaying
    case search
    case settings
}

struct ContentView: View {
    @State private var selectedTab: TVTab = .home
    @State private var activePodcast: TVPodcast? = nil
    @Bindable var controller = TVPlaybackController.shared
    
    var body: some View {
        TabView(selection: $selectedTab) {
            NavigationStack {
                HomeView(onNavigateToNowPlaying: {
                    selectedTab = .nowPlaying
                })
            }
            .tabItem {
                Label("Home", systemImage: "house.fill")
            }
            .tag(TVTab.home)
            
            NavigationStack {
                StationsView(onNavigateToNowPlaying: {
                    selectedTab = .nowPlaying
                })
            }
            .tabItem {
                Label("Stations", systemImage: "radio.fill")
            }
            .tag(TVTab.stations)
            
            NavigationStack {
                GuideView(onNavigateToNowPlaying: {
                    selectedTab = .nowPlaying
                })
            }
            .tabItem {
                Label("Guide", systemImage: "calendar")
            }
            .tag(TVTab.guide)
            
            NavigationStack {
                PodcastsView(onNavigateToNowPlaying: {
                    selectedTab = .nowPlaying
                })
                .navigationDestination(item: $activePodcast) { podcast in
                    EpisodeListView(podcast: podcast, onNavigateToNowPlaying: {
                        selectedTab = .nowPlaying
                    })
                }
            }
            .tabItem {
                Label("Podcasts", systemImage: "antenna.radiowaves.left.and.right")
            }
            .tag(TVTab.podcasts)
            
            NowPlayingView()
                .tabItem {
                    Label("Now Playing", systemImage: controller.isPlaying ? "speaker.wave.3.fill" : "play.circle.fill")
                }
                .tag(TVTab.nowPlaying)
            
            SearchView(onNavigateToNowPlaying: {
                selectedTab = .nowPlaying
            })
            .tabItem {
                Label("Search", systemImage: "magnifyingglass")
            }
            .tag(TVTab.search)
            
            SettingsView()
                .tabItem {
                    Label("Settings", systemImage: "gearshape.fill")
                }
                .tag(TVTab.settings)
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("BRPTVOpenTab"))) { notif in
            if let tabName = notif.userInfo?["tab"] as? String {
                switch tabName.lowercased() {
                case "home": selectedTab = .home
                case "stations": selectedTab = .stations
                case "guide": selectedTab = .guide
                case "podcasts": selectedTab = .podcasts
                case "nowplaying", "now_playing": selectedTab = .nowPlaying
                case "search": selectedTab = .search
                case "settings": selectedTab = .settings
                default: break
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("BRPTVOpenStation"))) { notif in
            if let stationId = notif.userInfo?["stationId"] as? String,
               let station = TVStationCatalogue.findById(stationId) {
                controller.playStation(station)
                selectedTab = .nowPlaying
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("BRPTVOpenPodcast"))) { notif in
            if let podcastId = notif.userInfo?["podcastId"] as? String {
                if let podcast = TVPodcastManager.shared.featuredPodcasts.first(where: { $0.id == podcastId }) {
                    selectedTab = .podcasts
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                        activePodcast = podcast
                    }
                }
            }
        }
    }
}
