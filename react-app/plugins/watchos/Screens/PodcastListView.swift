import SwiftUI

struct PodcastListView: View {
    @Bindable var connectivity = WatchConnectivityManager.shared
    @Bindable var podcastManager = WatchPodcastManager.shared

    var body: some View {
        List {
            let subscribedIds = connectivity.appState.subscribed_podcast_ids ?? []
            let podcasts = podcastManager.subscribedPodcasts

            if subscribedIds.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "waveform.and.mic")
                        .font(.title2)
                        .foregroundStyle(.secondary)
                    Text("No Subscriptions")
                        .font(.headline)
                    Text("Subscribe to podcasts in the phone app to listen on your Apple Watch.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .padding(.vertical, 16)
                .frame(maxWidth: .infinity)
                .listRowBackground(Color.clear)
            } else if podcasts.isEmpty && podcastManager.isLoading {
                VStack(spacing: 8) {
                    ProgressView()
                    Text("Loading podcasts…")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 20)
                .frame(maxWidth: .infinity)
                .listRowBackground(Color.clear)
            } else {
                ForEach(podcasts) { podcast in
                    NavigationLink(destination: EpisodeListView(podcast: podcast)) {
                        HStack(spacing: 10) {
                            if !podcast.imageUrl.isEmpty, let url = URL(string: podcast.imageUrl) {
                                AsyncImage(url: url) { phase in
                                    switch phase {
                                    case .success(let image):
                                        image
                                            .resizable()
                                            .aspectRatio(contentMode: .fill)
                                            .frame(width: 36, height: 36)
                                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                                    default:
                                        podcastPlaceholder
                                    }
                                }
                                .frame(width: 36, height: 36)
                            } else {
                                podcastPlaceholder
                            }

                            VStack(alignment: .leading, spacing: 2) {
                                Text(podcast.title)
                                    .font(.headline)
                                    .lineLimit(2)
                                    .foregroundStyle(.primary)
                            }
                        }
                        .padding(.vertical, 2)
                    }
                }
            }
        }
        .navigationTitle("Podcasts")
        .onAppear {
            let ids = connectivity.appState.subscribed_podcast_ids ?? []
            let json = connectivity.appState.subscribed_podcasts_json
            podcastManager.refreshSubscribedPodcasts(subscribedIds: ids, phonePodcastsJson: json)
        }
    }

    private var podcastPlaceholder: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Color.secondary.opacity(0.25))
            Image(systemName: "mic.fill")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(width: 36, height: 36)
    }
}
