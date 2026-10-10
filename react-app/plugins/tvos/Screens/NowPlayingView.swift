import SwiftUI

struct NowPlayingView: View {
    @Bindable var controller = TVPlaybackController.shared
    @Bindable var metadata = TVNowPlayingMetadata.shared
    @Bindable var favouritesManager = TVFavouritesManager.shared
    @Bindable var subscriptionManager = TVSubscriptionManager.shared
    
    @State private var isShowingScreensaver: Bool = false
    @State private var idleTimer: Timer? = nil
    
    // Screensaver timeout in seconds (default 180s / 3 min)
    private var screensaverTimeout: TimeInterval {
        let saved = UserDefaults.standard.double(forKey: "tv_screensaver_timeout")
        return saved > 0 ? saved : 180.0
    }
    
    var body: some View {
        ZStack {
            if isShowingScreensaver, (controller.currentStation != nil || controller.currentEpisode != nil) {
                // OLED Ambient Screensaver Mode
                AmbientScreensaverView(
                    stationId: controller.currentStation?.id,
                    title: controller.currentStation?.title ?? controller.currentPodcast?.title ?? "British Radio Player",
                    subtitle: currentScreensaverSubtitle,
                    logoUrl: controller.currentPodcast?.imageUrl,
                    onDismiss: {
                        withAnimation(.easeOut(duration: 0.4)) {
                            isShowingScreensaver = false
                            resetIdleTimer()
                        }
                    }
                )
                .transition(.opacity)
            } else {
                // Interactive Now Playing HUD
                interactivePlayerView
                    .transition(.opacity)
            }
        }
        .onAppear {
            resetIdleTimer()
        }
        .onDisappear {
            idleTimer?.invalidate()
            idleTimer = nil
        }
        .onChange(of: controller.currentStation?.id) { _, _ in
            withAnimation {
                isShowingScreensaver = false
            }
            resetIdleTimer()
        }
        .onChange(of: controller.currentEpisode?.id) { _, _ in
            withAnimation {
                isShowingScreensaver = false
            }
            resetIdleTimer()
        }
    }
    
    private var currentScreensaverSubtitle: String? {
        if let track = metadata.currentTrackTitle, let artist = metadata.currentArtist {
            return "🎵 \(track) • \(artist)"
        }
        return metadata.currentShowTitle ?? controller.currentEpisode?.title
    }
    
    private var interactivePlayerView: some View {
        ZStack {
            // Ambient Backdrop Glow
            ambientBackdrop
                .ignoresSafeArea()
            
            VStack(spacing: 0) {
                Spacer()
                
                HStack(alignment: .center, spacing: 70) {
                    
                    // Large Artwork / Station Ident
                    artworkView
                        .frame(width: 460, height: 460)
                        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
                        .shadow(color: .black.opacity(0.6), radius: 30, x: 0, y: 15)
                    
                    // Programme Details & Controls
                    VStack(alignment: .leading, spacing: 18) {
                        
                        // Live badge & Bitrate & Time Window (Radio) or Podcast Genre (Podcasts)
                        if controller.currentStation != nil {
                            HStack(spacing: 12) {
                                LiveBadgeView(bitrateText: controller.audioQuality.displayName)
                                
                                if let window = metadata.timeWindowText {
                                    Text(window)
                                        .font(.system(size: 16, weight: .semibold))
                                        .foregroundColor(.white.opacity(0.85))
                                        .padding(.horizontal, 12)
                                        .padding(.vertical, 5)
                                        .background(Color.white.opacity(0.12))
                                        .clipShape(Capsule())
                                }
                            }
                        } else if let pod = controller.currentPodcast {
                            HStack(spacing: 12) {
                                HStack(spacing: 6) {
                                    Image(systemName: "antenna.radiowaves.left.and.right")
                                        .font(.system(size: 14, weight: .bold))
                                    Text("PODCAST")
                                        .font(.system(size: 13, weight: .heavy))
                                }
                                .foregroundColor(.white)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 5)
                                .background(Color.purple.opacity(0.85))
                                .clipShape(Capsule())
                                
                                if let genre = pod.genre {
                                    Text(genre)
                                        .font(.system(size: 16, weight: .semibold))
                                        .foregroundColor(.white.opacity(0.85))
                                        .padding(.horizontal, 12)
                                        .padding(.vertical, 5)
                                        .background(Color.white.opacity(0.12))
                                        .clipShape(Capsule())
                                }
                            }
                        }
                        
                        // Main Station / Podcast Title
                        TVMarqueeText(
                            text: currentMainTitle,
                            font: .system(size: 54, weight: .heavy, design: .rounded),
                            fontWeight: .heavy,
                            color: .white
                        )
                        
                        // RMS Live Song Banner (when music is on air)
                        if let track = metadata.currentTrackTitle, let artist = metadata.currentArtist {
                            HStack(spacing: 14) {
                                Image(systemName: "music.note")
                                    .font(.title2)
                                    .foregroundColor(.red)
                                
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("PLAYING NOW")
                                        .font(.system(size: 15, weight: .heavy))
                                        .foregroundColor(.red)
                                    TVMarqueeText(
                                        text: "\(track) — \(artist)",
                                        font: .system(size: 28, weight: .bold),
                                        fontWeight: .bold,
                                        color: .white
                                    )
                                }
                            }
                            .padding(.horizontal, 20)
                            .padding(.vertical, 12)
                            .background(Color.white.opacity(0.12))
                            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                        }
                        
                        // Current Show Title
                        if let show = metadata.currentShowTitle ?? controller.currentEpisode?.title {
                            Text(show)
                                .font(.system(size: 34, weight: .bold))
                                .foregroundColor(metadata.currentTrackTitle != nil ? .white.opacity(0.9) : .red)
                                .lineLimit(2)
                        }
                        
                        // Programme detail / synopsis
                        if let detail = metadata.currentShowDetail ?? controller.currentEpisode?.summary {
                            Text(detail)
                                .font(.system(size: 24))
                                .foregroundColor(.white.opacity(0.75))
                                .lineLimit(3)
                                .frame(maxWidth: 640, alignment: .leading)
                        }
                        
                        // Up Next Programme Preview
                        if let nextShow = metadata.nextShowTitle, let nextTime = metadata.nextShowTimeText {
                            HStack(spacing: 10) {
                                Image(systemName: "clock.arrow.circlepath")
                                    .font(.subheadline)
                                    .foregroundColor(.white.opacity(0.6))
                                TVMarqueeText(
                                    text: "\(nextTime): \(nextShow)",
                                    font: .system(size: 20, weight: .medium),
                                    fontWeight: .medium,
                                    color: .white.opacity(0.6)
                                )
                            }
                            .padding(.top, 2)
                        }
                        
                        // Podcast Scrubber / Progress Bar
                        if controller.currentEpisode != nil {
                            VStack(spacing: 8) {
                                GeometryReader { geo in
                                    ZStack(alignment: .leading) {
                                        RoundedRectangle(cornerRadius: 4)
                                            .fill(Color.white.opacity(0.2))
                                            .frame(height: 8)
                                        
                                        let maxDuration = controller.currentDurationSeconds > 0
                                            ? controller.currentDurationSeconds
                                            : Double(controller.currentEpisode?.duration ?? 0)
                                        let progress = maxDuration > 0
                                            ? min(1.0, max(0.0, controller.currentPositionSeconds / maxDuration))
                                            : 0.0
                                        
                                        RoundedRectangle(cornerRadius: 4)
                                            .fill(Color.red)
                                            .frame(width: geo.size.width * CGFloat(progress), height: 8)
                                    }
                                }
                                .frame(height: 8)
                                
                                HStack {
                                    Text(formatClock(controller.currentPositionSeconds))
                                        .font(.system(size: 18, weight: .medium, design: .monospaced))
                                        .foregroundColor(.white.opacity(0.8))
                                    
                                    Spacer()
                                    
                                    let maxDuration = controller.currentDurationSeconds > 0
                                        ? controller.currentDurationSeconds
                                        : Double(controller.currentEpisode?.duration ?? 0)
                                    let remaining = max(0, maxDuration - controller.currentPositionSeconds)
                                    Text("-\(formatClock(remaining))")
                                        .font(.system(size: 18, weight: .medium, design: .monospaced))
                                        .foregroundColor(.white.opacity(0.8))
                                }
                            }
                            .frame(maxWidth: 640)
                            .padding(.top, 4)
                        }
                        
                        // Transport Controls
                        HStack(spacing: 28) {
                            // Stop Button
                            Button(action: {
                                controller.stop()
                                resetIdleTimer()
                            }) {
                                Image(systemName: "stop.fill")
                                    .font(.system(size: 32, weight: .semibold))
                                    .frame(width: 80, height: 80)
                            }
                            .buttonStyle(.card)
                            
                            // Skip Back / Previous Button
                            Button(action: {
                                controller.playPrevious()
                                resetIdleTimer()
                            }) {
                                Image(systemName: controller.currentEpisode != nil ? "gobackward.10" : "backward.end.fill")
                                    .font(.system(size: 32, weight: .semibold))
                                    .frame(width: 80, height: 80)
                            }
                            .buttonStyle(.card)
                            
                            // Play / Pause Button
                            Button(action: {
                                controller.togglePlayPause()
                                resetIdleTimer()
                            }) {
                                Group {
                                    if controller.isBuffering {
                                        ProgressView()
                                            .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                    } else {
                                        Image(systemName: controller.isPlaying ? "pause.fill" : "play.fill")
                                            .font(.system(size: 40, weight: .bold))
                                    }
                                }
                                .frame(width: 100, height: 80)
                            }
                            .buttonStyle(.card)
                            
                            // Skip Forward / Next Button
                            Button(action: {
                                controller.playNext()
                                resetIdleTimer()
                            }) {
                                Image(systemName: controller.currentEpisode != nil ? "goforward.30" : "forward.end.fill")
                                    .font(.system(size: 32, weight: .semibold))
                                    .frame(width: 80, height: 80)
                            }
                            .buttonStyle(.card)
                            
                            // Favourite Button (Stations)
                            if let station = controller.currentStation {
                                Button(action: {
                                    favouritesManager.toggleFavourite(station.id)
                                    resetIdleTimer()
                                }) {
                                    Image(systemName: favouritesManager.isFavourite(station.id) ? "star.fill" : "star")
                                        .font(.system(size: 32, weight: .semibold))
                                        .foregroundColor(favouritesManager.isFavourite(station.id) ? .yellow : .white)
                                        .frame(width: 80, height: 80)
                                }
                                .buttonStyle(.card)
                            }
                            
                            // Subscribe Button (Podcasts)
                            if let podId = controller.currentPodcast?.id ?? controller.currentEpisode?.podcastId {
                                Button(action: {
                                    subscriptionManager.toggleSubscription(podId)
                                    resetIdleTimer()
                                }) {
                                    Image(systemName: subscriptionManager.isSubscribed(podId) ? "star.fill" : "star")
                                        .font(.system(size: 32, weight: .semibold))
                                        .foregroundColor(subscriptionManager.isSubscribed(podId) ? .yellow : .white)
                                        .frame(width: 80, height: 80)
                                }
                                .buttonStyle(.card)
                            }
                            
                            // Ambient Mode Button
                            Button(action: {
                                withAnimation(.easeInOut(duration: 0.4)) {
                                    isShowingScreensaver = true
                                }
                            }) {
                                Image(systemName: "sparkles.tv")
                                    .font(.system(size: 32, weight: .semibold))
                                    .frame(width: 80, height: 80)
                            }
                            .buttonStyle(.card)
                        }
                        .padding(.top, 16)
                        .padding(.bottom, 8)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.horizontal, 90)
                
                Spacer()
            }
        }
    }
    
    @ViewBuilder
    private var artworkView: some View {
        if let station = controller.currentStation {
            if let songImg = metadata.currentSongImageUrl,
               !TVNowPlayingMetadata.isPlaceholderArtwork(songImg),
               let url = URL(string: songImg) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                    default:
                        TVStationIdentView(stationId: station.id, width: 460, height: 460, cornerRadius: 28)
                    }
                }
            } else {
                TVStationIdentView(stationId: station.id, width: 460, height: 460, cornerRadius: 28)
            }
        } else if let episode = controller.currentEpisode, let pod = controller.currentPodcast {
            let imgUrl = episode.imageUrl ?? pod.imageUrl
            if let url = URL(string: imgUrl) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                    default:
                        artworkPlaceholder
                    }
                }
            } else {
                artworkPlaceholder
            }
        } else {
            artworkPlaceholder
        }
    }
    
    @ViewBuilder
    private var ambientBackdrop: some View {
        if let songImg = metadata.currentSongImageUrl,
           !TVNowPlayingMetadata.isPlaceholderArtwork(songImg),
           let url = URL(string: songImg) {
            AsyncImage(url: url) { phase in
                if let image = phase.image {
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                        .blur(radius: 90)
                        .opacity(0.3)
                }
            }
        } else if let station = controller.currentStation {
            // Soft gradient matching the station ambient
            RadialGradient(
                gradient: Gradient(colors: [Color.red.opacity(0.2), Color.black]),
                center: .center,
                startRadius: 100,
                endRadius: 800
            )
        } else {
            Color.clear
        }
    }
    
    private var currentMainTitle: String {
        controller.currentStation?.title ?? controller.currentPodcast?.title ?? "Not Playing"
    }
    
    private var artworkPlaceholder: some View {
        ZStack {
            Color(white: 0.15)
            Image(systemName: "radio")
                .font(.system(size: 80))
                .foregroundColor(.white.opacity(0.4))
        }
    }
    
    private func formatClock(_ totalSeconds: Double) -> String {
        let secs = max(0, Int(totalSeconds))
        let hours = secs / 3600
        let minutes = (secs % 3600) / 60
        let seconds = secs % 60
        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, seconds)
        } else {
            return String(format: "%02d:%02d", minutes, seconds)
        }
    }
    
    private func resetIdleTimer() {
        idleTimer?.invalidate()
        guard controller.isPlaying else { return }
        idleTimer = Timer.scheduledTimer(withTimeInterval: screensaverTimeout, repeats: false) { _ in
            withAnimation(.easeInOut(duration: 0.6)) {
                isShowingScreensaver = true
            }
        }
    }
}
