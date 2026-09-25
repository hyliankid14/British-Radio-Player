import Foundation

struct SavedPodcastSnapshot: Codable, Identifiable, Equatable {
    let id: String
    let title: String
    let description: String
    let rssURLString: String
    let htmlURLString: String?
    let imageURLString: String?
    let genres: [String]
    let typicalDurationMins: Int

    init(podcast: Podcast) {
        self.id = podcast.id
        self.title = podcast.title
        self.description = podcast.description
        self.rssURLString = podcast.rssURL.absoluteString
        self.htmlURLString = podcast.htmlURL?.absoluteString
        self.imageURLString = podcast.imageURL?.absoluteString
        self.genres = podcast.genres
        self.typicalDurationMins = podcast.typicalDurationMins
    }

    var asPodcast: Podcast? {
        guard let rssURL = URL(string: rssURLString) else { return nil }
        return Podcast(
            id: id,
            title: title,
            description: description,
            rssURL: rssURL,
            htmlURL: htmlURLString.flatMap(URL.init(string:)),
            imageURL: imageURLString.flatMap(URL.init(string:)),
            genres: genres,
            typicalDurationMins: typicalDurationMins
        )
    }
}

struct SavedEpisodeSnapshot: Codable, Identifiable, Equatable {
    let id: String
    let title: String
    let description: String
    let audioURLString: String
    let imageURLString: String?
    let pubDate: String
    let durationMins: Int
    let podcastID: String
    let podcastTitle: String?

    init(episode: Episode, podcastTitle: String?) {
        self.id = episode.id
        self.title = episode.title
        self.description = episode.description
        self.audioURLString = episode.audioURL.absoluteString
        self.imageURLString = episode.imageURL?.absoluteString
        self.pubDate = episode.pubDate
        self.durationMins = episode.durationMins
        self.podcastID = episode.podcastID
        self.podcastTitle = podcastTitle
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

final class FavoritesStore: ObservableObject {
    @Published private(set) var favoriteStationIDs: Set<String>
    @Published private(set) var subscribedPodcastIDs: Set<String>
    @Published private(set) var savedEpisodeIDs: Set<String>
    @Published private(set) var subscribedPodcastSnapshotsByID: [String: SavedPodcastSnapshot]
    @Published private(set) var savedEpisodeSnapshotsByID: [String: SavedEpisodeSnapshot]
    @Published private(set) var notificationsEnabledIDs: Set<String>

    var onSubscribedPodcastsChanged: (([SavedPodcastSnapshot]) -> Void)?
    var onSavedEpisodesChanged: (([SavedEpisodeSnapshot]) -> Void)?

    private let defaults: UserDefaults
    private static let stationKey = "favorite_station_ids"
    private static let podcastKey = "subscribed_podcast_ids"
    private static let episodeKey = "saved_episode_ids"
    private static let podcastSnapshotsKey = "subscribed_podcast_snapshots"
    private static let episodeSnapshotsKey = "saved_episode_snapshots"
    private static let notificationsKey = "podcast_notifications_enabled"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        let storedStations = defaults.stringArray(forKey: Self.stationKey) ?? []
        let storedPodcasts = defaults.stringArray(forKey: Self.podcastKey) ?? []
        let storedEpisodes = defaults.stringArray(forKey: Self.episodeKey) ?? []

        let podcastSnapshots: [SavedPodcastSnapshot] = {
                        guard let data = defaults.data(forKey: Self.podcastSnapshotsKey),
                  let decoded = try? JSONDecoder().decode([SavedPodcastSnapshot].self, from: data) else {
                return []
            }
            return decoded
        }()

        let episodeSnapshots: [SavedEpisodeSnapshot] = {
                        guard let data = defaults.data(forKey: Self.episodeSnapshotsKey),
                  let decoded = try? JSONDecoder().decode([SavedEpisodeSnapshot].self, from: data) else {
                return []
            }
            return decoded
        }()

        self.favoriteStationIDs = Set(storedStations)
        self.subscribedPodcastIDs = Set(storedPodcasts)
        self.savedEpisodeIDs = Set(storedEpisodes)
        self.subscribedPodcastSnapshotsByID = Dictionary(uniqueKeysWithValues: podcastSnapshots.map { ($0.id, $0) })
        self.savedEpisodeSnapshotsByID = Dictionary(uniqueKeysWithValues: episodeSnapshots.map { ($0.id, $0) })
        let storedNotifications = defaults.stringArray(forKey: Self.notificationsKey) ?? []
        self.notificationsEnabledIDs = Set(storedNotifications)

        // Ensure IDs include anything recovered from snapshots.
        self.subscribedPodcastIDs.formUnion(self.subscribedPodcastSnapshotsByID.keys)
        self.savedEpisodeIDs.formUnion(self.savedEpisodeSnapshotsByID.keys)
    }

    // MARK: - Station Favorites
    func isFavorite(stationID: String) -> Bool {
        favoriteStationIDs.contains(stationID)
    }

    func toggleFavorite(stationID: String) {
        if favoriteStationIDs.contains(stationID) {
            favoriteStationIDs.remove(stationID)
        } else {
            favoriteStationIDs.insert(stationID)
        }
        persist()
    }

    // MARK: - Podcast Subscriptions
    func isSubscribed(podcastID: String) -> Bool {
        subscribedPodcastIDs.contains(podcastID)
    }

    func toggleSubscription(podcast: Podcast) {
        let podcastID = podcast.id
        if subscribedPodcastIDs.contains(podcastID) {
            subscribedPodcastIDs.remove(podcastID)
            subscribedPodcastSnapshotsByID[podcastID] = nil
            notificationsEnabledIDs.remove(podcastID)
        } else {
            subscribedPodcastIDs.insert(podcastID)
            subscribedPodcastSnapshotsByID[podcastID] = SavedPodcastSnapshot(podcast: podcast)
        }
        persist()
        onSubscribedPodcastsChanged?(subscribedPodcastSnapshots)
    }

    func toggleSubscription(podcastID: String) {
        if subscribedPodcastIDs.contains(podcastID) {
            subscribedPodcastIDs.remove(podcastID)
            subscribedPodcastSnapshotsByID[podcastID] = nil
            notificationsEnabledIDs.remove(podcastID)
        } else {
            subscribedPodcastIDs.insert(podcastID)
        }
        persist()
        onSubscribedPodcastsChanged?(subscribedPodcastSnapshots)
    }

    // MARK: - Podcast Notifications
    func isNotificationsEnabled(podcastID: String) -> Bool {
        notificationsEnabledIDs.contains(podcastID)
    }

    func toggleNotifications(podcastID: String) {
        guard subscribedPodcastIDs.contains(podcastID) else { return }
        if notificationsEnabledIDs.contains(podcastID) {
            notificationsEnabledIDs.remove(podcastID)
        } else {
            notificationsEnabledIDs.insert(podcastID)
        }
        persist()
    }

    // MARK: - Episode Saves
    func isSaved(episodeID: String) -> Bool {
        savedEpisodeIDs.contains(episodeID)
    }

    func toggleSaved(episode: Episode, podcastTitle: String?) {
        let episodeID = episode.id
        if savedEpisodeIDs.contains(episodeID) {
            savedEpisodeIDs.remove(episodeID)
            savedEpisodeSnapshotsByID[episodeID] = nil
        } else {
            savedEpisodeIDs.insert(episodeID)
            savedEpisodeSnapshotsByID[episodeID] = SavedEpisodeSnapshot(episode: episode, podcastTitle: podcastTitle)
        }
        persist()
        onSavedEpisodesChanged?(savedEpisodeSnapshots)
    }

    func toggleSaved(episodeID: String) {
        if savedEpisodeIDs.contains(episodeID) {
            savedEpisodeIDs.remove(episodeID)
            savedEpisodeSnapshotsByID[episodeID] = nil
        } else {
            savedEpisodeIDs.insert(episodeID)
        }
        persist()
        onSavedEpisodesChanged?(savedEpisodeSnapshots)
    }

    var subscribedPodcastSnapshots: [SavedPodcastSnapshot] {
        subscribedPodcastIDs.compactMap { subscribedPodcastSnapshotsByID[$0] }
            .sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
    }

    var savedEpisodeSnapshots: [SavedEpisodeSnapshot] {
        savedEpisodeIDs.compactMap { savedEpisodeSnapshotsByID[$0] }
            .sorted { $0.pubDate > $1.pubDate }
    }

    // MARK: - Clear All
    func clear() {
        favoriteStationIDs.removeAll()
        subscribedPodcastIDs.removeAll()
        savedEpisodeIDs.removeAll()
        subscribedPodcastSnapshotsByID.removeAll()
        savedEpisodeSnapshotsByID.removeAll()
        persist()
        onSubscribedPodcastsChanged?(subscribedPodcastSnapshots)
        onSavedEpisodesChanged?(savedEpisodeSnapshots)
    }

    private func persist() {
        defaults.set(Array(favoriteStationIDs).sorted(), forKey: Self.stationKey)
        defaults.set(Array(subscribedPodcastIDs).sorted(), forKey: Self.podcastKey)
        defaults.set(Array(savedEpisodeIDs).sorted(), forKey: Self.episodeKey)
        defaults.set(Array(notificationsEnabledIDs).sorted(), forKey: Self.notificationsKey)

        let podcastSnapshots = subscribedPodcastIDs.compactMap { subscribedPodcastSnapshotsByID[$0] }
        if let data = try? JSONEncoder().encode(podcastSnapshots) {
            defaults.set(data, forKey: Self.podcastSnapshotsKey)
        }

        let episodeSnapshots = savedEpisodeIDs.compactMap { savedEpisodeSnapshotsByID[$0] }
        if let data = try? JSONEncoder().encode(episodeSnapshots) {
            defaults.set(data, forKey: Self.episodeSnapshotsKey)
        }
    }
}

