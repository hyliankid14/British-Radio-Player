import Foundation

struct EpisodeSearchResult: Identifiable, Equatable {
    let id: String
    let podcastID: String
    let podcastTitle: String
    let episodeTitle: String
    let episodeDescription: String
    let audioURL: URL?
    let pubEpoch: Int?
}

struct PlayedEpisodeHistoryEntry: Identifiable, Codable, Equatable {
    let id: String
    let title: String
    let description: String
    let audioURLString: String
    let imageURLString: String?
    let pubDate: String
    let durationMins: Int
    let podcastID: String
    let podcastTitle: String?
    let playedAt: Date

    init(episode: Episode, podcastTitle: String?, playedAt: Date = Date()) {
        self.id = episode.id
        self.title = episode.title
        self.description = episode.description
        self.audioURLString = episode.audioURL.absoluteString
        self.imageURLString = episode.imageURL?.absoluteString
        self.pubDate = episode.pubDate
        self.durationMins = episode.durationMins
        self.podcastID = episode.podcastID
        self.podcastTitle = podcastTitle
        self.playedAt = playedAt
    }

    var asEpisode: Episode? {
        guard let audioURL = URL(string: audioURLString) else { return nil }
        return Episode(
            id: id,
            title: title,
            description: description,
            audioURL: audioURL,
            imageURL: imageURLString.flatMap(URL.init(string:)),
            pubDate: pubDate,
            durationMins: durationMins,
            podcastID: podcastID
        )
    }
}

enum PodcastSortOption: String, CaseIterable, Identifiable {
    case mostPopular = "Most Popular"
    case mostRecent = "Most Recent"
    case alphabetical = "Alphabetical (A-Z)"

    var id: String { rawValue }
}

enum EpisodeSortOption: String, CaseIterable, Identifiable {
    case newestFirst = "Newest First"
    case oldestFirst = "Oldest First"

    var id: String { rawValue }
}

@MainActor
final class PodcastsViewModel: ObservableObject {
    @Published private(set) var podcasts: [Podcast] = []
    @Published private(set) var episodes: [Episode] = []
    @Published private(set) var selectedPodcast: Podcast?
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?
    @Published var searchText: String = ""
    @Published var selectedGenre: String = "All Genres"
    @Published var selectedSort: PodcastSortOption = .mostPopular
    @Published var episodeSortOption: EpisodeSortOption = .newestFirst
    @Published private(set) var playedEpisodeIDs: Set<String> = []
    @Published private(set) var episodeSearchResults: [EpisodeSearchResult] = []
    @Published private(set) var isEpisodeSearchLoading = false
    @Published private(set) var isRefreshingEpisodeIndex = false
    @Published private(set) var savedSearches: [String] = []
    @Published private(set) var playedHistory: [PlayedEpisodeHistoryEntry] = []
    @Published private(set) var indexPodcastCount: Int = 0
    @Published private(set) var indexEpisodeCount: Int = 0

    private let podcastRepository: PodcastRepository
    private let remoteIndexClient: RemoteIndexClient
    private let audioPlayerService: AudioPlayerService
    private let favoritesStore: FavoritesStore
    private let appSettingsStore: AppSettingsStore
    private let episodeDownloadService: EpisodeDownloadService
    private let defaults: UserDefaults
    private var indexedPodcastsByID: [String: RemoteIndexPodcast] = [:]
    private var indexedEpisodes: [RemoteIndexEpisode] = []
    private var indexedEpisodeCorpus: [(episode: RemoteIndexEpisode, searchable: String)] = []
    private var latestEpisodeEpochByPodcastID: [String: Int] = [:]
    private var hasLoadedRemoteIndex = false

    private static let savedSearchesKey = "saved_podcast_episode_searches"
    private static let playedHistoryKey = "played_podcast_episode_history"
    private static let maxPlayedHistoryEntries = 20
    private static let indexRefreshInterval: TimeInterval = 60 * 60 * 24

    init(
        podcastRepository: PodcastRepository,
        remoteIndexClient: RemoteIndexClient,
        audioPlayerService: AudioPlayerService,
        favoritesStore: FavoritesStore,
        appSettingsStore: AppSettingsStore,
        episodeDownloadService: EpisodeDownloadService,
        defaults: UserDefaults = .standard
    ) {
        self.podcastRepository = podcastRepository
        self.remoteIndexClient = remoteIndexClient
        self.audioPlayerService = audioPlayerService
        self.favoritesStore = favoritesStore
        self.appSettingsStore = appSettingsStore
        self.episodeDownloadService = episodeDownloadService
        self.defaults = defaults
        loadPlayedEpisodes()
        loadSavedSearches()
        loadPlayedHistory()
    }

    func loadPodcasts() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            podcasts = try await podcastRepository.fetchPodcasts(forceRefresh: false)
            await loadIndexSummaryIfNeeded()
        } catch {
            let message = (error as NSError).localizedDescription
            errorMessage = message == "The operation couldn’t be completed." ? "The BBC podcast feed could not be parsed." : message
        }
    }

    func selectPodcast(_ podcast: Podcast) async {
        selectedPodcast = podcast
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            episodes = try await podcastRepository.fetchEpisodes(for: podcast)
        } catch {
            errorMessage = "Could not load episodes for \(podcast.title)."
            episodes = []
        }
    }

    func play(_ episode: Episode) {
        let playableEpisode = resolvedEpisodeForPlayback(episode)
        markEpisodeAsPlayed(playableEpisode, podcastTitle: selectedPodcast?.title)
        audioPlayerService.play(
            episode: playableEpisode,
            podcastTitle: selectedPodcast?.title,
            podcastArtworkURL: selectedPodcast?.imageURL
        )
    }

    func play(_ episode: Episode, podcastTitle: String?) {
        let playableEpisode = resolvedEpisodeForPlayback(episode)
        markEpisodeAsPlayed(playableEpisode, podcastTitle: podcastTitle)
        audioPlayerService.play(
            episode: playableEpisode,
            podcastTitle: podcastTitle,
            podcastArtworkURL: selectedPodcast?.imageURL
        )
    }

    func clearSelection() {
        selectedPodcast = nil
        episodes = []
    }

    func markEpisodeAsPlayed(_ episode: Episode, podcastTitle: String? = nil) {
        playedEpisodeIDs.insert(episode.id)
        savePlayedEpisodes()
        appendPlayedHistory(episode, podcastTitle: podcastTitle)
    }

    func isEpisodePlayed(_ episode: Episode) -> Bool {
        playedEpisodeIDs.contains(episode.id)
    }

    // MARK: - Podcast Subscriptions
    func toggleSubscription(for podcast: Podcast) {
        favoritesStore.toggleSubscription(podcast: podcast)
    }

    func isSubscribed(to podcast: Podcast) -> Bool {
        favoritesStore.isSubscribed(podcastID: podcast.id)
    }

    // MARK: - Episode Saves
    func toggleSavedEpisode(_ episode: Episode) {
        favoritesStore.toggleSaved(episode: episode, podcastTitle: selectedPodcast?.title)
    }

    func isSavedEpisode(_ episode: Episode) -> Bool {
        favoritesStore.isSaved(episodeID: episode.id)
    }

    func searchEpisodesFromIndex(limit: Int = 60) async {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else {
            episodeSearchResults = []
            return
        }

        isEpisodeSearchLoading = true
        defer { isEpisodeSearchLoading = false }

        do {
            try await ensureRemoteIndexLoaded()

            let queryMatcher = QueryMatcher(query: query)

            let results = indexedEpisodeCorpus.lazy
                .filter { entry in
                    queryMatcher.matches(entry.searchable)
                }
                .prefix(limit)
                .map { entry -> EpisodeSearchResult in
                    let episode = entry.episode
                    let podcastTitle = self.indexedPodcastsByID[episode.podcastId]?.title ?? "Podcast"
                    let stableID = "\(episode.podcastId)|\(episode.audioUrl ?? episode.title)"
                    return EpisodeSearchResult(
                        id: stableID,
                        podcastID: episode.podcastId,
                        podcastTitle: podcastTitle,
                        episodeTitle: episode.title,
                        episodeDescription: episode.description,
                        audioURL: episode.audioUrl.flatMap(URL.init(string:)),
                        pubEpoch: episode.pubEpoch
                    )
                }

            episodeSearchResults = Array(results)
        } catch {
            episodeSearchResults = []
        }
    }

    func saveCurrentSearch() {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return }

        var updated = savedSearches.filter { $0.caseInsensitiveCompare(query) != .orderedSame }
        updated.insert(query, at: 0)
        if updated.count > 20 {
            updated = Array(updated.prefix(20))
        }
        savedSearches = updated
        defaults.set(savedSearches, forKey: Self.savedSearchesKey)
    }

    func removeSavedSearch(at offsets: IndexSet) {
        savedSearches.remove(atOffsets: offsets)
        defaults.set(savedSearches, forKey: Self.savedSearchesKey)
    }

    func removePlayedHistory(at offsets: IndexSet) {
        playedHistory.remove(atOffsets: offsets)
        persistPlayedHistory()
    }

    func applySavedSearch(_ query: String) {
        searchText = query
        selectedSort = .mostRecent
    }

    func resetFilters() {
        searchText = ""
        selectedGenre = "All Genres"
        selectedSort = .mostPopular
        episodeSearchResults = []
    }

    var hasActiveFilters: Bool {
        !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
        selectedGenre != "All Genres" ||
        selectedSort != .mostPopular
    }

    func refreshEpisodeIndex(force: Bool) async -> Bool {
        if !force,
           hasLoadedRemoteIndex,
           let last = appSettingsStore.episodeIndexLastUpdated,
           Date().timeIntervalSince(last) < Self.indexRefreshInterval {
            return true
        }

        isRefreshingEpisodeIndex = true
        defer { isRefreshingEpisodeIndex = false }

        do {
            let index = try await remoteIndexClient.fetchIndex()
            indexedPodcastsByID = Dictionary(uniqueKeysWithValues: index.podcasts.map { ($0.id, $0) })
            indexedEpisodes = index.episodes
            indexedEpisodeCorpus = index.episodes.map { episode in
                let searchable = "\(episode.title) \(episode.description)".lowercased()
                return (episode: episode, searchable: searchable)
            }
            latestEpisodeEpochByPodcastID = Dictionary(index.episodes.compactMap { episode in
                guard let epoch = episode.pubEpoch else { return nil }
                return (episode.podcastId, normalisedEpoch(epoch))
            }, uniquingKeysWith: max)
            indexPodcastCount = index.podcasts.count
            indexEpisodeCount = index.episodes.count
            hasLoadedRemoteIndex = true
            let now = Date()
            appSettingsStore.episodeIndexLastUpdated = now
            return true
        } catch {
            if force {
                errorMessage = "Could not update episode index right now."
            }
            return false
        }
    }

    func refreshEpisodeIndexIfNeeded() async {
        guard appSettingsStore.episodeIndexAutoUpdatesEnabled else { return }
        _ = await refreshEpisodeIndex(force: false)
    }

    func openEpisodeSearchResult(_ result: EpisodeSearchResult) async {
        if podcasts.isEmpty {
            await loadPodcasts()
        }
        guard let podcast = podcasts.first(where: { $0.id == result.podcastID }) else {
            return
        }
        await selectPodcast(podcast)
    }

    func playEpisodeSearchResult(_ result: EpisodeSearchResult) {
        guard let audioURL = result.audioURL else { return }
        let fallbackDate = dateFromEpoch(result.pubEpoch) ?? Date()
        let dateString = ISO8601DateFormatter().string(from: fallbackDate)
        let episode = Episode(
            id: result.id,
            title: result.episodeTitle,
            description: result.episodeDescription,
            audioURL: audioURL,
            imageURL: nil,
            pubDate: dateString,
            durationMins: 0,
            podcastID: result.podcastID
        )
        let playableEpisode = resolvedEpisodeForPlayback(episode)
        markEpisodeAsPlayed(playableEpisode, podcastTitle: result.podcastTitle)
        audioPlayerService.play(
            episode: playableEpisode,
            podcastTitle: result.podcastTitle,
            podcastArtworkURL: nil
        )
    }

    func downloadEpisode(_ episode: Episode, podcastTitle: String?) async -> Bool {
        await episodeDownloadService.downloadEpisode(episode, podcastTitle: podcastTitle)
    }

    func deleteDownloadedEpisode(_ episode: Episode) {
        episodeDownloadService.deleteDownload(for: episode)
    }

    func formattedEpoch(_ epoch: Int?) -> String {
        guard let date = dateFromEpoch(epoch) else { return "" }
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter.string(from: date)
    }

    private func loadPlayedEpisodes() {
        if let savedArray = defaults.array(forKey: "played_episode_ids") as? [String] {
            playedEpisodeIDs = Set(savedArray)
        }
    }

    private func savePlayedEpisodes() {
        defaults.set(Array(playedEpisodeIDs), forKey: "played_episode_ids")
    }

    private func loadSavedSearches() {
        savedSearches = defaults.stringArray(forKey: Self.savedSearchesKey) ?? []
    }

    private func loadPlayedHistory() {
        guard let data = defaults.data(forKey: Self.playedHistoryKey),
              let decoded = try? JSONDecoder().decode([PlayedEpisodeHistoryEntry].self, from: data) else {
            playedHistory = []
            return
        }
        playedHistory = Array(decoded.sorted(by: { $0.playedAt > $1.playedAt }).prefix(Self.maxPlayedHistoryEntries))
    }

    private func appendPlayedHistory(_ episode: Episode, podcastTitle: String?) {
        let entry = PlayedEpisodeHistoryEntry(episode: episode, podcastTitle: podcastTitle)
        var updated = playedHistory.filter { $0.id != entry.id }
        updated.insert(entry, at: 0)
        playedHistory = Array(updated.prefix(Self.maxPlayedHistoryEntries))
        persistPlayedHistory()
    }

    private func persistPlayedHistory() {
        if let data = try? JSONEncoder().encode(playedHistory) {
            defaults.set(data, forKey: Self.playedHistoryKey)
        }
    }

    private func ensureRemoteIndexLoaded() async throws {
        guard !hasLoadedRemoteIndex else { return }
        _ = await refreshEpisodeIndex(force: false)
        guard hasLoadedRemoteIndex else {
            throw URLError(.resourceUnavailable)
        }
    }

    private func loadIndexSummaryIfNeeded() async {
        guard indexPodcastCount == 0, indexEpisodeCount == 0 else { return }
        do {
            let meta = try await remoteIndexClient.fetchMeta()
            indexPodcastCount = meta.podcastCount
            indexEpisodeCount = meta.episodeCount
        } catch {
            // Leave defaults if metadata endpoint is unavailable.
        }
    }

    private func resolvedEpisodeForPlayback(_ episode: Episode) -> Episode {
        guard let localFileURL = episodeDownloadService.localFileURL(for: episode) else {
            return episode
        }

        return Episode(
            id: episode.id,
            title: episode.title,
            description: episode.description,
            audioURL: localFileURL,
            imageURL: episode.imageURL,
            pubDate: episode.pubDate,
            durationMins: episode.durationMins,
            podcastID: episode.podcastID
        )
    }

    var availableGenres: [String] {
        let genres = Set(podcasts.flatMap(\.genres).filter { !$0.isEmpty })
        return ["All Genres"] + genres.sorted()
    }

    var sortedEpisodes: [Episode] {
        let sorted: [Episode]
        switch episodeSortOption {
        case .newestFirst:
            sorted = episodes.sorted { episode1, episode2 in
                parseDate(episode1.pubDate) > parseDate(episode2.pubDate)
            }
        case .oldestFirst:
            sorted = episodes.sorted { episode1, episode2 in
                parseDate(episode1.pubDate) < parseDate(episode2.pubDate)
            }
        }
        return sorted
    }

    private func parseDate(_ dateString: String) -> Date {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        
        // Try common RSS date formats
        let formats = [
            "EEE, dd MMM yyyy HH:mm:ss Z",
            "EEE, dd MMM yyyy HH:mm:ss zzz",
            "yyyy-MM-dd'T'HH:mm:ssZ",
            "yyyy-MM-dd'T'HH:mm:ss.SSSZ",
            "yyyy-MM-dd"
        ]
        
        for format in formats {
            formatter.dateFormat = format
            if let date = formatter.date(from: dateString) {
                return date
            }
        }
        
        // Fallback to current date if parsing fails
        return Date()
    }

    func formattedDate(_ dateString: String) -> String {
        let date = parseDate(dateString)
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter.string(from: date)
    }

    var filteredPodcasts: [Podcast] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        let genreFiltered = podcasts.filter { podcast in
            selectedGenre == "All Genres" || podcast.genres.contains(selectedGenre)
        }

        let searchFiltered: [Podcast]
        if query.isEmpty {
            searchFiltered = genreFiltered
        } else {
            let queryMatcher = QueryMatcher(query: query)
            searchFiltered = genreFiltered.filter { podcast in
                let searchable = "\(podcast.title) \(podcast.description) \(podcast.genres.joined(separator: " "))".lowercased()
                return queryMatcher.matches(searchable)
            }
        }

        switch selectedSort {
        case .mostPopular:
            return searchFiltered.sorted {
                let lhsRank = popularRank(for: $0)
                let rhsRank = popularRank(for: $1)
                if lhsRank != rhsRank {
                    return lhsRank < rhsRank
                }
                return $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending
            }
        case .mostRecent:
            return searchFiltered.sorted {
                let lhsEpoch = latestEpisodeEpochByPodcastID[$0.id] ?? 0
                let rhsEpoch = latestEpisodeEpochByPodcastID[$1.id] ?? 0
                if lhsEpoch != rhsEpoch {
                    return lhsEpoch > rhsEpoch
                }
                return $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending
            }
        case .alphabetical:
            return searchFiltered.sorted {
                $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending
            }
        }
    }

    private func normalisedEpoch(_ epoch: Int) -> Int {
        epoch > 10_000_000_000 ? epoch / 1000 : epoch
    }

    private func dateFromEpoch(_ epoch: Int?) -> Date? {
        guard let epoch else { return nil }
        return Date(timeIntervalSince1970: TimeInterval(normalisedEpoch(epoch)))
    }

    private func popularRank(for podcast: Podcast) -> Int {
        Self.popularRanking[podcast.title.lowercased()] ?? 101
    }

    private static let popularRanking: [String: Int] = [
        "global news podcast": 1,
        "football daily": 2,
        "newshour": 3,
        "radio 1's all day breakfast with greg james": 4,
        "test match special": 5,
        "best of nolan": 6,
        "rugby union weekly": 7,
        "wake up to money": 8,
        "ten to the top": 9,
        "witness history": 10,
        "focus on africa": 11,
        "bbc music introducing mixtape": 12,
        "f1: chequered flag": 13,
        "bbc introducing in oxfordshire & berkshire": 14,
        "business daily": 15,
        "americast": 16,
        "crowdscience": 17,
        "the interview": 18,
        "six o'clock news": 19,
        "science in action": 20,
        "today in parliament": 21,
        "talkback": 22,
        "access all: disability news and mental health": 23,
        "fighting talk": 24,
        "world business report": 25,
        "business matters": 26,
        "tailenders": 27,
        "moral maze": 28,
        "any questions? and any answers?": 29,
        "health check": 30,
        "friday night comedy from bbc radio 4": 31,
        "bbc inside science": 32,
        "people fixing the world": 33,
        "add to playlist": 34,
        "in touch": 35,
        "limelight": 36,
        "evil genius with russell kane": 37,
        "africa daily": 38,
        "broadcasting house": 39,
        "from our own correspondent": 40,
        "newscast": 41,
        "derby county": 42,
        "learning english stories": 43,
        "tech life": 44,
        "world football": 45,
        "private passions": 46,
        "sunday supplement": 47,
        "drama of the week": 48,
        "sporting witness": 49,
        "file on 4 investigates": 50,
        "nottingham forest: shut up and show more football": 51,
        "soul music": 52,
        "westminster hour": 53,
        "inside health": 54,
        "5 live's world football phone-in": 55,
        "over to you": 56,
        "political thinking with nick robinson": 57,
        "sport's strangest crimes": 58,
        "inheritance tracks": 59,
        "the archers": 60,
        "profile": 61,
        "sacked in the morning": 62,
        "the world tonight": 63,
        "record review podcast": 64,
        "composer of the week": 65,
        "short cuts": 66,
        "the history hour": 67,
        "the archers omnibus": 68,
        "the lazarus heist": 69,
        "bad people": 70,
        "jill scott's coffee club": 71,
        "5 live boxing with steve bunce": 72,
        "unexpected elements": 73,
        "the inquiry": 74,
        "not by the playbook": 75,
        "the bottom line": 76,
        "stumped": 77,
        "sliced bread": 78,
        "sound of cinema": 79,
        "5 live news specials": 80,
        "comedy of the week": 81,
        "curious cases": 82,
        "breaking the news": 83,
        "the skewer": 84,
        "5 live sport: all about...": 85,
        "the briefing room": 86,
        "the early music show": 87,
        "the life scientific": 88,
        "5 live rugby league": 89,
        "learning english from the news": 90,
        "the gaa social": 91,
        "sportsworld": 92,
        "assume nothing": 93,
        "the lgbt sport podcast": 94,
        "fairy meadow": 95,
        "kermode and mayo's film review": 96,
        "in our time: history": 97,
        "digital planet": 98,
        "just one thing - with michael mosley": 99,
        "scientifically...": 100
    ]
}

private struct QueryMatcher {
    private let orGroups: [[QueryToken]]

    init(query: String) {
        self.orGroups = QueryMatcher.parse(query)
    }

    func matches(_ searchableLowercased: String) -> Bool {
        guard !orGroups.isEmpty else { return true }
        for group in orGroups {
            var groupMatches = true
            for token in group {
                let contains = searchableLowercased.contains(token.term)
                if token.isNegated {
                    if contains {
                        groupMatches = false
                        break
                    }
                } else if !contains {
                    groupMatches = false
                    break
                }
            }
            if groupMatches { return true }
        }
        return false
    }

    private static func parse(_ query: String) -> [[QueryToken]] {
        let rawTokens = tokenise(query.lowercased())
        guard !rawTokens.isEmpty else { return [] }

        var groups: [[QueryToken]] = [[]]
        var negateNext = false

        for raw in rawTokens {
            if raw == "or" || raw == "|" {
                if !groups.last!.isEmpty {
                    groups.append([])
                }
                negateNext = false
                continue
            }

            if raw == "and" {
                continue
            }

            if raw == "not" {
                negateNext = true
                continue
            }

            let isNegated = negateNext || raw.hasPrefix("-")
            let term = raw.hasPrefix("-") ? String(raw.dropFirst()) : raw
            negateNext = false

            let cleaned = term.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !cleaned.isEmpty else { continue }
            groups[groups.count - 1].append(QueryToken(term: cleaned, isNegated: isNegated))
        }

        return groups.filter { !$0.isEmpty }
    }

    private static func tokenise(_ query: String) -> [String] {
        var tokens: [String] = []
        var current = ""
        var inQuotes = false

        for ch in query {
            if ch == "\"" {
                inQuotes.toggle()
                if !inQuotes {
                    let cleaned = current.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !cleaned.isEmpty { tokens.append(cleaned) }
                    current = ""
                }
                continue
            }

            if ch.isWhitespace && !inQuotes {
                let cleaned = current.trimmingCharacters(in: .whitespacesAndNewlines)
                if !cleaned.isEmpty { tokens.append(cleaned) }
                current = ""
                continue
            }

            current.append(ch)
        }

        let cleaned = current.trimmingCharacters(in: .whitespacesAndNewlines)
        if !cleaned.isEmpty { tokens.append(cleaned) }
        return tokens
    }
}

private struct QueryToken {
    let term: String
    let isNegated: Bool
}
