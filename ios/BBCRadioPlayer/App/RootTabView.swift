import SwiftUI

struct RootTabView: View {
    @EnvironmentObject private var container: AppContainer
    @State private var miniPlayerVisible = false

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
                    SettingsView(settingsStore: container.appSettingsStore)
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
        }
        .onReceive(container.audioPlayerService.objectWillChange) { _ in
            miniPlayerVisible = container.audioPlayerService.hasActiveItem
        }
    }

    @ViewBuilder
    private var miniPlayerSpacer: some View {
        if miniPlayerVisible {
            Color.clear.frame(height: 124)
        }
    }
}
