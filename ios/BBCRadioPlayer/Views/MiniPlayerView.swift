import SwiftUI

struct MiniPlayerView: View {
    @EnvironmentObject private var container: AppContainer
    @State private var showFullPlayer = false

    private var audio: AudioPlayerService { container.audioPlayerService }
    private var isEpisode: Bool { audio.currentEpisode != nil }

    private var progress: Double {
        guard audio.duration > 0 else { return 0 }
        return min(audio.currentTime / audio.duration, 1)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                Button { showFullPlayer = true } label: {
                    artwork
                        .id(artworkIdentity)
                        .frame(width: 76, height: 76)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
                .buttonStyle(.plain)

                VStack(alignment: .leading, spacing: 8) {
                    Button { showFullPlayer = true } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(nowPlayingTitle)
                                .font(.headline)
                                .fontWeight(.semibold)
                                .lineLimit(1)

                            Text(nowPlayingSubtitle)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)

                    HStack(spacing: 0) {
                        controlButton(symbol: "stop.fill") {
                            audio.stop()
                        }
                        controlButton(symbol: isEpisode ? "gobackward.15" : "backward.end.fill") {
                            if isEpisode { audio.seekBackward() }
                            else { container.radioViewModel.playPreviousStation() }
                        }

                        Button {
                            audio.isPlaying ? audio.pause() : audio.resume()
                        } label: {
                            Image(systemName: audio.isPlaying ? "pause.fill" : "play.fill")
                                .font(.title)
                                .frame(maxWidth: .infinity)
                                .frame(height: 44)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)

                        controlButton(symbol: isEpisode ? "goforward.15" : "forward.end.fill") {
                            if isEpisode { audio.seekForward() }
                            else { container.radioViewModel.playNextStation() }
                        }

                        favouriteControlButton
                    }
                    .frame(maxWidth: .infinity)
                }

                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .padding(.top, 10)
            .padding(.bottom, 8)

            if isEpisode {
                ProgressView(value: progress)
                    .progressViewStyle(.linear)
                    .tint(.accentColor)
                    .padding(.horizontal, 10)
                    .padding(.bottom, 6)
            }
        }
        .background(
            RoundedRectangle(cornerRadius: 0, style: .continuous)
                .fill(Color(.secondarySystemBackground).opacity(0.96))
        )
        .overlay(alignment: .top) {
            Divider()
        }
        .sheet(isPresented: $showFullPlayer) {
            FullPlayerView()
        }
    }

    // MARK: - Helpers

    @ViewBuilder
    private func controlButton(symbol: String, tint: Color? = nil, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.title2)
                .foregroundStyle(tint ?? .primary)
                .frame(maxWidth: .infinity)
                .frame(height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var favouriteControlButton: some View {
        if let episode = audio.currentEpisode {
            let isSaved = container.favoritesStore.isSaved(episodeID: episode.id)
            controlButton(symbol: isSaved ? "bookmark.fill" : "bookmark") {
                container.favoritesStore.toggleSaved(episode: episode, podcastTitle: audio.currentEpisodePodcastTitle)
            }
        } else {
            controlButton(
                symbol: container.radioViewModel.isCurrentFavourite ? "star.fill" : "star",
                tint: container.radioViewModel.isCurrentFavourite ? .yellow : nil
            ) {
                container.radioViewModel.toggleCurrentFavourite()
            }
        }
    }

    private var nowPlayingTitle: String {
        if let station = audio.currentStation { return station.title }
        if audio.currentEpisode != nil {
            return audio.currentEpisodePodcastTitle?.stripHTMLTags ?? "Podcast"
        }
        return "Now Playing"
    }

    private var nowPlayingSubtitle: String {
        if !audio.nowPlayingDetail.isEmpty {
            return audio.nowPlayingDetail
        }
        if audio.currentStation != nil {
            return audio.currentStationShowTitle.isEmpty ? "BBC Radio" : audio.currentStationShowTitle
        }
        if let episode = audio.currentEpisode {
            return episode.title
        }
        return ""
    }

    @ViewBuilder
    private var artwork: some View {
        if let url = audio.nowPlayingArtworkURL {
            AsyncImage(url: url) { img in img.resizable().scaledToFill() }
                placeholder: { placeholder("mic.circle.fill") }
        } else if let url = audio.currentStation?.logoURL {
            AsyncImage(url: url) { img in img.resizable().scaledToFill() }
                placeholder: { placeholder("dot.radiowaves.left.and.right") }
        } else {
            placeholder("waveform.circle.fill")
        }
    }

    private var artworkIdentity: String {
        if let episode = audio.currentEpisode {
            return "episode-\(episode.id)-\(audio.nowPlayingArtworkURL?.absoluteString ?? "")"
        }
        if let station = audio.currentStation {
            return "station-\(station.id)-\(audio.nowPlayingArtworkURL?.absoluteString ?? "")"
        }
        return "none"
    }

    private func placeholder(_ symbol: String) -> some View {
        ZStack {
            Color(.secondarySystemGroupedBackground)
            Image(systemName: symbol).font(.caption).foregroundStyle(.secondary)
        }
    }
}

#Preview {
    MiniPlayerView().environmentObject(AppContainer())
}

