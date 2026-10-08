import Foundation

/// Anonymous analytics tracker for watchOS playback, mirroring Android Wear `PrivacyAnalytics.kt`.
/// Only logs when user has opted into analytics (defaults to true on watch standalone, or synced from phone).
final class WatchAnalytics: @unchecked Sendable {
    static let shared = WatchAnalytics()
    
    private let eventURL = URL(string: "https://bbc-radio.shai.website/event")!
    private let session = URLSession(configuration: .ephemeral)
    
    private init() {}
    
    var isEnabled: Bool {
        if let stored = UserDefaults.standard.object(forKey: "analytics_enabled") as? Bool {
            return stored
        }
        return true // Default to true matching Wear OS PrivacyAnalytics
    }
    
    private var appVersion: String {
        let releaseVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "2.0.0"
        #if DEBUG
        return "\(releaseVersion)-debug"
        #else
        return releaseVersion
        #endif
    }
    
    func trackStationPlay(stationId: String, stationName: String?) {
        let cleanId = stationId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isEnabled, !cleanId.isEmpty else { return }
        
        let version = appVersion
        var payload: [String: Any] = [
            "event": "station_play",
            "station_id": cleanId,
            "date": utcTimestamp(),
            "app_version": version,
            "platform": "watchos"
        ]
        if let name = stationName?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty {
            payload["station_name"] = name
        }
        send(payload, version: version)
    }
    
    func trackEpisodePlay(
        podcastId: String,
        episodeId: String,
        episodeTitle: String?,
        podcastTitle: String?
    ) {
        let cleanPodId = podcastId.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanEpisodeId = episodeId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isEnabled, !cleanPodId.isEmpty, !cleanEpisodeId.isEmpty else { return }
        
        let version = appVersion
        var payload: [String: Any] = [
            "event": "episode_play",
            "podcast_id": cleanPodId,
            "episode_id": cleanEpisodeId,
            "date": utcTimestamp(),
            "app_version": version,
            "platform": "watchos"
        ]
        if let title = podcastTitle?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty {
            payload["podcast_title"] = title
        }
        if let title = episodeTitle?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty {
            payload["episode_title"] = title
        }
        send(payload, version: version)
    }
    
    private func utcTimestamp() -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss'Z'"
        return formatter.string(from: Date())
    }
    
    private func send(_ payload: [String: Any], version: String) {
        guard JSONSerialization.isValidJSONObject(payload),
              let data = try? JSONSerialization.data(withJSONObject: payload)
        else { return }
        
        var request = URLRequest(url: eventURL, timeoutInterval: 5)
        request.httpMethod = "POST"
        request.httpBody = data
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("British-Radio-Player-WatchOS/\(version)", forHTTPHeaderField: "User-Agent")
        
        session.dataTask(with: request) { _, _, _ in
            // Fail silently; analytics failures must never impact playback
        }.resume()
    }
}
