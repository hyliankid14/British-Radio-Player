import Foundation
import Observation

struct ScheduleItem {
    let brandTitle: String?
    let episodeTitle: String?
    let shortSynopsis: String?
    let startDate: Date
    let endDate: Date
    
    var displayTitle: String {
        let brand = brandTitle?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let episode = episodeTitle?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !brand.isEmpty && brand.lowercased() != "bbc radio" {
            return brand
        }
        if !episode.isEmpty {
            return episode
        }
        return brand.isEmpty ? "On Air" : brand
    }
    
    var detail: String {
        let episode = episodeTitle?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let synopsis = shortSynopsis?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !episode.isEmpty && episode != displayTitle {
            return episode
        }
        return synopsis
    }
}

@Observable final class StationShowManager {
    static let shared = StationShowManager()
    
    var shows: [String: String] = [:] // serviceId -> fallback show title
    var schedules: [String: [ScheduleItem]] = [:] // serviceId -> sorted items
    private var inFlight: Set<String> = []
    private var lastFetched: [String: Date] = [:]
    
    private let isoWithFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    
    private let isoStandard: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    private init() {}

    func showTitle(for serviceId: String) -> String? {
        if let current = resolveCurrentAndNext(for: serviceId).current {
            return current.displayTitle
        }
        return shows[serviceId]
    }

    func resolveCurrentAndNext(for serviceId: String, at date: Date = Date()) -> (current: ScheduleItem?, next: ScheduleItem?) {
        guard let items = schedules[serviceId], !items.isEmpty else { return (nil, nil) }
        
        // Match active slot: start <= date < end
        var current = items.first(where: { $0.startDate <= date && date < $0.endDate })
        if current == nil {
            // Gap handling (e.g. 2-minute junction between shows)
            if let upcoming = items.first(where: { $0.startDate > date && $0.startDate.timeIntervalSince(date) <= 300 }) {
                current = upcoming
            } else {
                current = items.filter({ $0.endDate <= date }).last
            }
        }
        
        var next: ScheduleItem? = nil
        if let curr = current {
            next = items.first(where: { $0.startDate >= curr.endDate || ($0.startDate > curr.startDate && $0.startDate > date) })
        } else {
            next = items.first(where: { $0.startDate > date })
        }
        
        return (current, next)
    }

    func prefetch(for stations: [WatchStation]) {
        for station in stations {
            fetchShow(for: station.serviceId)
        }
    }

    func fetchShow(for serviceId: String, force: Bool = false) {
        guard !serviceId.isEmpty else { return }
        if !force, let last = lastFetched[serviceId], Date().timeIntervalSince(last) < 120 {
            return
        }
        guard !inFlight.contains(serviceId) else { return }
        inFlight.insert(serviceId)

        guard let url = URL(string: "https://ess.api.bbci.co.uk/schedules?serviceId=\(serviceId)") else {
            inFlight.remove(serviceId)
            return
        }

        var request = URLRequest(url: url)
        request.setValue("BBC Radio Player Watch/1.0", forHTTPHeaderField: "User-Agent")
        request.timeoutInterval = 10

        URLSession.shared.dataTask(with: request) { [weak self] data, _, error in
            guard let self = self else { return }
            defer {
                DispatchQueue.main.async {
                    self.inFlight.remove(serviceId)
                }
            }
            guard let data = data, error == nil else { return }
            let parsed = self.parseScheduleItems(from: data)
            DispatchQueue.main.async {
                if !parsed.isEmpty {
                    self.schedules[serviceId] = parsed
                }
                let (current, _) = self.resolveCurrentAndNext(for: serviceId)
                if let curr = current {
                    self.shows[serviceId] = curr.displayTitle
                }
                self.lastFetched[serviceId] = Date()
            }
        }.resume()
    }

    func parseScheduleItems(from data: Data) -> [ScheduleItem] {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let items = json["items"] as? [[String: Any]] else {
            return []
        }
        var result: [ScheduleItem] = []
        for item in items {
            guard let pub = item["published_time"] as? [String: Any],
                  let startStr = pub["start"] as? String,
                  let endStr = pub["end"] as? String,
                  let start = parseDate(startStr),
                  let end = parseDate(endStr) else {
                continue
            }
            let brand = (item["brand"] as? [String: Any])?["title"] as? String
            let episode = (item["episode"] as? [String: Any])?["title"] as? String
            let synopses = (item["episode"] as? [String: Any])?["synopses"] as? [String: Any]
                ?? (item["brand"] as? [String: Any])?["synopses"] as? [String: Any]
            let shortSyn = synopses?["short"] as? String

            result.append(ScheduleItem(
                brandTitle: brand,
                episodeTitle: episode,
                shortSynopsis: shortSyn,
                startDate: start,
                endDate: end
            ))
        }
        return result.sorted(by: { $0.startDate < $1.startDate })
    }

    func parseDate(_ string: String) -> Date? {
        isoWithFraction.date(from: string) ?? isoStandard.date(from: string)
    }
}

@Observable final class NowPlayingMetadata {
    static let shared = NowPlayingMetadata()
    
    var showTitle: String = ""
    var showDetail: String = ""
    var nextShowTitle: String = ""
    var upNextLabel: String = ""
    var segmentArtist: String?
    var segmentTrack: String?
    var rmsArtworkUrl: String?
    
    var hasLiveSong: Bool {
        segmentArtist != nil || segmentTrack != nil
    }
    
    private struct RmsTrackData: Equatable {
        let artist: String?
        let track: String?
        let artworkUrl: String?
    }

    private var appliedRms: RmsTrackData?
    private var pendingRms: RmsTrackData?
    private var rmsDelayTimer: Timer?
    private var isInitialRmsFetch: Bool = true
    /// Matches RMS_DELAY_MS = 20_000 in the phone app (react-app/src/api/showInfo.ts)
    private static let rmsDelaySeconds: TimeInterval = 20.0

    private var pollTimer: Timer?
    private var scheduleTickTimer: Timer?
    private var currentServiceId: String?
    
    private init() {}
    
    static func isPlaceholderArtwork(_ url: String?) -> Bool {
        guard let url = url?.trimmingCharacters(in: .whitespacesAndNewlines), !url.isEmpty,
              url.lowercased().starts(with: "http") else { return true }
        let lower = url.lowercased()
        return lower.contains("p0bqcdzf") ||
               lower.contains("p01tqv8z") ||
               lower.contains("default") ||
               lower.contains("placeholder") ||
               lower.contains("blocks-colour-black") ||
               lower.contains("/services/") ||
               lower.contains("station_logo") ||
               lower.contains("brand_logo")
    }
    
    func startPolling(serviceId: String) {
        if currentServiceId == serviceId && pollTimer != nil { return }
        stopPolling()
        currentServiceId = serviceId
        
        isInitialRmsFetch = true
        appliedRms = nil
        pendingRms = nil
        rmsDelayTimer?.invalidate()
        rmsDelayTimer = nil

        // Immediate local evaluation if cached
        evaluateCurrentAndNextShow()
        
        // Initial fetch
        fetchMetadata()
        
        // Fast polling for RMS and ESS:
        // RMS polls every 15s to quickly detect song starts/stops.
        // Schedule re-evaluates every 5s against system clock to automatically switch show on the dot.
        pollTimer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in
            self?.fetchMetadata()
        }
        
        scheduleTickTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            self?.evaluateCurrentAndNextShow()
        }
    }
    
    func stopPolling() {
        pollTimer?.invalidate()
        pollTimer = nil
        scheduleTickTimer?.invalidate()
        scheduleTickTimer = nil
        rmsDelayTimer?.invalidate()
        rmsDelayTimer = nil
        appliedRms = nil
        pendingRms = nil
        isInitialRmsFetch = true
        currentServiceId = nil
        showTitle = ""
        showDetail = ""
        nextShowTitle = ""
        upNextLabel = ""
        segmentArtist = nil
        segmentTrack = nil
        rmsArtworkUrl = nil
    }

    private func applyRmsData(_ incoming: RmsTrackData?, immediate: Bool = false) {
        if immediate || isInitialRmsFetch {
            isInitialRmsFetch = false
            rmsDelayTimer?.invalidate()
            rmsDelayTimer = nil
            pendingRms = nil
            appliedRms = incoming
            self.segmentArtist = incoming?.artist
            self.segmentTrack = incoming?.track
            self.rmsArtworkUrl = incoming?.artworkUrl
            return
        }

        // If incoming already matches what is applied, cancel any pending change
        if incoming == appliedRms {
            if pendingRms != nil {
                rmsDelayTimer?.invalidate()
                rmsDelayTimer = nil
                pendingRms = nil
            }
            return
        }

        // If incoming is already queued with a ticking timer, leave it running
        if incoming == pendingRms && rmsDelayTimer != nil {
            return
        }

        // Queue change delayed by 20s to match audio stream buffer latency
        pendingRms = incoming
        rmsDelayTimer?.invalidate()
        let timer = Timer(timeInterval: Self.rmsDelaySeconds, repeats: false) { [weak self] _ in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.appliedRms = self.pendingRms
                self.segmentArtist = self.appliedRms?.artist
                self.segmentTrack = self.appliedRms?.track
                self.rmsArtworkUrl = self.appliedRms?.artworkUrl
                self.pendingRms = nil
                self.rmsDelayTimer = nil
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        rmsDelayTimer = timer
    }
    
    private func evaluateCurrentAndNextShow() {
        guard let serviceId = currentServiceId else { return }
        let (current, next) = StationShowManager.shared.resolveCurrentAndNext(for: serviceId)
        
        let newTitle = current?.displayTitle ?? ""
        let newDetail = current?.detail ?? ""
        let nextTitle = next?.displayTitle ?? ""
        let upNext = Self.formatUpNext(nextItem: next)
        
        let showChanged = (!newTitle.isEmpty && newTitle != self.showTitle)
        
        DispatchQueue.main.async {
            if !newTitle.isEmpty {
                self.showTitle = newTitle
                self.showDetail = newDetail
                StationShowManager.shared.shows[serviceId] = newTitle
            }
            self.nextShowTitle = nextTitle
            self.upNextLabel = upNext
        }
        
        // If the scheduled show changed over time boundary, trigger a fresh fetch
        if showChanged {
            fetchMetadata()
        }
    }
    
    static func formatUpNext(nextItem: ScheduleItem?) -> String {
        guard let next = nextItem else { return "" }
        let title = next.displayTitle
        guard !title.isEmpty else { return "" }
        
        let timeFormatter = DateFormatter()
        timeFormatter.dateFormat = "HH:mm"
        timeFormatter.timeZone = TimeZone.current
        let timeStr = timeFormatter.string(from: next.startDate)
        
        if timeStr.isEmpty {
            return "Up next: \(title)"
        }
        return "Up next: \(title) at \(timeStr)"
    }
    
    private func fetchMetadata() {
        guard let serviceId = currentServiceId else { return }
        
        // 1. Fetch ESS schedules
        let essUrl = URL(string: "https://ess.api.bbci.co.uk/schedules?serviceId=\(serviceId)")!
        var essRequest = URLRequest(url: essUrl)
        essRequest.setValue("BBC Radio Player Watch/1.0", forHTTPHeaderField: "User-Agent")
        essRequest.timeoutInterval = 10
        
        URLSession.shared.dataTask(with: essRequest) { [weak self] data, _, error in
            guard let self = self, let data = data, error == nil else { return }
            let items = StationShowManager.shared.parseScheduleItems(from: data)
            DispatchQueue.main.async {
                if !items.isEmpty {
                    StationShowManager.shared.schedules[serviceId] = items
                }
                self.evaluateCurrentAndNextShow()
            }
        }.resume()
        
        // 2. Fetch RMS live segments
        let cacheBuster = Int(Date().timeIntervalSince1970)
        guard let rmsUrl = URL(string: "https://rms.api.bbc.co.uk/v2/services/\(serviceId)/segments/latest?t=\(cacheBuster)") else { return }
        var rmsRequest = URLRequest(url: rmsUrl)
        rmsRequest.setValue("BBC Radio Player Watch/1.0", forHTTPHeaderField: "User-Agent")
        rmsRequest.setValue("no-cache, no-store, must-revalidate", forHTTPHeaderField: "Cache-Control")
        rmsRequest.setValue("no-cache", forHTTPHeaderField: "Pragma")
        rmsRequest.timeoutInterval = 8
        
        URLSession.shared.dataTask(with: rmsRequest) { [weak self] data, _, error in
            guard let self = self else { return }
            guard let data = data, error == nil else {
                return
            }
            do {
                if let json = try JSONSerialization.jsonObject(with: data, options: []) as? [String: Any],
                   let dataObj = json["data"] as? [[String: Any]],
                   let first = dataObj.first {
                    
                    let segmentType = (first["segment_type"] as? String)?.lowercased() ?? ""
                    let isMusic = segmentType == "music"
                    
                    let offset = first["offset"] as? [String: Any]
                    let nowPlayingFlag = offset?["now_playing"] as? Bool
                    let label = (offset?["label"] as? String)?.lowercased() ?? ""
                    
                    // Live music track is actively on air only when now_playing is true (or label is "now playing")
                    // and label does NOT contain "ago" (e.g. "Less Than a Minute Ago", "5 Minutes Ago").
                    let isNowPlaying = isMusic &&
                        (nowPlayingFlag == true || label == "now playing") &&
                        nowPlayingFlag != false &&
                        !label.contains("ago")
                    
                    if isNowPlaying {
                        let titles = first["titles"] as? [String: Any]
                        let primary = (titles?["primary"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
                        let secondary = (titles?["secondary"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
                        let tertiary = (titles?["tertiary"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
                        let track = (secondary?.isEmpty == false ? secondary : tertiary)
                        
                        var artworkUrl: String? = nil
                        if let imgTemplate = first["image_url"] as? String,
                           !imgTemplate.isEmpty,
                           !Self.isPlaceholderArtwork(imgTemplate) {
                            artworkUrl = imgTemplate.replacingOccurrences(of: "{recipe}", with: "320x320")
                        }
                        
                        let incoming = RmsTrackData(artist: primary, track: track, artworkUrl: artworkUrl)
                        DispatchQueue.main.async {
                            self.applyRmsData(incoming)
                        }
                    } else {
                        // Song has ended or is not music: return to show name and station ident (delayed)
                        DispatchQueue.main.async {
                            self.applyRmsData(nil)
                        }
                    }
                } else {
                    // Empty segments: return to show name and station ident (delayed)
                    DispatchQueue.main.async {
                        self.applyRmsData(nil)
                    }
                }
            } catch {
                // Ignore parse errors on malformed responses
            }
        }.resume()
    }
}
