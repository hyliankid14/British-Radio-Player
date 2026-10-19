import AppIntents
import Foundation

// MARK: - TV Station Entity & Query

struct TVStationEntity: AppEntity, Hashable {
    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Station")
    static var defaultQuery = TVStationQuery()

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

struct TVStationQuery: EntityStringQuery {
    private func resolveStations() -> [TVStationEntity] {
        TVStationCatalogue.allStations().map {
            TVStationEntity(id: $0.id, title: $0.title, category: $0.category.rawValue.capitalized)
        }
    }

    func entities(matching string: String) async throws -> [TVStationEntity] {
        let query = string.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return resolveStations().filter {
            $0.title.lowercased().contains(query) || $0.category.lowercased().contains(query)
        }
    }

    func entities(for identifiers: [String]) async throws -> [TVStationEntity] {
        let wanted = Set(identifiers)
        return resolveStations().filter { wanted.contains($0.id) }
    }

    func suggestedEntities() async throws -> [TVStationEntity] {
        resolveStations()
    }

    func defaultResult() async -> TVStationEntity? {
        try? await suggestedEntities().first
    }
}

// MARK: - TV Podcast Entity & Query

struct TVPodcastEntity: AppEntity, Hashable {
    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Podcast")
    static var defaultQuery = TVPodcastQuery()

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

struct TVPodcastQuery: EntityStringQuery {
    static let fallbackPodcasts: [TVPodcastEntity] = [
        .init(id: "p02nq0gn", title: "The Archers", author: "BBC Radio 4"),
        .init(id: "p002vsxs", title: "Desert Island Discs", author: "BBC Radio 4"),
        .init(id: "p004y29g", title: "In Our Time", author: "BBC Radio 4"),
        .init(id: "p02pc9ny", title: "Friday Night Comedy", author: "BBC Radio 4"),
        .init(id: "b006qshd", title: "More or Less", author: "BBC Radio 4"),
        .init(id: "p07mck39", title: "You're Dead To Me", author: "BBC Radio 4"),
        .init(id: "p052994h", title: "Newscast", author: "BBC Sounds"),
        .init(id: "p02nq08x", title: "Global News Podcast", author: "BBC World Service")
    ]

    private func resolvePodcasts() -> [TVPodcastEntity] {
        let subs = TVSubscriptionManager.shared.subscribedPodcasts
        if !subs.isEmpty {
            return subs.map { TVPodcastEntity(id: $0.id, title: $0.title, author: "Subscribed") }
        }
        let featured = TVPodcastManager.shared.featuredPodcasts
        if !featured.isEmpty {
            return featured.map { TVPodcastEntity(id: $0.id, title: $0.title, author: "BBC") }
        }
        return Self.fallbackPodcasts
    }

    func entities(matching string: String) async throws -> [TVPodcastEntity] {
        let query = string.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return resolvePodcasts().filter {
            $0.title.lowercased().contains(query) || $0.author.lowercased().contains(query)
        }
    }

    func entities(for identifiers: [String]) async throws -> [TVPodcastEntity] {
        let wanted = Set(identifiers)
        return resolvePodcasts().filter { wanted.contains($0.id) }
    }

    func suggestedEntities() async throws -> [TVPodcastEntity] {
        resolvePodcasts()
    }

    func defaultResult() async -> TVPodcastEntity? {
        try? await suggestedEntities().first
    }
}

// MARK: - TV App Intents

struct TVPlayStationIntent: AppIntent {
    static var title: LocalizedStringResource = "Play Station"
    static var description = IntentDescription("Plays a BBC radio station in British Radio Player.")

    @Parameter(title: "Station")
    var station: TVStationEntity?

    static var parameterSummary: some ParameterSummary {
        Summary("Play \(\.$station)")
    }

    init() {}

    init(station: TVStationEntity?) {
        self.station = station
    }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let allStations = TVStationCatalogue.allStations()
        let targetStation: TVStation?
        if let stationId = station?.id, !stationId.isEmpty {
            targetStation = allStations.first(where: { $0.id == stationId })
        } else {
            targetStation = allStations.first
        }

        if let target = targetStation {
            TVPlaybackController.shared.playStation(target)
            return .result(dialog: "Playing \(target.title)")
        }
        return .result(dialog: "Station not found")
    }
}

struct TVPlayPodcastIntent: AppIntent {
    static var title: LocalizedStringResource = "Play Podcast"
    static var description = IntentDescription("Plays a BBC podcast episode in British Radio Player.")

    @Parameter(title: "Podcast")
    var podcast: TVPodcastEntity?

    static var parameterSummary: some ParameterSummary {
        Summary("Play \(\.$podcast)")
    }

    init() {}

    init(podcast: TVPodcastEntity?) {
        self.podcast = podcast
    }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let allPods = TVSubscriptionManager.shared.subscribedPodcasts + TVPodcastManager.shared.featuredPodcasts
        let targetPod: TVPodcast?
        if let id = podcast?.id, !id.isEmpty {
            targetPod = allPods.first(where: { $0.id == id }) ?? TVPodcast(id: id, title: podcast?.title ?? id, rssUrl: "", imageUrl: "")
        } else {
            targetPod = allPods.first
        }

        if let pod = targetPod {
            await withCheckedContinuation { continuation in
                TVPodcastManager.shared.fetchEpisodes(for: pod) { episodes in
                    if let ep = episodes.first {
                        TVPlaybackController.shared.playEpisode(ep, podcast: pod)
                    }
                    continuation.resume()
                }
            }
            return .result(dialog: "Playing \(pod.title)")
        }
        return .result(dialog: "Podcast not found")
    }
}

struct TVPlayRandomPodcastIntent: AppIntent {
    static var title: LocalizedStringResource = "Play Random Podcast"
    static var description = IntentDescription("Plays a random BBC podcast in British Radio Player.")

    init() {}

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let allPods = TVSubscriptionManager.shared.subscribedPodcasts + TVPodcastManager.shared.featuredPodcasts
        if let chosen = allPods.randomElement() {
            await withCheckedContinuation { continuation in
                TVPodcastManager.shared.fetchEpisodes(for: chosen) { episodes in
                    if let ep = episodes.first {
                        TVPlaybackController.shared.playEpisode(ep, podcast: chosen)
                    }
                    continuation.resume()
                }
            }
            return .result(dialog: "Playing \(chosen.title)")
        }
        return .result(dialog: "No podcasts available")
    }
}

struct TVPlayFromSearchIntent: AppIntent {
    static var title: LocalizedStringResource = "Voice Search & Play"
    static var description = IntentDescription("Searches and plays a station or podcast by voice.")

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
    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let q = query?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(), !q.isEmpty else {
            TVPlaybackController.shared.resume()
            return .result(dialog: "Resuming playback")
        }

        // Try matching station
        let allStations = TVStationCatalogue.allStations()
        if let matched = allStations.first(where: { $0.title.lowercased().contains(q) || $0.id.lowercased().contains(q) }) {
            TVPlaybackController.shared.playStation(matched)
            return .result(dialog: "Playing \(matched.title)")
        }

        // Try matching podcast
        let allPods = TVSubscriptionManager.shared.subscribedPodcasts + TVPodcastManager.shared.featuredPodcasts
        if let pod = allPods.first(where: { $0.title.lowercased().contains(q) }) {
            await withCheckedContinuation { continuation in
                TVPodcastManager.shared.fetchEpisodes(for: pod) { episodes in
                    if let ep = episodes.first {
                        TVPlaybackController.shared.playEpisode(ep, podcast: pod)
                    }
                    continuation.resume()
                }
            }
            return .result(dialog: "Playing \(pod.title)")
        }

        if let def = allStations.first {
            TVPlaybackController.shared.playStation(def)
            return .result(dialog: "Playing \(def.title)")
        }
        return .result(dialog: "No match found")
    }
}

struct TVResumePlaybackIntent: AppIntent {
    static var title: LocalizedStringResource = "Resume Radio"
    static var description = IntentDescription("Resumes playback in British Radio Player.")

    init() {}

    @MainActor
    func perform() async throws -> some IntentResult {
        TVPlaybackController.shared.resume()
        return .result()
    }
}

struct TVStopPlaybackIntent: AppIntent {
    static var title: LocalizedStringResource = "Stop Radio"
    static var description = IntentDescription("Stops playback in British Radio Player.")

    init() {}

    @MainActor
    func perform() async throws -> some IntentResult {
        TVPlaybackController.shared.pause()
        return .result()
    }
}

// MARK: - TV App Shortcuts Provider

struct TVSiriShortcutsProvider: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: TVPlayStationIntent(),
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
            intent: TVPlayPodcastIntent(),
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
            intent: TVPlayRandomPodcastIntent(),
            phrases: [
                "Play random podcast on \(.applicationName)",
                "Play a random podcast on \(.applicationName)"
            ],
            shortTitle: "Play Random Podcast",
            systemImageName: "shuffle"
        )
        AppShortcut(
            intent: TVPlayFromSearchIntent(),
            phrases: [
                "Search and play with \(.applicationName)",
                "Search and play on \(.applicationName)",
                "Play \(.applicationName)"
            ],
            shortTitle: "Voice Search",
            systemImageName: "magnifyingglass"
        )
        AppShortcut(
            intent: TVResumePlaybackIntent(),
            phrases: [
                "Resume radio on \(.applicationName)",
                "Resume playback on \(.applicationName)"
            ],
            shortTitle: "Resume Radio",
            systemImageName: "play.fill"
        )
        AppShortcut(
            intent: TVStopPlaybackIntent(),
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
