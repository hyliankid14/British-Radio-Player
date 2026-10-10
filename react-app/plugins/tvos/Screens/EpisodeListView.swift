import SwiftUI

struct EpisodeListView: View {
    let podcast: TVPodcast
    let onNavigateToNowPlaying: () -> Void
    
    @Bindable var controller = TVPlaybackController.shared
    @Bindable var podcastManager = TVPodcastManager.shared
    @Bindable var subscriptionManager = TVSubscriptionManager.shared
    
    @State private var episodes: [TVEpisode] = []
    @State private var isLoading: Bool = true
    @FocusState private var isSubscribeFocused: Bool
    
    var body: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 40) {
                
                // Podcast Header
                HStack(alignment: .top, spacing: 40) {
                    AsyncImage(url: URL(string: podcast.imageUrl)) { phase in
                        switch phase {
                        case .success(let image):
                            image
                                .resizable()
                                .aspectRatio(contentMode: .fill)
                        default:
                            Color(white: 0.15)
                        }
                    }
                    .frame(width: 280, height: 280)
                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                    
                    VStack(alignment: .leading, spacing: 14) {
                        Text(podcast.title)
                            .font(.title)
                            .fontWeight(.bold)
                            .foregroundColor(.primary)
                        
                        if let author = podcast.author {
                            Text(author)
                                .font(.title3)
                                .foregroundColor(.red)
                        }
                        
                        if let desc = podcast.description {
                            Text(desc)
                                .font(.body)
                                .foregroundColor(.secondary)
                                .lineLimit(3)
                        }
                        
                        HStack(spacing: 20) {
                            if let genre = podcast.genre {
                                Text(genre)
                                    .font(.caption)
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 8)
                                    .background(Color.white.opacity(0.1))
                                    .clipShape(Capsule())
                            }
                            
                            Button(action: {
                                withAnimation(.spring(response: 0.35, dampingFraction: 0.6)) {
                                    subscriptionManager.toggleSubscription(podcast.id)
                                }
                            }) {
                                HStack(spacing: 10) {
                                    Image(systemName: subscriptionManager.isSubscribed(podcast.id) ? "star.fill" : "star")
                                        .font(.system(size: 20, weight: .semibold))
                                        .foregroundColor(isSubscribeFocused ? .black : (subscriptionManager.isSubscribed(podcast.id) ? .yellow : .white))
                                    Text(subscriptionManager.isSubscribed(podcast.id) ? "Subscribed" : "Subscribe")
                                        .font(.headline)
                                        .fontWeight(.semibold)
                                        .foregroundColor(isSubscribeFocused ? .black : .white)
                                }
                                .padding(.horizontal, 18)
                                .padding(.vertical, 10)
                            }
                            .buttonStyle(.card)
                            .focused($isSubscribeFocused)
                        }
                        .padding(.top, 4)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.horizontal, 90)
                .padding(.top, 30)
                
                // Episodes Header
                Text("Episodes")
                    .font(.title2)
                    .fontWeight(.bold)
                    .padding(.horizontal, 90)
                
                if isLoading {
                    HStack {
                        Spacer()
                        ProgressView("Loading episodes…")
                            .padding(.vertical, 40)
                        Spacer()
                    }
                } else if episodes.isEmpty {
                    Text("No episodes available.")
                        .font(.headline)
                        .foregroundColor(.secondary)
                        .padding(.horizontal, 90)
                } else {
                    LazyVStack(spacing: 16) {
                        ForEach(episodes) { episode in
                            EpisodeRowView(
                                episode: episode,
                                isCurrentlyPlaying: controller.currentEpisode?.id == episode.id && controller.isPlaying,
                                onSelect: {
                                    controller.playEpisode(episode, podcast: podcast)
                                    onNavigateToNowPlaying()
                                }
                            )
                        }
                    }
                    .padding(.horizontal, 90)
                }
            }
            .padding(.bottom, 60)
        }
        .task(id: podcast.id) {
            if let cached = podcastManager.episodesByPodcast[podcast.id], !cached.isEmpty {
                self.episodes = cached
                self.isLoading = false
                return
            }
            isLoading = true
            podcastManager.fetchEpisodes(for: podcast) { fetched in
                DispatchQueue.main.async {
                    self.episodes = fetched
                    self.isLoading = false
                }
            }
        }
    }
}
