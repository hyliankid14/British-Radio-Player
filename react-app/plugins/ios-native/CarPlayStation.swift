import Foundation

enum CarPlayStationCategory: String, CaseIterable {
    case national = "National"
    case regions = "Nations & Regions"
    case local = "Local Radio"
}

struct CarPlayStation: Identifiable {
    let id: String
    let title: String
    let serviceId: String
    let directStreamURL: URL?
    let category: CarPlayStationCategory

    var streamURL: URL {
        if let directStreamURL = directStreamURL {
            return directStreamURL
        }
        return URL(string: "https://lsn.lv/bbcradio.m3u8?station=\(serviceId)&bitrate=320000")!
    }

    var fallbackStreamURL: URL {
        URL(string: "https://a.files.bbci.co.uk/media/live/manifesto/audio/simulcast/hls/uk/sbr_high/ak/\(serviceId).m3u8")!
    }

    var logoURL: URL? {
        URL(string: "https://sounds.files.bbci.co.uk/3.11.1/services/\(serviceId)/blocks-colour-black_600x600.png")
    }
}
