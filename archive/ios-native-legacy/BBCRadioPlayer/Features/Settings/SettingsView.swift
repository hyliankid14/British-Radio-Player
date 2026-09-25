import SwiftUI

struct SettingsView: View {
    @ObservedObject var settingsStore: AppSettingsStore
    @ObservedObject var analytics: PrivacyAnalyticsService
    @ObservedObject var podcastsViewModel: PodcastsViewModel
    @ObservedObject var episodeDownloadService: EpisodeDownloadService
    var body: some View {
        List {
            Section("Playback") {
                NavigationLink("Playback") {
                    PlaybackSettingsSubView(settingsStore: settingsStore)
                }
            }

            Section("Podcasts") {
                NavigationLink("Episode Index") {
                    EpisodeIndexSettingsSubView(settingsStore: settingsStore, podcastsViewModel: podcastsViewModel)
                }
                NavigationLink("Downloads") {
                    DownloadsSettingsSubView(settingsStore: settingsStore, episodeDownloadService: episodeDownloadService)
                }
            }

            Section("App") {
                NavigationLink("Interface") {
                    InterfaceSettingsSubView(settingsStore: settingsStore)
                }
                NavigationLink("Privacy") {
                    PrivacySettingsSubView(analytics: analytics)
                }
                NavigationLink("About") {
                    AboutSettingsSubView()
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct PlaybackSettingsSubView: View {
    @ObservedObject var settingsStore: AppSettingsStore

    var body: some View {
        Form {
            Picker("Quality", selection: $settingsStore.playbackQuality) {
                ForEach(PlaybackQuality.allCases, id: \.self) { quality in
                    Text(quality.displayName).tag(quality)
                }
            }

            if settingsStore.playbackQuality == .auto {
                Text("Automatically selects High quality on Wi-Fi and Low quality on cellular data")
                    .font(.caption)
                    .foregroundStyle(.secondary)
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

            Picker("Automatically play next episode", selection: $settingsStore.autoplayNextEpisode) {
                ForEach(AutoplayNextEpisode.allCases, id: \.self) { option in
                    Text(option.displayName).tag(option)
                }
            }
        }
        .navigationTitle("Playback")
    }
}

private struct EpisodeIndexSettingsSubView: View {
    @ObservedObject var settingsStore: AppSettingsStore
    @ObservedObject var podcastsViewModel: PodcastsViewModel
    @State private var statusMessage: String?

    var body: some View {
        Form {
            HStack {
                Text("Last updated")
                Spacer()
                Text((podcastsViewModel.cloudIndexLastUpdated ?? settingsStore.episodeIndexLastUpdated).map(relativeDateString) ?? "Never")
                    .foregroundStyle(.secondary)
            }

            HStack {
                Text("Podcasts in index")
                Spacer()
                Text("\(podcastsViewModel.indexPodcastCount)")
                    .foregroundStyle(.secondary)
            }

            HStack {
                Text("Episodes in index")
                Spacer()
                Text("\(podcastsViewModel.indexEpisodeCount)")
                    .foregroundStyle(.secondary)
            }

            Button {
                Task {
                    let didRefresh = await podcastsViewModel.refreshEpisodeIndex(force: true)
                    statusMessage = didRefresh ? "Episode index updated" : "Could not update episode index"
                }
            } label: {
                HStack {
                    Text("Update episode index now")
                    Spacer()
                    if podcastsViewModel.isRefreshingEpisodeIndex {
                        ProgressView()
                    }
                }
            }
            .disabled(podcastsViewModel.isRefreshingEpisodeIndex)

            Toggle("Auto-update daily", isOn: $settingsStore.episodeIndexAutoUpdatesEnabled)
        }
        .navigationTitle("Episode Index")
        .alert("Status", isPresented: Binding(
            get: { statusMessage != nil },
            set: { if !$0 { statusMessage = nil } }
        )) {
            Button("OK", role: .cancel) {
                statusMessage = nil
            }
        } message: {
            Text(statusMessage ?? "")
        }
    }

    private func relativeDateString(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}

private struct DownloadsSettingsSubView: View {
    @ObservedObject var settingsStore: AppSettingsStore
    @ObservedObject var episodeDownloadService: EpisodeDownloadService
    @State private var showDeleteDownloadsConfirmation = false

    var body: some View {
        Form {
            Toggle("Auto-download saved episodes", isOn: $settingsStore.autoDownloadSavedEpisodes)
            Toggle("Auto-download latest subscribed episodes", isOn: $settingsStore.autoDownloadSubscribedPodcasts)

            if settingsStore.autoDownloadSubscribedPodcasts {
                Picker("Episodes per podcast", selection: $settingsStore.autoDownloadLimit) {
                    ForEach(AutoDownloadLimit.allCases) { option in
                        Text(option.displayName).tag(option)
                    }
                }
            }

            HStack {
                Text("Downloaded episodes")
                Spacer()
                Text("\(episodeDownloadService.downloadedEpisodeCount)")
                    .foregroundStyle(.secondary)
            }

            Button("Delete all downloads", role: .destructive) {
                showDeleteDownloadsConfirmation = true
            }
            .disabled(episodeDownloadService.downloadedEpisodeCount == 0)

            Text("Downloads are saved in the app’s Documents folder so they can be accessed from the Files app.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .navigationTitle("Downloads")
        .alert("Delete all downloads?", isPresented: $showDeleteDownloadsConfirmation) {
            Button("Delete", role: .destructive) {
                episodeDownloadService.deleteAllDownloads()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This removes all downloaded podcast episodes from local storage.")
        }
    }
}

private struct InterfaceSettingsSubView: View {
    @ObservedObject var settingsStore: AppSettingsStore

    var body: some View {
        Form {
            Picker("Theme", selection: $settingsStore.appTheme) {
                ForEach(AppTheme.allCases, id: \.self) { theme in
                    Text(theme.displayName).tag(theme)
                }
            }
        }
        .navigationTitle("Interface")
    }
}

private struct PrivacySettingsSubView: View {
    @ObservedObject var analytics: PrivacyAnalyticsService
    @State private var showPrivacyPolicy = false

    var body: some View {
        Form {
            Toggle("Share anonymous analytics", isOn: Binding(
                get: { analytics.isEnabled },
                set: { analytics.isEnabled = $0 }
            ))

            Button("Privacy policy") {
                showPrivacyPolicy = true
            }
        }
        .navigationTitle("Privacy")
        .sheet(isPresented: $showPrivacyPolicy) {
            NavigationStack {
                ScrollView {
                    Text("""
                    British Radio Player Analytics Privacy Policy

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

private struct AboutSettingsSubView: View {
    var body: some View {
        Form {
            Text("British Radio Player iOS port")
            Text("Unofficial third-party app. Not affiliated with or endorsed by the BBC.")
                .font(.caption)
                .foregroundStyle(.secondary)
            HStack {
                Text("Version")
                Spacer()
                Text(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "Unknown")
                    .foregroundStyle(.secondary)
            }
            Text("Initial parity target: favourites, stations, podcasts, settings")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .navigationTitle("About")
    }
}
