import Foundation
import AVFoundation
import WatchKit
import MediaPlayer
import Observation

@Observable final class WatchPlaybackController {
    static let shared = WatchPlaybackController()
    
    var isPlaying: Bool = false
    var isBuffering: Bool = false
    var currentStationId: String?
    var currentEpisodeId: String?
    var currentEpisode: WatchEpisode?
    var currentEpisodePodcast: WatchPodcast?
    var currentPositionSeconds: Double = 0
    var currentDurationSeconds: Double = 0
    
    private var player: AVPlayer?
    private var playerItem: AVPlayerItem?
    private var timeObserver: Any?
    private var statusObserver: NSKeyValueObservation?
    private var bufferObserver: NSKeyValueObservation?
    private var runtimeSession: WKExtendedRuntimeSession?
    
    private var candidateUrls: [URL] = []
    private var currentCandidateIndex = 0
    private var currentPlayingStation: WatchStation?
    
    private let userDefaults = UserDefaults.standard
    
    // Analytics tracking (matching WearPlaybackService)
    private static let analyticsMinPlaySeconds: Double = 10.001
    private static let keyLastTrackedEpisodeId = "watch_last_tracked_episode_id"
    private var stationAnalyticsTask: DispatchWorkItem?
    private var episodeAnalyticsTask: DispatchWorkItem?
    private var lastTrackedEpisodeAnalyticsId: String?
    
    var audioQuality: AudioQuality {
        let rawValue = userDefaults.string(forKey: "watch_audio_quality") ?? "standard"
        return AudioQuality(rawValue: rawValue) ?? .standard
    }
    
    private init() {
        lastTrackedEpisodeAnalyticsId = userDefaults.string(forKey: Self.keyLastTrackedEpisodeId)
        setupAudioSession()
        setupRemoteCommandCenter()
    }
    
    private func setupAudioSession() {
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, policy: .longFormAudio)
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            print("Failed to set audio session category: \(error)")
        }
    }
    
    func playStation(_ station: WatchStation) {
        stop()
        currentStationId = station.id
        currentPlayingStation = station
        
        scheduleStationAnalytics(stationId: station.id, stationTitle: station.title)
        
        let serviceId = station.serviceId
        let bitrate = audioQuality.bitrate
        
        candidateUrls = [
            URL(string: "https://lsn.lv/bbcradio.m3u8?station=\(serviceId)&bitrate=\(bitrate)")!,
            URL(string: "https://lsn.lv/bbcradio.m3u8?station=\(serviceId)")!,
            URL(string: "https://a.files.bbci.co.uk/ms6/live/3441A116-B12E-4D2F-ACA8-C1984642FA4B/audio/simulcast/hls/uk/pc_hd_abr_v2/cf/\(serviceId).m3u8")!,
            URL(string: "https://a.files.bbci.co.uk/ms6/live/3441A116-B12E-4D2F-ACA8-C1984642FA4B/audio/simulcast/hls/nonuk/pc_hd_abr_v2/cf/\(serviceId).m3u8")!
        ]
        
        currentCandidateIndex = 0
        tryPlayCurrentCandidate()
        
        updateNowPlayingInfo(title: station.title, artist: "BBC Radio")
        NowPlayingMetadata.shared.startPolling(serviceId: serviceId)
    }
    
    private func tryPlayCurrentCandidate() {
        guard currentCandidateIndex < candidateUrls.count else {
            print("All candidates failed")
            stop()
            return
        }
        
        let url = candidateUrls[currentCandidateIndex]
        playerItem = AVPlayerItem(url: url)
        
        statusObserver = playerItem?.observe(\.status, options: [.new, .old]) { [weak self] item, _ in
            guard let self = self else { return }
            if item.status == .failed {
                self.currentCandidateIndex += 1
                self.tryPlayCurrentCandidate()
            }
        }
        
        bufferObserver = playerItem?.observe(\.isPlaybackLikelyToKeepUp, options: [.new]) { [weak self] item, _ in
            self?.isBuffering = !item.isPlaybackLikelyToKeepUp
        }
        
        if player == nil {
            player = AVPlayer(playerItem: playerItem)
        } else {
            player?.replaceCurrentItem(with: playerItem)
        }
        
        startSession()
        player?.play()
        isPlaying = true
        isBuffering = true
    }
    
    func playEpisode(_ episode: WatchEpisode, podcast: WatchPodcast? = nil, startPositionMs: Int) {
        stop()
        currentEpisodeId = episode.id
        currentEpisode = episode
        currentPositionSeconds = Double(startPositionMs) / 1000.0
        currentDurationSeconds = Double(episode.duration)
        if let pod = podcast {
            currentEpisodePodcast = pod
        } else if let found = WatchPodcastManager.shared.subscribedPodcasts.first(where: { $0.id == episode.podcastId }) {
            currentEpisodePodcast = found
        } else if let epImg = episode.imageUrl {
            currentEpisodePodcast = WatchPodcast(id: episode.podcastId, title: "Podcast", rssUrl: "", imageUrl: epImg)
        }
        
        guard let url = URL(string: episode.mediaUrl) else { return }
        playerItem = AVPlayerItem(url: url)
        
        bufferObserver = playerItem?.observe(\.isPlaybackLikelyToKeepUp, options: [.new]) { [weak self] item, _ in
            self?.isBuffering = !item.isPlaybackLikelyToKeepUp
        }
        
        player = AVPlayer(playerItem: playerItem)
        
        if startPositionMs > 0 {
            let time = CMTime(value: CMTimeValue(startPositionMs), timescale: 1000)
            player?.seek(to: time)
        }
        
        NotificationCenter.default.removeObserver(self, name: .AVPlayerItemDidPlayToEndTime, object: nil)
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(playerItemDidReachEnd),
            name: .AVPlayerItemDidPlayToEndTime,
            object: playerItem
        )
        
        startSession()
        player?.play()
        isPlaying = true
        isBuffering = true
        
        let cleanEpId = episode.id.trimmingCharacters(in: .whitespacesAndNewlines)
        if startPositionMs == 0 && cleanEpId == lastTrackedEpisodeAnalyticsId {
            lastTrackedEpisodeAnalyticsId = nil
            userDefaults.removeObject(forKey: Self.keyLastTrackedEpisodeId)
        }
        scheduleEpisodeAnalytics(
            podcastId: episode.podcastId,
            episodeId: cleanEpId,
            episodeTitle: episode.title,
            podcastTitle: currentEpisodePodcast?.title ?? podcast?.title
        )
        
        setupProgressSaving(episodeId: episode.id)
        updateNowPlayingInfo(title: episode.title, artist: currentEpisodePodcast?.title ?? "Podcast")
    }
    
    @objc private func playerItemDidReachEnd(notification: Notification) {
        if let epId = currentEpisodeId {
            WatchConnectivityManager.shared.markEpisodePlayed(epId, played: true)
        }
        stop()
    }
    
    func togglePlayPause() {
        if isPlaying {
            cancelAnalyticsTasks()
            player?.pause()
            isPlaying = false
            if let epId = currentEpisodeId, let player = player {
                let ms = Int(player.currentTime().seconds * 1000)
                WatchConnectivityManager.shared.updateEpisodeProgress(episodeId: epId, positionMs: ms, immediate: true)
            }
        } else {
            player?.play()
            isPlaying = true
            if let station = currentPlayingStation {
                scheduleStationAnalytics(stationId: station.id, stationTitle: station.title)
            } else if let ep = currentEpisode {
                scheduleEpisodeAnalytics(
                    podcastId: ep.podcastId,
                    episodeId: ep.id,
                    episodeTitle: ep.title,
                    podcastTitle: currentEpisodePodcast?.title
                )
            }
        }
    }
    
    func seekTo(_ seconds: Double) {
        guard let player = player else { return }
        let safe = max(0, seconds)
        currentPositionSeconds = safe
        let time = CMTime(seconds: safe, preferredTimescale: 600)
        player.seek(to: time)
        if let epId = currentEpisodeId {
            let ms = Int(safe * 1000)
            WatchConnectivityManager.shared.updateEpisodeProgress(episodeId: epId, positionMs: ms, immediate: true)
        }
    }

    func seekBy(_ seconds: Double) {
        guard let player = player else { return }
        let currentTime = player.currentTime()
        let newTime = CMTimeAdd(currentTime, CMTime(seconds: seconds, preferredTimescale: 600))
        let targetSecs = max(0, newTime.seconds)
        currentPositionSeconds = targetSecs
        player.seek(to: newTime)
        if let epId = currentEpisodeId {
            let ms = Int(targetSecs * 1000)
            WatchConnectivityManager.shared.updateEpisodeProgress(episodeId: epId, positionMs: ms, immediate: true)
        }
    }
    
    func stop() {
        cancelAnalyticsTasks()
        if let epId = currentEpisodeId, let player = player {
            let ms = Int(player.currentTime().seconds * 1000)
            if ms > 0 {
                WatchConnectivityManager.shared.updateEpisodeProgress(episodeId: epId, positionMs: ms, immediate: true)
            }
        }
        NotificationCenter.default.removeObserver(self, name: .AVPlayerItemDidPlayToEndTime, object: nil)

        player?.pause()
        isPlaying = false
        isBuffering = false
        currentStationId = nil
        currentPlayingStation = nil
        currentEpisodeId = nil
        currentEpisode = nil
        currentEpisodePodcast = nil
        currentPositionSeconds = 0
        currentDurationSeconds = 0
        
        if let observer = timeObserver {
            player?.removeTimeObserver(observer)
            timeObserver = nil
        }
        statusObserver?.invalidate()
        bufferObserver?.invalidate()
        
        playerItem = nil
        player = nil
        
        NowPlayingMetadata.shared.stopPolling()
        stopSession()
        
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }
    
    private func scheduleStationAnalytics(stationId: String, stationTitle: String) {
        cancelAnalyticsTasks()
        let cleanId = stationId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanId.isEmpty else { return }
        
        let workItem = DispatchWorkItem { [weak self] in
            guard let self = self else { return }
            if self.isPlaying, self.currentStationId == cleanId {
                WatchAnalytics.shared.trackStationPlay(stationId: cleanId, stationName: stationTitle)
            }
        }
        stationAnalyticsTask = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.analyticsMinPlaySeconds, execute: workItem)
    }
    
    private func scheduleEpisodeAnalytics(
        podcastId: String,
        episodeId: String,
        episodeTitle: String,
        podcastTitle: String?
    ) {
        cancelAnalyticsTasks()
        let cleanPodId = podcastId.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanEpId = episodeId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanPodId.isEmpty, !cleanEpId.isEmpty else { return }
        guard lastTrackedEpisodeAnalyticsId != cleanEpId else { return }
        
        let workItem = DispatchWorkItem { [weak self] in
            guard let self = self else { return }
            if self.isPlaying, self.currentEpisodeId == cleanEpId {
                WatchAnalytics.shared.trackEpisodePlay(
                    podcastId: cleanPodId,
                    episodeId: cleanEpId,
                    episodeTitle: episodeTitle,
                    podcastTitle: podcastTitle
                )
                self.lastTrackedEpisodeAnalyticsId = cleanEpId
                self.userDefaults.set(cleanEpId, forKey: Self.keyLastTrackedEpisodeId)
            }
        }
        episodeAnalyticsTask = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.analyticsMinPlaySeconds, execute: workItem)
    }
    
    private func cancelAnalyticsTasks() {
        stationAnalyticsTask?.cancel()
        stationAnalyticsTask = nil
        episodeAnalyticsTask?.cancel()
        episodeAnalyticsTask = nil
    }
    
    private func setupProgressSaving(episodeId: String) {
        timeObserver = player?.addPeriodicTimeObserver(forInterval: CMTime(seconds: 1.0, preferredTimescale: 600), queue: .main) { [weak self] time in
            guard let self = self else { return }
            let secs = time.seconds
            if secs.isFinite && !secs.isNaN {
                self.currentPositionSeconds = max(0, secs)
            }
            if let dur = self.playerItem?.duration.seconds, dur.isFinite && !dur.isNaN && dur > 0 {
                self.currentDurationSeconds = dur
            }
            let ms = Int(time.seconds * 1000)
            WatchConnectivityManager.shared.updateEpisodeProgress(episodeId: episodeId, positionMs: ms, immediate: false)
        }
    }
    
    private func startSession() {
        if runtimeSession == nil {
            runtimeSession = WKExtendedRuntimeSession()
            runtimeSession?.start()
        }
    }
    
    private func stopSession() {
        runtimeSession?.invalidate()
        runtimeSession = nil
    }
    
    private func setupRemoteCommandCenter() {
        let commandCenter = MPRemoteCommandCenter.shared()
        commandCenter.playCommand.addTarget { [weak self] _ in
            self?.togglePlayPause()
            return .success
        }
        commandCenter.pauseCommand.addTarget { [weak self] _ in
            self?.togglePlayPause()
            return .success
        }
        commandCenter.skipForwardCommand.addTarget { [weak self] event in
            self?.seekBy(30)
            return .success
        }
        commandCenter.skipBackwardCommand.addTarget { [weak self] event in
            self?.seekBy(-10)
            return .success
        }
    }
    
    private func updateNowPlayingInfo(title: String, artist: String) {
        var nowPlayingInfo = [String: Any]()
        nowPlayingInfo[MPMediaItemPropertyTitle] = title
        nowPlayingInfo[MPMediaItemPropertyArtist] = artist
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nowPlayingInfo
    }
}
