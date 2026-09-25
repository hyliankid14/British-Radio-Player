import Foundation
import Combine

enum RootTab: Hashable {
    case favourites
    case stations
    case podcasts
    case settings
}

@MainActor
final class AppContainer: ObservableObject {
    @Published var selectedRootTab: RootTab = .favourites

    let stationRepository: StationRepository
    let podcastRepository: PodcastRepository
    let remoteIndexClient: RemoteIndexClient
    let audioPlayerService: AudioPlayerService
    let favoritesStore: FavoritesStore
    let appSettingsStore: AppSettingsStore
    let episodeDownloadService: EpisodeDownloadService
    let privacyAnalytics: PrivacyAnalyticsService
    let podcastNotificationService: PodcastNotificationService
    let radioViewModel: RadioViewModel
    let podcastsViewModel: PodcastsViewModel
    private var cancellables: Set<AnyCancellable> = []

    var shouldShowAnalyticsOptInDialog: Bool {
        privacyAnalytics.shouldShowOptInDialog
    }

    func setAnalyticsEnabled(_ enabled: Bool) {
        privacyAnalytics.isEnabled = enabled
    }

    func markAnalyticsOptInDialogShown() {
        privacyAnalytics.markOptInDialogShown()
    }

    func checkEpisodeNotifications() {
        Task {
            await podcastNotificationService.checkForNewEpisodes(
                podcastRepository: podcastRepository,
                favoritesStore: favoritesStore
            )
        }
    }

    func checkEpisodeIndexRefresh() {
        Task {
            await podcastsViewModel.refreshEpisodeIndexIfNeeded()
        }
    }

    func syncEpisodeDownloads() {
        syncSavedEpisodeDownloads()
        syncSubscribedPodcastDownloads()
    }

    init(
        stationRepository: StationRepository = DefaultStationRepository(),
        podcastRepository: PodcastRepository = DefaultPodcastRepository(),
        remoteIndexClient: RemoteIndexClient = RemoteIndexClient(),
        audioPlayerService: AudioPlayerService? = nil,
        favoritesStore: FavoritesStore = FavoritesStore(),
        appSettingsStore: AppSettingsStore = AppSettingsStore(),
        episodeDownloadService: EpisodeDownloadService? = nil,
        privacyAnalytics: PrivacyAnalyticsService = PrivacyAnalyticsService(),
        podcastNotificationService: PodcastNotificationService = PodcastNotificationService()
    ) {
        let resolvedAudioPlayerService = audioPlayerService ?? AudioPlayerService()
        let resolvedEpisodeDownloadService = episodeDownloadService ?? EpisodeDownloadService()

        self.stationRepository = stationRepository
        self.podcastRepository = podcastRepository
        self.remoteIndexClient = remoteIndexClient
        self.audioPlayerService = resolvedAudioPlayerService
        self.favoritesStore = favoritesStore
        self.appSettingsStore = appSettingsStore
        self.episodeDownloadService = resolvedEpisodeDownloadService
        self.privacyAnalytics = privacyAnalytics
        self.podcastNotificationService = podcastNotificationService
        self.radioViewModel = RadioViewModel(
            stationRepository: stationRepository,
            audioPlayerService: resolvedAudioPlayerService,
            favoritesStore: favoritesStore,
            appSettingsStore: appSettingsStore
        )
        self.podcastsViewModel = PodcastsViewModel(
            podcastRepository: podcastRepository,
            remoteIndexClient: remoteIndexClient,
            audioPlayerService: resolvedAudioPlayerService,
            favoritesStore: favoritesStore,
            appSettingsStore: appSettingsStore,
            episodeDownloadService: resolvedEpisodeDownloadService
        )

        favoritesStore.onSavedEpisodesChanged = { [weak self] snapshots in
            guard let self, self.appSettingsStore.autoDownloadSavedEpisodes else { return }
            self.episodeDownloadService.scheduleSavedEpisodeDownloads(snapshots)
        }
        favoritesStore.onSubscribedPodcastsChanged = { [weak self] snapshots in
            guard let self, self.appSettingsStore.autoDownloadSubscribedPodcasts else { return }
            self.episodeDownloadService.scheduleSubscribedPodcastDownloads(
                snapshots,
                podcastRepository: self.podcastRepository,
                limit: self.appSettingsStore.autoDownloadLimit.rawValue
            )
        }

        resolvedAudioPlayerService.onNextRequested = { [weak self] in
            self?.radioViewModel.playNextStation()
        }
        resolvedAudioPlayerService.onPreviousRequested = { [weak self] in
            self?.radioViewModel.playPreviousStation()
        }
        resolvedAudioPlayerService.onEpisodeCompleted = { [weak self] episode in
            self?.handleEpisodeCompleted(episode)
        }
        resolvedAudioPlayerService.updatePodcastArtworkMode(appSettingsStore.podcastArtworkMode)
        resolvedAudioPlayerService.updateAnalyticsService(privacyAnalytics)

        // Forward nested updates so root environment object refreshes immediately.
        favoritesStore.objectWillChange
            .sink { [weak self] _ in self?.objectWillChange.send() }
            .store(in: &cancellables)

        appSettingsStore.objectWillChange
            .sink { [weak self] _ in self?.objectWillChange.send() }
            .store(in: &cancellables)

        resolvedEpisodeDownloadService.objectWillChange
            .sink { [weak self] _ in self?.objectWillChange.send() }
            .store(in: &cancellables)

        appSettingsStore.$podcastArtworkMode
            .removeDuplicates()
            .sink { [resolvedAudioPlayerService] mode in
                resolvedAudioPlayerService.updatePodcastArtworkMode(mode)
            }
            .store(in: &cancellables)

        appSettingsStore.$autoDownloadSavedEpisodes
            .removeDuplicates()
            .sink { [weak self] enabled in
                guard let self, enabled else { return }
                self.syncSavedEpisodeDownloads()
            }
            .store(in: &cancellables)

        appSettingsStore.$autoDownloadSubscribedPodcasts
            .removeDuplicates()
            .sink { [weak self] enabled in
                guard let self, enabled else { return }
                self.syncSubscribedPodcastDownloads()
            }
            .store(in: &cancellables)

        appSettingsStore.$autoDownloadLimit
            .removeDuplicates()
            .sink { [weak self] _ in
                guard let self, self.appSettingsStore.autoDownloadSubscribedPodcasts else { return }
                self.syncSubscribedPodcastDownloads()
            }
            .store(in: &cancellables)

        resolvedAudioPlayerService.objectWillChange
            .sink { [weak self] _ in self?.objectWillChange.send() }
            .store(in: &cancellables)

        radioViewModel.objectWillChange
            .sink { [weak self] _ in self?.objectWillChange.send() }
            .store(in: &cancellables)

        podcastsViewModel.objectWillChange
            .sink { [weak self] _ in self?.objectWillChange.send() }
            .store(in: &cancellables)

        syncEpisodeDownloads()
    }

    private func syncSavedEpisodeDownloads() {
        guard appSettingsStore.autoDownloadSavedEpisodes else { return }
        episodeDownloadService.scheduleSavedEpisodeDownloads(favoritesStore.savedEpisodeSnapshots)
    }

    private func syncSubscribedPodcastDownloads() {
        guard appSettingsStore.autoDownloadSubscribedPodcasts else { return }
        episodeDownloadService.scheduleSubscribedPodcastDownloads(
            favoritesStore.subscribedPodcastSnapshots,
            podcastRepository: podcastRepository,
            limit: appSettingsStore.autoDownloadLimit.rawValue
        )
    }

    private func handleEpisodeCompleted(_ episode: Episode) {
        let pref = appSettingsStore.autoplayNextEpisode
        guard pref != .none else { return }
        if pref == .subscriptionsOnly, !favoritesStore.isSubscribed(podcastID: episode.podcastID) {
            return
        }
        Task {
            do {
                let allPods = try await podcastRepository.fetchPodcasts(forceRefresh: false)
                guard let podcast = allPods.first(where: { $0.id == episode.podcastID }) else { return }
                let allEpisodes = try await podcastRepository.fetchEpisodes(for: podcast)
                let currentEpoch = Self.parsePubDateToEpoch(episode.pubDate)
                guard currentEpoch > 0 else { return }
                let candidates: [(Episode, Int64)] = allEpisodes.compactMap { ep in
                    let epEpoch = Self.parsePubDateToEpoch(ep.pubDate)
                    guard epEpoch > 0, epEpoch > currentEpoch else { return nil }
                    return (ep, epEpoch)
                }
                guard let next = candidates.min(by: { $0.1 < $1.1 })?.0 else { return }
                guard audioPlayerService.currentEpisode?.id == episode.id else { return }
                audioPlayerService.play(
                    episode: next,
                    podcastTitle: podcast.title,
                    podcastArtworkURL: podcast.imageURL
                )
            } catch {
                // Silently ignore network errors — autoplay is best-effort
            }
        }
    }

    private static let pubDateFormatters: [DateFormatter] = {
        let f1 = DateFormatter()
        f1.locale = Locale(identifier: "en_US_POSIX")
        f1.dateFormat = "EEE, dd MMM yyyy HH:mm:ss Z"
        let f2 = DateFormatter()
        f2.locale = Locale(identifier: "en_US_POSIX")
        f2.dateFormat = "EEE, dd MMM yyyy HH:mm:ss z"
        return [f1, f2]
    }()

    private static func parsePubDateToEpoch(_ pubDate: String) -> Int64 {
        for formatter in pubDateFormatters {
            if let date = formatter.date(from: pubDate) {
                return Int64(date.timeIntervalSince1970)
            }
        }
        return 0
    }
}
