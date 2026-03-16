import SwiftUI

struct SettingsView: View {
    @ObservedObject var settingsStore: AppSettingsStore
    @ObservedObject var analytics: PrivacyAnalyticsService
    @State private var showPrivacyPolicy = false

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

            Section("Privacy") {
                Toggle("Share anonymous analytics", isOn: Binding(
                    get: { analytics.isEnabled },
                    set: { analytics.isEnabled = $0 }
                ))

                Button("Privacy policy") {
                    showPrivacyPolicy = true
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
        .sheet(isPresented: $showPrivacyPolicy) {
            NavigationStack {
                ScrollView {
                    Text("""
                    BBC Radio Player Analytics Privacy Policy

                    When you enable analytics:
                    • We collect station, podcast and episode play events
                    • We collect the date/time (UTC timestamp) and app version
                    • Data is sent over HTTPS to our private server
                    • IP addresses are not stored in the analytics database
                    • No user identifiers, device IDs or personal info are collected
                    • Data is anonymous and used only for popularity trends

                    When you disable analytics:
                    • No data is collected or sent
                    • You can disable it anytime in settings
                    """)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
                }
                .navigationTitle("Privacy Policy")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Done") { showPrivacyPolicy = false }
                    }
                }
            }
        }
    }
}
