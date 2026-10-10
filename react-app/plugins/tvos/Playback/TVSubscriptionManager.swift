import Foundation
import Observation

@Observable final class TVSubscriptionManager {
    static let shared = TVSubscriptionManager()
    
    private let appGroupId = "group.com.hyliankid14.bbcradioplayer"
    private let storageKey = "cached_subscribed_podcast_ids"
    private let legacyJsonKey = "pref_subscribed_podcasts"
    
    private var defaults: UserDefaults {
        UserDefaults(suiteName: appGroupId) ?? UserDefaults.standard
    }
    
    var subscribedPodcastIds: [String] = []
    
    private init() {
        loadSubscriptions()
    }
    
    func loadSubscriptions() {
        if let saved = defaults.stringArray(forKey: storageKey), !saved.isEmpty {
            subscribedPodcastIds = saved
        } else if let standardSaved = UserDefaults.standard.stringArray(forKey: storageKey), !standardSaved.isEmpty {
            subscribedPodcastIds = standardSaved
        } else if let jsonString = defaults.string(forKey: legacyJsonKey) ?? UserDefaults.standard.string(forKey: legacyJsonKey),
                  let data = jsonString.data(using: .utf8),
                  let parsed = try? JSONDecoder().decode([String].self, from: data), !parsed.isEmpty {
            subscribedPodcastIds = parsed
            saveSubscriptions()
        } else {
            subscribedPodcastIds = []
        }
    }
    
    func isSubscribed(_ podcastId: String) -> Bool {
        subscribedPodcastIds.contains(podcastId)
    }
    
    func toggleSubscription(_ podcastId: String) {
        if isSubscribed(podcastId) {
            unsubscribe(podcastId)
        } else {
            subscribe(podcastId)
        }
    }
    
    func subscribe(_ podcastId: String) {
        guard !subscribedPodcastIds.contains(podcastId) else { return }
        subscribedPodcastIds.append(podcastId)
        saveSubscriptions()
    }
    
    func unsubscribe(_ podcastId: String) {
        subscribedPodcastIds.removeAll { $0 == podcastId }
        saveSubscriptions()
    }
    
    private func saveSubscriptions() {
        defaults.set(subscribedPodcastIds, forKey: storageKey)
        UserDefaults.standard.set(subscribedPodcastIds, forKey: storageKey)
        if let data = try? JSONEncoder().encode(subscribedPodcastIds),
           let json = String(data: data, encoding: .utf8) {
            defaults.set(json, forKey: legacyJsonKey)
            UserDefaults.standard.set(json, forKey: legacyJsonKey)
        }
    }
    
    func updateCachedPodcastMetadata(podcasts: [TVPodcast]) {
        var metaDict = defaults.dictionary(forKey: "cached_subscribed_podcasts_meta") as? [String: [String: String]] ?? [:]
        for p in podcasts {
            metaDict[p.id] = ["title": p.title, "imageUrl": p.imageUrl]
        }
        defaults.set(metaDict, forKey: "cached_subscribed_podcasts_meta")
    }
}
