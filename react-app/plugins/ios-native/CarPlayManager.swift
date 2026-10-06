import AVFoundation
import CarPlay
import MediaPlayer
import UIKit

/// Drives the CarPlay interface: the browse tree, playback, and the now-playing screen.
///
/// The structure mirrors the Android Auto media service: the same root nodes (Favourites,
/// All Stations, Podcasts, plus search), the same podcast collection screens, the same
/// status glyphs on episode rows, the same custom actions, and the same stream fallback
/// ladder. All data comes from the shared snapshot written by the React layer, and every
/// change made in the car is queued back for React to reconcile.
@MainActor
final class CarPlayManager: NSObject {
    static let shared = CarPlayManager()

    private enum Kind {
        case none
        case station(CarPlayStation)
        case episode(CarPlayEpisode, playlistId: String?)
    }

    private static let seekForwardSeconds: Double = 30
    private static let seekBackwardSeconds: Double = 10
    private static let resumeThresholdMs: Double = 5_000
    /// Keeps browse-row idents crisp without allocating full-size artwork per row.
    private static let rowImageSize: CGFloat = 60

    private weak var interfaceController: CPInterfaceController?
    private var player: AVPlayer?
    private var kind: Kind = .none
    private var candidates: [String] = []
    private var candidateIndex = 0
    private var retriedWithGeoFallback = false
    private var isConnected = false
    private var remoteCommandsConfigured = false
    private var observersInstalled = false

    private var imageCache: [String: UIImage] = [:]
    private lazy var showTitlePrefetchQueue: OperationQueue = {
        let queue = OperationQueue()
        queue.name = "com.bbcradioplayer.carplay.show-title-prefetch"
        queue.maxConcurrentOperationCount = 3
        queue.qualityOfService = .utility
        return queue
    }()
    private var showTitlePrefetching: Set<String> = []
    private var progressTimer: Timer?
    private var endObserver: NSObjectProtocol?
    private var statusObservation: NSKeyValueObservation?
    private var itemStatusObservation: NSKeyValueObservation?
    private var lastPersistedPositionMs: Double = 0
    private var lastTrackedSongSignature = ""
    private var lastTrackedEpisodeAnalyticsId = ""
    private var fetchingEpisodes: Set<String> = []
    private var lastPhonePlaybackFlag = false
    private var lastSearchQuery = ""
    /// The template the driver is currently looking at, tracked from the interface
    /// controller delegate so a refresh is only applied when it is safe to replace the
    /// root template without throwing the driver out of the list they are reading.
    private weak var visibleTemplate: CPTemplate?
    private weak var favouritesTemplate: CPListTemplate?
    private weak var stationsTemplate: CPListTemplate?

    private static let analyticsMinPlaySeconds: Double = 10.001
    private static let lastTrackedEpisodeAnalyticsKey = "last_tracked_analytics_episode_id"

    private var stationAnalyticsTask: Task<Void, Never>?
    private var stationAnalyticsPending = false
    private var stationAnalyticsScheduled = false
    private var pendingStationAnalytics: (id: String, name: String)?

    private var episodeAnalyticsTask: Task<Void, Never>?
    private var episodeAnalyticsPending = false
    private var episodeAnalyticsScheduled = false
    private var pendingEpisodeAnalytics: (podcastId: String, episodeId: String, episodeTitle: String, podcastTitle: String)?

    private override init() {
        super.init()
        lastTrackedEpisodeAnalyticsId = UserDefaults.standard.string(forKey: Self.lastTrackedEpisodeAnalyticsKey) ?? ""
    }

    private func cancelAnalyticsTimers() {
        stationAnalyticsTask?.cancel()
        stationAnalyticsTask = nil
        stationAnalyticsPending = false
        stationAnalyticsScheduled = false
        pendingStationAnalytics = nil

        episodeAnalyticsTask?.cancel()
        episodeAnalyticsTask = nil
        episodeAnalyticsPending = false
        episodeAnalyticsScheduled = false
        pendingEpisodeAnalytics = nil
    }

    private func onPlaybackStatusChanged(_ status: AVPlayer.TimeControlStatus) {
        if status == .playing {
            if stationAnalyticsPending && !stationAnalyticsScheduled, let pending = pendingStationAnalytics {
                stationAnalyticsScheduled = true
                stationAnalyticsTask = Task { [weak self] in
                    try? await Task.sleep(nanoseconds: 10_001_000_000)
                    guard !Task.isCancelled else { return }
                    await MainActor.run {
                        guard let self = self else { return }
                        guard self.player?.timeControlStatus == .playing else { return }
                        if case .station(let currentStation) = self.kind, currentStation.id == pending.id {
                            self.stationAnalyticsPending = false
                            self.stationAnalyticsScheduled = false
                            self.pendingStationAnalytics = nil
                            CarPlayAnalytics.trackStationPlay(stationId: pending.id, stationName: pending.name)
                        }
                    }
                }
            }

            if episodeAnalyticsPending && !episodeAnalyticsScheduled, let pending = pendingEpisodeAnalytics {
                episodeAnalyticsScheduled = true
                episodeAnalyticsTask = Task { [weak self] in
                    try? await Task.sleep(nanoseconds: 10_001_000_000)
                    guard !Task.isCancelled else { return }
                    await MainActor.run {
                        guard let self = self else { return }
                        guard self.player?.timeControlStatus == .playing else { return }
                        if case .episode(let currentEpisode, _) = self.kind, currentEpisode.id == pending.episodeId {
                            self.episodeAnalyticsPending = false
                            self.episodeAnalyticsScheduled = false
                            self.pendingEpisodeAnalytics = nil
                            self.lastTrackedEpisodeAnalyticsId = pending.episodeId
                            UserDefaults.standard.set(pending.episodeId, forKey: Self.lastTrackedEpisodeAnalyticsKey)
                            CarPlayAnalytics.trackEpisodePlay(
                                podcastId: pending.podcastId,
                                episodeId: pending.episodeId,
                                episodeTitle: pending.episodeTitle,
                                podcastTitle: pending.podcastTitle
                            )
                        }
                    }
                }
            }
        } else {
            if stationAnalyticsScheduled {
                stationAnalyticsTask?.cancel()
                stationAnalyticsTask = nil
                stationAnalyticsScheduled = false
            }
            if episodeAnalyticsScheduled {
                episodeAnalyticsTask?.cancel()
                episodeAnalyticsTask = nil
                episodeAnalyticsScheduled = false
            }
        }
    }

    // MARK: - Scene lifecycle

    func connect(interfaceController: CPInterfaceController) {
        if isConnected && self.interfaceController === interfaceController { return }
        self.interfaceController = interfaceController
        isConnected = true

        if !observersInstalled {
            observersInstalled = true
            NotificationCenter.default.addObserver(
                self,
                selector: #selector(handleUserDefaultsChange),
                name: UserDefaults.didChangeNotification,
                object: nil
            )
            NotificationCenter.default.addObserver(
                self,
                selector: #selector(handleStateChanged),
                name: CarPlayState.didChangeNotification,
                object: nil
            )
        }

        interfaceController.delegate = self
        configureRemoteCommands()
        buildAndSetRootTemplate(animated: false)
        resumeOnConnectIfNeeded()
        prefetchStationShowTitles()
    }

    func disconnect() {
        stopPlayback()
        removeEndObserver()
        statusObservation = nil
        progressTimer?.invalidate()
        progressTimer = nil
        interfaceController = nil
        isConnected = false
    }

    /// The React layer writes a revision counter in `NSUserDefaults` after replacing the
    /// snapshot file. The notification is only a hint, so the revision decides.
    @objc private func handleUserDefaultsChange() {
        if CarPlayState.shared.reloadIfStale() {
            refreshTemplates()
            updateNowPlayingInfo()
        }
        let phoneActive = UserDefaults.standard.bool(forKey: CarPlayManager.phonePlaybackKey)
        if phoneActive != lastPhonePlaybackFlag {
            lastPhonePlaybackFlag = phoneActive
            if phoneActive { onPhonePlaybackStarted() }
        }
    }

    @objc private func handleStateChanged() {
        refreshTemplates()
        updateNowPlayingButtons()
        updateNowPlayingInfo()
    }

    static let phonePlaybackKey = "carplay_phone_playback_active"

    // MARK: - Remote commands

    private func configureRemoteCommands() {
        guard !remoteCommandsConfigured else { return }
        remoteCommandsConfigured = true
        let center = MPRemoteCommandCenter.shared()

        center.playCommand.isEnabled = true
        center.playCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                guard let self, let player = self.player else { return }
                player.play()
                self.updateNowPlayingInfo()
            }
            return .success
        }

        center.pauseCommand.isEnabled = true
        center.pauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                guard let self, let player = self.player else { return }
                player.pause()
                self.persistProgress()
                self.updateNowPlayingInfo()
            }
            return .success
        }

        center.togglePlayPauseCommand.isEnabled = true
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                guard let self, let player = self.player else { return }
                if player.timeControlStatus == .playing {
                    player.pause()
                    self.persistProgress()
                } else {
                    player.play()
                }
                self.updateNowPlayingInfo()
            }
            return .success
        }

        center.stopCommand.isEnabled = true
        center.stopCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.stopPlayback() }
            return .success
        }

        center.nextTrackCommand.isEnabled = true
        center.nextTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.skipToNext() }
            return .success
        }

        center.previousTrackCommand.isEnabled = true
        center.previousTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.skipToPrevious() }
            return .success
        }

        center.skipForwardCommand.isEnabled = true
        center.skipForwardCommand.preferredIntervals = [NSNumber(value: Self.seekForwardSeconds)]
        center.skipForwardCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                guard let self, self.isEpisodePlaying else { return }
                self.seekBy(Self.seekForwardSeconds)
            }
            return .success
        }

        center.skipBackwardCommand.isEnabled = true
        center.skipBackwardCommand.preferredIntervals = [NSNumber(value: Self.seekBackwardSeconds)]
        center.skipBackwardCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                guard let self, self.isEpisodePlaying else { return }
                self.seekBy(-Self.seekBackwardSeconds)
            }
            return .success
        }

        center.changePlaybackPositionCommand.isEnabled = true
        center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let positionEvent = event as? MPChangePlaybackPositionCommandEvent else {
                return .commandFailed
            }
            Task { @MainActor in
                guard let self, self.isEpisodePlaying else { return }
                self.player?.seek(
                    to: CMTime(
                        seconds: positionEvent.positionTime, preferredTimescale: 600))
                self.updateNowPlayingInfo()
            }
            return .success
        }
    }

    // MARK: - Template tree

    private func buildAndSetRootTemplate(animated: Bool) {
        guard let interfaceController = interfaceController else { return }
        let favourites = makeFavouritesTemplate()
        let stations = makeStationsTemplate()
        let podcasts = makePodcastsRootTemplate()

        let root = CPTabBarTemplate(templates: [
            favourites,
            stations,
            podcasts
        ])

        if #available(iOS 17.0, *) {
            let startup = CarPlayState.shared.snapshot.startupPage
            if startup == "all_stations" {
                root.selectTemplate(at: 1)
            } else if startup == "podcasts" {
                root.selectTemplate(at: 2)
            } else {
                root.selectTemplate(at: 0)
            }
        }

        interfaceController.setRootTemplate(root, animated: animated) { [weak self] _, _ in
            Task { @MainActor in
                self?.updateNowPlayingButtons()
            }
        }
    }

    /// Rebuilds the tab bar so new data is picked up. Skipped while a drill-down list is
    /// on screen, because replacing the root template would discard the driver's place.
    private func refreshTemplates() {
        if visibleTemplate == nil || visibleTemplate is CPTabBarTemplate {
            buildAndSetRootTemplate(animated: true)
        } else {
            refreshStationBrowseTemplates()
        }
    }

    private func refreshStationBrowseTemplates() {
        favouritesTemplate?.updateSections(makeFavouritesSections())
        stationsTemplate?.updateSections(makeStationSections())
    }

    private func push(_ template: CPTemplate) {
        interfaceController?.pushTemplate(template, animated: true, completion: nil)
    }

    private func makeSearchButton() -> CPBarButton {
        CPBarButton(image: UIImage(systemName: "magnifyingglass") ?? UIImage()) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.push(self.makeSearchTemplate())
            }
        }
    }

    // MARK: Favourites

    private func makeFavouritesTemplate() -> CPListTemplate {
        let template = CPListTemplate(
            title: "Favourites", sections: makeFavouritesSections())
        template.tabTitle = "Favourites"
        template.tabImage = UIImage(systemName: "star.fill")
        template.trailingNavigationBarButtons = [makeSearchButton()]
        favouritesTemplate = template
        return template
    }

    private func makeFavouritesSections() -> [CPListSection] {
        let stations = CarPlayState.shared.favorites.compactMap {
            CarPlayStationRepository.station(id: $0)
        }

        let items: [CPListItem]
        if stations.isEmpty {
            let empty = CPListItem(
                text: "No favourite stations yet",
                detailText: "Star a station while it is playing, or add favourites on your iPhone"
            )
            empty.isEnabled = false
            items = [empty]
        } else {
            items = stations.map { station in
                let showTitle = CarPlayShowInfo.shared.cachedShowTitle(serviceId: station.serviceId)
                let item = CPListItem(
                    text: station.title,
                    detailText: showTitle.isEmpty ? nil : showTitle,
                    image: CarPlayArtwork.image(for: station.id, size: Self.rowImageSize)
                )
                item.handler = { [weak self] _, completion in
                    Task { @MainActor in
                        guard let self else { completion(); return }
                        self.play(station: station)
                        completion()
                    }
                }
                return item
            }
        }

        return [CPListSection(items: items)]
    }

    // MARK: Stations

    private func makeStationsTemplate() -> CPListTemplate {
        let template = CPListTemplate(title: "All Stations", sections: makeStationSections())
        template.tabTitle = "All Stations"
        template.tabImage = UIImage(systemName: "dot.radiowaves.left.and.right")
        template.trailingNavigationBarButtons = [makeSearchButton()]
        stationsTemplate = template
        return template
    }

    private func makeStationSections() -> [CPListSection] {
        let sections =
            CarPlayStationCategory.allCases
            .compactMap { category -> CPListSection? in
                let stations = CarPlayStationRepository.stations(for: category)
                guard !stations.isEmpty else { return nil }
                let items = stations.map { station -> CPListItem in
                    let showTitle = CarPlayShowInfo.shared.cachedShowTitle(serviceId: station.serviceId)
                    let item = CPListItem(
                        text: station.title,
                        detailText: showTitle.isEmpty ? nil : showTitle,
                        image: CarPlayArtwork.image(for: station.id, size: Self.rowImageSize)
                    )
                    item.handler = { [weak self] _, completion in
                        Task { @MainActor in
                            guard let self else { completion(); return }
                            self.play(station: station)
                            completion()
                        }
                    }
                    return item
                }
                return CPListSection(
                    items: items, header: category.rawValue, sectionIndexTitle: nil)
            }

        let sectionsToUse: [CPListSection]
        if sections.isEmpty {
            let empty = CPListItem(
                text: "No stations available",
                detailText: "Open British Radio Player on your iPhone to load stations"
            )
            empty.isEnabled = false
            sectionsToUse = [CPListSection(items: [empty])]
        } else {
            sectionsToUse = sections
        }

        return sectionsToUse
    }

    // MARK: Podcasts

    private func makePodcastsRootTemplate() -> CPListTemplate {
        var items: [CPListItem] = []

        func addDrillDown(
            title: String, makeTemplate: @escaping @MainActor () -> CPTemplate
        ) {
            let item = CPListItem(text: title, detailText: nil)
            item.accessoryType = .disclosureIndicator
            item.handler = { [weak self] _, completion in
                Task { @MainActor in
                    guard let self else { completion(); return }
                    self.push(makeTemplate())
                    completion()
                }
            }
            items.append(item)
        }

        addDrillDown(title: "Subscribed Podcasts") { [weak self] in
            self?.makeSubscribedTemplate() ?? CPListTemplate(title: "Subscribed", sections: [])
        }
        addDrillDown(title: "Browse by Tag") { [weak self] in
            self?.makeTagsTemplate() ?? CPListTemplate(title: "Browse by Tag", sections: [])
        }
        addDrillDown(title: "Playlists") { [weak self] in
            self?.makePlaylistsTemplate() ?? CPListTemplate(title: "Playlists", sections: [])
        }
        addDrillDown(title: "History") { [weak self] in
            self?.makeHistoryTemplate() ?? CPListTemplate(title: "History", sections: [])
        }
        addDrillDown(title: "Downloaded Episodes") { [weak self] in
            self?.makeDownloadedTemplate() ?? CPListTemplate(title: "Downloaded", sections: [])
        }

        let random = CPListItem(text: "Random Podcast Episode", detailText: nil)
        random.handler = { [weak self] _, completion in
            Task { @MainActor in
                guard let self else { completion(); return }
                self.playRandomPodcast()
                completion()
            }
        }
        items.append(random)

        let template = CPListTemplate(title: "Podcasts", sections: [CPListSection(items: items)])
        template.tabTitle = "Podcasts"
        template.tabImage = UIImage(systemName: "antenna.radiowaves.left.and.right")
        template.trailingNavigationBarButtons = [makeSearchButton()]
        return template
    }

    private func makeSubscribedTemplate() -> CPListTemplate {
        let subscriptions = sortedSubscriptions(subscribedPodcasts())
        let items: [CPListItem]
        if subscriptions.isEmpty {
            let empty = CPListItem(
                text: "No subscribed podcasts",
                detailText: "Subscribe to podcasts on your iPhone"
            )
            empty.isEnabled = false
            items = [empty]
        } else {
            items = subscriptions.map { podcastItem($0) }
        }
        return CPListTemplate(title: "Subscribed", sections: [CPListSection(items: items)])
    }

    private func makeTagsTemplate() -> CPListTemplate {
        let state = CarPlayState.shared
        let subscriptions = subscribedPodcasts()
        let tagMap = state.snapshot.podcastTags
        let tags =
            Set(subscriptions.flatMap { tagMap[$0.id] ?? [] }.filter { !$0.isEmpty }).sorted()

        let items: [CPListItem]
        if tags.isEmpty {
            let empty = CPListItem(
                text: "No tagged podcasts",
                detailText: "Add tags to podcasts on your iPhone"
            )
            empty.isEnabled = false
            items = [empty]
        } else {
            items = tags.map { tag -> CPListItem in
                let tagged = sortedSubscriptions(
                    subscriptions.filter { tagMap[$0.id]?.contains(tag) == true })
                let item = CPListItem(
                    text: tag, detailText: tagged.prefix(3).map { $0.title }.joined(separator: ", "))
                item.accessoryType = .disclosureIndicator
                item.handler = { [weak self] _, completion in
                    Task { @MainActor in
                        guard let self else { completion(); return }
                        let items = tagged.map { self.podcastItem($0) }
                        self.push(CPListTemplate(title: tag, sections: [CPListSection(items: items)]))
                        completion()
                    }
                }
                return item
            }
        }

        return CPListTemplate(title: "Browse by Tag", sections: [CPListSection(items: items)])
    }

    private func makePlaylistsTemplate() -> CPListTemplate {
        let playlists = CarPlayState.shared.playlists
        let items: [CPListItem]
        if playlists.isEmpty {
            let empty = CPListItem(
                text: "No playlists yet",
                detailText: "Create playlists on your iPhone"
            )
            empty.isEnabled = false
            items = [empty]
        } else {
            items = playlists.map { playlist -> CPListItem in
                let count = playlist.entries.count
                let item = CPListItem(
                    text: playlist.name, detailText: count == 1 ? "1 episode" : "\(count) episodes")
                item.accessoryType = .disclosureIndicator
                item.handler = { [weak self] _, completion in
                    Task { @MainActor in
                        guard let self else { completion(); return }
                        self.push(self.makePlaylistEntriesTemplate(playlist: playlist))
                        completion()
                    }
                }
                return item
            }
        }
        return CPListTemplate(title: "Playlists", sections: [CPListSection(items: items)])
    }

    private func makePlaylistEntriesTemplate(playlist: CarPlayPlaylist) -> CPListTemplate {
        let state = CarPlayState.shared
        var entries = state.playlistEntries(playlistId: playlist.id)
        if hidesPlayedEpisodes() {
            entries.removeAll { state.isPlayed(episodeId: $0.id) }
        }
        let downloads = Set(state.downloads.map { $0.id })
        let items: [CPListItem]
        if entries.isEmpty {
            let empty = CPListItem(
                text: "Playlist is empty",
                detailText: "Add episodes to this playlist on your iPhone"
            )
            empty.isEnabled = false
            items = [empty]
        } else {
            items = entries.map {
                episodeItem($0, playlistId: playlist.id, downloaded: downloads.contains($0.id))
            }
        }
        return CPListTemplate(title: playlist.name, sections: [CPListSection(items: items)])
    }

    private func makeHistoryTemplate() -> CPListTemplate {
        let downloads = Set(CarPlayState.shared.downloads.map { $0.id })
        let history = CarPlayState.shared.history
        let items: [CPListItem]
        if history.isEmpty {
            let empty = CPListItem(
                text: "No history yet",
                detailText: "Episodes you play will appear here"
            )
            empty.isEnabled = false
            items = [empty]
        } else {
            items = history.map {
                episodeItem($0, playlistId: nil, downloaded: downloads.contains($0.id))
            }
        }
        return CPListTemplate(title: "History", sections: [CPListSection(items: items)])
    }

    private func makeDownloadedTemplate() -> CPListTemplate {
        let downloads = CarPlayState.shared.downloads
        let items: [CPListItem]
        if downloads.isEmpty {
            let empty = CPListItem(
                text: "No downloaded episodes",
                detailText: "Download episodes on your iPhone for offline listening"
            )
            empty.isEnabled = false
            items = [empty]
        } else {
            items = downloads.map {
                episodeItem($0, playlistId: nil, downloaded: true)
            }
        }
        return CPListTemplate(title: "Downloaded", sections: [CPListSection(items: items)])
    }

    private func makePodcastEpisodesTemplate(podcastId: String) -> CPListTemplate {
        let state = CarPlayState.shared
        let title = state.findPodcast(podcastId: podcastId)?.title ?? podcastId
        var episodes = state.episodes(podcastId: podcastId)
        if state.settingBool("carplayHidePlayed") {
            episodes.removeAll { state.isPlayed(episodeId: $0.id) }
        }
        if episodes.isEmpty {
            fetchEpisodesInBackground(podcastId: podcastId)
        }
        let downloads = Set(state.downloads.map { $0.id })
        let items: [CPListItem]
        if episodes.isEmpty {
            let empty = CPListItem(
                text: "Loading episodes...",
                detailText: "Episodes will appear shortly"
            )
            empty.isEnabled = false
            items = [empty]
        } else {
            items = episodes.map {
                episodeItem($0, playlistId: nil, downloaded: downloads.contains($0.id))
            }
        }
        return CPListTemplate(title: title, sections: [CPListSection(items: items)])
    }

    private func podcastItem(_ podcast: CarPlayPodcast) -> CPListItem {
        let isNew = podcast.latestUpdateMs > CarPlayState.shared.lastPlayedEpoch(podcastId: podcast.id)
        let item = CPListItem(text: podcast.title, detailText: isNew ? "New" : nil)
        item.accessoryType = .disclosureIndicator
        item.handler = { [weak self] _, completion in
            Task { @MainActor in
                guard let self else { completion(); return }
                self.push(self.makePodcastEpisodesTemplate(podcastId: podcast.id))
                completion()
            }
        }
        return item
    }

    private func episodeItem(
        _ episode: CarPlayEpisode, playlistId: String?, downloaded: Bool
    ) -> CPListItem {
        let item = CPListItem(
            text: episode.title,
            detailText: Self.episodeSubtitle(episode, downloaded: downloaded)
        )
        item.handler = { [weak self] _, completion in
            Task { @MainActor in
                guard let self else { completion(); return }
                self.play(episode: episode, playlistId: playlistId)
                completion()
            }
        }
        return item
    }

    /// Mirrors the Android `episodeSubtitle`: a played / in-progress / new glyph, a
    /// download marker, the publication date and the podcast the episode belongs to.
    private static func episodeSubtitle(_ episode: CarPlayEpisode, downloaded: Bool) -> String {
        let played = CarPlayState.shared.isPlayed(episodeId: episode.id)
        let inProgress = !played && CarPlayState.shared.progress(episodeId: episode.id) > 0
        let date = CarPlayRss.formatDate(episode.pubDate)

        var markers: [String] = [played ? "\u{2705}" : (inProgress ? "~" : "\u{25CF}")]
        if downloaded { markers.append("\u{2B07}") }

        var line = markers.joined(separator: " ") + " " + date
        if !episode.podcastTitle.isEmpty {
            let separator = date.isEmpty ? "" : " \u{2022} "
            line += separator + episode.podcastTitle
        }
        return line.trimmingCharacters(in: .whitespaces)
    }

    // MARK: Search

    private func makeSearchTemplate() -> CPSearchTemplate {
        let template = CPSearchTemplate()
        template.delegate = self
        return template
    }

    private func searchResults(for query: String) -> [CPListItem] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        lastSearchQuery = query
        guard !trimmed.isEmpty else { return [] }
        let terms = trimmed.lowercased().split(separator: " ").map(String.init)

        var items = CarPlayStationRepository.all
            .map { (station: $0, score: Self.matchScore($0.title, terms)) }
            .filter { $0.score > 0 }
            .sorted { $0.score > $1.score }
            .prefix(12)
            .map { entry -> CPListItem in
                let item = CPListItem(
                    text: entry.station.title,
                    detailText: entry.station.category.rawValue,
                    image: CarPlayArtwork.image(for: entry.station.id, size: Self.rowImageSize)
                )
                item.handler = { [weak self] _, completion in
                    Task { @MainActor in
                        guard let self else { completion(); return }
                        self.play(station: entry.station)
                        completion()
                    }
                }
                return item
            }

        items += CarPlayState.shared.subscriptions
            .map {
                (
                    podcast: $0,
                    score: max(
                        Self.matchScore($0.title, terms), Self.matchScore($0.description, terms) - 1)
                )
            }
            .filter { $0.score > 0 }
            .sorted { $0.score > $1.score }
            .prefix(12)
            .map { podcastItem($0.podcast) }

        return items
    }

    private func pushSearchResults(_ items: [CPListItem]) {
        let template = CPListTemplate(title: "Search", sections: [CPListSection(items: items)])
        push(template)
    }

    private static func matchScore(_ text: String, _ terms: [String]) -> Int {
        guard !text.isEmpty else { return 0 }
        let haystack = text.lowercased()
        return terms.filter { haystack.contains($0) }.count
    }

    // MARK: - Playback

    private var isIdle: Bool {
        if case .none = kind { return true }
        return false
    }

    private var isEpisodePlaying: Bool {
        if case .episode = kind { return true }
        return false
    }

    private var currentStationId: String? {
        if case .station(let station) = kind { return station.id }
        return nil
    }

    private var currentEpisode: CarPlayEpisode? {
        if case .episode(let episode, _) = kind { return episode }
        return nil
    }

    private var currentPlaylistId: String? {
        if case .episode(_, let playlistId) = kind { return playlistId }
        return nil
    }

    private func activateAudioSession() {
        do {
            try AVAudioSession.sharedInstance().setCategory(
                .playback,
                mode: .default,
                options: [.allowBluetoothHFP, .allowBluetoothA2DP, .allowAirPlay]
            )
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            NSLog("[CarPlayManager] Failed to activate audio session: \(error)")
        }
    }

    private func play(station: CarPlayStation) {
        activateAudioSession()
        kind = .station(station)
        retriedWithGeoFallback = false
        candidates = station.streamCandidates(
            geoBlocked: CarPlayState.shared.settingBool("geoBlocked"))
        candidateIndex = 0

        cancelAnalyticsTimers()
        stationAnalyticsPending = true
        stationAnalyticsScheduled = false
        pendingStationAnalytics = (id: station.id, name: station.title)

        guard !candidates.isEmpty, startCandidate() else {
            stopPlayback()
            return
        }

        CarPlayState.shared.addMutation(
            type: "playbackStarted",
            payload: [
                "kind": "station",
                "id": station.id,
                "title": station.title,
                "subtitle": "BBC Radio",
                "imageUrl": station.logoUrl
            ]
        )
        CarPlayState.shared.setLastPlayed(kind: "station", id: station.id)
    }

    private func play(episode: CarPlayEpisode, playlistId: String? = nil) {
        guard let url = resolveAudioURL(episode) else {
            NSLog("[CarPlayManager] Episode has no playable audio: \(episode.id)")
            return
        }

        activateAudioSession()
        kind = .episode(episode, playlistId: playlistId)
        retriedWithGeoFallback = false
        candidates = [url.absoluteString]
        candidateIndex = 0

        cancelAnalyticsTimers()
        let state = CarPlayState.shared
        let podcastId = episode.podcastId
        let podcastTitle =
            episode.podcastTitle.isEmpty
            ? (state.findPodcast(podcastId: podcastId)?.title ?? podcastId)
            : episode.podcastTitle

        let savedProgressMs = state.progress(episodeId: episode.id)
        let isResume = savedProgressMs > Self.resumeThresholdMs && !state.isPlayed(episodeId: episode.id)
        if !isResume && lastTrackedEpisodeAnalyticsId == episode.id {
            lastTrackedEpisodeAnalyticsId = ""
            UserDefaults.standard.removeObject(forKey: Self.lastTrackedEpisodeAnalyticsKey)
        }

        if lastTrackedEpisodeAnalyticsId != episode.id {
            episodeAnalyticsPending = true
            episodeAnalyticsScheduled = false
            pendingEpisodeAnalytics = (
                podcastId: podcastId,
                episodeId: episode.id,
                episodeTitle: episode.title,
                podcastTitle: podcastTitle
            )
        }

        guard startCandidate() else {
            stopPlayback()
            return
        }

        var imageUrl = episode.imageUrl
        if imageUrl.isEmpty { imageUrl = state.findEpisode(episodeId: episode.id)?.imageUrl ?? "" }
        if imageUrl.isEmpty { imageUrl = state.findPodcast(podcastId: podcastId)?.imageUrl ?? "" }

        var historyEntry = episode
        historyEntry.imageUrl = imageUrl
        historyEntry.podcastTitle = podcastTitle
        state.addHistory(historyEntry)
        state.setLastPlayed(kind: "episode", id: episode.id, podcastId: podcastId)

        CarPlayState.shared.addMutation(
            type: "playbackStarted",
            payload: [
                "kind": "episode",
                "id": episode.id,
                "podcastId": podcastId,
                "title": episode.title,
                "subtitle": podcastTitle.isEmpty ? podcastId : podcastTitle,
                "imageUrl": imageUrl,
                "description": episode.description,
                "audioUrl": episode.audioUrl,
                "pubDate": episode.pubDate,
                "durationMins": episode.durationMins
            ]
        )
    }

    /// Prefers a downloaded file so "Downloaded Episodes" works without a connection.
    private func resolveAudioURL(_ episode: CarPlayEpisode) -> URL? {
        if let localPath = episode.localFilePath, !localPath.isEmpty {
            let candidate =
                localPath.hasPrefix("file://")
                ? URL(string: localPath) ?? URL(fileURLWithPath: localPath)
                : URL(fileURLWithPath: localPath)
            if FileManager.default.isReadableFile(atPath: candidate.path) { return candidate }
        }
        guard !episode.audioUrl.isEmpty, let url = URL(string: episode.audioUrl) else { return nil }
        return url
    }

    @discardableResult
    private func startCandidate() -> Bool {
        guard candidates.indices.contains(candidateIndex) else { return false }
        let raw = candidates[candidateIndex]
        let url =
            raw.hasPrefix("/") || raw.hasPrefix("file://")
            ? (URL(string: raw) ?? URL(fileURLWithPath: raw)) : URL(string: raw)
        guard let url = url else { return false }

        removeEndObserver()
        statusObservation = nil
        player?.pause()

        let item = AVPlayerItem(url: url)
        let newPlayer = AVPlayer(playerItem: item)
        newPlayer.actionAtItemEnd = .pause
        player = newPlayer
        lastPersistedPositionMs = 0

        observe(newPlayer, item: item)
        newPlayer.play()
        onPlaybackStatusChanged(newPlayer.timeControlStatus)

        if case .episode(let episode, _) = kind {
            let resumeMs = CarPlayState.shared.progress(episodeId: episode.id)
            if resumeMs > Self.resumeThresholdMs {
                newPlayer.seek(to: CMTime(value: Int64(resumeMs), timescale: 1000))
            }
        }
        if case .station(let station) = kind {
            refreshShowInfoInBackground(for: station, skipDelay: true)
        }

        startProgressTimer()
        updateNowPlayingInfo()
        updateNowPlayingButtons()
        return true
    }

    private func observe(_ player: AVPlayer, item: AVPlayerItem) {
        statusObservation = player.observe(\.timeControlStatus, options: [.new]) {
            [weak self] player, _ in
            let status = player.timeControlStatus
            Task { @MainActor in
                self?.onPlaybackStatusChanged(status)
                self?.updateNowPlayingInfo()
            }
        }

        itemStatusObservation = item.observe(\.status, options: [.new]) { [weak self] item, _ in
            guard item.status == .failed else { return }
            Task { @MainActor in self?.onCandidateFailed() }
        }

        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.onPlaybackEnded() }
        }
    }

    private func removeEndObserver() {
        if let endObserver = endObserver {
            NotificationCenter.default.removeObserver(endObserver)
            self.endObserver = nil
        }
        itemStatusObservation = nil
    }

    /// A stream that will not start falls through to the next candidate, and a station
    /// that fails outright retries once against the international BBC HLS endpoints.
    private func onCandidateFailed() {
        if tryNextCandidate() { return }
        if case .station(let station) = kind, !retriedWithGeoFallback {
            retriedWithGeoFallback = true
            candidates = station.streamCandidates(geoBlocked: true)
            candidateIndex = 0
            if !candidates.isEmpty, startCandidate() { return }
        }
        CarPlayState.shared.addMutation(type: "playbackError", payload: [:])
        stopPlayback()
    }

    private func tryNextCandidate() -> Bool {
        guard candidateIndex + 1 < candidates.count else { return false }
        candidateIndex += 1
        return startCandidate()
    }

    private func stopPlayback() {
        guard !isIdle else { return }
        cancelAnalyticsTimers()
        persistProgress()
        kind = .none
        candidates = []
        candidateIndex = 0
        retriedWithGeoFallback = false
        lastTrackedSongSignature = ""
        progressTimer?.invalidate()
        progressTimer = nil
        removeEndObserver()
        statusObservation = nil
        player?.pause()
        player?.replaceCurrentItem(with: nil)
        player = nil
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        updateNowPlayingButtons()
        CarPlayState.shared.addMutation(type: "playbackStopped", payload: [:])
    }

    /// Called when the phone app starts playing, so the car yields.
    func onPhonePlaybackStarted() {
        guard player?.timeControlStatus == .playing else { return }
        player?.pause()
        persistProgress()
        updateNowPlayingInfo()
    }

    private func seekBy(_ seconds: Double) {
        guard isEpisodePlaying, let player = player else { return }
        let target = player.currentTime().seconds + seconds
        player.seek(to: CMTime(seconds: max(target, 0), preferredTimescale: 600))
        updateNowPlayingInfo()
    }

    private func onPlaybackEnded() {
        if case .episode(let episode, _) = kind {
            CarPlayState.shared.markPlayed(
                episodeId: episode.id,
                podcastId: episode.podcastId.isEmpty ? nil : episode.podcastId,
                pubDateEpochMs: episode.pubDateEpochMs > 0 ? episode.pubDateEpochMs : nil
            )
            if hidesPlayedEpisodes() { refreshTemplates() }
            // When autoplay starts the next episode it takes over the player, so the
            // progress timer and now-playing state below must not be torn down.
            if maybeAutoplayNextEpisode() { return }
        }
        cancelAnalyticsTimers()
        progressTimer?.invalidate()
        progressTimer = nil
        updateNowPlayingInfo()
        updateNowPlayingButtons()
    }

    private func maybeAutoplayNextEpisode() -> Bool {
        let autoplayNext = CarPlayState.shared.settingString("autoplayNext", fallback: "none")
        guard autoplayNext != "none" else { return false }
        guard let next = nextEpisodeInContext() else { return false }
        if autoplayNext == "subscriptions",
            !CarPlayState.shared.isSubscribed(podcastId: next.podcastId) {
            return false
        }
        play(episode: next, playlistId: currentPlaylistId)
        return true
    }

    private func nextEpisodeInContext() -> CarPlayEpisode? {
        guard let current = currentEpisode else { return nil }
        let playlistId = currentPlaylistId
        let pool =
            playlistId != nil
            ? CarPlayState.shared.playlistEntries(playlistId: playlistId!)
            : CarPlayState.shared.episodes(podcastId: current.podcastId)
        guard let index = pool.firstIndex(where: { $0.id == current.id }) else { return nil }
        return pool[pool.index(after: index)...].first {
            !CarPlayState.shared.isPlayed(episodeId: $0.id)
        }
    }

    private func skipToNext() {
        switch kind {
        case .station:
            let list = stationNavigationList()
            guard !list.isEmpty else { return }
            let index = list.firstIndex { $0.id == currentStationId } ?? -1
            play(station: list[(index + 1) % list.count])
        case .episode:
            let pool = episodePool()
            guard !pool.isEmpty else { return }
            let index = pool.firstIndex { $0.id == currentEpisode?.id } ?? -1
            play(episode: pool[(index + 1) % pool.count], playlistId: currentPlaylistId)
        case .none:
            resumeLastSession()
        }
    }

    private func skipToPrevious() {
        switch kind {
        case .station:
            let list = stationNavigationList()
            guard !list.isEmpty else { return }
            let index = (list.firstIndex { $0.id == currentStationId } ?? 0) - 1
            play(station: list[(index + list.count) % list.count])
        case .episode:
            let pool = episodePool()
            guard !pool.isEmpty else { return }
            let index = pool.firstIndex { $0.id == currentEpisode?.id } ?? 0
            if index > 0 {
                play(episode: pool[index - 1], playlistId: currentPlaylistId)
            } else {
                player?.seek(to: .zero)
                updateNowPlayingInfo()
            }
        case .none:
            resumeLastSession()
        }
    }

    private func episodePool() -> [CarPlayEpisode] {
        if let playlistId = currentPlaylistId {
            return CarPlayState.shared.playlistEntries(playlistId: playlistId)
        }
        guard let episode = currentEpisode else { return [] }
        return CarPlayState.shared.episodes(podcastId: episode.podcastId)
    }

    /// Honours the "favourites only" scroll mode, like Android Auto.
    private func stationNavigationList() -> [CarPlayStation] {
        let all = CarPlayStationRepository.all
        guard CarPlayState.shared.settingString("scrollMode", fallback: "all") == "favourites"
        else { return all }
        let favorites = Set(CarPlayState.shared.favorites)
        return all.filter { favorites.contains($0.id) }
    }

    private func resumeLastSession() {
        if resumeLastPlayed() { return }
        let state = CarPlayState.shared
        let last = state.settingString("lastStationId")
        if !last.isEmpty, let station = CarPlayStationRepository.station(id: last) {
            play(station: station)
            return
        }
        let configured = state.settingString("carplayStation")
        if !configured.isEmpty, let station = CarPlayStationRepository.station(id: configured) {
            play(station: station)
            return
        }
        if let first = CarPlayStationRepository.all.first { play(station: first) }
    }

    /// Restarts whatever the listener last started: a podcast episode or a radio station.
    private func resumeLastPlayed() -> Bool {
        let state = CarPlayState.shared
        guard let lastPlayed = state.lastPlayedItem else { return false }
        if lastPlayed.isEpisode {
            guard let episode = state.findEpisode(episodeId: lastPlayed.id),
                isResumableEpisode(episode)
            else { return false }
            play(episode: episode)
            return true
        }
        guard let station = CarPlayStationRepository.station(id: lastPlayed.id) else { return false }
        play(station: station)
        return true
    }

    /// A finished episode is a poor resume target, so an episode that is already marked played,
    /// or whose saved position reaches the end, is skipped in favour of the fallback ladder.
    private func isResumableEpisode(_ episode: CarPlayEpisode) -> Bool {
        guard !episode.id.isEmpty else { return false }
        let state = CarPlayState.shared
        if state.isPlayed(episodeId: episode.id) { return false }
        let positionMs = state.progress(episodeId: episode.id)
        if positionMs <= 0 { return true }
        let durationMs = episode.durationMins * 60_000
        if durationMs <= 0 { return true }
        return positionMs < durationMs * 0.99
    }

    /// Restores the previous session when CarPlay connects, matching the
    /// "Automatically resume playback" setting.
    private func resumeOnConnectIfNeeded() {
        guard CarPlayState.shared.settingBool("carplayAutoResume", fallback: true) else { return }
        guard isIdle else { return }
        guard !CarPlayState.shared.settingBool("phonePlaybackActive") else { return }
        resumeLastSession()
    }

    // MARK: Progress

    private func startProgressTimer() {
        progressTimer?.invalidate()
        let timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
        timer.tolerance = 0.25
        RunLoop.main.add(timer, forMode: .common)
        progressTimer = timer
    }

    private var lastStationShowRefreshMs: Double = 0

    private func tick() {
        if case .station(let station) = kind {
            let now = Date().timeIntervalSince1970 * 1000
            if now - lastStationShowRefreshMs >= 5000 {
                lastStationShowRefreshMs = now
                refreshShowInfoInBackground(for: station, skipDelay: false)
            }
            return
        }
        guard let episode = currentEpisode, let player = player else { return }
        let positionMs = player.currentTime().seconds * 1000
        guard positionMs > 0 else { return }
        CarPlayState.shared.setProgress(episodeId: episode.id, positionMs: positionMs)
        updateNowPlayingInfo()
    }

    private func persistProgress() {
        guard let episode = currentEpisode, let player = player else { return }
        let positionMs = player.currentTime().seconds * 1000
        guard positionMs > 0, abs(positionMs - lastPersistedPositionMs) > 1000 else { return }
        lastPersistedPositionMs = positionMs
        CarPlayState.shared.setProgress(episodeId: episode.id, positionMs: positionMs)
        CarPlayState.shared.addMutation(
            type: "episodeProgress", payload: ["episodeId": episode.id, "positionMs": positionMs])
    }

    // MARK: Now playing

    private func updateNowPlayingInfo() {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = currentNowPlayingInfo()
    }

    private func currentNowPlayingInfo() -> [String: Any]? {
        let isPlaying = player?.timeControlStatus == .playing

        switch kind {
        case .station(let station):
            let showInfo = CarPlayShowInfo.shared.cachedShowInfo(serviceId: station.serviceId)
            let hasSong = !showInfo.track.isEmpty || !showInfo.artist.isEmpty

            let subtitle: String
            if hasSong {
                subtitle =
                    (!showInfo.artist.isEmpty && !showInfo.track.isEmpty)
                    ? "\(showInfo.artist) - \(showInfo.track)"
                    : (showInfo.track.isEmpty ? showInfo.artist : showInfo.track)
            } else {
                let show = showInfo.showTitle.isEmpty ? station.title : showInfo.showTitle
                subtitle =
                    !showInfo.showSubtitle.isEmpty
                    && showInfo.showSubtitle.caseInsensitiveCompare(show) != .orderedSame
                    ? "\(show) - \(showInfo.showSubtitle)" : show
            }

            var info: [String: Any] = [
                MPMediaItemPropertyTitle: station.title,
                MPMediaItemPropertyArtist: subtitle,
                MPMediaItemPropertyAlbumTitle: station.title,
                MPNowPlayingInfoPropertyIsLiveStream: true,
                MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1.0 : 0.0
            ]

            // Without song artwork the custom station ident is published and no asset URL
            // is set, so the official BBC station logo is never loaded.
            if hasSong, !showInfo.songArtworkUrl.isEmpty, !CarPlayShowInfo.isPlaceholderArtwork(showInfo.songArtworkUrl) {
                info[MPNowPlayingInfoPropertyAssetURL] = URL(
                    string: showInfo.songArtworkUrl.replacingOccurrences(of: "http://", with: "https://")
                )
                if let image = CarPlayShowInfo.shared.cachedArtwork(serviceId: station.serviceId) {
                    info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: image.size) {
                        _ in image
                    }
                }
            } else {
                let ident = CarPlayArtwork.image(for: station.id, size: 512)
                info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: ident.size) {
                    _ in ident
                }
            }
            return info

        case .episode(let episode, _):
            let state = CarPlayState.shared
            let podcastTitle =
                episode.podcastTitle.isEmpty
                ? (state.findPodcast(podcastId: episode.podcastId)?.title ?? episode.podcastId)
                : episode.podcastTitle
            let durationSeconds = episode.durationMins * 60
            var info: [String: Any] = [
                MPMediaItemPropertyTitle: episode.title,
                MPMediaItemPropertyArtist: podcastTitle,
                MPMediaItemPropertyAlbumTitle: podcastTitle,
                MPNowPlayingInfoPropertyIsLiveStream: false,
                MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1.0 : 0.0
            ]
            if durationSeconds > 0 {
                info[MPMediaItemPropertyPlaybackDuration] = durationSeconds
                info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = player?.currentTime().seconds ?? 0
            }
            let artworkUrl = Self.episodeArtwork(episode)
            if let url = URL(string: artworkUrl), let image = image(at: url) {
                info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
            }
            return info

        case .none:
            return nil
        }
    }

    /// Honours the podcast artwork preference: episode art or the parent podcast's art.
    private static func episodeArtwork(_ episode: CarPlayEpisode) -> String {
        if CarPlayState.shared.settingString("podcastArtwork", fallback: "episode") == "podcast" {
            return episode.podcastImageUrl.isEmpty ? episode.imageUrl : episode.podcastImageUrl
        }
        return episode.imageUrl.isEmpty ? episode.podcastImageUrl : episode.imageUrl
    }

    /// Loads remote artwork off the main thread and installs it once available.
    private func image(at url: URL) -> UIImage? {
        if let cached = imageCache[url.absoluteString] { return cached }
        DispatchQueue.global(qos: .utility).async { [weak self] in
            guard
                let data = try? Data(contentsOf: url, options: [.mappedIfSafe]),
                let image = UIImage(data: data)
            else { return }
            Task { @MainActor in
                guard let self else { return }
                self.imageCache[url.absoluteString] = image
                self.updateNowPlayingInfo()
            }
        }
        return nil
    }

    private func refreshShowInfoInBackground(for station: CarPlayStation, skipDelay: Bool = false) {
        guard !station.serviceId.isEmpty else { return }
        let stationId = station.id
        let stationName = station.title
        let logoUrl = station.logoUrl
        if skipDelay {
            CarPlayShowInfo.shared.resetDelay(serviceId: station.serviceId)
        }
        DispatchQueue.global(qos: .utility).async { [weak self] in
            let info = CarPlayShowInfo.shared.refresh(serviceId: station.serviceId, skipDelay: skipDelay)
            Task { @MainActor in
                guard let self, self.currentStationId == stationId else { return }
                self.updateNowPlayingInfo()
                self.refreshStationBrowseTemplates()

                let signature = "\(info.rawArtist)|\(info.rawTrack)"
                guard signature != self.lastTrackedSongSignature else { return }
                self.lastTrackedSongSignature = signature
                guard !info.rawTrack.isEmpty || !info.rawArtist.isEmpty else { return }
                CarPlayState.shared.addMutation(
                    type: "recentSongAdded",
                    payload: [
                        "artist": info.rawArtist,
                        "track": info.rawTrack,
                        "imageUrl": info.rawArtworkUrl.isEmpty ? logoUrl : info.rawArtworkUrl,
                        "stationId": stationId,
                        "stationName": stationName
                    ]
                )
            }
        }
    }

    /// Loads show titles for every station without waiting for playback to start.
    private func prefetchStationShowTitles() {
        var scheduledServiceIds = showTitlePrefetching
        let stations = CarPlayStationRepository.all.filter {
            !$0.serviceId.isEmpty && scheduledServiceIds.insert($0.serviceId).inserted
        }
        for station in stations {
            showTitlePrefetching.insert(station.serviceId)
            showTitlePrefetchQueue.addOperation { [weak self] in
                CarPlayShowInfo.shared.refresh(
                    serviceId: station.serviceId, includeSongInfo: false)
                DispatchQueue.main.async {
                    guard let self else { return }
                    self.showTitlePrefetching.remove(station.serviceId)
                    guard self.isConnected else { return }
                    self.refreshStationBrowseTemplates()
                }
            }
        }
    }

    // MARK: Now playing buttons

    private func updateNowPlayingButtons() {
        let center = MPRemoteCommandCenter.shared()
        center.nextTrackCommand.isEnabled = !isIdle
        center.previousTrackCommand.isEnabled = !isIdle
        center.skipForwardCommand.isEnabled = isEpisodePlaying
        center.skipBackwardCommand.isEnabled = isEpisodePlaying
        center.changePlaybackPositionCommand.isEnabled = isEpisodePlaying

        var buttons: [CPNowPlayingImageButton] = []

        switch kind {
        case .station(let station):
            let isFavorite = CarPlayState.shared.favorites.contains(station.id)
            let stationId = station.id
            if let image = UIImage(systemName: isFavorite ? "star.fill" : "star") {
                buttons.append(
                    CPNowPlayingImageButton(image: image) { [weak self] _ in
                        Task { @MainActor in
                            CarPlayState.shared.toggleFavorite(stationId: stationId)
                            self?.updateNowPlayingButtons()
                            self?.refreshTemplates()
                        }
                    }
                )
            }

        case .episode(let episode, _):
            let state = CarPlayState.shared
            let isSaved = state.isEpisodeSaved(episodeId: episode.id)
            if let image = UIImage(systemName: isSaved ? "bookmark.fill" : "bookmark") {
                buttons.append(
                    CPNowPlayingImageButton(image: image) { [weak self] _ in
                        Task { @MainActor in self?.toggleSaved(episode: episode) }
                    }
                )
            }
            let podcastId = episode.podcastId
            if !podcastId.isEmpty {
                let subscribed = state.isSubscribed(podcastId: podcastId)
                if let image = UIImage(systemName: subscribed ? "bell.fill" : "bell") {
                    buttons.append(
                        CPNowPlayingImageButton(image: image) { [weak self] _ in
                            Task { @MainActor in
                                CarPlayState.shared.setSubscribed(
                                    podcastId: podcastId, subscribed: !subscribed)
                                self?.updateNowPlayingButtons()
                                self?.refreshTemplates()
                            }
                        }
                    )
                }
            }

        case .none:
            break
        }

        if !isIdle, let image = UIImage(systemName: "stop.fill") {
            buttons.append(
                CPNowPlayingImageButton(image: image) { [weak self] _ in
                    Task { @MainActor in self?.stopPlayback() }
                }
            )
        }

        CPNowPlayingTemplate.shared.updateNowPlayingButtons(buttons)
    }

    private func toggleSaved(episode: CarPlayEpisode) {
        let state = CarPlayState.shared
        var entry = episode
        if entry.podcastTitle.isEmpty,
            let podcast = state.findPodcast(podcastId: entry.podcastId) {
            entry.podcastTitle = podcast.title
            if entry.podcastImageUrl.isEmpty { entry.podcastImageUrl = podcast.imageUrl }
        }
        state.setEpisodeSaved(entry, saved: !state.isEpisodeSaved(episodeId: episode.id))
        updateNowPlayingButtons()
        refreshTemplates()
    }

    // MARK: Subscriptions

    private func subscribedPodcasts() -> [CarPlayPodcast] {
        let state = CarPlayState.shared
        let ids = state.subscribedIds
        if ids.isEmpty { return state.subscriptions }
        return state.subscriptions.filter { ids.contains($0.id) }
    }

    private func sortedSubscriptions(_ podcasts: [CarPlayPodcast]) -> [CarPlayPodcast] {
        let state = CarPlayState.shared
        switch state.settingString("podcastSort", fallback: "most_recently_updated") {
        case "alphabetical":
            return podcasts.sorted { $0.title.lowercased() < $1.title.lowercased() }
        case "least_recently_updated":
            return podcasts.sorted { $0.latestUpdateMs < $1.latestUpdateMs }
        case "manual":
            let order = state.snapshot.podcastManualOrder
            guard !order.isEmpty else {
                return podcasts.sorted { $0.latestUpdateMs > $1.latestUpdateMs }
            }
            let index = Dictionary(
                uniqueKeysWithValues: order.enumerated().map { ($0.element, $0.offset) })
            return podcasts.sorted { (index[$0.id] ?? Int.max) < (index[$1.id] ?? Int.max) }
        case "tags":
            let tagMap = state.snapshot.podcastTags
            return podcasts.sorted { (tagMap[$0.id]?.first ?? "") < (tagMap[$1.id]?.first ?? "") }
        default:
            return podcasts.sorted { $0.latestUpdateMs > $1.latestUpdateMs }
        }
    }

    private func hidesPlayedEpisodes() -> Bool {
        CarPlayState.shared.settingBool("hidePlayedInPlaylists")
            || CarPlayState.shared.settingBool("carplayHidePlayed")
    }

    // MARK: Background data

    /// Fills a podcast's episode list when React has nothing cached for it, so a cold
    /// CarPlay connect is still browsable.
    private func fetchEpisodesInBackground(podcastId: String) {
        guard fetchingEpisodes.insert(podcastId).inserted else { return }
        let rssUrl = Self.feedURL(podcastId: podcastId, rssUrl: CarPlayState.shared.findPodcast(podcastId: podcastId)?.rssUrl)
        DispatchQueue.global(qos: .utility).async { [weak self] in
            defer { Task { @MainActor in self?.fetchingEpisodes.remove(podcastId) } }
            guard
                let episodes = CarPlayRss.fetchEpisodes(
                    podcastId: podcastId, rssUrl: rssUrl, limit: 50), !episodes.isEmpty
            else { return }
            CarPlayState.shared.saveEpisodes(podcastId: podcastId, episodes: episodes)
            Task { @MainActor in
                guard let self, self.isConnected else { return }
                self.refreshTemplates()
            }
        }
    }

    private func playRandomPodcast() {
        let state = CarPlayState.shared
        var pool = state.catalog
        if pool.isEmpty { pool = state.subscriptions }
        guard !pool.isEmpty else { return }

        DispatchQueue.global(qos: .utility).async { [weak self] in
            for podcast in pool.shuffled().prefix(20) {
                var episodes = state.episodes(podcastId: podcast.id)
                if episodes.isEmpty {
                    let rssUrl = Self.feedURL(podcastId: podcast.id, rssUrl: podcast.rssUrl)
                    if let fetched = CarPlayRss.fetchEpisodes(
                        podcastId: podcast.id, rssUrl: rssUrl, limit: 20), !fetched.isEmpty {
                        state.saveEpisodes(podcastId: podcast.id, episodes: fetched)
                        episodes = fetched
                    }
                }
                guard
                    let latest = episodes.max(by: { $0.pubDateEpochMs < $1.pubDateEpochMs })
                        ?? episodes.first
                else { continue }
                var enriched = state.enrich(latest, podcastId: podcast.id)
                if enriched.podcastTitle.isEmpty { enriched.podcastTitle = podcast.title }
                if enriched.podcastImageUrl.isEmpty { enriched.podcastImageUrl = podcast.imageUrl }
                Task { @MainActor in self?.play(episode: enriched) }
                return
            }
        }
    }

    private nonisolated static func feedURL(podcastId: String, rssUrl: String?) -> String {
        guard let rssUrl = rssUrl, !rssUrl.isEmpty else {
            return "https://podcasts.files.bbci.co.uk/\(podcastId).rss"
        }
        return rssUrl
    }
}

// MARK: - Template visibility

extension CarPlayManager: CPInterfaceControllerDelegate {
    nonisolated func templateDidAppear(_ aTemplate: CPTemplate, animated: Bool) {
        Task { @MainActor in self.visibleTemplate = aTemplate }
    }

    nonisolated func templateDidDisappear(_ aTemplate: CPTemplate, animated: Bool) {
        Task { @MainActor in
            guard self.visibleTemplate === aTemplate else { return }
            self.visibleTemplate = nil
        }
    }
}

// MARK: - Search

extension CarPlayManager: CPSearchTemplateDelegate {
    nonisolated func searchTemplate(
        _ searchTemplate: CPSearchTemplate,
        updatedSearchText searchText: String,
        completionHandler: @escaping ([CPListItem]) -> Void
    ) {
        let trimmed = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        Task { @MainActor in self.lastSearchQuery = searchText }
        if trimmed.lowercased().contains("random") {
            completionHandler([])
            Task { @MainActor in self.playRandomPodcast() }
            return
        }
        completionHandler(MainActor.assumeIsolated { self.searchResults(for: searchText) })
    }

    nonisolated func searchTemplate(
        _ searchTemplate: CPSearchTemplate,
        selectedResult item: CPListItem,
        completionHandler: @escaping () -> Void
    ) {
        // Each result carries its own handler, so the row is already playing by the time
        // CarPlay asks us to dismiss the search field.
        completionHandler()
    }

    nonisolated func searchTemplateSearchButtonPressed(_ searchTemplate: CPSearchTemplate) {
        Task { @MainActor in self.pushSearchResults(self.searchResults(for: self.lastSearchQuery)) }
    }
}
