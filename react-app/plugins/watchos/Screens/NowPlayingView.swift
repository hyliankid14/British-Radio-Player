import SwiftUI

struct NowPlayingView: View {
    @Bindable var controller = WatchPlaybackController.shared
    @Bindable var metadata = NowPlayingMetadata.shared
    @Bindable var connectivity = WatchConnectivityManager.shared

    @State private var volume: Double = 0.5
    @State private var showQualityDialog = false

    var body: some View {
        ZStack {
            // Full-bleed Background: RMS Track Artwork if available, otherwise Station Ident
            ZStack {
                Color.black

                if let ep = controller.currentEpisode {
                    let podArtwork = controller.currentEpisodePodcast?.imageUrl ?? WatchPodcastManager.shared.subscribedPodcasts.first(where: { $0.id == ep.podcastId })?.imageUrl ?? ep.imageUrl
                    if let artworkStr = podArtwork, !artworkStr.isEmpty, let url = URL(string: artworkStr) {
                        AsyncImage(url: url) { phase in
                            switch phase {
                            case .success(let image):
                                ZStack {
                                    image
                                        .resizable()
                                        .aspectRatio(contentMode: .fill)

                                    LinearGradient(
                                        colors: [
                                            Color.black.opacity(0.30),
                                            Color.black.opacity(0.60)
                                        ],
                                        startPoint: .top,
                                        endPoint: .bottom
                                    )
                                }
                            default:
                                Color.black
                            }
                        }
                    } else {
                        Color.black
                    }
                } else if let artworkUrl = metadata.rmsArtworkUrl, let url = URL(string: artworkUrl) {
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .success(let image):
                            ZStack {
                                image
                                    .resizable()
                                    .aspectRatio(contentMode: .fill)

                                LinearGradient(
                                    colors: [
                                        Color.black.opacity(0.30),
                                        Color.black.opacity(0.60)
                                    ],
                                    startPoint: .top,
                                    endPoint: .bottom
                                )
                            }
                        default:
                            if let stationId = controller.currentStationId {
                                stationIdentBackground(for: stationId)
                            }
                        }
                    }
                } else if let stationId = controller.currentStationId {
                    stationIdentBackground(for: stationId)
                }
            }
            .ignoresSafeArea()

            // Foreground Content: Everything on a single screen without scrolling
            VStack(spacing: 3) {
                // Header: Favourite Star (pinned leading) + Centred Station/Podcast Title (No waveform)
                ZStack {
                    MarqueeText(
                        text: currentStationTitle,
                        font: .headline,
                        color: .white,
                        isBold: true,
                        alignment: .center
                    )
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.horizontal, 28)

                    if let stationId = controller.currentStationId {
                        HStack {
                            Button(action: {
                                connectivity.pushFavouriteToggle(stationId: stationId)
                                WKInterfaceDevice.current().play(.click)
                            }) {
                                Image(systemName: isFavourite(stationId) ? "star.fill" : "star")
                                    .font(.caption2)
                                    .foregroundStyle(isFavourite(stationId) ? Color.yellow : Color.white.opacity(0.8))
                            }
                            .buttonStyle(.plain)

                            Spacer()
                        }
                    }
                }
                .frame(maxWidth: .infinity)

                // Show or Song or Episode Title
                if let ep = controller.currentEpisode {
                    MarqueeText(
                        text: ep.title,
                        font: .footnote,
                        color: .white,
                        isBold: true,
                        alignment: .center
                    )

                    // Podcast Playback Progress Bar & Timestamps
                    VStack(spacing: 2) {
                        GeometryReader { geo in
                            ZStack(alignment: .leading) {
                                Capsule()
                                    .fill(Color.white.opacity(0.25))
                                    .frame(height: 3)

                                Capsule()
                                    .fill(Color.accentColor)
                                    .frame(
                                        width: max(0, min(geo.size.width, geo.size.width * progressFraction)),
                                        height: 3
                                    )
                            }
                            .contentShape(Rectangle())
                            .gesture(
                                DragGesture(minimumDistance: 0)
                                    .onChanged { value in
                                        let dur = effectiveDuration
                                        guard dur > 0 else { return }
                                        let frac = max(0, min(1, value.location.x / geo.size.width))
                                        controller.seekTo(Double(frac) * dur)
                                    }
                            )
                        }
                        .frame(height: 3)

                        HStack {
                            Text(formatTime(controller.currentPositionSeconds))
                            Spacer()
                            Text(formatRemaining(position: controller.currentPositionSeconds, duration: effectiveDuration))
                        }
                        .font(.system(size: 9, weight: .medium, design: .monospaced))
                        .foregroundStyle(Color.white.opacity(0.85))
                    }
                    .padding(.horizontal, 6)
                    .padding(.top, 2)
                    .padding(.bottom, 1)
                } else if let artist = metadata.segmentArtist, let track = metadata.segmentTrack, !track.isEmpty {
                    MarqueeText(
                        text: "\(artist) – \(track)",
                        font: .footnote,
                        color: .white,
                        isBold: true,
                        alignment: .center
                    )

                    if !metadata.showTitle.isEmpty {
                        Text(metadata.showTitle)
                            .font(.caption2)
                            .fontWeight(.medium)
                            .foregroundStyle(Color.white.opacity(0.88))
                            .multilineTextAlignment(.center)
                            .lineLimit(2)
                    }
                } else {
                    if !metadata.showTitle.isEmpty {
                        Text(metadata.showTitle)
                            .font(.footnote)
                            .fontWeight(.bold)
                            .foregroundStyle(.white)
                            .multilineTextAlignment(.center)
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                // Next Show Info ("Up next: ...")
                if !metadata.upNextLabel.isEmpty {
                    MarqueeText(
                        text: metadata.upNextLabel,
                        font: .system(size: 10, weight: .medium),
                        color: Color.white.opacity(0.78),
                        alignment: .center
                    )
                }

                // Playback Controls (Always visible, directly on main screen)
                HStack(spacing: 16) {
                    if isLiveStation {
                        Button(action: {
                            playPreviousStation()
                        }) {
                            Image(systemName: "backward.end.fill")
                                .font(.body)
                        }
                        .buttonStyle(.plain)
                        .frame(width: 36, height: 36)
                        .background(Color.secondary.opacity(0.35))
                        .clipShape(Circle())
                    } else {
                        Button(action: {
                            controller.seekBy(-10)
                        }) {
                            Image(systemName: "gobackward.10")
                                .font(.body)
                        }
                        .buttonStyle(.plain)
                        .frame(width: 36, height: 36)
                        .background(Color.secondary.opacity(0.35))
                        .clipShape(Circle())
                    }

                    Button(action: {
                        controller.togglePlayPause()
                    }) {
                        Image(systemName: controller.isPlaying ? "pause.fill" : "play.fill")
                            .font(.title3)
                    }
                    .buttonStyle(.plain)
                    .frame(width: 46, height: 46)
                    .background(Color.accentColor)
                    .clipShape(Circle())

                    if isLiveStation {
                        Button(action: {
                            playNextStation()
                        }) {
                            Image(systemName: "forward.end.fill")
                                .font(.body)
                        }
                        .buttonStyle(.plain)
                        .frame(width: 36, height: 36)
                        .background(Color.secondary.opacity(0.35))
                        .clipShape(Circle())
                    } else {
                        Button(action: {
                            controller.seekBy(30)
                        }) {
                            Image(systemName: "goforward.30")
                                .font(.body)
                        }
                        .buttonStyle(.plain)
                        .frame(width: 36, height: 36)
                        .background(Color.secondary.opacity(0.35))
                        .clipShape(Circle())
                    }
                }
                .padding(.top, 2)

                // Compact Audio Quality Pill (Live radio only, no waveform icon)
                if isLiveStation {
                    Button(action: {
                        showQualityDialog = true
                    }) {
                        Text(currentQualityLabel)
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(Color.white.opacity(0.85))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(Color.white.opacity(0.18))
                            .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .padding(.top, 8)
                }
            }
            .padding(.horizontal, 8)
            .shadow(color: .black.opacity(0.85), radius: 4, x: 0, y: 1)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .focusable()
        .digitalCrownRotation(
            $volume,
            from: 0.0,
            through: 1.0,
            by: 0.05,
            sensitivity: .low,
            isContinuous: false,
            isHapticFeedbackEnabled: true
        )
        .confirmationDialog("Audio Quality", isPresented: $showQualityDialog) {
            Button("Low (48 kbps)") { UserDefaults.standard.set("low", forKey: "watch_audio_quality") }
            Button("Standard (128 kbps)") { UserDefaults.standard.set("standard", forKey: "watch_audio_quality") }
            Button("High (320 kbps)") { UserDefaults.standard.set("high", forKey: "watch_audio_quality") }
            Button("Cancel", role: .cancel) {}
        }
        .onAppear {
            if let stationId = controller.currentStationId,
               let station = WatchStationCatalogue.findById(stationId) {
                metadata.startPolling(serviceId: station.serviceId)
            }
        }
        .onDisappear {
            // Nothing to clean up
        }
    }

    private var progressFraction: CGFloat {
        let dur = effectiveDuration
        guard dur > 0 else { return 0 }
        let frac = controller.currentPositionSeconds / dur
        return CGFloat(min(max(frac, 0.0), 1.0))
    }

    private var effectiveDuration: Double {
        if controller.currentDurationSeconds > 0 {
            return controller.currentDurationSeconds
        }
        if let ep = controller.currentEpisode, ep.duration > 0 {
            return Double(ep.duration)
        }
        return 0
    }

    private func formatTime(_ totalSeconds: Double) -> String {
        guard totalSeconds.isFinite && !totalSeconds.isNaN && totalSeconds >= 0 else { return "0:00" }
        let s = Int(totalSeconds)
        let hours = s / 3600
        let minutes = (s % 3600) / 60
        let seconds = s % 60
        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, seconds)
        } else {
            return String(format: "%d:%02d", minutes, seconds)
        }
    }

    private func formatRemaining(position: Double, duration: Double) -> String {
        guard duration > 0 else { return "" }
        let rem = max(0, duration - position)
        return "-\(formatTime(rem))"
    }

    private var currentStationTitle: String {
        if let id = controller.currentStationId {
            return WatchStationCatalogue.findById(id)?.title ?? "Radio"
        }
        if let podcast = controller.currentEpisodePodcast {
            return podcast.title
        }
        if let ep = controller.currentEpisode,
           let found = WatchPodcastManager.shared.subscribedPodcasts.first(where: { $0.id == ep.podcastId }) {
            return found.title
        }
        return "Podcast"
    }

    private var isLiveStation: Bool {
        controller.currentStationId != nil
    }

    private var currentQualityLabel: String {
        let q = UserDefaults.standard.string(forKey: "watch_audio_quality") ?? "standard"
        switch q {
        case "low": return "Low 48k"
        case "high": return "High 320k"
        default: return "Std 128k"
        }
    }

    private func isFavourite(_ stationId: String) -> Bool {
        connectivity.appState.favourite_ids?.contains(stationId) ?? false
    }

    private var stationRotation: [WatchStation] {
        if connectivity.appState.scroll_mode == "favourites" {
            let favIds = connectivity.appState.favourite_ids ?? []
            let favOrder = connectivity.appState.favourite_order ?? favIds
            let favs = WatchStationCatalogue.favourites(from: favIds, order: favOrder)
            if !favs.isEmpty {
                return favs
            }
        }
        return WatchStationCatalogue.allStations()
    }

    private func playPreviousStation() {
        let stations = stationRotation
        guard !stations.isEmpty else { return }
        let currentId = controller.currentStationId
        let currentIndex = stations.firstIndex(where: { $0.id == currentId }) ?? 0
        let prevIndex = (currentIndex - 1 + stations.count) % stations.count
        controller.playStation(stations[prevIndex])
    }

    private func playNextStation() {
        let stations = stationRotation
        guard !stations.isEmpty else { return }
        let currentId = controller.currentStationId
        let currentIndex = stations.firstIndex(where: { $0.id == currentId }) ?? -1
        let nextIndex = (currentIndex + 1) % stations.count
        controller.playStation(stations[nextIndex])
    }

    @ViewBuilder
    private func stationIdentBackground(for stationId: String) -> some View {
        ZStack {
            WatchArtwork.color(stationId: stationId)
                .opacity(0.30)

            StationIdentView(stationId: stationId, size: 140, cornerRadius: 26)
                .opacity(0.50)
                .shadow(color: .black.opacity(0.6), radius: 10, x: 0, y: 4)

            LinearGradient(
                colors: [
                    Color.black.opacity(0.35),
                    Color.black.opacity(0.70)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
