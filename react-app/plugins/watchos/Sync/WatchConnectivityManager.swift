import Foundation
import WatchConnectivity
import Observation

@Observable final class WatchConnectivityManager: NSObject, WCSessionDelegate {
    static let shared = WatchConnectivityManager()
    
    var appState: WatchAppState = WatchAppState()
    var isReachable: Bool = false
    var episodeProgressMap: [String: Int] = [:]
    
    private var retryCount = 0
    private let maxRetries = 5
    private let retryDelay: TimeInterval = 15.0
    private var lastProgressPushTime: Date = .distantPast
    
    private override init() {
        super.init()
        if let cachedFavs = UserDefaults.standard.stringArray(forKey: "cached_favourite_ids") {
            appState.favourite_ids = cachedFavs
        }
        if let cachedOrder = UserDefaults.standard.stringArray(forKey: "cached_favourite_order") {
            appState.favourite_order = cachedOrder
        }
        if let cachedSubs = UserDefaults.standard.stringArray(forKey: "cached_subscribed_podcast_ids") {
            appState.subscribed_podcast_ids = cachedSubs
            let cachedJson = UserDefaults.standard.string(forKey: "cached_subscribed_podcasts_json")
            appState.subscribed_podcasts_json = cachedJson
            WatchPodcastManager.shared.refreshSubscribedPodcasts(subscribedIds: cachedSubs, phonePodcastsJson: cachedJson)
        }
        if let cachedScrollMode = UserDefaults.standard.string(forKey: "cached_scroll_mode") {
            appState.scroll_mode = cachedScrollMode
        }
        if let cachedPlayed = UserDefaults.standard.stringArray(forKey: "cached_played_episode_ids") {
            appState.played_episode_ids = cachedPlayed
        }
        if let cachedProgressJson = UserDefaults.standard.string(forKey: "cached_episode_progress_json") {
            appState.episode_progress_json = cachedProgressJson
            parseProgressMap(cachedProgressJson)
        }
        if let cachedHistory = UserDefaults.standard.stringArray(forKey: "cached_history_episode_ids") {
            appState.history_episode_ids = cachedHistory
        }

        if WCSession.isSupported() {
            let session = WCSession.default
            session.delegate = self
            session.activate()
        }
    }
    
    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        if activationState == .activated {
            if !session.receivedApplicationContext.isEmpty {
                updateState(from: session.receivedApplicationContext)
            }
            requestInitialSync()
        }
    }
    
    func sessionReachabilityDidChange(_ session: WCSession) {
        DispatchQueue.main.async {
            self.isReachable = session.isReachable
        }
        if session.isReachable {
            requestInitialSync()
        }
    }
    
    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String : Any]) {
        updateState(from: applicationContext)
    }
    
    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String : Any] = [:]) {
        updateState(from: userInfo)
    }

    func session(_ session: WCSession, didReceiveMessage message: [String : Any]) {
        updateState(from: message)
    }

    func session(_ session: WCSession, didReceiveMessage message: [String : Any], replyHandler: @escaping ([String : Any]) -> Void) {
        updateState(from: message)
        replyHandler(["status": "ok"])
    }
    
    private func requestInitialSync() {
        guard retryCount < maxRetries else { return }
        
        if WCSession.default.isReachable {
            WCSession.default.sendMessage(["request": true], replyHandler: { [weak self] reply in
                self?.updateState(from: reply)
            }) { [weak self] error in
                guard let self = self else { return }
                self.scheduleRetry()
            }
        } else {
            scheduleRetry()
        }
    }
    
    private func scheduleRetry() {
        retryCount += 1
        DispatchQueue.global().asyncAfter(deadline: .now() + retryDelay) { [weak self] in
            self?.requestInitialSync()
        }
    }
    
    private func updateState(from dictionary: [String: Any]) {
        // Direct field extraction for maximum resilience
        if let favIds = dictionary["favourite_ids"] as? [String] {
            DispatchQueue.main.async {
                self.appState.favourite_ids = favIds
            }
            UserDefaults.standard.set(favIds, forKey: "cached_favourite_ids")
        }
        if let favOrder = dictionary["favourite_order"] as? [String] {
            DispatchQueue.main.async {
                self.appState.favourite_order = favOrder
            }
            UserDefaults.standard.set(favOrder, forKey: "cached_favourite_order")
        }
        let subsJson = dictionary["subscribed_podcasts_json"] as? String
        if let subsJson = subsJson {
            DispatchQueue.main.async {
                self.appState.subscribed_podcasts_json = subsJson
            }
            UserDefaults.standard.set(subsJson, forKey: "cached_subscribed_podcasts_json")
        }
        if let subs = dictionary["subscribed_podcast_ids"] as? [String] {
            DispatchQueue.main.async {
                self.appState.subscribed_podcast_ids = subs
                WatchPodcastManager.shared.refreshSubscribedPodcasts(subscribedIds: subs, phonePodcastsJson: subsJson)
            }
            UserDefaults.standard.set(subs, forKey: "cached_subscribed_podcast_ids")
        }
        if let scrollMode = dictionary["scroll_mode"] as? String {
            DispatchQueue.main.async {
                self.appState.scroll_mode = scrollMode
            }
            UserDefaults.standard.set(scrollMode, forKey: "cached_scroll_mode")
        }
        if let playedIds = dictionary["played_episode_ids"] as? [String] {
            DispatchQueue.main.async {
                self.appState.played_episode_ids = playedIds
            }
            UserDefaults.standard.set(playedIds, forKey: "cached_played_episode_ids")
        }
        if let progressJson = dictionary["episode_progress_json"] as? String {
            DispatchQueue.main.async {
                self.appState.episode_progress_json = progressJson
                self.parseProgressMap(progressJson)
            }
            UserDefaults.standard.set(progressJson, forKey: "cached_episode_progress_json")
        }
        if let historyIds = dictionary["history_episode_ids"] as? [String] {
            DispatchQueue.main.async {
                self.appState.history_episode_ids = historyIds
            }
            UserDefaults.standard.set(historyIds, forKey: "cached_history_episode_ids")
        }
        if let analytics = dictionary["analytics_enabled"] as? Bool {
            DispatchQueue.main.async {
                self.appState.analytics_enabled = analytics
            }
            UserDefaults.standard.set(analytics, forKey: "analytics_enabled")
        }

        do {
            let data = try JSONSerialization.data(withJSONObject: dictionary, options: [])
            let newState = try JSONDecoder().decode(WatchAppState.self, from: data)
            DispatchQueue.main.async {
                self.appState = newState
                self.retryCount = self.maxRetries // Stop retrying on successful sync
                if let subs = newState.subscribed_podcast_ids {
                    WatchPodcastManager.shared.refreshSubscribedPodcasts(subscribedIds: subs, phonePodcastsJson: newState.subscribed_podcasts_json)
                }
                if let progressJson = newState.episode_progress_json {
                    self.parseProgressMap(progressJson)
                }
            }
        } catch {
            print("Failed to decode WatchAppState: \(error)")
        }
    }

    private func parseProgressMap(_ jsonStr: String) {
        guard let data = jsonStr.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Int] else { return }
        self.episodeProgressMap = dict
        for (id, ms) in dict {
            let local = UserDefaults.standard.integer(forKey: "watch_episode_progress_\(id)")
            if local == 0 {
                UserDefaults.standard.set(ms, forKey: "watch_episode_progress_\(id)")
            }
        }
    }

    func isEpisodePlayed(_ episodeId: String) -> Bool {
        return appState.played_episode_ids?.contains(episodeId) ?? false
    }

    func episodeProgressMs(for episodeId: String) -> Int {
        let local = UserDefaults.standard.integer(forKey: "watch_episode_progress_\(episodeId)")
        if local > 0 { return local }
        return episodeProgressMap[episodeId] ?? 0
    }

    func markEpisodePlayed(_ episodeId: String, played: Bool) {
        guard !episodeId.isEmpty else { return }
        var playedIds = appState.played_episode_ids ?? []
        var unplayedIds: [String] = []

        if played {
            if !playedIds.contains(episodeId) {
                playedIds.append(episodeId)
            }
            episodeProgressMap.removeValue(forKey: episodeId)
            UserDefaults.standard.removeObject(forKey: "watch_episode_progress_\(episodeId)")
        } else {
            playedIds.removeAll { $0 == episodeId }
            unplayedIds.append(episodeId)
        }

        appState.played_episode_ids = playedIds
        UserDefaults.standard.set(playedIds, forKey: "cached_played_episode_ids")

        var history = appState.history_episode_ids ?? []
        if played {
            history.removeAll { $0 == episodeId }
            history.insert(episodeId, at: 0)
            if history.count > 40 { history = Array(history.prefix(40)) }
            appState.history_episode_ids = history
            UserDefaults.standard.set(history, forKey: "cached_history_episode_ids")
        }

        pushEpisodeSyncState(unplayedIds: unplayedIds)
    }

    func updateEpisodeProgress(episodeId: String, positionMs: Int, immediate: Bool = false) {
        guard !episodeId.isEmpty, positionMs > 0 else { return }
        if isEpisodePlayed(episodeId) { return }

        UserDefaults.standard.set(positionMs, forKey: "watch_episode_progress_\(episodeId)")
        episodeProgressMap[episodeId] = positionMs

        let now = Date()
        if immediate || now.timeIntervalSince(lastProgressPushTime) >= 10.0 {
            lastProgressPushTime = now
            pushEpisodeSyncState()
        }
    }

    func pushEpisodeSyncState(unplayedIds: [String] = []) {
        let playedIds = appState.played_episode_ids ?? []
        let history = appState.history_episode_ids ?? []

        var progressJson = "{}"
        if let data = try? JSONSerialization.data(withJSONObject: episodeProgressMap, options: []),
           let str = String(data: data, encoding: .utf8) {
            progressJson = str
        }
        UserDefaults.standard.set(progressJson, forKey: "cached_episode_progress_json")

        var dict: [String: Any] = [
            "has_episode_snapshot": true,
            "played_episode_ids": playedIds,
            "history_episode_ids": history,
            "episode_progress_json": progressJson
        ]
        if !unplayedIds.isEmpty {
            dict["unplayed_episode_ids"] = unplayedIds
        }

        sendPayload(dict)
    }
    
    func pushFavouriteToggle(stationId: String) {
        var currentIds = appState.favourite_ids ?? []
        if currentIds.contains(stationId) {
            currentIds.removeAll { $0 == stationId }
        } else {
            currentIds.append(stationId)
        }
        
        appState.favourite_ids = currentIds
        UserDefaults.standard.set(currentIds, forKey: "cached_favourite_ids")
        
        var currentOrder = appState.favourite_order ?? []
        if !currentOrder.contains(stationId) {
            currentOrder.append(stationId)
        } else if !currentIds.contains(stationId) {
            currentOrder.removeAll { $0 == stationId }
        }
        appState.favourite_order = currentOrder
        UserDefaults.standard.set(currentOrder, forKey: "cached_favourite_order")
        
        let dict: [String: Any] = [
            "favourite_ids": currentIds,
            "favourite_order": currentOrder
        ]
        
        sendPayload(dict)
    }

    private func sendPayload(_ dict: [String: Any]) {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        if session.isReachable {
            session.sendMessage(dict, replyHandler: nil) { error in
                print("[WatchConnectivityManager] sendMessage error: \(error)")
            }
        }
        if session.activationState == .activated {
            do {
                try session.updateApplicationContext(dict)
            } catch {
                print("[WatchConnectivityManager] updateApplicationContext error: \(error)")
            }
            _ = session.transferUserInfo(dict)
        }
    }
}
