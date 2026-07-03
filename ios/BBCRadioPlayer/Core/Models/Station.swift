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

    func streamCandidates(quality: PlaybackQuality, geoBlocked: Bool = false) -> [URL] {
        var candidates: [URL] = []

        // First: UK stream at the user's chosen quality (from directStreamURL if it matches)
        if let directStreamURL = directStreamURL {
            let bitrateStr = String(quality.bitrate)
            if directStreamURL.absoluteString.contains("bitrate=\(bitrateStr)") {
                candidates.append(directStreamURL)
            }
        }

        // Second: International/worldwide streams (BBC non-UK HLS)
        if let url = URL(string: "https://a.files.bbci.co.uk/media/live/manifesto/audio/simulcast/hls/nonuk/sbr_low/ak/\(serviceId).m3u8") {
            candidates.append(url)
        }

        // Radio 5 Live specific: Akamai international stream
        if id == "radio5live" {
            if let url = URL(string: "https://as-hls-ww-live.akamaized.net/pool_89021708/live/ww/bbc_radio_five_live/bbc_radio_five_live.isml/bbc_radio_five_live-audio%3d96000.norewind.m3u8") {
                candidates.append(url)
            }
        }

        if geoBlocked {
            return candidates
        }

        // Third: lsn.lv at requested quality
        if let url = URL(string: "\(Self.streamBase)?station=\(serviceId)&bitrate=\(quality.bitrate)") {
            candidates.append(url)
        }

        // Fourth: BBC UK HLS as final fallback
        if let url = URL(string: "https://a.files.bbci.co.uk/media/live/manifesto/audio/simulcast/hls/uk/sbr_high/ak/\(serviceId).m3u8") {
            candidates.append(url)
        }

        return candidates
    }
}
