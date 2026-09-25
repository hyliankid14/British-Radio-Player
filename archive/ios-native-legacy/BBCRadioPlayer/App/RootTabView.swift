import SwiftUI

struct RootTabView: View {
    @EnvironmentObject private var container: AppContainer
    @Environment(\.scenePhase) private var scenePhase
    @State private var miniPlayerVisible = false
    @State private var showAnalyticsPrompt = false

    var body: some View {
        ZStack(alignment: .bottom) {
            TabView(selection: $container.selectedRootTab) {
                NavigationStack {
                    FavouritesView(viewModel: container.radioViewModel)
                }
                .tabItem {
                    Label("Favourites", systemImage: "star.fill")
                }
                .tag(RootTab.favourites)
                .safeAreaInset(edge: .bottom, spacing: 0) { miniPlayerSpacer }

                NavigationStack {
                    RadioView(viewModel: container.radioViewModel)
                }
                .tabItem {
                    Label("Stations", systemImage: "dot.radiowaves.left.and.right")
                }
                .tag(RootTab.stations)
                .safeAreaInset(edge: .bottom, spacing: 0) { miniPlayerSpacer }

                NavigationStack {
                    PodcastsView(viewModel: container.podcastsViewModel)
                }
                .tabItem {
                    Label("Podcasts", systemImage: "mic")
                }
                .tag(RootTab.podcasts)
                .safeAreaInset(edge: .bottom, spacing: 0) { miniPlayerSpacer }

                NavigationStack {
                    SettingsView(
                        settingsStore: container.appSettingsStore,
                        analytics: container.privacyAnalytics,
                        podcastsViewModel: container.podcastsViewModel,
                        episodeDownloadService: container.episodeDownloadService
                    )
                }
                .tabItem {
                    Label("Settings", systemImage: "gearshape")
                }
                .tag(RootTab.settings)
                .safeAreaInset(edge: .bottom, spacing: 0) { miniPlayerSpacer }
            }

            if miniPlayerVisible {
                MiniPlayerView()
                    .environmentObject(container)
                    .padding(.bottom, 49)
            }
        }
        .onAppear {
            miniPlayerVisible = container.audioPlayerService.hasActiveItem
            if container.shouldShowAnalyticsOptInDialog {
                showAnalyticsPrompt = true
            }
            container.checkEpisodeNotifications()
            container.syncEpisodeDownloads()
        }
        .onChange(of: scenePhase) { newPhase in
            if newPhase == .active {
                container.checkEpisodeNotifications()
                container.syncEpisodeDownloads()
            }
        }
        .onReceive(container.audioPlayerService.objectWillChange) { _ in
            miniPlayerVisible = container.audioPlayerService.hasActiveItem
        }
        .alert("Help Improve British Radio Player", isPresented: $showAnalyticsPrompt) {
            Button("Approve") {
                container.setAnalyticsEnabled(true)
                container.markAnalyticsOptInDialogShown()
            }
            Button("Maybe Later", role: .cancel) {
                container.setAnalyticsEnabled(false)
                container.markAnalyticsOptInDialogShown()
            }
        } message: {
            Text("Share anonymous playback events to help improve station and podcast recommendations.")
        }
    }

    @ViewBuilder
    private var miniPlayerSpacer: some View {
        if miniPlayerVisible {
            Color.clear.frame(height: 124)
        }
    }
}
