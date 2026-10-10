import Foundation

enum CarPlayStationCategory: String, CaseIterable {
    case national = "National"
    case regions = "Nations & Regions"
    case local = "Local Radio"

    /// Mirrors the category values produced by the React `StationRepository`.
    init(snapshotValue: String) {
        switch snapshotValue.lowercased() {
        case "national": self = .national
        case "regions": self = .regions
        default: self = .local
        }
    }
}

/// A station as described by the shared snapshot, plus the stream resolution ladder
/// used by `StationRepository.getStreamCandidates` so both surfaces fall back identically.
struct CarPlayStation: Identifiable {
    let id: String
    let title: String
    let serviceId: String
    let streamServiceIds: [String]
    let directStreamUrls: [String]
    let logoUrl: String
    let category: CarPlayStationCategory

    init(record: CarPlayStationRecord) {
        id = record.id
        title = record.title
        serviceId = record.serviceId
        streamServiceIds = record.streamServiceIds.isEmpty ? [record.serviceId] : record.streamServiceIds
        directStreamUrls = record.directStreamUrls
        logoUrl = record.logoUrl
        category = CarPlayStationCategory(snapshotValue: record.category)
    }

    /// Ordered stream URLs to try. Mirrors `getStreamCandidates` in `src/data/stations.ts`.
    func streamCandidates(geoBlocked: Bool) -> [String] {
        let direct = directStreamUrls.filter { !$0.isEmpty }
        let serviceIds = streamServiceIds.filter { !$0.isEmpty }
        var candidates: [String] = []
        var seen: Set<String> = []

        func append(_ url: String) {
            guard !url.isEmpty, seen.insert(url).inserted else { return }
            candidates.append(url)
        }

        if geoBlocked {
            for serviceId in serviceIds { append("\(CarPlayStation.bbcHlsNonUK)/\(serviceId).m3u8") }
            for url in direct where !url.contains("&uk=1") && !url.contains("/live/uk/") && !url.contains("/hls/uk/") { append(url) }
            return candidates
        }

        for serviceId in serviceIds { append("\(CarPlayStation.bbcHlsUK)/\(serviceId).m3u8") }
        for url in direct where !url.contains("/live/ww/") && !url.contains("/nonuk/") { append(url) }
        for serviceId in serviceIds { append("\(CarPlayStation.bbcHlsNonUK)/\(serviceId).m3u8") }
        for url in direct where url.contains("/live/ww/") || url.contains("/nonuk/") { append(url) }

        return candidates
    }

    static let bbcHlsUK =
        "https://a.files.bbci.co.uk/ms6/live/3441A116-B12E-4D2F-ACA8-C1984642FA4B/audio/simulcast/hls/uk/pc_hd_abr_v2/cf"
    static let bbcHlsNonUK =
        "https://a.files.bbci.co.uk/ms6/live/3441A116-B12E-4D2F-ACA8-C1984642FA4B/audio/simulcast/hls/nonuk/pc_hd_abr_v2/cf"
}
