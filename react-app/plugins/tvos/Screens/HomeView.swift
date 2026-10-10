import SwiftUI

struct HomeView: View {
    @Bindable var controller = TVPlaybackController.shared
    @Bindable var favouritesManager = TVFavouritesManager.shared
    @Bindable var subscriptionManager = TVSubscriptionManager.shared
    @Bindable var podcastManager = TVPodcastManager.shared
    let onNavigateToNowPlaying: () -> Void
    
    private let allStations = TVStationCatalogue.allStations()
    
    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: 44) {
                    
                    // App Branding Header
                    HStack(spacing: 24) {
                        if let img = UIImage(named: "app-logo") ?? UIImage(contentsOfFile: Bundle.main.path(forResource: "app-logo", ofType: "png") ?? "") {
                            Image(uiImage: img)
                                .resizable()
                                .aspectRatio(contentMode: .fit)
                                .frame(width: 80, height: 80)
                                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                                .shadow(color: .black.opacity(0.25), radius: 8, x: 0, y: 4)
                        }
                        
                        VStack(alignment: .leading, spacing: 6) {
                            Text("British Radio Player")
                                .font(.title)
                                .fontWeight(.bold)
                                .foregroundColor(.primary)
                            
                            Text("Live Radio Stations and Podcasts")
                                .font(.headline)
                                .foregroundColor(.secondary)
                        }
                        
                        Spacer()
                    }
                    .padding(.horizontal, 90)
                    .padding(.top, 20)
                    
                    // Favourites Shelf (Top Row)
                    VStack(alignment: .leading, spacing: 20) {
                        Text("Favourites")
                            .font(.title2)
                            .fontWeight(.bold)
                            .padding(.horizontal, 90)
                        
                        let favouriteStations = favouritesManager.favouriteStations()
                        if !favouriteStations.isEmpty {
                            ScrollView(.horizontal, showsIndicators: false) {
                                LazyHStack(spacing: 36) {
                                    ForEach(favouriteStations) { station in
                                        StationCardView(
                                            station: station,
                                            isCurrentlyPlaying: controller.currentStation?.id == station.id && controller.isPlaying,
                                            onSelect: {
                                                controller.playStation(station)
                                                onNavigateToNowPlaying()
                                            }
                                        )
                                    }
                                }
                                .padding(.horizontal, 90)
                                .padding(.vertical, 16)
                            }
                        } else {
                            VStack(spacing: 12) {
                                Text("No favourite stations yet")
                                    .font(.headline)
                                    .foregroundColor(.secondary)
                                Text("Favourite any station from the player or directory to pin it here")
                                    .font(.subheadline)
                                    .foregroundColor(.secondary.opacity(0.8))
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 36)
                            .padding(.horizontal, 90)
                        }
                    }
                    .id("favourites_shelf")
                    
                    // Subscribed Podcasts Shelf (Second Row)
                    let subscribedPodcasts = podcastManager.subscribedPodcasts()
                    VStack(alignment: .leading, spacing: 20) {
                        HStack(alignment: .firstTextBaseline) {
                            Text("Subscribed Podcasts")
                                .font(.title2)
                                .fontWeight(.bold)
                            
                            Spacer()
                            
                            if !subscribedPodcasts.isEmpty {
                                Text("\(subscribedPodcasts.count) subscribed")
                                    .font(.subheadline)
                                    .foregroundColor(.secondary)
                            } else {
                                Text("Subscribe in Podcasts tab")
                                    .font(.subheadline)
                                    .foregroundColor(.secondary)
                            }
                        }
                        .padding(.horizontal, 90)
                        
                        if !subscribedPodcasts.isEmpty {
                            ScrollView(.horizontal, showsIndicators: false) {
                                LazyHStack(spacing: 36) {
                                    ForEach(subscribedPodcasts) { podcast in
                                        NavigationLink(destination: EpisodeListView(podcast: podcast, onNavigateToNowPlaying: onNavigateToNowPlaying)) {
                                            PodcastCardView(podcast: podcast)
                                        }
                                        .buttonStyle(.card)
                                    }
                                }
                                .padding(.horizontal, 90)
                                .padding(.vertical, 16)
                            }
                        } else {
                            VStack(spacing: 12) {
                                Text("No subscribed podcasts yet")
                                    .font(.headline)
                                    .foregroundColor(.secondary)
                                Text("Subscribe to any podcast to see new episodes and quick access here")
                                    .font(.subheadline)
                                    .foregroundColor(.secondary.opacity(0.8))
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 36)
                            .padding(.horizontal, 90)
                        }
                    }
                    .id("subscribed_podcasts_shelf")
                    
                    // All Stations Shelf
                    VStack(alignment: .leading, spacing: 20) {
                        Text("All Stations")
                            .font(.title2)
                            .fontWeight(.bold)
                            .padding(.horizontal, 90)
                        
                        ScrollView(.horizontal, showsIndicators: false) {
                            LazyHStack(spacing: 36) {
                                ForEach(allStations) { station in
                                    StationCardView(
                                        station: station,
                                        isCurrentlyPlaying: controller.currentStation?.id == station.id && controller.isPlaying,
                                        onSelect: {
                                            controller.playStation(station)
                                            onNavigateToNowPlaying()
                                        }
                                    )
                                }
                            }
                            .padding(.horizontal, 90)
                            .padding(.vertical, 16)
                        }
                    }
                    .id("all_stations_shelf")
                    
                    // Podcasts Shelf
                    VStack(alignment: .leading, spacing: 20) {
                        Text("Podcasts")
                            .font(.title2)
                            .fontWeight(.bold)
                            .padding(.horizontal, 90)
                        
                        ScrollView(.horizontal, showsIndicators: false) {
                            LazyHStack(spacing: 36) {
                                ForEach(podcastManager.featuredPodcasts) { podcast in
                                    NavigationLink(destination: EpisodeListView(podcast: podcast, onNavigateToNowPlaying: onNavigateToNowPlaying)) {
                                        PodcastCardView(podcast: podcast)
                                    }
                                    .buttonStyle(.card)
                                }
                            }
                            .padding(.horizontal, 90)
                            .padding(.vertical, 16)
                        }
                    }
                    .id("podcasts_shelf")
                }
                .padding(.vertical, 40)
            }
            .onReceive(NotificationCenter.default.publisher(for: Notification.Name("BRPTVScrollHome"))) { notif in
                if let target = notif.userInfo?["target"] as? String {
                    withAnimation {
                        proxy.scrollTo(target, anchor: .top)
                    }
                }
            }
        }
        .task {
            for station in favouritesManager.favouriteStations() {
                TVNowPlayingMetadata.shared.fetchShowTitle(for: station.serviceId) { _ in }
            }
            for station in allStations {
                TVNowPlayingMetadata.shared.fetchShowTitle(for: station.serviceId) { _ in }
            }
        }
    }
}
