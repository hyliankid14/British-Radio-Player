import Foundation

enum PodcastSortOption: String, CaseIterable, Identifiable {
    case mostPopular = "Most Popular"
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

    private let podcastRepository: PodcastRepository
    private let audioPlayerService: AudioPlayerService
    private let favoritesStore: FavoritesStore
    private let defaults: UserDefaults

    init(podcastRepository: PodcastRepository, audioPlayerService: AudioPlayerService, favoritesStore: FavoritesStore, defaults: UserDefaults = .standard) {
        self.podcastRepository = podcastRepository
        self.audioPlayerService = audioPlayerService
        self.favoritesStore = favoritesStore
        self.defaults = defaults
        loadPlayedEpisodes()
    }

    func loadPodcasts() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            podcasts = try await podcastRepository.fetchPodcasts(forceRefresh: false)
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
        markEpisodeAsPlayed(episode)
        audioPlayerService.play(episode: episode, podcastTitle: selectedPodcast?.title)
        if episode.imageURL == nil {
            audioPlayerService.updateCurrentEpisodeArtwork(selectedPodcast?.imageURL)
        }
    }

    func play(_ episode: Episode, podcastTitle: String?) {
        markEpisodeAsPlayed(episode)
        audioPlayerService.play(episode: episode, podcastTitle: podcastTitle)
        if episode.imageURL == nil {
            audioPlayerService.updateCurrentEpisodeArtwork(selectedPodcast?.imageURL)
        }
    }

    func clearSelection() {
        selectedPodcast = nil
        episodes = []
    }

    func markEpisodeAsPlayed(_ episode: Episode) {
        playedEpisodeIDs.insert(episode.id)
        savePlayedEpisodes()
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

    private func loadPlayedEpisodes() {
        if let savedArray = defaults.array(forKey: "played_episode_ids") as? [String] {
            playedEpisodeIDs = Set(savedArray)
        }
    }

    private func savePlayedEpisodes() {
        defaults.set(Array(playedEpisodeIDs), forKey: "played_episode_ids")
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
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let genreFiltered = podcasts.filter { podcast in
            selectedGenre == "All Genres" || podcast.genres.contains(selectedGenre)
        }

        let searchFiltered: [Podcast]
        if query.isEmpty {
            searchFiltered = genreFiltered
        } else {
            searchFiltered = genreFiltered.filter { podcast in
                podcast.title.lowercased().contains(query) ||
                podcast.description.lowercased().contains(query) ||
                podcast.genres.joined(separator: " ").lowercased().contains(query)
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
        case .alphabetical:
            return searchFiltered.sorted {
                $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending
            }
        }
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
