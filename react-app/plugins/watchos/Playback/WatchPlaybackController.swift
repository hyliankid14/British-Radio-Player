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
    
    var audioQuality: AudioQuality {
        let rawValue = userDefaults.string(forKey: "watch_audio_quality") ?? "standard"
        return AudioQuality(rawValue: rawValue) ?? .standard
    }
    
    private init() {
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
    
    func playEpisode(_ episode: WatchEpisode, startPositionMs: Int) {
        stop()
        currentEpisodeId = episode.id
        
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
        
        startSession()
        player?.play()
        isPlaying = true
        isBuffering = true
        
        setupProgressSaving(episodeId: episode.id)
        updateNowPlayingInfo(title: episode.title, artist: "Podcast")
    }
    
    func togglePlayPause() {
        if isPlaying {
            player?.pause()
            isPlaying = false
        } else {
            player?.play()
            isPlaying = true
        }
    }
    
    func seekBy(_ seconds: Double) {
        guard let player = player else { return }
        let currentTime = player.currentTime()
        let newTime = CMTimeAdd(currentTime, CMTime(seconds: seconds, preferredTimescale: 600))
        player.seek(to: newTime)
    }
    
    func stop() {
        player?.pause()
        isPlaying = false
        isBuffering = false
        currentStationId = nil
        currentEpisodeId = nil
        
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
    
    private func setupProgressSaving(episodeId: String) {
        timeObserver = player?.addPeriodicTimeObserver(forInterval: CMTime(seconds: 15, preferredTimescale: 600), queue: .main) { [weak self] time in
            guard let self = self else { return }
            let ms = Int(time.seconds * 1000)
            self.userDefaults.set(ms, forKey: "watch_episode_progress_\(episodeId)")
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
