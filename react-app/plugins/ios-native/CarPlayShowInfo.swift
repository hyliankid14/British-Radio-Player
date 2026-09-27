import Foundation
import UIKit

/// Best-effort "now playing" programme and song info for CarPlay browse rows and the
/// now-playing screen.
///
/// Fetches real-time song/artist/artwork from the BBC RMS segments endpoint, and the
/// programme title from the BBC ESS schedules endpoint. Results and downloaded artwork
/// are cached so template builds and now-playing updates never block on the network.
final class CarPlayShowInfo {
    static let shared = CarPlayShowInfo()

    struct ShowInfo {
        var showTitle = ""
        var showSubtitle = ""
        var artist = ""
        var track = ""
        var songArtworkUrl = ""
        var rawArtist = ""
        var rawTrack = ""
        var rawArtworkUrl = ""
    }

    private struct ScheduleEntry {
        let title: String
        let subtitle: String
        let startMs: Double
        let endMs: Double
    }

    private struct RmsSong: Equatable {
        var artist = ""
        var track = ""
        var artworkUrl = ""
    }

    private struct DelayedRms {
        var applied = RmsSong()
        var pending: RmsSong?
        var pendingApplyAtMs: Double = 0
        var lastRaw = RmsSong()
    }

    private struct CachedInfo {
        var info: ShowInfo
        var showStartMs: Double
        var showEndMs: Double
        var essFetchedAtMs: Double
        var fetchedAtMs: Double
    }

    private static let essCacheTTL: Double = 5 * 60 * 1000
    private static let rmsCacheTTL: Double = 5 * 1000
    /// The HLS stream lags the BBC's published schedule, so RMS song changes are
    /// applied this far in the future to match what the listener actually hears.
    private static let rmsDelayMs: Double = 20 * 1000

    private let queue = DispatchQueue(label: "com.bbcradioplayer.carplay.showinfo")
    private var cache: [String: CachedInfo] = [:]
    private var schedules: [String: [ScheduleEntry]] = [:]
    private var delayed: [String: DelayedRms] = [:]
    private var artwork: [String: UIImage] = [:]

    private init() {}

    // MARK: Cached reads

    /// Returns the cached show info, applying any schedule transition that has passed.
    func cachedShowInfo(serviceId: String) -> ShowInfo {
        queue.sync {
            guard let cached = cache[serviceId] else { return ShowInfo() }
            return cached.info
        }
    }

    func cachedShowTitle(serviceId: String) -> String {
        cachedShowInfo(serviceId: serviceId).showTitle
    }

    func cachedArtwork(serviceId: String) -> UIImage? {
        queue.sync { artwork[serviceId] }
    }

    // MARK: Refresh

    /// Fetches the latest show and song info. Runs synchronously, so call it off the
    /// main thread; the results land in the cache for the UI to pick up.
    @discardableResult
    func refresh(serviceId: String) -> ShowInfo {
        guard !serviceId.isEmpty else { return ShowInfo() }
        let now = Date().timeIntervalSince1970 * 1000
        let streamTime = now - Self.rmsDelayMs

        let existing = queue.sync { cache[serviceId] }

        // Song metadata (RMS).
        let rmsFresh = existing.map { now - $0.fetchedAtMs <= Self.rmsCacheTTL } ?? false
        var rawSong = RmsSong()
        if rmsFresh, let existing = existing {
            rawSong = RmsSong(
                artist: existing.info.artist, track: existing.info.track,
                artworkUrl: existing.info.songArtworkUrl)
        } else {
            let fetched = fetchRmsNowPlaying(serviceId: serviceId) ?? RmsSong()
            if fetched.artist.isEmpty, fetched.track.isEmpty, fetched.artworkUrl.isEmpty,
                let existing = existing {
                rawSong = RmsSong(
                    artist: existing.info.artist, track: existing.info.track,
                    artworkUrl: existing.info.songArtworkUrl)
            } else {
                rawSong = fetched
            }
        }

        let applied = queue.sync { () -> RmsSong in
            var state = delayed[serviceId] ?? DelayedRms()
            if state.pendingApplyAtMs > 0, now >= state.pendingApplyAtMs {
                state.applied = state.pending ?? RmsSong()
                state.pending = nil
                state.pendingApplyAtMs = 0
            }
            if state.lastRaw != rawSong {
                state.lastRaw = rawSong
                state.pending = rawSong
                state.pendingApplyAtMs = now + Self.rmsDelayMs
            }
            delayed[serviceId] = state
            return state.applied
        }

        // Programme details (ESS).
        let currentScheduled = queue.sync { () -> ScheduleEntry? in
            guard let entries = schedules[serviceId] else { return nil }
            return entries.first { streamTime >= $0.startMs && streamTime < $0.endMs }
        }
        let showEnded = existing.map { $0.showEndMs > 0 && streamTime >= $0.showEndMs } ?? false
        let essExpired =
            existing == nil
            || existing!.info.showTitle.isEmpty
            || (now - existing!.essFetchedAtMs > Self.essCacheTTL)

        var details: (title: String, subtitle: String, start: Double, end: Double, fetched: Double)
        if essExpired || (showEnded && currentScheduled == nil) {
            if let fetched = fetchCurrentShowDetails(serviceId: serviceId, streamTime: streamTime),
                !fetched.title.isEmpty {
                details = fetched
            } else if let currentScheduled = currentScheduled {
                details = (
                    currentScheduled.title, currentScheduled.subtitle, currentScheduled.startMs,
                    currentScheduled.endMs, existing?.essFetchedAtMs ?? now
                )
            } else {
                details = (
                    existing?.info.showTitle ?? "", existing?.info.showSubtitle ?? "",
                    existing?.showStartMs ?? 0, existing?.showEndMs ?? 0,
                    existing?.essFetchedAtMs ?? now
                )
            }
        } else if let currentScheduled = currentScheduled,
            currentScheduled.title != existing?.info.showTitle
                || currentScheduled.subtitle != existing?.info.showSubtitle {
            details = (
                currentScheduled.title, currentScheduled.subtitle, currentScheduled.startMs,
                currentScheduled.endMs, existing?.essFetchedAtMs ?? now
            )
        } else {
            details = (
                existing?.info.showTitle ?? "", existing?.info.showSubtitle ?? "",
                existing?.showStartMs ?? 0, existing?.showEndMs ?? 0,
                existing?.essFetchedAtMs ?? now
            )
        }

        // Song artwork.
        let artworkUrl = applied.artworkUrl
        if !artworkUrl.isEmpty, artworkUrl != existing?.info.songArtworkUrl {
            if let image = downloadImage(artworkUrl) {
                queue.sync { artwork[serviceId] = image }
            }
        } else if artworkUrl.isEmpty {
            queue.sync { _ = artwork.removeValue(forKey: serviceId) }
        }

        var info = ShowInfo()
        info.showTitle = details.title
        info.showSubtitle = details.subtitle
        info.artist = applied.artist
        info.track = applied.track
        info.songArtworkUrl = artworkUrl
        info.rawArtist = rawSong.artist
        info.rawTrack = rawSong.track
        info.rawArtworkUrl = rawSong.artworkUrl

        queue.sync {
            cache[serviceId] = CachedInfo(
                info: info, showStartMs: details.start, showEndMs: details.end,
                essFetchedAtMs: details.fetched, fetchedAtMs: now)
        }
        return info
    }

    // MARK: Networking

    private func fetchRmsNowPlaying(serviceId: String) -> RmsSong? {
        guard
            let url = URL(
                string:
                    "https://rms.api.bbc.co.uk/v2/services/\(serviceId)/segments/latest?t=\(Int(Date().timeIntervalSince1970 * 1000))"
            ),
            let data = Self.get(url, accept: "application/json", timeout: 6),
            let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
            let segments = root["data"] as? [[String: Any]],
            let segment = segments.first
        else { return nil }

        let isMusic = ((segment["segment_type"] as? String) ?? "").lowercased() == "music"
        guard isMusic else { return nil }

        let offset = segment["offset"] as? [String: Any]
        let label = (offset?["label"] as? String) ?? ""
        let nowPlaying = offset?["now_playing"] as? Bool ?? false
        let stillCurrent = (offset?["now_playing"] as? Bool) ?? true
        let actuallyPlaying =
            (nowPlaying || label.lowercased() == "now playing")
            && stillCurrent
            && !label.lowercased().contains("ago")
        guard actuallyPlaying else { return nil }

        let titles = segment["titles"] as? [String: Any]
        let primary = ((titles?["primary"] as? String) ?? "")
            .trimmingCharacters(in: .whitespaces)
        let secondary = ((titles?["secondary"] as? String) ?? "")
            .trimmingCharacters(in: .whitespaces)
        let tertiary = ((titles?["tertiary"] as? String) ?? "")
            .trimmingCharacters(in: .whitespaces)
        guard !primary.isEmpty || !secondary.isEmpty || !tertiary.isEmpty else { return nil }

        var song = RmsSong()
        song.artist = primary
        song.track = secondary.isEmpty ? tertiary : secondary

        let template = (segment["image_url"] as? String) ?? ""
        if !template.isEmpty, !template.lowercased().contains("default"),
            !template.lowercased().contains("p01tqv8z") {
            song.artworkUrl = template.replacingOccurrences(of: "{recipe}", with: "640x640")
        }
        return song
    }

    /// Resolves the programme that is on air at `streamTime`, falling back to the next
    /// scheduled entry when the schedule has no current programme.
    private func fetchCurrentShowDetails(
        serviceId: String, streamTime: Double
    ) -> (title: String, subtitle: String, start: Double, end: Double, fetched: Double)? {
        guard
            let url = URL(
                string:
                    "https://ess.api.bbci.co.uk/schedules?serviceId=\(serviceId)&mediatypes=audio&t=\(Int(Date().timeIntervalSince1970 * 1000))"
            ),
            let data = Self.get(url, accept: "application/json", timeout: 8),
            let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
            let items = root["items"] as? [[String: Any]]
        else { return nil }

        var entries: [ScheduleEntry] = []
        for item in items {
            guard
                let published = item["published_time"] as? [String: Any],
                let startRaw = published["start"] as? String, !startRaw.isEmpty,
                let endRaw = published["end"] as? String, !endRaw.isEmpty
            else { continue }
            guard let start = Self.parseIso(startRaw), let end = Self.parseIso(endRaw) else {
                continue
            }

            let brand = item["brand"] as? [String: Any]
            let episode = item["episode"] as? [String: Any]
            let brandTitle = ((brand?["title"] as? String) ?? "")
                .trimmingCharacters(in: .whitespaces)
            let episodeTitle = ((episode?["title"] as? String) ?? "")
                .trimmingCharacters(in: .whitespaces)
            let episodeSynopses = episode?["synopses"] as? [String: Any]
            let itemSynopses = item["synopses"] as? [String: Any]
            var shortSynopsis =
                ((episodeSynopses?["short"] as? String) ?? "")
                .trimmingCharacters(in: .whitespaces)
            if shortSynopsis.isEmpty {
                shortSynopsis =
                    ((itemSynopses?["short"] as? String) ?? "")
                    .trimmingCharacters(in: .whitespaces)
            }

            let showTitle = brandTitle.isEmpty ? episodeTitle : brandTitle
            var showSubtitle = ""
            if !brandTitle.isEmpty, !episodeTitle.isEmpty,
                episodeTitle.lowercased() != brandTitle.lowercased() {
                showSubtitle = episodeTitle
            } else if !shortSynopsis.isEmpty,
                shortSynopsis.lowercased() != showTitle.lowercased() {
                showSubtitle = shortSynopsis
            }

            if !showTitle.isEmpty {
                entries.append(
                    ScheduleEntry(
                        title: showTitle, subtitle: showSubtitle, startMs: start, endMs: end))
            }
        }

        if !entries.isEmpty {
            entries.sort { $0.startMs < $1.startMs }
            queue.sync { schedules[serviceId] = entries }
        }

        let now = Date().timeIntervalSince1970 * 1000
        if let current = entries.first(where: { streamTime >= $0.startMs && streamTime < $0.endMs }) {
            return (current.title, current.subtitle, current.startMs, current.endMs, now)
        }
        if let upcoming = entries.first(where: { $0.startMs > streamTime }) ?? entries.first {
            return (upcoming.title, upcoming.subtitle, upcoming.startMs, upcoming.endMs, now)
        }
        return nil
    }

    private func downloadImage(_ urlString: String) -> UIImage? {
        guard
            let url = URL(string: urlString.replacingOccurrences(of: "http://", with: "https://")),
            let data = Self.get(url, accept: "image/*", timeout: 8)
        else { return nil }
        return UIImage(data: data)
    }


    private static func get(_ url: URL, accept: String, timeout: Double) -> Data? {
        var request = URLRequest(url: url, timeoutInterval: timeout)
        request.setValue(accept, forHTTPHeaderField: "Accept")
        request.setValue("BritishRadioPlayer/2.0.0 (iOS)", forHTTPHeaderField: "User-Agent")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let semaphore = DispatchSemaphore(value: 0)
        var result: Data?
        URLSession.shared.dataTask(with: request) { data, response, _ in
            defer { semaphore.signal() }
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                return
            }
            result = data
        }.resume()
        _ = semaphore.wait(timeout: .now() + timeout + 1)
        return result
    }

    private static let isoFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let isoFormatterNoFraction: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    private static func parseIso(_ raw: String) -> Double? {
        let trimmed = raw.trimmingCharacters(in: .whitespaces)
        if let date = isoFormatter.date(from: trimmed) {
            return date.timeIntervalSince1970 * 1000
        }
        if let date = isoFormatterNoFraction.date(from: trimmed) {
            return date.timeIntervalSince1970 * 1000
        }
        return nil
    }
}
