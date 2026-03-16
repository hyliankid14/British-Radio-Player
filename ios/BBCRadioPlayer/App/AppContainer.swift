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
    let radioViewModel: RadioViewModel
    let podcastsViewModel: PodcastsViewModel
    private var cancellables: Set<AnyCancellable> = []

    init(
        stationRepository: StationRepository = DefaultStationRepository(),
        podcastRepository: PodcastRepository = DefaultPodcastRepository(),
        remoteIndexClient: RemoteIndexClient = RemoteIndexClient(),
        audioPlayerService: AudioPlayerService? = nil,
        favoritesStore: FavoritesStore = FavoritesStore(),
        appSettingsStore: AppSettingsStore = AppSettingsStore()
    ) {
        let resolvedAudioPlayerService = audioPlayerService ?? AudioPlayerService()

        self.stationRepository = stationRepository
        self.podcastRepository = podcastRepository
        self.remoteIndexClient = remoteIndexClient
        self.audioPlayerService = resolvedAudioPlayerService
        self.favoritesStore = favoritesStore
        self.appSettingsStore = appSettingsStore
        self.radioViewModel = RadioViewModel(
            stationRepository: stationRepository,
            audioPlayerService: resolvedAudioPlayerService,
            favoritesStore: favoritesStore,
            appSettingsStore: appSettingsStore
        )
        self.podcastsViewModel = PodcastsViewModel(
            podcastRepository: podcastRepository,
            audioPlayerService: resolvedAudioPlayerService,
            favoritesStore: favoritesStore
        )

        resolvedAudioPlayerService.onNextRequested = { [weak self] in
            self?.radioViewModel.playNextStation()
        }
        resolvedAudioPlayerService.onPreviousRequested = { [weak self] in
            self?.radioViewModel.playPreviousStation()
        }
        resolvedAudioPlayerService.updatePodcastArtworkMode(appSettingsStore.podcastArtworkMode)

        // Forward nested updates so root environment object refreshes immediately.
        favoritesStore.objectWillChange
            .sink { [weak self] _ in self?.objectWillChange.send() }
            .store(in: &cancellables)

        appSettingsStore.objectWillChange
            .sink { [weak self] _ in self?.objectWillChange.send() }
            .store(in: &cancellables)

        appSettingsStore.$podcastArtworkMode
            .removeDuplicates()
            .sink { [resolvedAudioPlayerService] mode in
                resolvedAudioPlayerService.updatePodcastArtworkMode(mode)
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
    }
}
