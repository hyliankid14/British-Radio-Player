import AVFoundation
import CarPlay
import MediaPlayer
import UIKit

@MainActor
final class CarPlayManager: NSObject {
    static let shared = CarPlayManager()

    private weak var interfaceController: CPInterfaceController?
    private weak var window: CPWindow?
    private var player: AVPlayer?
    private var currentStation: CarPlayStation?
    private var logoCache: [String: UIImage] = [:]
    private var isPlayingObservation: NSKeyValueObservation?
    private var isObservingUserDefaults = false

    private override init() {
        super.init()
    }

    func connect(interfaceController: CPInterfaceController, window: CPWindow) {
        self.interfaceController = interfaceController
        self.window = window

        if !isObservingUserDefaults {
            NotificationCenter.default.addObserver(
                self,
                selector: #selector(handleUserDefaultsChange),
                name: UserDefaults.didChangeNotification,
                object: nil
            )
            isObservingUserDefaults = true
        }

        setupRemoteCommands()
        refreshTemplates()
    }

    func disconnect() {
        interfaceController = nil
        window = nil
    }

    @objc private func handleUserDefaultsChange() {
        Task { @MainActor in
            refreshTemplates()
        }
    }

    private func setupRemoteCommands() {
        let commandCenter = MPRemoteCommandCenter.shared()

        commandCenter.playCommand.isEnabled = true
        commandCenter.playCommand.addTarget { [weak self] _ in
            self?.player?.play()
            return .success
        }

        commandCenter.pauseCommand.isEnabled = true
        commandCenter.pauseCommand.addTarget { [weak self] _ in
            self?.player?.pause()
            return .success
        }

        commandCenter.stopCommand.isEnabled = true
        commandCenter.stopCommand.addTarget { [weak self] _ in
            self?.player?.pause()
            return .success
        }

        commandCenter.togglePlayPauseCommand.isEnabled = true
        commandCenter.togglePlayPauseCommand.addTarget { [weak self] _ in
            if self?.player?.timeControlStatus == .playing {
                self?.player?.pause()
            } else {
                self?.player?.play()
            }
            return .success
        }
    }

    func refreshTemplates() {
        guard let interfaceController = interfaceController else { return }

        let favStationIDs = UserDefaults.standard.stringArray(forKey: "favorite_station_ids") ?? []
        let favStations = favStationIDs.compactMap { CarPlayStationRepository.station(id: $0) }

        // 1. Favourites tab
        let favItems: [CPListItem]
        if favStations.isEmpty {
            let emptyItem = CPListItem(
                text: "No favourite stations yet",
                detailText: "Add favourite stations in British Radio Player on your iPhone"
            )
            emptyItem.isEnabled = false
            favItems = [emptyItem]
        } else {
            favItems = favStations.map { station in
                let item = CPListItem(text: station.title, detailText: station.category.rawValue)
                item.handler = { [weak self] _, completion in
                    Task { @MainActor in
                        self?.play(station: station)
                        completion()
                    }
                }
                return item
            }
        }
        let favTemplate = CPListTemplate(title: "Favourites", sections: [CPListSection(items: favItems)])
        favTemplate.tabTitle = "Favourites"
        favTemplate.tabImage = UIImage(systemName: "star.fill")

        // 2. Stations tab (Sections: National, Nations & Regions, Local Radio)
        var stationSections: [CPListSection] = []
        for category in CarPlayStationCategory.allCases {
            let stations = CarPlayStationRepository.stations(for: category)
            let items = stations.map { station -> CPListItem in
                let item = CPListItem(text: station.title, detailText: nil)
                item.handler = { [weak self] _, completion in
                    Task { @MainActor in
                        self?.play(station: station)
                        completion()
                    }
                }
                return item
            }
            stationSections.append(CPListSection(items: items, header: category.rawValue, sectionIndexTitle: nil))
        }
        let stationsTemplate = CPListTemplate(title: "Stations", sections: stationSections)
        stationsTemplate.tabTitle = "Stations"
        stationsTemplate.tabImage = UIImage(systemName: "dot.radiowaves.left.and.right")

        // 3. Now Playing tab
        let nowPlayingTemplate = CPNowPlayingTemplate.shared
        nowPlayingTemplate.tabTitle = "Now Playing"
        nowPlayingTemplate.tabImage = UIImage(systemName: "play.circle.fill")
        updateNowPlayingButtons()

        let root = CPTabBarTemplate(templates: [favTemplate, stationsTemplate, nowPlayingTemplate])
        interfaceController.setRootTemplate(root, animated: true) { _, _ in }
    }

    func play(station: CarPlayStation) {
        currentStation = station

        do {
            try AVAudioSession.sharedInstance().setCategory(
                .playback,
                mode: .default,
                options: [.allowBluetooth, .allowBluetoothA2DP, .allowAirPlay]
            )
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            NSLog("[CarPlayManager] Failed to activate audio session: \(error)")
        }

        player?.pause()
        let playerItem = AVPlayerItem(url: station.streamURL)
        let newPlayer = AVPlayer(playerItem: playerItem)
        self.player = newPlayer

        isPlayingObservation = newPlayer.observe(\.timeControlStatus, options: [.new]) { [weak self] p, _ in
            Task { @MainActor in
                self?.updateNowPlayingInfo(isPlaying: p.timeControlStatus == .playing)
            }
        }

        newPlayer.play()
        updateNowPlayingInfo(isPlaying: true)
        updateNowPlayingButtons()

        // Push Now Playing template so user sees the station screen immediately
        interfaceController?.pushTemplate(CPNowPlayingTemplate.shared, animated: true) { _, _ in }

        // Asynchronously load artwork
        loadArtwork(for: station)
    }

    private func updateNowPlayingInfo(isPlaying: Bool) {
        guard let station = currentStation else { return }

        var info: [String: Any] = [
            MPMediaItemPropertyTitle: station.title,
            MPMediaItemPropertyArtist: "BBC Radio",
            MPNowPlayingInfoPropertyIsLiveStream: true,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1.0 : 0.0
        ]

        if let logo = logoCache[station.id] {
            info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: logo.size) { _ in logo }
        }

        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func loadArtwork(for station: CarPlayStation) {
        if let cached = logoCache[station.id] {
            updateNowPlayingInfo(isPlaying: player?.timeControlStatus == .playing)
            return
        }

        guard let logoURL = station.logoURL else { return }
        Task {
            do {
                let (data, _) = try await URLSession.shared.data(from: logoURL)
                if let image = UIImage(data: data) {
                    await MainActor.run {
                        self.logoCache[station.id] = image
                        self.updateNowPlayingInfo(isPlaying: self.player?.timeControlStatus == .playing)
                    }
                }
            } catch {
                // Ignore artwork download failures
            }
        }
    }

    private func updateNowPlayingButtons() {
        guard let station = currentStation else {
            CPNowPlayingTemplate.shared.updateNowPlayingButtons([])
            return
        }

        let favStationIDs = UserDefaults.standard.stringArray(forKey: "favorite_station_ids") ?? []
        let isFav = favStationIDs.contains(station.id)
        let img = UIImage(systemName: isFav ? "star.fill" : "star") ?? UIImage()

        let favButton = CPNowPlayingImageButton(image: img) { [weak self] _ in
            Task { @MainActor in
                self?.toggleFavorite(stationId: station.id)
            }
        }

        CPNowPlayingTemplate.shared.updateNowPlayingButtons([favButton])
    }

    private func toggleFavorite(stationId: String) {
        var favs = UserDefaults.standard.stringArray(forKey: "favorite_station_ids") ?? []
        if let idx = favs.firstIndex(of: stationId) {
            favs.remove(at: idx)
        } else {
            favs.append(stationId)
        }
        UserDefaults.standard.set(favs, forKey: "favorite_station_ids")
        updateNowPlayingButtons()
        refreshTemplates()
    }
}
