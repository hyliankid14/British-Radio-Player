import SwiftUI

struct HomeView: View {
    @State private var selectedTab = 1
    
    var body: some View {
        TabView(selection: $selectedTab) {
            FavouritesPageView()
                .tag(0)
            
            MenuPageView()
                .tag(1)
        }
        .tabViewStyle(.page)
        .overlay(alignment: .bottom) {
            MiniPlayerView()
        }
    }
}

struct FavouritesPageView: View {
    var body: some View {
        let manager = WatchConnectivityManager.shared
        let ids = manager.appState.favourite_ids ?? []
        let order = manager.appState.favourite_order ?? []
        let stations = WatchStationCatalogue.favourites(from: ids, order: order)
        
        if stations.isEmpty {
            Text("Add favourites in the app")
                .font(.headline)
                .multilineTextAlignment(.center)
                .padding()
        } else {
            List {
                Text("Favourites").font(.headline)
                ForEach(stations) { station in
                    Button(action: {
                        WatchPlaybackController.shared.playStation(station)
                    }) {
                        Text(station.title)
                    }
                }
            }
        }
    }
}

struct MenuPageView: View {
    var body: some View {
        List {
            NavigationLink("Stations", destination: StationListView())
            NavigationLink("Podcasts", destination: PodcastListView())
        }
    }
}

struct MiniPlayerView: View {
    var body: some View {
        if WatchPlaybackController.shared.isPlaying || WatchPlaybackController.shared.currentStationId != nil {
            NavigationLink(destination: NowPlayingView()) {
                HStack {
                    Text("Now Playing")
                        .font(.caption)
                    Spacer()
                    Image(systemName: WatchPlaybackController.shared.isPlaying ? "pause.fill" : "play.fill")
                }
                .padding()
                .background(Color.secondary.opacity(0.5))
                .cornerRadius(8)
            }
            .buttonStyle(.plain)
            .padding(.horizontal)
            .padding(.bottom, 8)
        }
    }
}
