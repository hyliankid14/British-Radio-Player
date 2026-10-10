import Foundation
import MediaPlayer
import Observation

struct TVScheduleItem: Identifiable, Hashable {
    var id: String { "\(startDate.timeIntervalSince1970)_\(brandTitle ?? "")" }
    let brandTitle: String?
    let episodeTitle: String?
    let shortSynopsis: String?
    let startDate: Date
    let endDate: Date
    var imageUrl: String?
    
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
    
    var startTimeFormatted: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: startDate)
    }
    
    var endTimeFormatted: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: endDate)
    }
    
    var timeWindowFormatted: String {
        return "\(startTimeFormatted)\u{00A0}–\u{00A0}\(endTimeFormatted)"
    }
    
    var isLiveNow: Bool {
        let now = Date()
        return now >= startDate && now < endDate
    }
}

@Observable final class TVNowPlayingMetadata {
    static let shared = TVNowPlayingMetadata()
    
    var currentShowTitle: String?
    var currentShowDetail: String?
    var currentTrackTitle: String?
    var currentArtist: String?
    var currentSongImageUrl: String?
    var timeWindowText: String?
    var nextShowTitle: String?
    var nextShowTimeText: String?
    
    var schedules: [String: [TVScheduleItem]] = [:]
    var dateSchedules: [String: [TVScheduleItem]] = [:]
    private var activeServiceId: String?
    private var pollTimer: Timer?
    
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
    
    func startPolling(serviceId: String) {
        stopPolling()
        activeServiceId = serviceId
        fetchSchedule(for: serviceId)
        fetchLatestRmsSegment(for: serviceId)
        
        DispatchQueue.main.async { [weak self] in
            // Poll every 15 seconds for timely track transitions
            self?.pollTimer = Timer.scheduledTimer(withTimeInterval: 15.0, repeats: true) { [weak self] _ in
                guard let self = self, let sid = self.activeServiceId else { return }
                self.fetchSchedule(for: sid)
                self.fetchLatestRmsSegment(for: sid)
            }
        }
    }
    
    func stopPolling() {
        pollTimer?.invalidate()
        pollTimer = nil
        activeServiceId = nil
        currentShowTitle = nil
        currentShowDetail = nil
        currentTrackTitle = nil
        currentArtist = nil
        currentSongImageUrl = nil
        timeWindowText = nil
        nextShowTitle = nil
        nextShowTimeText = nil
    }
    
    func showTitle(for serviceId: String) -> String? {
        if let current = resolveCurrentAndNext(for: serviceId).current {
            return current.displayTitle
        }
        return nil
    }
    
    func fetchShowTitle(for serviceId: String, completion: @escaping (String?) -> Void) {
        if let current = resolveCurrentAndNext(for: serviceId).current {
            completion(current.displayTitle)
            return
        }
        
        fetchSchedule(for: serviceId) { [weak self] _ in
            if let current = self?.resolveCurrentAndNext(for: serviceId).current {
                completion(current.displayTitle)
            } else {
                completion(nil)
            }
        }
    }
    
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
    
    // MARK: - Fetch RMS Segments (Music Tracks & Artist info)
    
    func fetchLatestRmsSegment(for serviceId: String) {
        guard let url = URL(string: "https://rms.api.bbc.co.uk/v2/services/\(serviceId)/segments/latest") else { return }
        
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 8)
        request.setValue("BritishRadioPlayer-tvOS/1.0", forHTTPHeaderField: "User-Agent")
        
        URLSession.shared.dataTask(with: request) { [weak self] data, _, error in
            guard let self = self, let data = data, error == nil else { return }
            do {
                if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let dataArr = json["data"] as? [[String: Any]],
                   let segment = dataArr.first {
                    
                    let segmentType = (segment["segment_type"] as? String)?.lowercased() ?? ""
                    let titles = segment["titles"] as? [String: Any]
                    let primary = titles?["primary"] as? String // Artist
                    let secondary = (titles?["secondary"] as? String) ?? (titles?["tertiary"] as? String) // Track Title
                    let imgTemplate = segment["image_url"] as? String
                    
                    let offset = segment["offset"] as? [String: Any]
                    let label = (offset?["label"] as? String)?.lowercased() ?? ""
                    let nowPlaying = offset?["now_playing"] as? Bool
                    let isNowPlaying = (nowPlaying == true || label == "now playing") && !label.contains("ago")
                    
                    DispatchQueue.main.async {
                        if segmentType == "music" && (isNowPlaying || label.contains("now playing") || !label.contains("ago")) {
                            self.currentArtist = primary?.trimmingCharacters(in: .whitespacesAndNewlines)
                            self.currentTrackTitle = secondary?.trimmingCharacters(in: .whitespacesAndNewlines)
                            
                            if let template = imgTemplate, !template.isEmpty, !Self.isPlaceholderArtwork(template) {
                                self.currentSongImageUrl = template.replacingOccurrences(of: "{recipe}", with: "640x640")
                            } else {
                                self.currentSongImageUrl = nil
                            }
                            
                            if let artist = self.currentArtist, let track = self.currentTrackTitle {
                                TVScrobbleManager.shared.trackStarted(artist: artist, track: track)
                            }
                        } else if segmentType == "music" && label.contains("minute") {
                            // Recently finished track — keep visible if current show hasn't started new song
                            self.currentArtist = primary?.trimmingCharacters(in: .whitespacesAndNewlines)
                            self.currentTrackTitle = secondary?.trimmingCharacters(in: .whitespacesAndNewlines)
                            if let template = imgTemplate, !template.isEmpty, !Self.isPlaceholderArtwork(template) {
                                self.currentSongImageUrl = template.replacingOccurrences(of: "{recipe}", with: "640x640")
                            } else {
                                self.currentSongImageUrl = nil
                            }
                        } else {
                            self.currentArtist = nil
                            self.currentTrackTitle = nil
                            self.currentSongImageUrl = nil
                        }
                    }
                }
            } catch {
                // Ignore parse errors
            }
        }.resume()
    }
    
    // MARK: - Fetch RMS Programme Schedules
    
    func fetchSchedule(for serviceId: String, date: Date = Date(), completion: (([TVScheduleItem]) -> Void)? = nil) {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        let dateStr = formatter.string(from: date)
        let cacheKey = "\(serviceId)_\(dateStr)"
        
        if let cached = dateSchedules[cacheKey], !cached.isEmpty {
            completion?(cached)
            return
        }
        
        let urlString = "https://rms.api.bbc.co.uk/v2/experience/inline/schedules/\(serviceId)/\(dateStr)"
        guard let url = URL(string: urlString) else {
            completion?([])
            return
        }
        
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10)
        request.setValue("BritishRadioPlayer-tvOS/1.0", forHTTPHeaderField: "User-Agent")
        
        URLSession.shared.dataTask(with: request) { [weak self] data, _, error in
            guard let self = self, let data = data, error == nil else {
                completion?([])
                return
            }
            do {
                if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let rawData = json["data"] as? [[String: Any]] {
                    var entries: [[String: Any]] = []
                    for item in rawData {
                        if let subEntries = item["data"] as? [[String: Any]] {
                            entries.append(contentsOf: subEntries)
                        } else {
                            entries.append(item)
                        }
                    }
                    
                    var items: [TVScheduleItem] = []
                    for entry in entries {
                        guard let startStr = entry["start"] as? String,
                              let endStr = entry["end"] as? String,
                              let start = self.parseDate(startStr),
                              let end = self.parseDate(endStr) else { continue }
                        
                        let titles = entry["titles"] as? [String: Any]
                        let brand = (titles?["primary"] as? String) ?? (titles?["brand"] as? String)
                        let episode = (titles?["secondary"] as? String) ?? (titles?["episode"] as? String)
                        
                        let synopses = entry["synopses"] as? [String: Any]
                        let synopsis = synopses?["short"] as? String
                        
                        let imgTemplate = entry["image_url"] as? String
                        let resolvedImage = imgTemplate?.replacingOccurrences(of: "{recipe}", with: "640x640")
                        
                        items.append(TVScheduleItem(
                            brandTitle: brand,
                            episodeTitle: episode,
                            shortSynopsis: synopsis,
                            startDate: start,
                            endDate: end,
                            imageUrl: resolvedImage
                        ))
                    }
                    
                    items.sort { $0.startDate < $1.startDate }
                    
                    DispatchQueue.main.async {
                        self.dateSchedules[cacheKey] = items
                        if Calendar.current.isDateInToday(date) {
                            self.schedules[serviceId] = items
                            if self.activeServiceId == serviceId {
                                self.updateCurrentMetadata(for: serviceId)
                            }
                        }
                        completion?(items)
                    }
                }
            } catch {
                completion?([])
            }
        }.resume()
    }
    
    private func updateCurrentMetadata(for serviceId: String) {
        let (current, next) = resolveCurrentAndNext(for: serviceId)
        
        if let current = current {
            self.currentShowTitle = current.displayTitle
            self.currentShowDetail = current.detail
            self.timeWindowText = current.timeWindowFormatted
        }
        
        if let next = next {
            self.nextShowTitle = next.displayTitle
            let formatter = DateFormatter()
            formatter.dateFormat = "HH:mm"
            self.nextShowTimeText = "Next at \(formatter.string(from: next.startDate))"
        } else {
            self.nextShowTitle = nil
            self.nextShowTimeText = nil
        }
    }
    
    private func resolveCurrentAndNext(for serviceId: String) -> (current: TVScheduleItem?, next: TVScheduleItem?) {
        guard let list = schedules[serviceId], !list.isEmpty else { return (nil, nil) }
        let now = Date()
        
        if let currentIndex = list.firstIndex(where: { now >= $0.startDate && now < $0.endDate }) {
            let current = list[currentIndex]
            let next = (currentIndex + 1 < list.count) ? list[currentIndex + 1] : nil
            return (current, next)
        }
        
        if let nextIndex = list.firstIndex(where: { $0.startDate > now }) {
            return (nil, list[nextIndex])
        }
        
        return (list.last, nil)
    }
    
    private func parseDate(_ string: String) -> Date? {
        return isoWithFraction.date(from: string) ?? isoStandard.date(from: string)
    }
}
