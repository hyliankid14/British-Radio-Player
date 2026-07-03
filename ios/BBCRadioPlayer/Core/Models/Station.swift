import Foundation

enum StationCategory: String, CaseIterable, Codable {
    case national
    case regions
    case local

    var displayName: String {
        switch self {
        case .national:
            return "National"
        case .regions:
            return "Regions"
        case .local:
            return "Local"
        }
    }
}

struct Station: Identifiable, Codable, Equatable {
    private static let streamBase = "https://lsn.lv/bbcradio.m3u8"
    private static let logoBase = "https://sounds.files.bbci.co.uk/3.11.1/services"

    let id: String
    let title: String
    let serviceId: String
    let directStreamURL: URL?
    let category: StationCategory

    var logoURL: URL? {
        URL(string: "\(Self.logoBase)/\(serviceId)/blocks-colour-black_600x600.png")
    }

    func streamURL(quality: PlaybackQuality) -> URL? {
        if let directStreamURL {
            return directStreamURL
        }

        let streamURLString = "\(Self.streamBase)?station=\(serviceId)&bitrate=\(quality.bitrate)"
        return URL(string: streamURLString)
    }

    func streamCandidates(quality: PlaybackQuality) -> [URL] {
        var candidates: [URL] = []
        if let directStreamURL {
            candidates.append(directStreamURL)
        }
        if let url = URL(string: "\(Self.streamBase)?station=\(serviceId)&bitrate=\(quality.bitrate)") {
            candidates.append(url)
        }
        if let url = URL(string: "https://a.files.bbci.co.uk/media/live/manifesto/audio/simulcast/hls/uk/sbr_high/ak/\(serviceId).m3u8") {
            candidates.append(url)
        }
        if let url = URL(string: "https://a.files.bbci.co.uk/media/live/manifesto/audio/simulcast/hls/nonuk/sbr_low/ak/\(serviceId).m3u8") {
            candidates.append(url)
        }
        return candidates
    }
}
