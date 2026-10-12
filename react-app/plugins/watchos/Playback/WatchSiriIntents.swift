import AppIntents
import Foundation

// MARK: - Watch Station Entity & Query

struct WatchStationEntity: AppEntity, Hashable {
    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Station")
    static var defaultQuery = WatchStationQuery()

    let id: String
    let title: String
    let category: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(title)", subtitle: "\(category)")
    }

    init(id: String, title: String, category: String) {
        self.id = id
        self.title = title
        self.category = category
    }
}

struct WatchStationQuery: EntityStringQuery {
    private func resolveStations() -> [WatchStationEntity] {
        WatchStationCatalogue.allStations().map {
            WatchStationEntity(id: $0.id, title: $0.title, category: $0.category.rawValue.capitalized)
        }
    }

    func entities(matching string: String) async throws -> [WatchStationEntity] {
        let query = string.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return resolveStations().filter {
            $0.title.lowercased().contains(query) || $0.category.lowercased().contains(query)
        }
    }

    func entities(for identifiers: [String]) async throws -> [WatchStationEntity] {
        let wanted = Set(identifiers)
        return resolveStations().filter { wanted.contains($0.id) }
    }

    func suggestedEntities() async throws -> [WatchStationEntity] {
        resolveStations()
    }

    func defaultResult() async -> WatchStationEntity? {
        try? await suggestedEntities().first
    }
}

// MARK: - Watch Podcast Entity & Query

struct WatchPodcastEntity: AppEntity, Hashable {
    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Podcast")
    static var defaultQuery = WatchPodcastQuery()

    let id: String
    let title: String
    let author: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(title)", subtitle: "\(author)")
    }

    init(id: String, title: String, author: String = "BBC") {
        self.id = id
        self.title = title
        self.author = author
    }
}

struct WatchPodcastQuery: EntityStringQuery {
    static let fallbackPodcasts: [WatchPodcastEntity] = [
        .init(id: "p02nq0gn", title: "The Archers", author: "BBC Radio 4"),
        .init(id: "p002vsxs", title: "Desert Island Discs", author: "BBC Radio 4"),
        .init(id: "p004y29g", title: "In Our Time", author: "BBC Radio 4"),
        .init(id: "p02pc9ny", title: "Friday Night Comedy", author: "BBC Radio 4"),
        .init(id: "p02nq0lx", title: "More or Less", author: "BBC Radio 4"),
        .init(id: "p07mck39", title: "You're Dead To Me", author: "BBC Radio 4"),
        .init(id: "p052994h", title: "Newscast", author: "BBC Sounds"),
        .init(id: "p02nq08x", title: "Global News Podcast", author: "BBC World Service")
    ]

    private func resolvePodcasts() -> [WatchPodcastEntity] {
        let subs = WatchPodcastManager.shared.subscribedPodcasts
        if !subs.isEmpty {
            return subs.map { WatchPodcastEntity(id: $0.id, title: $0.title, author: "Subscribed") }
        }
        return Self.fallbackPodcasts
    }

    func entities(matching string: String) async throws -> [WatchPodcastEntity] {
        let query = string.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return resolvePodcasts().filter {
            $0.title.lowercased().contains(query) || $0.author.lowercased().contains(query)
        }
    }

    func entities(for identifiers: [String]) async throws -> [WatchPodcastEntity] {
        let wanted = Set(identifiers)
        return resolvePodcasts().filter { wanted.contains($0.id) }
    }

    func suggestedEntities() async throws -> [WatchPodcastEntity] {
        resolvePodcasts()
    }

    func defaultResult() async -> WatchPodcastEntity? {
        try? await suggestedEntities().first
    }
}

// MARK: - Watch App Intents

struct WatchPlayStationIntent: AppIntent {
    static var title: LocalizedStringResource = "Play Station"
    static var description = IntentDescription("Plays a BBC radio station on Apple Watch.")

    @Parameter(title: "Station")
    var station: WatchStationEntity?

    static var parameterSummary: some ParameterSummary {
        Summary("Play \(\.$station)")
    }

    init() {}

    init(station: WatchStationEntity?) {
        self.station = station
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        let allStations = WatchStationCatalogue.allStations()
        let targetStation: WatchStation?
        if let stationId = station?.id, !stationId.isEmpty {
            targetStation = allStations.first(where: { $0.id == stationId })
        } else {
            targetStation = allStations.first
        }

        if let target = targetStation {
            WatchPlaybackController.shared.playStation(target)
        }
        return .result()
    }
}

struct WatchPlayPodcastIntent: AppIntent {
    static var title: LocalizedStringResource = "Play Podcast"
    static var description = IntentDescription("Plays a BBC podcast episode on Apple Watch.")

    @Parameter(title: "Podcast")
    var podcast: WatchPodcastEntity?

    static var parameterSummary: some ParameterSummary {
        Summary("Play \(\.$podcast)")
    }

    init() {}

    init(podcast: WatchPodcastEntity?) {
        self.podcast = podcast
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        let subs = WatchPodcastManager.shared.subscribedPodcasts
        let targetPod: WatchPodcast?
        if let id = podcast?.id, !id.isEmpty {
            targetPod = subs.first(where: { $0.id == id }) ?? WatchPodcast(id: id, title: podcast?.title ?? id, rssUrl: "https://podcasts.files.bbci.co.uk/\(id).rss", imageUrl: "")
        } else {
            targetPod = subs.first
        }

        if let pod = targetPod {
            await withCheckedContinuation { continuation in
                WatchPodcastManager.shared.fetchEpisodes(for: pod) { episodes in
                    let unplayed = episodes.first(where: { !WatchSharedState.shared.isEpisodePlayed($0.id) }) ?? episodes.first
                    if let ep = unplayed {
                        WatchPlaybackController.shared.playEpisode(ep, podcast: pod)
                    }
                    continuation.resume()
                }
            }
        }
        return .result()
    }
}

struct WatchPlayRandomPodcastIntent: AppIntent {
    static var title: LocalizedStringResource = "Play Random Podcast"
    static var description = IntentDescription("Plays a random BBC podcast on Apple Watch.")

    init() {}

    @MainActor
    func perform() async throws -> some IntentResult {
        let subs = WatchPodcastManager.shared.subscribedPodcasts
        if let chosen = subs.randomElement() {
            await withCheckedContinuation { continuation in
                WatchPodcastManager.shared.fetchEpisodes(for: chosen) { episodes in
                    let unplayed = episodes.first(where: { !WatchSharedState.shared.isEpisodePlayed($0.id) }) ?? episodes.first
                    if let ep = unplayed {
                        WatchPlaybackController.shared.playEpisode(ep, podcast: chosen)
                    }
                    continuation.resume()
                }
            }
        }
        return .result()
    }
}

struct WatchPlayFromSearchIntent: AppIntent {
    static var title: LocalizedStringResource = "Voice Search & Play"
    static var description = IntentDescription("Searches and plays a station or podcast by voice on Apple Watch.")

    @Parameter(title: "Search Query")
    var query: String?

    static var parameterSummary: some ParameterSummary {
        Summary("Play \(\.$query)")
    }

    init() {}

    init(query: String?) {
        self.query = query
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        guard let q = query?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(), !q.isEmpty else {
            WatchPlaybackController.shared.resume()
            return .result()
        }

        // Try station match
        let allStations = WatchStationCatalogue.allStations()
        if let matched = allStations.first(where: { $0.title.lowercased().contains(q) || $0.id.lowercased().contains(q) }) {
            WatchPlaybackController.shared.playStation(matched)
            return .result()
        }

        // Try podcast match
        let subs = WatchPodcastManager.shared.subscribedPodcasts
        if let pod = subs.first(where: { $0.title.lowercased().contains(q) }) {
            await withCheckedContinuation { continuation in
                WatchPodcastManager.shared.fetchEpisodes(for: pod) { episodes in
                    let unplayed = episodes.first(where: { !WatchSharedState.shared.isEpisodePlayed($0.id) }) ?? episodes.first
                    if let ep = unplayed {
                        WatchPlaybackController.shared.playEpisode(ep, podcast: pod)
                    }
                    continuation.resume()
                }
            }
            return .result()
        }

        // Fallback to resume or default
        if let def = allStations.first {
            WatchPlaybackController.shared.playStation(def)
        }
        return .result()
    }
}

struct WatchResumePlaybackIntent: AppIntent {
    static var title: LocalizedStringResource = "Resume Radio"
    static var description = IntentDescription("Resumes playback on Apple Watch.")

    init() {}

    @MainActor
    func perform() async throws -> some IntentResult {
        WatchPlaybackController.shared.resume()
        return .result()
    }
}

struct WatchStopPlaybackIntent: AppIntent {
    static var title: LocalizedStringResource = "Stop Radio"
    static var description = IntentDescription("Stops playback on Apple Watch.")

    init() {}

    @MainActor
    func perform() async throws -> some IntentResult {
        WatchPlaybackController.shared.stop()
        return .result()
    }
}

// MARK: - Watch App Shortcuts Provider

struct WatchSiriShortcutsProvider: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: WatchPlayStationIntent(),
            phrases: [
                "Play \(\.$station) on \(.applicationName)",
                "Play \(\.$station) with \(.applicationName)",
                "Play radio on \(.applicationName)",
                "Play station on \(.applicationName)"
            ],
            shortTitle: "Play Station",
            systemImageName: "radio"
        )
        AppShortcut(
            intent: WatchPlayPodcastIntent(),
            phrases: [
                "Play \(\.$podcast) on \(.applicationName)",
                "Play \(\.$podcast) with \(.applicationName)",
                "Play podcast on \(.applicationName)",
                "Play a podcast on \(.applicationName)"
            ],
            shortTitle: "Play Podcast",
            systemImageName: "mic.fill"
        )
        AppShortcut(
            intent: WatchPlayRandomPodcastIntent(),
            phrases: [
                "Play random podcast on \(.applicationName)",
                "Play a random podcast on \(.applicationName)"
            ],
            shortTitle: "Play Random Podcast",
            systemImageName: "shuffle"
        )
        AppShortcut(
            intent: WatchPlayFromSearchIntent(),
            phrases: [
                "Play \(\.$query) on \(.applicationName)",
                "Play \(\.$query) with \(.applicationName)",
                "Play \(.applicationName)"
            ],
            shortTitle: "Voice Search",
            systemImageName: "magnifyingglass"
        )
        AppShortcut(
            intent: WatchResumePlaybackIntent(),
            phrases: [
                "Resume radio on \(.applicationName)",
                "Resume playback on \(.applicationName)"
            ],
            shortTitle: "Resume Radio",
            systemImageName: "play.fill"
        )
        AppShortcut(
            intent: WatchStopPlaybackIntent(),
            phrases: [
                "Stop radio on \(.applicationName)",
                "Stop playback on \(.applicationName)"
            ],
            shortTitle: "Stop Radio",
            systemImageName: "stop.fill"
        )
    }

    static var shortcutTileColor: ShortcutTileColor = .red
}
