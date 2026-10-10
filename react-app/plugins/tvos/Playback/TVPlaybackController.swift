import Foundation
import AVFoundation
import MediaPlayer
import Observation

@Observable final class TVPlaybackController {
    static let shared = TVPlaybackController()
    
    var isPlaying: Bool = false
    var isBuffering: Bool = false
    var currentStation: TVStation?
    var currentEpisode: TVEpisode?
    var currentPodcast: TVPodcast?
    var currentPositionSeconds: Double = 0
    var currentDurationSeconds: Double = 0
    
    private var player: AVPlayer?
    private var playerItem: AVPlayerItem?
    private var timeObserver: Any?
    private var statusObserver: NSKeyValueObservation?
    private var bufferObserver: NSKeyValueObservation?
    
    private var candidateUrls: [URL] = []
    private var currentCandidateIndex = 0
    
    var audioQuality: TVAudioQuality {
        .high
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
            print("[TVPlaybackController] Failed to activate audio session: \(error)")
        }
    }
    
    private func setupRemoteCommandCenter() {
        let commandCenter = MPRemoteCommandCenter.shared()
        
        commandCenter.playCommand.isEnabled = true
        commandCenter.playCommand.addTarget { [weak self] _ in
            self?.resume()
            return .success
        }
        
        commandCenter.pauseCommand.isEnabled = true
        commandCenter.pauseCommand.addTarget { [weak self] _ in
            self?.pause()
            return .success
        }
        
        commandCenter.togglePlayPauseCommand.isEnabled = true
        commandCenter.togglePlayPauseCommand.addTarget { [weak self] _ in
            self?.togglePlayPause()
            return .success
        }

        commandCenter.stopCommand.isEnabled = true
        commandCenter.stopCommand.addTarget { [weak self] _ in
            self?.stop()
            return .success
        }

        commandCenter.nextTrackCommand.isEnabled = true
        commandCenter.nextTrackCommand.addTarget { [weak self] _ in
            self?.playNext()
            return .success
        }

        commandCenter.previousTrackCommand.isEnabled = true
        commandCenter.previousTrackCommand.addTarget { [weak self] _ in
            self?.playPrevious()
            return .success
        }

        commandCenter.skipForwardCommand.isEnabled = true
        commandCenter.skipForwardCommand.preferredIntervals = [30]
        commandCenter.skipForwardCommand.addTarget { [weak self] _ in
            self?.seekBy(30)
            return .success
        }

        commandCenter.skipBackwardCommand.isEnabled = true
        commandCenter.skipBackwardCommand.preferredIntervals = [10]
        commandCenter.skipBackwardCommand.addTarget { [weak self] _ in
            self?.seekBy(-10)
            return .success
        }
        
        commandCenter.changePlaybackPositionCommand.isEnabled = true
        commandCenter.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let posEvent = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            self?.seek(to: posEvent.positionTime)
            return .success
        }
    }
    
    // MARK: - Station Playback
    
    func playStation(_ station: TVStation) {
        stop()
        currentStation = station
        currentEpisode = nil
        currentPodcast = nil
        isBuffering = true
        
        let serviceId = station.serviceId
        var urls: [URL] = []
        // 1. Direct UK streams if provided for this station
        if let direct = station.directStreamUrls {
            for streamStr in direct {
                if !streamStr.contains("/live/ww/") && !streamStr.contains("/nonuk/"),
                   let url = URL(string: streamStr) {
                    urls.append(url)
                }
            }
        }
        // 2. Official BBC UK HLS streams
        for sid in station.streamServiceIds {
            if let url = URL(string: "https://a.files.bbci.co.uk/ms6/live/3441A116-B12E-4D2F-ACA8-C1984642FA4B/audio/simulcast/hls/uk/audio_syndication_high_sbr_v1/cf/\(sid).m3u8") {
                urls.append(url)
            }
            if let url = URL(string: "https://a.files.bbci.co.uk/ms6/live/3441A116-B12E-4D2F-ACA8-C1984642FA4B/audio/simulcast/hls/uk/pc_hd_abr_v2/cf/\(sid).m3u8") {
                urls.append(url)
            }
            if let url = URL(string: "https://a.files.bbci.co.uk/ms6/live/3441A116-B12E-4D2F-ACA8-C1984642FA4B/audio/simulcast/hls/uk/audio_syndication_med_sbr_v1/cf/\(sid).m3u8") {
                urls.append(url)
            }
        }
        // 3. Fallback international / non-UK HLS streams
        for sid in station.streamServiceIds {
            if let url = URL(string: "https://a.files.bbci.co.uk/ms6/live/3441A116-B12E-4D2F-ACA8-C1984642FA4B/audio/simulcast/hls/nonuk/pc_hd_abr_v2/cf/\(sid).m3u8") {
                urls.append(url)
            }
        }
        if let direct = station.directStreamUrls {
            for streamStr in direct {
                if (streamStr.contains("/live/ww/") || streamStr.contains("/nonuk/")),
                   let url = URL(string: streamStr) {
                    urls.append(url)
                }
            }
        }
        candidateUrls = urls
        
        currentCandidateIndex = 0
        tryPlayCurrentCandidate()
        
        updateNowPlayingInfo(title: station.title, artist: "Live Radio")
        TVNowPlayingMetadata.shared.startPolling(serviceId: serviceId)
    }
    
    // MARK: - Podcast Playback
    
    func playEpisode(_ episode: TVEpisode, podcast: TVPodcast) {
        stop()
        currentStation = nil
        currentEpisode = episode
        currentPodcast = podcast
        isBuffering = true
        
        guard let url = URL(string: episode.mediaUrl) else { return }
        candidateUrls = [url]
        currentCandidateIndex = 0
        
        tryPlayCurrentCandidate()
        updateNowPlayingInfo(title: episode.title, artist: podcast.title)
    }
    
    private func tryPlayCurrentCandidate() {
        guard currentCandidateIndex < candidateUrls.count else {
            isBuffering = false
            isPlaying = false
            return
        }
        
        let url = candidateUrls[currentCandidateIndex]
        setupPlayer(with: url)
    }
    
    private func setupPlayer(with url: URL) {
        cleanObservers()
        
        let asset = AVURLAsset(url: url)
        playerItem = AVPlayerItem(asset: asset)
        
        statusObserver = playerItem?.observe(\.status, options: [.new]) { [weak self] item, _ in
            DispatchQueue.main.async {
                self?.handleItemStatusChange(item)
            }
        }
        
        bufferObserver = playerItem?.observe(\.isPlaybackBufferEmpty, options: [.new]) { [weak self] item, _ in
            DispatchQueue.main.async {
                self?.isBuffering = item.isPlaybackBufferEmpty
            }
        }
        
        if player == nil {
            player = AVPlayer(playerItem: playerItem)
        } else {
            player?.replaceCurrentItem(with: playerItem)
        }
        
        setupTimeObserver()
        player?.play()
        isPlaying = true
    }
    
    private func handleItemStatusChange(_ item: AVPlayerItem) {
        switch item.status {
        case .readyToPlay:
            isBuffering = false
            isPlaying = true
            if let duration = playerItem?.duration.seconds, !duration.isNaN && duration > 0 {
                currentDurationSeconds = duration
            }
        case .failed:
            print("[TVPlaybackController] Candidate failed: \(String(describing: item.error))")
            currentCandidateIndex += 1
            tryPlayCurrentCandidate()
        default:
            break
        }
    }
    
    private func setupTimeObserver() {
        let interval = CMTime(seconds: 1.0, preferredTimescale: CMTimeScale(NSEC_PER_SEC))
        timeObserver = player?.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
            guard let self = self else { return }
            self.currentPositionSeconds = time.seconds
            
            if self.currentStation != nil {
                // Check if current show changed
                if let show = TVNowPlayingMetadata.shared.currentShowTitle,
                   let station = self.currentStation {
                    self.updateNowPlayingInfo(title: station.title, artist: show)
                }
            }
        }
    }
    
    func pause() {
        player?.pause()
        isPlaying = false
    }
    
    func resume() {
        if let player = player {
            player.play()
            isPlaying = true
        } else if let station = currentStation {
            playStation(station)
        } else if let episode = currentEpisode, let podcast = currentPodcast {
            playEpisode(episode, podcast: podcast)
        } else if let first = TVStationCatalogue.allStations().first {
            playStation(first)
        }
    }
    
    func togglePlayPause() {
        if isPlaying {
            pause()
        } else {
            resume()
        }
    }
    
    func stop() {
        player?.pause()
        isPlaying = false
        isBuffering = false
        cleanObservers()
        playerItem = nil
        player = nil
        currentPositionSeconds = 0
        TVNowPlayingMetadata.shared.stopPolling()
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }

    func playNext() {
        if currentEpisode != nil {
            seekBy(30)
            return
        }
        guard let current = currentStation else {
            if let first = TVStationCatalogue.allStations().first {
                playStation(first)
            }
            return
        }
        let stations = TVStationCatalogue.allStations()
        guard !stations.isEmpty else { return }
        
        let targetList: [TVStation]
        let favs = TVFavouritesManager.shared.favouriteIds
        if UserDefaults.standard.string(forKey: "tv_scroll_mode") == "favourites" && !favs.isEmpty {
            let filtered = stations.filter { favs.contains($0.id) }
            targetList = filtered.isEmpty ? stations : filtered
        } else {
            targetList = stations
        }
        
        if let idx = targetList.firstIndex(where: { $0.id == current.id }) {
            let nextIndex = (idx + 1) % targetList.count
            playStation(targetList[nextIndex])
        } else if let first = targetList.first {
            playStation(first)
        }
    }

    func playPrevious() {
        if currentEpisode != nil {
            seekBy(-10)
            return
        }
        guard let current = currentStation else {
            if let last = TVStationCatalogue.allStations().last {
                playStation(last)
            }
            return
        }
        let stations = TVStationCatalogue.allStations()
        guard !stations.isEmpty else { return }
        
        let targetList: [TVStation]
        let favs = TVFavouritesManager.shared.favouriteIds
        if UserDefaults.standard.string(forKey: "tv_scroll_mode") == "favourites" && !favs.isEmpty {
            let filtered = stations.filter { favs.contains($0.id) }
            targetList = filtered.isEmpty ? stations : filtered
        } else {
            targetList = stations
        }
        
        if let idx = targetList.firstIndex(where: { $0.id == current.id }) {
            let prevIndex = idx <= 0 ? targetList.count - 1 : idx - 1
            playStation(targetList[prevIndex])
        } else if let last = targetList.last {
            playStation(last)
        }
    }
    
    func seek(to seconds: Double) {
        guard let player = player else { return }
        let targetTime = CMTime(seconds: max(0, seconds), preferredTimescale: CMTimeScale(NSEC_PER_SEC))
        player.seek(to: targetTime, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
            guard let self = self else { return }
            self.currentPositionSeconds = max(0, seconds)
            if let ep = self.currentEpisode, let pod = self.currentPodcast {
                self.updateNowPlayingInfo(title: ep.title, artist: pod.title)
            }
        }
    }

    func seekBy(_ delta: Double) {
        let maxDuration = currentDurationSeconds > 0 ? currentDurationSeconds : 7200.0
        let newPos = max(0.0, min(maxDuration, currentPositionSeconds + delta))
        seek(to: newPos)
    }
    
    private func updateNowPlayingInfo(title: String, artist: String) {
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: title,
            MPMediaItemPropertyArtist: artist
        ]
        
        if currentStation != nil {
            info[MPNowPlayingInfoPropertyIsLiveStream] = true
        } else if currentDurationSeconds > 0 {
            info[MPMediaItemPropertyPlaybackDuration] = currentDurationSeconds
            info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = currentPositionSeconds
        }
        
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }
    
    private func cleanObservers() {
        statusObserver?.invalidate()
        statusObserver = nil
        bufferObserver?.invalidate()
        bufferObserver = nil
        if let observer = timeObserver {
            player?.removeTimeObserver(observer)
            timeObserver = nil
        }
    }
}
