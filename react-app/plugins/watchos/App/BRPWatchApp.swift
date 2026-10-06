import SwiftUI

@main
struct BRPWatchApp: App {
    init() {
        _ = WatchPlaybackController.shared
        _ = WatchConnectivityManager.shared
        _ = NowPlayingMetadata.shared
    }
    
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
