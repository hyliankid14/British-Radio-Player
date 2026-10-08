import SwiftUI

struct EpisodeListView: View {
    let podcast: WatchPodcast
    @Bindable var controller = WatchPlaybackController.shared
    @Bindable var connectivity = WatchConnectivityManager.shared
    @Bindable var podcastManager = WatchPodcastManager.shared
    @State private var episodes: [WatchEpisode] = []
    @State private var isLoading = true
    @State private var navigateToNowPlaying = false

    var body: some View {
        List {
            if isLoading && episodes.isEmpty {
                VStack(spacing: 8) {
                    ProgressView()
                    Text("Loading episodes…")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 20)
                .frame(maxWidth: .infinity)
                .listRowBackground(Color.clear)
            } else if episodes.isEmpty {
                VStack(spacing: 6) {
                    Text("No Episodes")
                        .font(.headline)
                    Text("No episodes currently available for this podcast.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .padding(.vertical, 16)
                .frame(maxWidth: .infinity)
                .listRowBackground(Color.clear)
            } else {
                ForEach(episodes) { episode in
                    Button(action: {
                        playEpisode(episode)
                    }) {
                        HStack(spacing: 8) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(episode.title)
                                    .font(.headline)
                                    .foregroundStyle(controller.currentEpisodeId == episode.id ? Color.accentColor : Color.primary)
                                    .lineLimit(2)

                                HStack(spacing: 6) {
                                    if let date = formattedPubDate(episode.pubDate) {
                                        Text(date)
                                            .font(.caption2)
                                            .foregroundStyle(.secondary)
                                    }
                                    if episode.duration > 0 {
                                        Text(formattedDuration(episode.duration))
                                            .font(.caption2)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }

                            Spacer(minLength: 4)

                            if controller.currentEpisodeId == episode.id && controller.isPlaying {
                                Image(systemName: "waveform")
                                    .symbolEffect(.variableColor.iterative, isActive: controller.isPlaying)
                                    .foregroundStyle(Color.accentColor)
                                    .font(.caption2)
                            } else if isPlayed(episode.id) {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundStyle(.secondary.opacity(0.6))
                                    .font(.caption)
                            } else if connectivity.episodeProgressMs(for: episode.id) > 0 {
                                HStack(spacing: 3) {
                                    Circle()
                                        .fill(Color.accentColor)
                                        .frame(width: 6, height: 6)
                                    let posSec = connectivity.episodeProgressMs(for: episode.id) / 1000
                                    let remSec = max(0, episode.duration - posSec)
                                    if remSec > 0 {
                                        Text("\(formattedDuration(remSec)) left")
                                            .font(.system(size: 9))
                                            .foregroundStyle(Color.accentColor)
                                    }
                                }
                            }
                        }
                        .padding(.vertical, 2)
                    }
                    .buttonStyle(.plain)
                    .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                        Button {
                            let willBePlayed = !isPlayed(episode.id)
                            connectivity.markEpisodePlayed(episode.id, played: willBePlayed)
                            WKInterfaceDevice.current().play(.click)
                        } label: {
                            Label(
                                isPlayed(episode.id) ? "Unplayed" : "Played",
                                systemImage: isPlayed(episode.id) ? "arrow.uturn.backward" : "checkmark"
                            )
                        }
                        .tint(isPlayed(episode.id) ? .gray : .blue)
                    }
                    .contextMenu {
                        Button {
                            let willBePlayed = !isPlayed(episode.id)
                            connectivity.markEpisodePlayed(episode.id, played: willBePlayed)
                            WKInterfaceDevice.current().play(.click)
                        } label: {
                            Label(
                                isPlayed(episode.id) ? "Mark as Unplayed" : "Mark as Played",
                                systemImage: isPlayed(episode.id) ? "arrow.uturn.backward.circle" : "checkmark.circle"
                            )
                        }
                    }
                }
            }
        }
        .navigationTitle(podcast.title)
        .navigationDestination(isPresented: $navigateToNowPlaying) {
            NowPlayingView()
        }
        .onAppear {
            loadEpisodes()
        }
    }

    private func loadEpisodes() {
        isLoading = true
        podcastManager.fetchEpisodes(for: podcast) { list in
            self.episodes = list
            self.isLoading = false
        }
    }

    private func playEpisode(_ episode: WatchEpisode) {
        let savedMs = connectivity.episodeProgressMs(for: episode.id)
        controller.playEpisode(episode, podcast: podcast, startPositionMs: savedMs)
        navigateToNowPlaying = true
    }

    private func isPlayed(_ episodeId: String) -> Bool {
        connectivity.isEpisodePlayed(episodeId)
    }

    private func formattedDuration(_ seconds: Int) -> String {
        let mins = seconds / 60
        if mins >= 60 {
            return "\(mins / 60)h \(mins % 60)m"
        }
        return "\(mins)m"
    }

    private func formattedPubDate(_ pubDate: String?) -> String? {
        guard let raw = pubDate, !raw.isEmpty else { return nil }
        let parts = raw.components(separatedBy: " ")
        if parts.count >= 3 {
            return "\(parts[1]) \(parts[2])"
        }
        return nil
    }
}
