import Foundation

/// Anonymous analytics tracker for CarPlay, mirroring the Android `AutoAnalytics` and
/// the main app's privacy analytics. Nothing is sent unless the user has opted in.
enum CarPlayAnalytics {
    private static let eventURL = URL(string: "https://bbc-radio.shai.website/event")!

    private static var appVersion: String {
        let releaseVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "2.0.0"
        #if DEBUG
        let components = releaseVersion.split(separator: ".")
        if components.count == 3, let patch = Int(components[2]) {
            return "\(components[0]).\(components[1]).\(patch + 1)-debug"
        }
        return "\(releaseVersion)-debug"
        #else
        return releaseVersion
        #endif
    }

    static func trackStationPlay(stationId: String, stationName: String?) {
        let cleanId = stationId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard CarPlayState.shared.settingBool("analyticsEnabled"), !cleanId.isEmpty else { return }
        let version = appVersion
        var payload: [String: Any] = [
            "event": "station_play",
            "station_id": cleanId,
            "date": utcTimestamp(),
            "app_version": version,
            "platform": "ios"
        ]
        if let name = stationName?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty {
            payload["station_name"] = name
        }
        send(payload, version: version)
    }

    static func trackEpisodePlay(
        podcastId: String, episodeId: String, episodeTitle: String?, podcastTitle: String?
    ) {
        let cleanPodId = podcastId.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanEpisodeId = episodeId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard
            CarPlayState.shared.settingBool("analyticsEnabled"), !cleanPodId.isEmpty,
            !cleanEpisodeId.isEmpty
        else { return }

        let version = appVersion
        var payload: [String: Any] = [
            "event": "episode_play",
            "podcast_id": cleanPodId,
            "episode_id": cleanEpisodeId,
            "date": utcTimestamp(),
            "app_version": version,
            "platform": "ios"
        ]
        if let title = podcastTitle?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty {
            payload["podcast_title"] = title
        }
        if let title = episodeTitle?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty {
            payload["episode_title"] = title
        }
        send(payload, version: version)
    }

    private static func utcTimestamp() -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss'Z'"
        return formatter.string(from: Date())
    }

    private static func send(_ payload: [String: Any], version: String) {
        guard JSONSerialization.isValidJSONObject(payload),
            let data = try? JSONSerialization.data(withJSONObject: payload)
        else { return }

        var request = URLRequest(url: eventURL, timeoutInterval: 5)
        request.httpMethod = "POST"
        request.httpBody = data
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("British-Radio-Player/\(version)", forHTTPHeaderField: "User-Agent")
        URLSession.shared.dataTask(with: request).resume()
    }
}
