import SwiftUI

struct FullPlayerView: View {
    @EnvironmentObject private var container: AppContainer
    @Environment(\.dismiss) private var dismiss
    @State private var showEpisodeDescription = false

    private var audio: AudioPlayerService { container.audioPlayerService }
    private var isEpisode: Bool { audio.currentEpisode != nil }

    private var progress: Double {
        guard audio.duration > 0 else { return 0 }
        return min(audio.currentTime / audio.duration, 1)
    }
    private var elapsed: String { formatTime(audio.currentTime) }
    private var remaining: String { audio.duration > 0 ? "-\(formatTime(audio.duration - audio.currentTime))" : "" }

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                // Artwork
                Button {
                    if canShowEpisodeDescription {
                        showEpisodeDescription = true
                    }
                } label: {
                    artworkView
                        .id(artworkIdentity)
                        .frame(width: 240, height: 240)
                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .shadow(radius: 12)
                }
                .buttonStyle(.plain)

                // Title & subtitle
                Button {
                    if canShowEpisodeDescription {
                        showEpisodeDescription = true
                    }
                } label: {
                    VStack(spacing: 6) {
                        Text(nowPlayingTitle)
                            .font(.title2)
                            .fontWeight(.bold)
                            .multilineTextAlignment(.center)
                            .lineLimit(2)
                        Text(nowPlayingSubtitle)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    .padding(.horizontal, 24)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                // Progress (episodes only)
                if isEpisode {
                    VStack(spacing: 4) {
                        ProgressView(value: progress)
                            .progressViewStyle(.linear)
                            .tint(.accentColor)
                        HStack {
                            Text(elapsed).font(.caption2).foregroundStyle(.secondary)
                            Spacer()
                            Text(remaining).font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                    .padding(.horizontal, 24)
                }

                // Controls: Stop | Back | Play/Pause | Next | Favourite
                HStack(spacing: 0) {
                    // Stop
                    fullControlButton(symbol: "stop.fill", size: .title3) {
                        audio.stop()
                        dismiss()
                    }
                    // Back / seek back
                    fullControlButton(symbol: isEpisode ? "gobackward.15" : "backward.end.fill", size: .title3) {
                        if isEpisode { audio.seekBackward() }
                        else { container.radioViewModel.playPreviousStation() }
                    }
                    // Play / Pause – large centre button
                    Button {
                        audio.isPlaying ? audio.pause() : audio.resume()
                    } label: {
                        Image(systemName: audio.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                            .font(.system(size: 64))
                            .foregroundStyle(.tint)
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.plain)
                    // Next / seek forward
                    fullControlButton(symbol: isEpisode ? "goforward.15" : "forward.end.fill", size: .title3) {
                        if isEpisode { audio.seekForward() }
                        else { container.radioViewModel.playNextStation() }
                    }
                    // Favourite
                    favouriteControlButton
                }
                .padding(.horizontal, 8)

                Spacer()
            }
            .padding(.top, 24)
            .navigationTitle("Now Playing")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { dismiss() } label: {
                        Image(systemName: "chevron.down")
                            .font(.body.weight(.semibold))
                    }
                }
            }
            .sheet(isPresented: $showEpisodeDescription) {
                EpisodeDescriptionSheet(
                    episodeTitle: audio.currentEpisode?.title ?? "Episode",
                    description: audio.currentEpisode?.description.stripHTMLTags ?? ""
                )
            }
        }
    }

    // MARK: - Helpers

    @ViewBuilder
    private func fullControlButton(symbol: String, size: Font, tint: Color? = nil, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(size)
                .foregroundStyle(tint ?? .primary)
                .frame(maxWidth: .infinity)
                .frame(height: 52)
        }
        .buttonStyle(.plain)
    }

    private var nowPlayingTitle: String {
        if let s = audio.currentStation { return s.title }
        if audio.currentEpisode != nil {
            return audio.currentEpisodePodcastTitle?.stripHTMLTags ?? "Podcast"
        }
        return "Now Playing"
    }

    private var nowPlayingSubtitle: String {
        if !audio.nowPlayingDetail.isEmpty { return audio.nowPlayingDetail }
        if audio.currentStation != nil {
            return audio.currentStationShowTitle.isEmpty ? "BBC Radio" : audio.currentStationShowTitle
        }
        if let e = audio.currentEpisode {
            return e.title
        }
        return ""
    }

    @ViewBuilder
    private var artworkView: some View {
        if let url = audio.currentEpisode?.imageURL ?? audio.nowPlayingArtworkURL {
            AsyncImage(url: url) { img in img.resizable().scaledToFill() }
                placeholder: {
                    ZStack {
                        Color(.secondarySystemGroupedBackground)
                        Image(systemName: "mic.circle").font(.system(size: 60)).foregroundStyle(.orange)
                    }
                }
        } else if let url = audio.currentStation?.logoURL {
            AsyncImage(url: url) { img in img.resizable().scaledToFill() }
                placeholder: {
                    ZStack {
                        Color(.secondarySystemGroupedBackground)
                        Image(systemName: "dot.radiowaves.left.and.right").font(.system(size: 60)).foregroundStyle(.blue)
                    }
                }
        } else {
            ZStack {
                Color(.secondarySystemGroupedBackground)
                Image(systemName: "waveform").font(.system(size: 60)).foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private var favouriteControlButton: some View {
        if let episode = audio.currentEpisode {
            let isSaved = container.favoritesStore.isSaved(episodeID: episode.id)
            fullControlButton(symbol: isSaved ? "bookmark.fill" : "bookmark", size: .title3) {
                container.favoritesStore.toggleSaved(episode: episode, podcastTitle: audio.currentEpisodePodcastTitle)
            }
        } else {
            fullControlButton(
                symbol: container.radioViewModel.isCurrentFavourite ? "star.fill" : "star",
                size: .title3,
                tint: container.radioViewModel.isCurrentFavourite ? .yellow : nil
            ) {
                container.radioViewModel.toggleCurrentFavourite()
            }
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

    private var canShowEpisodeDescription: Bool {
        guard let episode = audio.currentEpisode else { return false }
        return !episode.description.stripHTMLTags.isEmpty
    }

    private func formatTime(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds >= 0 else { return "0:00" }
        let s = Int(seconds)
        let h = s / 3600
        let m = (s % 3600) / 60
        let sec = s % 60
        if h > 0 { return String(format: "%d:%02d:%02d", h, m, sec) }
        return String(format: "%d:%02d", m, sec)
    }
}

private struct EpisodeDescriptionSheet: View {
    @Environment(\.dismiss) private var dismiss
    let episodeTitle: String
    let description: String

    var body: some View {
        NavigationStack {
            ScrollView {
                Text(description)
                    .font(.body)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
            }
            .navigationTitle(episodeTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

#Preview {
    FullPlayerView().environmentObject(AppContainer())
}
