import AppIntents
import Foundation
import UIKit
import Intents
import React

// MARK: - Pending voice action written before app open

public enum SiriPendingAction {
    public static let appGroup = "group.com.hyliankid14.bbcradioplayer"
    public static let userDefaultsKey = "brp_siri_pending_url"

    public static func post(url: String) {
        let defaults = UserDefaults(suiteName: appGroup) ?? .standard
        defaults.set(url, forKey: userDefaultsKey)
        defaults.synchronize()
    }

    public static func consume() -> String? {
        let defaults = UserDefaults(suiteName: appGroup) ?? .standard
        guard let url = defaults.string(forKey: userDefaultsKey), !url.isEmpty else { return nil }
        defaults.removeObject(forKey: userDefaultsKey)
        defaults.synchronize()
        return url
    }
}

// MARK: - SiriKit INPlayMediaIntent Handler (In-App)

@objc public final class PlayMediaIntentHandler: NSObject, INPlayMediaIntentHandling {
    public static let shared = PlayMediaIntentHandler()

    public func confirm(intent: INPlayMediaIntent, completion: @escaping (INPlayMediaIntentResponse) -> Void) {
        completion(INPlayMediaIntentResponse(code: .ready, userActivity: nil))
    }

    public func handle(intent: INPlayMediaIntent, completion: @escaping (INPlayMediaIntentResponse) -> Void) {
        let query = intent.mediaSearch?.mediaName ?? intent.mediaSearch?.artistName ?? intent.mediaItems?.first?.title ?? ""
        let urlString: String
        if !query.isEmpty {
            let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
            urlString = "bbcradioplayer://voice/play?query=\(encoded)"
        } else {
            urlString = "bbcradioplayer://voice/resume"
        }

        SiriPendingAction.post(url: urlString)

        DispatchQueue.main.async {
            if let url = URL(string: urlString) {
                _ = RCTLinkingManager.application(UIApplication.shared, open: url, options: [:])
            }
        }

        let response = INPlayMediaIntentResponse(code: .success, userActivity: nil)
        completion(response)
    }

    public func resolveMediaItems(for intent: INPlayMediaIntent, with completion: @escaping ([INPlayMediaMediaItemResolutionResult]) -> Void) {
        let query = intent.mediaSearch?.mediaName ?? intent.mediaSearch?.artistName ?? intent.mediaItems?.first?.title ?? ""
        if query.isEmpty {
            completion([.notRequired()])
            return
        }
        let item = INMediaItem(
            identifier: query,
            title: query,
            type: .radioStation,
            artwork: nil
        )
        completion([.success(with: item)])
    }
}

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
        .init(id: "radio1", title: "BBC Radio 1", category: "National"),
        .init(id: "1xtra", title: "Radio 1Xtra", category: "National"),
        .init(id: "1xtra", title: "BBC Radio 1Xtra", category: "National"),
        .init(id: "radio1dance", title: "Radio 1 Dance", category: "National"),
        .init(id: "radio1dance", title: "BBC Radio 1 Dance", category: "National"),
        .init(id: "radio1anthems", title: "Radio 1 Anthems", category: "National"),
        .init(id: "radio1anthems", title: "BBC Radio 1 Anthems", category: "National"),
        .init(id: "radio2", title: "Radio 2", category: "National"),
        .init(id: "radio2", title: "BBC Radio 2", category: "National"),
        .init(id: "radio3", title: "Radio 3", category: "National"),
        .init(id: "radio3", title: "BBC Radio 3", category: "National"),
        .init(id: "radio3unwind", title: "Radio 3 Unwind", category: "National"),
        .init(id: "radio3unwind", title: "BBC Radio 3 Unwind", category: "National"),
        .init(id: "radio4", title: "Radio 4", category: "National"),
        .init(id: "radio4", title: "BBC Radio 4", category: "National"),
        .init(id: "radio4extra", title: "Radio 4 Extra", category: "National"),
        .init(id: "radio4extra", title: "BBC Radio 4 Extra", category: "National"),
        .init(id: "radio5live", title: "Radio 5 Live", category: "National"),
        .init(id: "radio5live", title: "BBC Radio 5 Live", category: "National"),
        .init(id: "radio5livesportsextra", title: "Radio 5 Sports Extra", category: "National"),
        .init(id: "radio5livesportsextra", title: "BBC Radio 5 Sports Extra", category: "National"),
        .init(id: "radio6", title: "Radio 6 Music", category: "National"),
        .init(id: "radio6", title: "BBC Radio 6 Music", category: "National"),
        .init(id: "radio6", title: "6 Music", category: "National"),
        .init(id: "radio6indieforever", title: "Radio 6 Indie Forever", category: "National"),
        .init(id: "asiannetwork", title: "Asian Network", category: "National"),
        .init(id: "asiannetwork", title: "BBC Asian Network", category: "National"),
        .init(id: "worldservice", title: "World Service", category: "National"),
        .init(id: "worldservice", title: "BBC World Service", category: "National"),
        .init(id: "livenews", title: "Live News", category: "National"),
        .init(id: "livenews", title: "BBC Live News", category: "National"),
        .init(id: "radioscotland", title: "Radio Scotland", category: "Regions"),
        .init(id: "radioscotland", title: "BBC Radio Scotland", category: "Regions"),
        .init(id: "radiowales", title: "Radio Wales", category: "Regions"),
        .init(id: "radiowales", title: "BBC Radio Wales", category: "Regions"),
        .init(id: "radioulster", title: "Radio Ulster", category: "Regions"),
        .init(id: "radioulster", title: "BBC Radio Ulster", category: "Regions"),
        .init(id: "radiofoyle", title: "Radio Foyle", category: "Regions"),
        .init(id: "radiofoyle", title: "BBC Radio Foyle", category: "Regions"),
        .init(id: "radionangaidheal", title: "Radio nan Gàidheal", category: "Regions"),
        .init(id: "radionangaidheal", title: "BBC Radio nan Gàidheal", category: "Regions"),
        .init(id: "radiocymru", title: "Radio Cymru", category: "Regions"),
        .init(id: "radiocymru", title: "BBC Radio Cymru", category: "Regions"),
        .init(id: "radiocymru2", title: "Radio Cymru 2", category: "Regions"),
        .init(id: "radiocymru2", title: "BBC Radio Cymru 2", category: "Regions"),
        .init(id: "radiolon", title: "Radio London", category: "Local"),
        .init(id: "radiolon", title: "BBC Radio London", category: "Local"),
        .init(id: "radiomanchester", title: "Radio Manchester", category: "Local"),
        .init(id: "radiomanchester", title: "BBC Radio Manchester", category: "Local")
    ]

    private func resolveStations() -> [SiriStationEntity] {
        let rawList: [(id: String, title: String, category: String)]
        let carplayList = CarPlayStationRepository.all
        if !carplayList.isEmpty {
            rawList = carplayList.map { ($0.id, $0.title, $0.category.rawValue.capitalized) }
        } else {
            let widgetList = WidgetSharedState.loadStations()
            if !widgetList.isEmpty {
                rawList = widgetList.map { ($0.id, $0.title, $0.category) }
            } else {
                return Self.fallbackStations
            }
        }

        var results: [SiriStationEntity] = []
        var seenKeys = Set<String>()
        for item in rawList {
            let key1 = "\(item.id):\(item.title.lowercased())"
            if !seenKeys.contains(key1) {
                seenKeys.insert(key1)
                results.append(SiriStationEntity(id: item.id, title: item.title, category: item.category))
            }
            if !item.title.lowercased().hasPrefix("bbc ") {
                let bbcTitle = "BBC \(item.title)"
                let key2 = "\(item.id):\(bbcTitle.lowercased())"
                if !seenKeys.contains(key2) {
                    seenKeys.insert(key2)
                    results.append(SiriStationEntity(id: item.id, title: bbcTitle, category: item.category))
                }
            }
        }
        return results.isEmpty ? Self.fallbackStations : results
    }

    private static func normalize(_ text: String) -> String {
        var s = text.lowercased()
        let numMap = [
            "one": "1", "two": "2", "three": "3", "four": "4",
            "five": "5", "six": "6"
        ]
        for (w, d) in numMap {
            s = s.replacingOccurrences(of: "\\b\(w)\\b", with: d, options: .regularExpression)
        }
        s = s.replacingOccurrences(of: "\\bbbc\\b", with: "", options: .regularExpression)
        s = s.replacingOccurrences(of: "\\bradio\\b", with: "", options: .regularExpression)
        s = s.replacingOccurrences(of: "\\bthe\\b", with: "", options: .regularExpression)
        let alpha = s.components(separatedBy: CharacterSet.alphanumerics.inverted).joined()
        return alpha.trimmingCharacters(in: .whitespaces)
    }

    func entities(matching string: String) async throws -> [SiriStationEntity] {
        let rawQuery = string.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !rawQuery.isEmpty else { return [] }

        let stations = resolveStations()

        // 1. Direct equality
        let exactMatches = stations.filter {
            $0.title.lowercased() == rawQuery || $0.id.lowercased() == rawQuery
        }
        if !exactMatches.isEmpty { return exactMatches }

        // 2. Contains matching
        let containsMatches = stations.filter {
            let t = $0.title.lowercased()
            return t.contains(rawQuery) || rawQuery.contains(t)
        }
        if !containsMatches.isEmpty { return containsMatches }

        // 3. Normalized token matching (e.g. "bbc radio 4" -> "4", matching "Radio 4")
        let cleanQ = Self.normalize(rawQuery)
        if !cleanQ.isEmpty {
            let normalizedMatches = stations.filter {
                let cleanT = Self.normalize($0.title)
                return cleanT == cleanQ || cleanT.contains(cleanQ) || cleanQ.contains(cleanT)
            }
            if !normalizedMatches.isEmpty { return normalizedMatches }
        }

        return stations.filter { $0.category.lowercased().contains(rawQuery) }
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
        .init(id: "p02nq0gn", title: "BBC The Archers", author: "BBC Radio 4"),
        .init(id: "p002vsxs", title: "Desert Island Discs", author: "BBC Radio 4"),
        .init(id: "p002vsxs", title: "BBC Desert Island Discs", author: "BBC Radio 4"),
        .init(id: "p004y29g", title: "In Our Time", author: "BBC Radio 4"),
        .init(id: "p004y29g", title: "BBC In Our Time", author: "BBC Radio 4"),
        .init(id: "p02pc9ny", title: "Friday Night Comedy", author: "BBC Radio 4"),
        .init(id: "p02pc9ny", title: "BBC Friday Night Comedy", author: "BBC Radio 4"),
        .init(id: "b006qshd", title: "More or Less", author: "BBC Radio 4"),
        .init(id: "b006qshd", title: "BBC More or Less", author: "BBC Radio 4"),
        .init(id: "p07mck39", title: "You're Dead To Me", author: "BBC Radio 4"),
        .init(id: "p07mck39", title: "BBC You're Dead To Me", author: "BBC Radio 4"),
        .init(id: "p052994h", title: "Newscast", author: "BBC Sounds"),
        .init(id: "p052994h", title: "BBC Newscast", author: "BBC Sounds"),
        .init(id: "p02nq08x", title: "Global News Podcast", author: "BBC World Service"),
        .init(id: "p02nq08x", title: "BBC Global News Podcast", author: "BBC World Service")
    ]

    private func resolvePodcasts() -> [SiriPodcastEntity] {
        let snapshot = CarPlayState.shared.snapshot
        var seen = Set<String>()
        var list: [SiriPodcastEntity] = []

        for p in snapshot.subscriptions where !seen.contains(p.id) {
            seen.insert(p.id)
            list.append(SiriPodcastEntity(id: p.id, title: p.title, author: "Subscribed"))
            if !p.title.lowercased().hasPrefix("bbc ") {
                list.append(SiriPodcastEntity(id: p.id, title: "BBC \(p.title)", author: "Subscribed"))
            }
        }
        for p in snapshot.catalog where !seen.contains(p.id) {
            seen.insert(p.id)
            list.append(SiriPodcastEntity(id: p.id, title: p.title, author: "BBC"))
            if !p.title.lowercased().hasPrefix("bbc ") {
                list.append(SiriPodcastEntity(id: p.id, title: "BBC \(p.title)", author: "BBC"))
            }
        }

        return list.isEmpty ? Self.fallbackPodcasts : list
    }

    func entities(matching string: String) async throws -> [SiriPodcastEntity] {
        let query = string.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else { return [] }
        return resolvePodcasts().filter {
            let t = $0.title.lowercased()
            let a = $0.author.lowercased()
            return t.contains(query) || query.contains(t) || a.contains(query)
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

        SiriPendingAction.post(url: urlString)

        DispatchQueue.main.async {
            if let url = URL(string: urlString) {
                _ = RCTLinkingManager.application(UIApplication.shared, open: url, options: [:])
            }
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

        SiriPendingAction.post(url: urlString)

        DispatchQueue.main.async {
            if let url = URL(string: urlString) {
                _ = RCTLinkingManager.application(UIApplication.shared, open: url, options: [:])
            }
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
        let urlString = "bbcradioplayer://voice/play?random=true"
        SiriPendingAction.post(url: urlString)

        DispatchQueue.main.async {
            if let url = URL(string: urlString) {
                _ = RCTLinkingManager.application(UIApplication.shared, open: url, options: [:])
            }
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

        SiriPendingAction.post(url: urlString)

        DispatchQueue.main.async {
            if let url = URL(string: urlString) {
                _ = RCTLinkingManager.application(UIApplication.shared, open: url, options: [:])
            }
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
        let urlString = "bbcradioplayer://voice/resume"
        SiriPendingAction.post(url: urlString)

        DispatchQueue.main.async {
            if let url = URL(string: urlString) {
                _ = RCTLinkingManager.application(UIApplication.shared, open: url, options: [:])
            }
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
        let urlString = "bbcradioplayer://voice/stop"
        SiriPendingAction.post(url: urlString)

        DispatchQueue.main.async {
            if let url = URL(string: urlString) {
                _ = RCTLinkingManager.application(UIApplication.shared, open: url, options: [:])
            }
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
                "Play \(\.$station) in \(.applicationName)",
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
                "Play \(\.$podcast) in \(.applicationName)",
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
                "Play a random podcast on \(.applicationName)",
                "Play random podcast with \(.applicationName)"
            ],
            shortTitle: "Play Random Podcast",
            systemImageName: "shuffle"
        )
        AppShortcut(
            intent: PlayFromSearchIntent(),
            phrases: [
                "Search and play with \(.applicationName)",
                "Search and play on \(.applicationName)",
                "Voice search on \(.applicationName)",
                "Play \(.applicationName)"
            ],
            shortTitle: "Voice Search",
            systemImageName: "magnifyingglass"
        )
        AppShortcut(
            intent: ResumePlaybackIntent(),
            phrases: [
                "Resume radio on \(.applicationName)",
                "Resume playback on \(.applicationName)",
                "Resume with \(.applicationName)"
            ],
            shortTitle: "Resume Radio",
            systemImageName: "play.fill"
        )
        AppShortcut(
            intent: StopPlaybackIntent(),
            phrases: [
                "Stop radio on \(.applicationName)",
                "Stop playback on \(.applicationName)",
                "Stop \(.applicationName)"
            ],
            shortTitle: "Stop Radio",
            systemImageName: "stop.fill"
        )
    }

    static var shortcutTileColor: ShortcutTileColor = .red
}
