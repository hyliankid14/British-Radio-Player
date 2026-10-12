import AppIntents
import Foundation
import UIKit

// MARK: - Station Entity & Query

struct SiriStationEntity: AppEntity, Hashable {
    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Station")
    static var defaultQuery = SiriStationQuery()

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

struct SiriStationQuery: EntityStringQuery {
    static let fallbackStations: [SiriStationEntity] = [
        .init(id: "radio1", title: "Radio 1", category: "National"),
        .init(id: "1xtra", title: "Radio 1Xtra", category: "National"),
        .init(id: "radio1dance", title: "Radio 1 Dance", category: "National"),
        .init(id: "radio1anthems", title: "Radio 1 Anthems", category: "National"),
        .init(id: "radio2", title: "Radio 2", category: "National"),
        .init(id: "radio3", title: "Radio 3", category: "National"),
        .init(id: "radio3unwind", title: "Radio 3 Unwind", category: "National"),
        .init(id: "radio4", title: "Radio 4", category: "National"),
        .init(id: "radio4extra", title: "Radio 4 Extra", category: "National"),
        .init(id: "radio5live", title: "Radio 5 Live", category: "National"),
        .init(id: "radio5livesportsextra", title: "Radio 5 Sports Extra", category: "National"),
        .init(id: "radio6", title: "Radio 6 Music", category: "National"),
        .init(id: "asiannetwork", title: "Asian Network", category: "National"),
        .init(id: "worldservice", title: "World Service", category: "National"),
        .init(id: "radioscotland", title: "Radio Scotland", category: "Regions"),
        .init(id: "radiowales", title: "Radio Wales", category: "Regions"),
        .init(id: "radioulster", title: "Radio Ulster", category: "Regions"),
        .init(id: "radiofoyle", title: "Radio Foyle", category: "Regions"),
        .init(id: "radionangaidheal", title: "Radio nan Gàidheal", category: "Regions"),
        .init(id: "radiocymru", title: "Radio Cymru", category: "Regions")
    ]

    private func resolveStations() -> [SiriStationEntity] {
        let carplayList = CarPlayStationRepository.all
        if !carplayList.isEmpty {
            return carplayList.map {
                SiriStationEntity(id: $0.id, title: $0.title, category: $0.category.rawValue.capitalized)
            }
        }
        let widgetList = WidgetSharedState.loadStations()
        if !widgetList.isEmpty {
            return widgetList.map {
                SiriStationEntity(id: $0.id, title: $0.title, category: $0.category)
            }
        }
        return Self.fallbackStations
    }

    func entities(matching string: String) async throws -> [SiriStationEntity] {
        let query = string.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return resolveStations().filter {
            $0.title.lowercased().contains(query) || $0.category.lowercased().contains(query)
        }
    }

    func entities(for identifiers: [String]) async throws -> [SiriStationEntity] {
        let wanted = Set(identifiers)
        return resolveStations().filter { wanted.contains($0.id) }
    }

    func suggestedEntities() async throws -> [SiriStationEntity] {
        resolveStations()
    }

    func defaultResult() async -> SiriStationEntity? {
        try? await suggestedEntities().first
    }
}

// MARK: - Podcast Entity & Query

struct SiriPodcastEntity: AppEntity, Hashable {
    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Podcast")
    static var defaultQuery = SiriPodcastQuery()

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

struct SiriPodcastQuery: EntityStringQuery {
    static let fallbackPodcasts: [SiriPodcastEntity] = [
        .init(id: "p02nq0gn", title: "The Archers", author: "BBC Radio 4"),
        .init(id: "p002vsxs", title: "Desert Island Discs", author: "BBC Radio 4"),
        .init(id: "p004y29g", title: "In Our Time", author: "BBC Radio 4"),
        .init(id: "p02pc9ny", title: "Friday Night Comedy", author: "BBC Radio 4"),
        .init(id: "p02nq0lx", title: "More or Less", author: "BBC Radio 4"),
        .init(id: "p07mck39", title: "You're Dead To Me", author: "BBC Radio 4"),
        .init(id: "p052994h", title: "Newscast", author: "BBC Sounds"),
        .init(id: "p02nq08x", title: "Global News Podcast", author: "BBC World Service")
    ]

    private func resolvePodcasts() -> [SiriPodcastEntity] {
        let snapshot = CarPlayState.shared.snapshot
        var seen = Set<String>()
        var list: [SiriPodcastEntity] = []

        for p in snapshot.subscriptions where !seen.contains(p.id) {
            seen.insert(p.id)
            list.append(SiriPodcastEntity(id: p.id, title: p.title, author: "Subscribed"))
        }
        for p in snapshot.catalog where !seen.contains(p.id) {
            seen.insert(p.id)
            list.append(SiriPodcastEntity(id: p.id, title: p.title, author: "BBC"))
        }

        return list.isEmpty ? Self.fallbackPodcasts : list
    }

    func entities(matching string: String) async throws -> [SiriPodcastEntity] {
        let query = string.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return resolvePodcasts().filter {
            $0.title.lowercased().contains(query) || $0.author.lowercased().contains(query)
        }
    }

    func entities(for identifiers: [String]) async throws -> [SiriPodcastEntity] {
        let wanted = Set(identifiers)
        return resolvePodcasts().filter { wanted.contains($0.id) }
    }

    func suggestedEntities() async throws -> [SiriPodcastEntity] {
        resolvePodcasts()
    }

    func defaultResult() async -> SiriPodcastEntity? {
        try? await suggestedEntities().first
    }
}

// MARK: - App Intents

struct PlayStationIntent: AppIntent {
    static var title: LocalizedStringResource = "Play Station"
    static var description = IntentDescription("Plays a BBC radio station in British Radio Player.")
    static var openAppWhenRun: Bool = true

    @Parameter(title: "Station")
    var station: SiriStationEntity?

    static var parameterSummary: some ParameterSummary {
        Summary("Play \(\.$station)")
    }

    init() {}

    init(station: SiriStationEntity?) {
        self.station = station
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        let urlString: String
        if let stationId = station?.id, !stationId.isEmpty {
            urlString = "bbcradioplayer://voice/play?station=\(stationId)"
        } else {
            urlString = "bbcradioplayer://voice/play"
        }
        if let url = URL(string: urlString) {
            await UIApplication.shared.open(url)
        }
        return .result()
    }
}

struct PlayPodcastIntent: AppIntent {
    static var title: LocalizedStringResource = "Play Podcast"
    static var description = IntentDescription("Plays a BBC podcast in British Radio Player.")
    static var openAppWhenRun: Bool = true

    @Parameter(title: "Podcast")
    var podcast: SiriPodcastEntity?

    static var parameterSummary: some ParameterSummary {
        Summary("Play \(\.$podcast)")
    }

    init() {}

    init(podcast: SiriPodcastEntity?) {
        self.podcast = podcast
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        let urlString: String
        if let podcastId = podcast?.id, !podcastId.isEmpty {
            urlString = "bbcradioplayer://voice/play?podcast=\(podcastId)"
        } else {
            urlString = "bbcradioplayer://voice/play?podcast=recent"
        }
        if let url = URL(string: urlString) {
            await UIApplication.shared.open(url)
        }
        return .result()
    }
}

struct PlayRandomPodcastIntent: AppIntent {
    static var title: LocalizedStringResource = "Play Random Podcast"
    static var description = IntentDescription("Plays a random BBC podcast in British Radio Player.")
    static var openAppWhenRun: Bool = true

    init() {}

    @MainActor
    func perform() async throws -> some IntentResult {
        if let url = URL(string: "bbcradioplayer://voice/play?random=true") {
            await UIApplication.shared.open(url)
        }
        return .result()
    }
}

struct PlayFromSearchIntent: AppIntent {
    static var title: LocalizedStringResource = "Voice Search & Play"
    static var description = IntentDescription("Searches and plays a BBC station or podcast by voice.")
    static var openAppWhenRun: Bool = true

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
        let urlString: String
        if let q = query?.trimmingCharacters(in: .whitespacesAndNewlines), !q.isEmpty,
           let encoded = q.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) {
            urlString = "bbcradioplayer://voice/play?query=\(encoded)"
        } else {
            urlString = "bbcradioplayer://voice/resume"
        }
        if let url = URL(string: urlString) {
            await UIApplication.shared.open(url)
        }
        return .result()
    }
}

struct ResumePlaybackIntent: AppIntent {
    static var title: LocalizedStringResource = "Resume Radio"
    static var description = IntentDescription("Resumes playback in British Radio Player.")
    static var openAppWhenRun: Bool = true

    init() {}

    @MainActor
    func perform() async throws -> some IntentResult {
        if let url = URL(string: "bbcradioplayer://voice/resume") {
            await UIApplication.shared.open(url)
        }
        return .result()
    }
}

struct StopPlaybackIntent: AppIntent {
    static var title: LocalizedStringResource = "Stop Radio"
    static var description = IntentDescription("Stops current playback in British Radio Player.")
    static var openAppWhenRun: Bool = true

    init() {}

    @MainActor
    func perform() async throws -> some IntentResult {
        if let url = URL(string: "bbcradioplayer://voice/stop") {
            await UIApplication.shared.open(url)
        }
        return .result()
    }
}

// MARK: - App Shortcuts Provider

struct SiriShortcutsProvider: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: PlayStationIntent(),
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
            intent: PlayPodcastIntent(),
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
            intent: PlayRandomPodcastIntent(),
            phrases: [
                "Play random podcast on \(.applicationName)",
                "Play a random podcast on \(.applicationName)"
            ],
            shortTitle: "Play Random Podcast",
            systemImageName: "shuffle"
        )
        AppShortcut(
            intent: PlayFromSearchIntent(),
            phrases: [
                "Play \(\.$query) on \(.applicationName)",
                "Play \(\.$query) with \(.applicationName)",
                "Play \(.applicationName)"
            ],
            shortTitle: "Voice Search",
            systemImageName: "magnifyingglass"
        )
        AppShortcut(
            intent: ResumePlaybackIntent(),
            phrases: [
                "Resume radio on \(.applicationName)",
                "Resume playback on \(.applicationName)"
            ],
            shortTitle: "Resume Radio",
            systemImageName: "play.fill"
        )
        AppShortcut(
            intent: StopPlaybackIntent(),
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
