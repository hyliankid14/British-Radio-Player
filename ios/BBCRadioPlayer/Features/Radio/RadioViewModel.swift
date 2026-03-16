import Foundation
import Combine

@MainActor
final class RadioViewModel: ObservableObject {
    @Published private(set) var stations: [Station] = []
    @Published private(set) var stationShowTitles: [String: String] = [:]
    @Published var selectedCategory: StationCategory = .national
    @Published var searchText: String = ""

    private let stationRepository: StationRepository
    private let audioPlayerService: AudioPlayerService
    private let favoritesStore: FavoritesStore
    private let appSettingsStore: AppSettingsStore
    private var cancellables: Set<AnyCancellable> = []
    private var showRefreshTask: Task<Void, Never>?

    init(
        stationRepository: StationRepository,
        audioPlayerService: AudioPlayerService,
        favoritesStore: FavoritesStore,
        appSettingsStore: AppSettingsStore
    ) {
        self.stationRepository = stationRepository
        self.audioPlayerService = audioPlayerService
        self.favoritesStore = favoritesStore
        self.appSettingsStore = appSettingsStore
        stations = stationRepository.allStations()

        favoritesStore.objectWillChange
            .sink { [weak self] _ in self?.objectWillChange.send() }
            .store(in: &cancellables)

        appSettingsStore.objectWillChange
            .sink { [weak self] _ in self?.objectWillChange.send() }
            .store(in: &cancellables)

        audioPlayerService.objectWillChange
            .sink { [weak self] _ in self?.objectWillChange.send() }
            .store(in: &cancellables)

        selectedCategory = .national
        refreshStationShowTitles()
    }

    deinit {
        showRefreshTask?.cancel()
    }

    func play(_ station: Station) {
        audioPlayerService.play(station: station, quality: appSettingsStore.playbackQuality)
    }

    func togglePlayback() {
        if audioPlayerService.isPlaying {
            audioPlayerService.pause()
        } else {
            audioPlayerService.resume()
        }
    }

    func toggleFavorite(_ station: Station) {
        favoritesStore.toggleFavorite(stationID: station.id)
    }

    func isFavorite(_ station: Station) -> Bool {
        favoritesStore.isFavorite(stationID: station.id)
    }

    var selectedQuality: PlaybackQuality {
        get { appSettingsStore.playbackQuality }
        set { appSettingsStore.playbackQuality = newValue }
    }

    var filteredStations: [Station] {
        let categoryStations = stationRepository.stations(for: selectedCategory)
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else {
            return categoryStations
        }

        return categoryStations.filter {
            $0.title.lowercased().contains(query)
        }
    }

    var favoriteStations: [Station] {
        stations.filter { favoritesStore.favoriteStationIDs.contains($0.id) }
            .sorted { $0.title < $1.title }
    }

    var isPlaying: Bool {
        audioPlayerService.isPlaying
    }

    var currentStationID: String? {
        audioPlayerService.currentStation?.id
    }

    func showSubtitle(for station: Station) -> String {
        if audioPlayerService.currentStation?.id == station.id,
           !audioPlayerService.currentStationShowTitle.isEmpty {
            return audioPlayerService.currentStationShowTitle
        }
        if let show = stationShowTitles[station.id], !show.isEmpty {
            return show
        }
        return "Loading show..."
    }

    func refreshStationShowTitles() {
        showRefreshTask?.cancel()
        let targetStations = stationRepository.stations(for: selectedCategory)

        showRefreshTask = Task { [weak self] in
            guard let self else { return }
            await withTaskGroup(of: (String, String?).self) { group in
                for station in targetStations {
                    group.addTask {
                        let show = await Self.fetchCurrentShowTitle(serviceID: station.serviceId)
                        return (station.id, show)
                    }
                }

                var updated = self.stationShowTitles
                for await (stationID, show) in group {
                    if let show, !show.isEmpty {
                        updated[stationID] = show
                    }
                }
                self.stationShowTitles = updated
            }
        }
    }

    private static func fetchCurrentShowTitle(serviceID: String) async -> String? {
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
}

extension RadioViewModel {
    private var skipStationsSource: [Station] {
        switch appSettingsStore.stationSkipMode {
        case .allStations:
            return stations
        case .favouritesOnly:
            return favoriteStations
        }
    }

    func playNextStation() {
        let list = skipStationsSource
        guard !list.isEmpty,
              let id = currentStationID,
              let idx = list.firstIndex(where: { $0.id == id }) else { return }
        play(list[(idx + 1) % list.count])
    }

    func playPreviousStation() {
        let list = skipStationsSource
        guard !list.isEmpty,
              let id = currentStationID,
              let idx = list.firstIndex(where: { $0.id == id }) else { return }
        play(list[(idx - 1 + list.count) % list.count])
    }

    func toggleCurrentFavourite() {
        guard let station = audioPlayerService.currentStation else { return }
        favoritesStore.toggleFavorite(stationID: station.id)
    }

    var isCurrentFavourite: Bool {
        guard let id = audioPlayerService.currentStation?.id else { return false }
        return favoritesStore.isFavorite(stationID: id)
    }
}
