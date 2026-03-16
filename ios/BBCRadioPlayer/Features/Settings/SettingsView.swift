import SwiftUI

struct SettingsView: View {
    @ObservedObject var settingsStore: AppSettingsStore

    var body: some View {
        Form {
            Section("Playback") {
                Picker("Quality", selection: $settingsStore.playbackQuality) {
                    ForEach(PlaybackQuality.allCases, id: \.self) { quality in
                        Text(quality.displayName).tag(quality)
                    }
                }

                Picker("Next/Previous buttons", selection: $settingsStore.stationSkipMode) {
                    ForEach(StationSkipMode.allCases, id: \.self) { mode in
                        Text(mode.displayName).tag(mode)
                    }
                }

                Picker("Podcast artwork", selection: $settingsStore.podcastArtworkMode) {
                    ForEach(PodcastArtworkMode.allCases, id: \.self) { mode in
                        Text(mode.displayName).tag(mode)
                    }
                }

                if settingsStore.playbackQuality == .auto {
                    Text("Automatically selects High quality on Wi-Fi and Low quality on cellular data")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Section("Interface") {
                Picker("Theme", selection: $settingsStore.appTheme) {
                    ForEach(AppTheme.allCases, id: \.self) { theme in
                        Text(theme.displayName).tag(theme)
                    }
                }
            }

            Section("About") {
                Text("BBC Radio Player iOS port")
                Text("Initial parity target: favourites, stations, podcasts, settings")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
    }
}
