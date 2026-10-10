import SwiftUI

struct PodcastsView: View {
    @Bindable var podcastManager = TVPodcastManager.shared
    @Bindable var subscriptionManager = TVSubscriptionManager.shared
    let onNavigateToNowPlaying: () -> Void
    
    var body: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 36) {
                Text("Podcasts")
                    .font(.title)
                    .fontWeight(.bold)
                    .padding(.horizontal, 90)
                    .padding(.top, 24)
                
                let subscribed = podcastManager.subscribedPodcasts()
                let otherPodcasts = podcastManager.featuredPodcasts.filter { !subscriptionManager.isSubscribed($0.id) }
                
                if !subscribed.isEmpty {
                    // Subscribed Section (Shows first!)
                    VStack(alignment: .leading, spacing: 20) {
                        Text("Subscribed")
                            .font(.title2)
                            .fontWeight(.bold)
                            .padding(.horizontal, 90)
                        
                        LazyVGrid(
                            columns: [
                                GridItem(.adaptive(minimum: 250, maximum: 250), spacing: 40)
                            ],
                            spacing: 40
                        ) {
                            ForEach(subscribed) { podcast in
                                NavigationLink(destination: EpisodeListView(podcast: podcast, onNavigateToNowPlaying: onNavigateToNowPlaying)) {
                                    PodcastCardView(podcast: podcast)
                                }
                                .buttonStyle(.card)
                            }
                        }
                        .padding(.horizontal, 90)
                    }
                    
                    // Popular Podcasts Section
                    VStack(alignment: .leading, spacing: 20) {
                        Text("Popular Podcasts")
                            .font(.title2)
                            .fontWeight(.bold)
                            .padding(.horizontal, 90)
                        
                        LazyVGrid(
                            columns: [
                                GridItem(.adaptive(minimum: 250, maximum: 250), spacing: 40)
                            ],
                            spacing: 40
                        ) {
                            ForEach(otherPodcasts) { podcast in
                                NavigationLink(destination: EpisodeListView(podcast: podcast, onNavigateToNowPlaying: onNavigateToNowPlaying)) {
                                    PodcastCardView(podcast: podcast)
                                }
                                .buttonStyle(.card)
                            }
                        }
                        .padding(.horizontal, 90)
                    }
                } else {
                    VStack(alignment: .leading, spacing: 20) {
                        Text("Popular Podcasts")
                            .font(.title2)
                            .fontWeight(.bold)
                            .padding(.horizontal, 90)
                        
                        LazyVGrid(
                            columns: [
                                GridItem(.adaptive(minimum: 250, maximum: 250), spacing: 40)
                            ],
                            spacing: 40
                        ) {
                            ForEach(podcastManager.featuredPodcasts) { podcast in
                                NavigationLink(destination: EpisodeListView(podcast: podcast, onNavigateToNowPlaying: onNavigateToNowPlaying)) {
                                    PodcastCardView(podcast: podcast)
                                }
                                .buttonStyle(.card)
                            }
                        }
                        .padding(.horizontal, 90)
                    }
                }
            }
            .padding(.vertical, 24)
        }
    }
}
