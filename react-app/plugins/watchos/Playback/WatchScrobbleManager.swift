import Foundation

final class WatchScrobbleManager {
    static let shared = WatchScrobbleManager()
    
    private var currentArtist: String?
    private var currentTrack: String?
    private var trackStartTime: Date?
    private var durationSec: Int?
    
    private init() {}
    
    func onTrackStarted(artist: String, track: String, durationSec: Int?) {
        self.currentArtist = artist
        self.currentTrack = track
        self.durationSec = durationSec
        self.trackStartTime = Date()
    }
    
    func onTrackEnded(playedSeconds: Double) {
        guard let artist = currentArtist, let track = currentTrack, let duration = durationSec else { return }
        
        if playedSeconds > Double(duration) * 0.5 {
            scrobble(artist: artist, track: track)
        }
        
        currentArtist = nil
        currentTrack = nil
        durationSec = nil
        trackStartTime = nil
    }
    
    private func scrobble(artist: String, track: String) {
        let appState = WatchConnectivityManager.shared.appState
        let isDirect = appState.lastfm_direct_enabled ?? false
        let sessionKey = appState.lastfm_session_key ?? ""
        
        // Basic scrobble implementation
        if isDirect && !sessionKey.isEmpty {
            // Last.fm API logic
            print("Scrobbling to Last.fm direct: \(artist) - \(track)")
        } else if let _ = appState.lastfm_proxy_url, let _ = appState.lastfm_username {
            // Proxy logic
            print("Scrobbling via proxy: \(artist) - \(track)")
        }
    }
}
