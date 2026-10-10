import Foundation
import Observation

@Observable final class TVScrobbleManager {
    static let shared = TVScrobbleManager()
    
    var isEnabled: Bool {
        get { UserDefaults.standard.bool(forKey: "tv_scrobble_enabled") }
        set { UserDefaults.standard.set(newValue, forKey: "tv_scrobble_enabled") }
    }
    
    var username: String {
        get { UserDefaults.standard.string(forKey: "tv_lastfm_username") ?? "" }
        set { UserDefaults.standard.set(newValue, forKey: "tv_lastfm_username") }
    }
    
    var sessionKey: String {
        get { UserDefaults.standard.string(forKey: "tv_lastfm_session_key") ?? "" }
        set { UserDefaults.standard.set(newValue, forKey: "tv_lastfm_session_key") }
    }
    
    private var currentTrack: String?
    private var currentArtist: String?
    private var trackStartTime: Date?
    
    private init() {}
    
    func trackStarted(artist: String, track: String) {
        guard isEnabled, !sessionKey.isEmpty else { return }
        self.currentArtist = artist
        self.currentTrack = track
        self.trackStartTime = Date()
        updateNowPlaying(artist: artist, track: track)
    }
    
    func trackEnded(elapsedSeconds: Double) {
        guard isEnabled, !sessionKey.isEmpty,
              let artist = currentArtist, let track = currentTrack else { return }
        
        // Scrobble if listened to at least 30 seconds
        if elapsedSeconds >= 30.0 {
            scrobble(artist: artist, track: track)
        }
        
        self.currentArtist = nil
        self.currentTrack = nil
        self.trackStartTime = nil
    }
    
    private func updateNowPlaying(artist: String, track: String) {
        // Last.fm track.updateNowPlaying API call
    }
    
    private func scrobble(artist: String, track: String) {
        // Last.fm track.scrobble API call
    }
}
