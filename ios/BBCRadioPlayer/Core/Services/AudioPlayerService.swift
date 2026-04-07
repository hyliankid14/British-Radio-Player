import AVFoundation
import Foundation
import MediaPlayer
import Network
import UIKit

private struct RMSSegmentResponse: Decodable {
    let data: [RMSSegment]
}

private struct RMSSegment: Decodable {
    let titles: RMSTitles?
    let offset: RMSOffset?
    let imageURL: String?

    enum CodingKeys: String, CodingKey {
        case titles
        case offset
        case imageURL = "image_url"
    }
}

private struct RMSTitles: Decodable {
    let primary: String?
    let secondary: String?
    let tertiary: String?
}

private struct RMSOffset: Decodable {
    let nowPlaying: Bool?

    enum CodingKeys: String, CodingKey {
        case nowPlaying = "now_playing"
    }
}

@MainActor
final class AudioPlayerService: NSObject, ObservableObject, AVPlayerItemMetadataOutputPushDelegate {
    @Published private(set) var isPlaying = false
    @Published private(set) var currentStation: Station?
    @Published private(set) var currentEpisode: Episode?
    @Published private(set) var currentEpisodePodcastTitle: String?
    @Published private(set) var nowPlayingDetail: String = ""
    @Published private(set) var currentStationShowTitle: String = ""
    @Published private(set) var nowPlayingArtworkURL: URL?
    @Published private(set) var currentTime: Double = 0
    @Published private(set) var duration: Double = 0

    private var player: AVPlayer?
    private var timeObserver: Any?
    private var timeControlObservation: NSKeyValueObservation?
    private var itemStatusObservation: NSKeyValueObservation?
    private var itemEndObserver: Any?
    private var metadataOutput: AVPlayerItemMetadataOutput?
    private var rmsPollingTask: Task<Void, Never>?
    private var artworkLoadTask: Task<Void, Never>?
    private let networkMonitor = NWPathMonitor()
    private var isOnWiFi = false
    private var nowPlayingTitleText: String = ""
    private var nowPlayingSubtitleText: String = ""
    private var nowPlayingArtworkImage: UIImage?
    private var podcastArtworkMode: PodcastArtworkMode = .episode
    private var currentEpisodePodcastArtworkURL: URL?
    private var privacyAnalytics: PrivacyAnalyticsService?
    private var analyticsDelayTask: Task<Void, Never>?
    private var currentAnalyticsSignature: String?
    private var currentAnalyticsSent = false
    private var stationStreamCandidates: [URL] = []
    private var stationStreamCandidateIndex: Int = 0
    var onNextRequested: (() -> Void)?
    var onPreviousRequested: (() -> Void)?
    var onEpisodeCompleted: ((Episode) -> Void)?

    var hasActiveItem: Bool {
        currentStation != nil || currentEpisode != nil
    }

    override init() {
        super.init()
        startNetworkMonitoring()
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleAudioSessionInterruption),
            name: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance()
        )
    }

    deinit {
        if let timeObserver, let player {
            player.removeTimeObserver(timeObserver)
        }
        if let itemEndObserver {
            NotificationCenter.default.removeObserver(itemEndObserver)
        }
        networkMonitor.cancel()
        NotificationCenter.default.removeObserver(self, name: AVAudioSession.interruptionNotification, object: AVAudioSession.sharedInstance())
    }

    @objc private func handleAudioSessionInterruption(_ notification: Notification) {
        guard let userInfo = notification.userInfo,
              let typeValue = userInfo[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: typeValue) else { return }
        if type == .began {
            stop()
        }
    }

    func play(station: Station, quality: PlaybackQuality) {
        let effectiveQuality = resolveQuality(quality)
        let candidates = station.streamCandidates(quality: effectiveQuality)
        guard !candidates.isEmpty else { return }

        stationStreamCandidates = candidates
        stationStreamCandidateIndex = 0

        currentStation = station
        currentEpisode = nil
        currentEpisodePodcastArtworkURL = nil
        nowPlayingDetail = ""
        currentStationShowTitle = ""
        nowPlayingArtworkURL = station.logoURL
        configureAudioSession()
        startPlayback(url: candidates[0])
        configureNowPlaying(title: station.title, subtitle: "Live radio")
        scheduleStationAnalytics(station)
        refreshRemoteCommandAvailability()
        Task { [weak self] in
            guard let self else { return }
            if let showTitle = await self.fetchCurrentShowTitle(serviceID: station.serviceId) {
                self.currentStationShowTitle = showTitle
                if self.nowPlayingDetail.isEmpty {
                    self.configureNowPlaying(title: station.title, subtitle: showTitle)
                }
            }
        }
        startRMSPolling(for: station)
    }

    func play(episode: Episode, podcastTitle: String? = nil, podcastArtworkURL: URL? = nil) {
        rmsPollingTask?.cancel()
        currentEpisode = episode
        currentEpisodePodcastTitle = podcastTitle
        currentEpisodePodcastArtworkURL = podcastArtworkURL
        currentStation = nil
        currentStationShowTitle = ""
        nowPlayingDetail = ""
        nowPlayingArtworkURL = preferredPodcastArtworkURL(
            episodeArtworkURL: episode.imageURL,
            podcastArtworkURL: podcastArtworkURL
        )
        configureAudioSession()
        startPlayback(url: episode.audioURL)
        configureNowPlaying(title: podcastTitle ?? "Podcast", subtitle: episode.title)
        scheduleEpisodeAnalytics(episode, podcastTitle: podcastTitle)
        refreshRemoteCommandAvailability()
    }

    func pause() {
        player?.pause()
        analyticsDelayTask?.cancel()
        analyticsDelayTask = nil
        isPlaying = false
        refreshNowPlayingInfo()
    }

    func resume() {
        player?.play()
        isPlaying = true
        scheduleAnalyticsIfNeededForCurrentItem()
        refreshNowPlayingInfo()
    }

    func stop() {
        if let timeObserver, let player {
            player.removeTimeObserver(timeObserver)
            self.timeObserver = nil
        }
        player?.pause()
        player?.replaceCurrentItem(with: nil)
        metadataOutput = nil
        rmsPollingTask?.cancel()
        rmsPollingTask = nil
        artworkLoadTask?.cancel()
        artworkLoadTask = nil
        player = nil
        isPlaying = false
        currentStation = nil
        currentEpisode = nil
        currentEpisodePodcastTitle = nil
        currentEpisodePodcastArtworkURL = nil
        nowPlayingDetail = ""
        currentStationShowTitle = ""
        nowPlayingArtworkURL = nil
        nowPlayingArtworkImage = nil
        analyticsDelayTask?.cancel()
        analyticsDelayTask = nil
        currentAnalyticsSignature = nil
        currentAnalyticsSent = false
        nowPlayingTitleText = ""
        nowPlayingSubtitleText = ""
        currentTime = 0
        duration = 0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        refreshRemoteCommandAvailability()
    }

    func updateCurrentEpisodeArtwork(_ url: URL?) {
        guard currentEpisode != nil else { return }
        currentEpisodePodcastArtworkURL = url
        nowPlayingArtworkURL = preferredPodcastArtworkURL(
            episodeArtworkURL: currentEpisode?.imageURL,
            podcastArtworkURL: currentEpisodePodcastArtworkURL
        )
        loadNowPlayingArtworkIfNeeded()
    }

    func updatePodcastArtworkMode(_ mode: PodcastArtworkMode) {
        podcastArtworkMode = mode
        guard currentEpisode != nil else { return }
        nowPlayingArtworkURL = preferredPodcastArtworkURL(
            episodeArtworkURL: currentEpisode?.imageURL,
            podcastArtworkURL: currentEpisodePodcastArtworkURL
        )
        loadNowPlayingArtworkIfNeeded()
    }

    func updateAnalyticsService(_ analytics: PrivacyAnalyticsService) {
        privacyAnalytics = analytics
    }

    func seekBackward(seconds: Double = 15) {
        guard currentEpisode != nil, let player else { return }
        let newTime = max(0, player.currentTime().seconds - seconds)
        player.seek(to: CMTime(seconds: newTime, preferredTimescale: 1))
        refreshNowPlayingInfo()
    }

    func seekForward(seconds: Double = 15) {
        guard currentEpisode != nil, let player else { return }
        let current = player.currentTime().seconds
        let d = player.currentItem?.duration.seconds ?? 0
        let newTime = d > 0 ? min(d, current + seconds) : current + seconds
        player.seek(to: CMTime(seconds: newTime, preferredTimescale: 1))
        refreshNowPlayingInfo()
    }

    private func resolveQuality(_ quality: PlaybackQuality) -> PlaybackQuality {
        guard quality == .auto else { return quality }
        return isOnWiFi ? .high : .low
    }

    private func tryNextStationStreamCandidate() {
        let nextIndex = stationStreamCandidateIndex + 1
        guard nextIndex < stationStreamCandidates.count else {
            isPlaying = false
            refreshNowPlayingInfo()
            return
        }
        stationStreamCandidateIndex = nextIndex
        startPlayback(url: stationStreamCandidates[nextIndex])
    }

    private func startNetworkMonitoring() {
        let queue = DispatchQueue(label: "network.monitor")
        networkMonitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                self?.isOnWiFi = path.usesInterfaceType(.wifi)
            }
        }
        networkMonitor.start(queue: queue)
    }

    private func startPlayback(url: URL) {
        currentTime = 0
        duration = 0

        if let timeObserver, let player {
            player.removeTimeObserver(timeObserver)
            self.timeObserver = nil
        }

        if player == nil {
            let item = AVPlayerItem(url: url)
            player = AVPlayer(playerItem: item)
            observe(player: player, item: item)
            configureRemoteCommands()
        } else {
            let item = AVPlayerItem(url: url)
            player?.replaceCurrentItem(with: item)
            observe(player: player, item: item)
        }

        timeObserver = player?.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 1, preferredTimescale: 1),
            queue: .main
        ) { [weak self] time in
            guard let self else { return }
            Task { @MainActor in
                self.currentTime = time.seconds.isFinite ? time.seconds : 0
                if let d = self.player?.currentItem?.duration.seconds, d.isFinite, d > 0 {
                    self.duration = d
                }
                self.refreshNowPlayingInfo()
            }
        }

        player?.play()
        isPlaying = player?.timeControlStatus == .playing || player?.rate ?? 0 > 0
        refreshNowPlayingInfo()
    }

    private func configureAudioSession() {
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [.allowAirPlay])
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            print("Audio session error: \(error)")
        }
    }

    private func configureNowPlaying(title: String, subtitle: String) {
        nowPlayingTitleText = title
        nowPlayingSubtitleText = subtitle
        loadNowPlayingArtworkIfNeeded()
        refreshNowPlayingInfo()
    }

    private func configureRemoteCommands() {
        let commandCenter = MPRemoteCommandCenter.shared()
        commandCenter.playCommand.isEnabled = true
        commandCenter.pauseCommand.isEnabled = true
        commandCenter.stopCommand.isEnabled = true
        commandCenter.nextTrackCommand.isEnabled = true
        commandCenter.previousTrackCommand.isEnabled = true
        commandCenter.skipForwardCommand.isEnabled = true
        commandCenter.skipBackwardCommand.isEnabled = true
        commandCenter.changePlaybackPositionCommand.isEnabled = true

        commandCenter.skipForwardCommand.preferredIntervals = [15]
        commandCenter.skipBackwardCommand.preferredIntervals = [15]

        commandCenter.playCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                self?.resume()
            }
            return .success
        }
        commandCenter.pauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                self?.pause()
            }
            return .success
        }

        commandCenter.stopCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                self?.stop()
            }
            return .success
        }

        commandCenter.nextTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                if self.currentEpisode != nil {
                    self.seekForward()
                } else {
                    self.onNextRequested?()
                }
            }
            return .success
        }

        commandCenter.previousTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                if self.currentEpisode != nil {
                    self.seekBackward()
                } else {
                    self.onPreviousRequested?()
                }
            }
            return .success
        }

        commandCenter.skipForwardCommand.addTarget { [weak self] event in
            Task { @MainActor in
                guard let self else { return }
                let interval = (event as? MPSkipIntervalCommandEvent)?.interval ?? 15
                self.seekForward(seconds: interval)
            }
            return .success
        }

        commandCenter.skipBackwardCommand.addTarget { [weak self] event in
            Task { @MainActor in
                guard let self else { return }
                let interval = (event as? MPSkipIntervalCommandEvent)?.interval ?? 15
                self.seekBackward(seconds: interval)
            }
            return .success
        }

        commandCenter.changePlaybackPositionCommand.addTarget { [weak self] event in
            Task { @MainActor in
                guard let self,
                      self.currentEpisode != nil,
                      let commandEvent = event as? MPChangePlaybackPositionCommandEvent,
                      let player = self.player else { return }
                player.seek(to: CMTime(seconds: commandEvent.positionTime, preferredTimescale: 1))
                self.refreshNowPlayingInfo()
            }
            return .success
        }

        refreshRemoteCommandAvailability()
    }

    private func observe(player: AVPlayer?, item: AVPlayerItem) {
        timeControlObservation = player?.observe(\.timeControlStatus, options: [.initial, .new]) { [weak self] player, _ in
            Task { @MainActor in
                self?.isPlaying = player.timeControlStatus == .playing || player.rate > 0
            }
        }

        itemStatusObservation = item.observe(\.status, options: [.new]) { [weak self] item, _ in
            Task { @MainActor in
                if item.status == .failed {
                    guard let self else { return }
                    if self.currentStation != nil {
                        self.tryNextStationStreamCandidate()
                    } else {
                        self.isPlaying = false
                        self.refreshNowPlayingInfo()
                    }
                }
            }
        }

        // Remove any previous end-of-item observer before attaching a new one.
        if let previous = itemEndObserver {
            NotificationCenter.default.removeObserver(previous)
        }
        itemEndObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                guard let self, let episode = self.currentEpisode else { return }
                self.onEpisodeCompleted?(episode)
            }
        }

        // Use metadata output delegate instead of deprecated timedMetadata KVO.
        let output = AVPlayerItemMetadataOutput(identifiers: nil)
        output.setDelegate(self, queue: .main)
        item.add(output)
        metadataOutput = output
    }

    nonisolated func metadataOutput(
        _ output: AVPlayerItemMetadataOutput,
        didOutputTimedMetadataGroups groups: [AVTimedMetadataGroup],
        from track: AVPlayerItemTrack?
    ) {
        let items = groups.flatMap { $0.items }
        Task { @MainActor in
            guard let detail = await extractNowPlayingDetail(from: items), !detail.isEmpty else { return }
            nowPlayingDetail = detail
            configureNowPlaying(title: currentStation?.title ?? nowPlayingTitleText, subtitle: detail)
        }
    }

    private func extractNowPlayingDetail(from metadata: [AVMetadataItem]) async -> String? {
        for item in metadata {
            if let value = try? await item.load(.stringValue),
               !value.isEmpty {
                let parsed = parseStreamTitle(value)
                if !parsed.isEmpty {
                    return parsed
                }
            }
            if let number = try? await item.load(.numberValue) {
                return number.stringValue
            }
        }
        return nil
    }

    private func parseStreamTitle(_ raw: String) -> String {
        if raw.contains("StreamTitle=") {
            let cleaned = raw
                .replacingOccurrences(of: "StreamTitle='", with: "")
                .replacingOccurrences(of: "';", with: "")
                .replacingOccurrences(of: "StreamTitle=", with: "")
                .replacingOccurrences(of: "'", with: "")
                .replacingOccurrences(of: ";", with: "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            return cleaned
        }
        return raw.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func startRMSPolling(for station: Station) {
        rmsPollingTask?.cancel()
        let stationID = station.id
        let serviceID = station.serviceId

        rmsPollingTask = Task { [weak self] in
            guard let self else { return }
            await self.fetchRMSNowPlaying(serviceID: serviceID)

            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 30_000_000_000)
                guard !Task.isCancelled else { break }
                guard self.currentStation?.id == stationID else { break }
                await self.fetchRMSNowPlaying(serviceID: serviceID)
            }
        }
    }

    private func fetchRMSNowPlaying(serviceID: String) async {
        guard var components = URLComponents(string: "https://rms.api.bbc.co.uk/v2/services/\(serviceID)/segments/latest") else {
            return
        }
        components.queryItems = [URLQueryItem(name: "t", value: "\(Int(Date().timeIntervalSince1970 * 1000))")]
        guard let url = components.url else { return }

        var request = URLRequest(url: url)
        request.setValue("BBCRadioPlayer-iOS/1.0", forHTTPHeaderField: "User-Agent")
        request.timeoutInterval = 8

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else { return }
            if http.statusCode == 404 { return }
            guard (200..<300).contains(http.statusCode) else { return }

            let payload = try JSONDecoder().decode(RMSSegmentResponse.self, from: data)
            guard let segment = payload.data.first else { return }
            if segment.offset?.nowPlaying == false { return }

            if let text = formatDetail(from: segment.titles), !text.isEmpty {
                nowPlayingDetail = text
                configureNowPlaying(title: currentStation?.title ?? "BBC Radio", subtitle: text)
            }

            if let image = segment.imageURL,
               !image.isEmpty,
               !image.lowercased().contains("default") {
                let prepared = image
                    .replacingOccurrences(of: "\\/", with: "/")
                    .replacingOccurrences(of: "{recipe}", with: "320x320")
                nowPlayingArtworkURL = URL(string: prepared)
                loadNowPlayingArtworkIfNeeded()
            }
        } catch {
            // Keep previous metadata on transient failures.
        }
    }

    private func formatDetail(from titles: RMSTitles?) -> String? {
        guard let titles else { return nil }
        let artist = (titles.primary ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let track = ((titles.secondary ?? titles.tertiary) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)

        if !artist.isEmpty && !track.isEmpty {
            return "\(artist) - \(track)"
        }
        if !artist.isEmpty {
            return artist
        }
        if !track.isEmpty {
            return track
        }
        return nil
    }

    private func fetchCurrentShowTitle(serviceID: String) async -> String? {
        guard var components = URLComponents(string: "https://ess.api.bbci.co.uk/schedules") else {
            return nil
        }
        components.queryItems = [URLQueryItem(name: "serviceId", value: serviceID)]
        guard let url = components.url else { return nil }

        var request = URLRequest(url: url)
        request.setValue("BBCRadioPlayer-iOS/1.0", forHTTPHeaderField: "User-Agent")
        request.timeoutInterval = 8

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse,
                  (200..<300).contains(http.statusCode),
                  let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let items = json["items"] as? [[String: Any]] else {
                return nil
            }

            let now = Date()
            let parser = ISO8601DateFormatter()
            parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            let fallbackParser = ISO8601DateFormatter()

            for item in items {
                guard let published = item["published_time"] as? [String: Any],
                      let startString = published["start"] as? String,
                      let endString = published["end"] as? String else {
                    continue
                }

                let start = parser.date(from: startString) ?? fallbackParser.date(from: startString)
                let end = parser.date(from: endString) ?? fallbackParser.date(from: endString)
                guard let start, let end, (start...end).contains(now) else { continue }

                if let brand = item["brand"] as? [String: Any],
                   let title = brand["title"] as? String,
                   !title.isEmpty {
                    return title
                }

                if let episode = item["episode"] as? [String: Any],
                   let title = episode["title"] as? String,
                   !title.isEmpty {
                    return title
                }
            }
        } catch {
            return nil
        }

        return nil
    }

    private func loadNowPlayingArtworkIfNeeded() {
        artworkLoadTask?.cancel()
        guard let url = nowPlayingArtworkURL else {
            nowPlayingArtworkImage = nil
            refreshNowPlayingInfo()
            return
        }
        artworkLoadTask = Task { [weak self] in
            guard let self else { return }
            do {
                let (data, _) = try await URLSession.shared.data(from: url)
                if Task.isCancelled { return }
                if let image = UIImage(data: data) {
                    self.nowPlayingArtworkImage = image
                    self.refreshNowPlayingInfo()
                }
            } catch {
                // Ignore artwork fetch failure.
            }
        }
    }

    private func preferredPodcastArtworkURL(episodeArtworkURL: URL?, podcastArtworkURL: URL?) -> URL? {
        switch podcastArtworkMode {
        case .episode:
            return episodeArtworkURL ?? podcastArtworkURL
        case .podcast:
            return podcastArtworkURL ?? episodeArtworkURL
        }
    }

    private func scheduleStationAnalytics(_ station: Station) {
        analyticsDelayTask?.cancel()
        currentAnalyticsSignature = "station:\(station.id)"
        currentAnalyticsSent = false
        analyticsDelayTask = Task { [weak self] in
            guard let self else { return }
            try? await Task.sleep(nanoseconds: 10_000_000_000)
            guard !Task.isCancelled else { return }
            guard self.isPlaying,
                  self.currentStation?.id == station.id,
                  self.currentAnalyticsSignature == "station:\(station.id)",
                  !self.currentAnalyticsSent else { return }
            self.currentAnalyticsSent = true
            await self.privacyAnalytics?.trackStationPlay(stationID: station.id, stationName: station.title)
        }
    }

    private func scheduleEpisodeAnalytics(_ episode: Episode, podcastTitle: String?) {
        analyticsDelayTask?.cancel()
        currentAnalyticsSignature = "episode:\(episode.id)"
        currentAnalyticsSent = false
        analyticsDelayTask = Task { [weak self] in
            guard let self else { return }
            try? await Task.sleep(nanoseconds: 10_000_000_000)
            guard !Task.isCancelled else { return }
            guard self.isPlaying,
                  self.currentEpisode?.id == episode.id,
                  self.currentAnalyticsSignature == "episode:\(episode.id)",
                  !self.currentAnalyticsSent else { return }
            self.currentAnalyticsSent = true
            await self.privacyAnalytics?.trackEpisodePlay(
                podcastID: episode.podcastID,
                episodeID: episode.id,
                episodeTitle: episode.title,
                podcastTitle: podcastTitle
            )
        }
    }

    private func scheduleAnalyticsIfNeededForCurrentItem() {
        guard !currentAnalyticsSent else { return }
        if let station = currentStation {
            scheduleStationAnalytics(station)
            return
        }
        if let episode = currentEpisode {
            scheduleEpisodeAnalytics(episode, podcastTitle: currentEpisodePodcastTitle)
        }
    }

    private func refreshRemoteCommandAvailability() {
        let commandCenter = MPRemoteCommandCenter.shared()
        let isEpisode = currentEpisode != nil
        commandCenter.skipForwardCommand.isEnabled = isEpisode
        commandCenter.skipBackwardCommand.isEnabled = isEpisode
        commandCenter.changePlaybackPositionCommand.isEnabled = isEpisode
        commandCenter.nextTrackCommand.isEnabled = isEpisode || currentStation != nil
        commandCenter.previousTrackCommand.isEnabled = isEpisode || currentStation != nil
    }

    private func refreshNowPlayingInfo() {
        guard hasActiveItem else { return }

        var info: [String: Any] = [
            MPMediaItemPropertyTitle: nowPlayingTitleText,
            MPMediaItemPropertyArtist: nowPlayingSubtitleText,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1.0 : 0.0
        ]

        if currentEpisode != nil {
            info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = currentTime
            if duration > 0 {
                info[MPMediaItemPropertyPlaybackDuration] = duration
            }
        }

        if let image = nowPlayingArtworkImage {
            let artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
            info[MPMediaItemPropertyArtwork] = artwork
        }

        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }
}
