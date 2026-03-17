import SwiftUI

enum FavouritesTab {
    case stations
    case podcasts
    case episodes
    case history
    case searches
}

struct FavouritesView: View {
    @ObservedObject var viewModel: RadioViewModel
    @EnvironmentObject private var container: AppContainer
    @State private var selectedTab = FavouritesTab.stations
    @State private var toastMessage: String?
    @State private var toastVisible = false

    private var hasAnyFavourites: Bool {
        !viewModel.favoriteStations.isEmpty ||
        !container.favoritesStore.subscribedPodcastIDs.isEmpty ||
        !container.favoritesStore.savedEpisodeIDs.isEmpty ||
        !container.podcastsViewModel.playedHistory.isEmpty ||
        !container.podcastsViewModel.savedSearches.isEmpty
    }

    var body: some View {
        Group {
            if !hasAnyFavourites {
                VStack(spacing: 16) {
                    Image(systemName: "star.fill")
                        .font(.system(size: 48))
                        .foregroundStyle(.gray)
                    Text("No Favourites Yet")
                        .font(.headline)
                    Text("Add stations, subscribe to podcasts, or save episodes to see them here")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(.systemBackground))
            } else {
                VStack(spacing: 0) {
                    Group {
                        switch selectedTab {
                        case .stations:
                            stationsList
                        case .podcasts:
                            podcastsList
                        case .episodes:
                            episodesList
                        case .history:
                            historyList
                        case .searches:
                            savedSearchesList
                        }
                    }
                }
            }
        }
        .navigationTitle("Favourites")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .top, spacing: 0) {
            if hasAnyFavourites {
                favouritesHeader
            }
        }
        .overlay(alignment: .bottom) {
            if toastVisible, let toastMessage {
                Text(toastMessage)
                    .font(.footnote)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(.black.opacity(0.85), in: Capsule())
                    .padding(.bottom, 90)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
    }

    private var favouritesHeader: some View {
        VStack(spacing: 0) {
            Picker("Favourites", selection: $selectedTab) {
                Text("Stations").tag(FavouritesTab.stations)
                Text("Podcasts").tag(FavouritesTab.podcasts)
                Text("Episodes").tag(FavouritesTab.episodes)
                Text("History").tag(FavouritesTab.history)
                Text("Searches").tag(FavouritesTab.searches)
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            .padding(.vertical, 10)
        }
        .background(Color(.systemBackground))
        .overlay(alignment: .bottom) {
            Divider()
        }
    }

    private var stationsList: some View {
        List {
            if viewModel.favoriteStations.isEmpty {
                Section {
                    Text("No favourite stations. Star any station to add it here.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            } else {
                Section("Favourite Stations") {
                    ForEach(viewModel.favoriteStations) { station in
                        Button {
                            viewModel.play(station)
                        } label: {
                            HStack(spacing: 12) {
                                stationArtwork(for: station)

                                VStack(alignment: .leading, spacing: 4) {
                                    Text(station.title)
                                        .font(container.appSettingsStore.compactRows ? .body : .headline)
                                        .lineLimit(2)
                                        .foregroundStyle(Color.brandText)
                                    Text(viewModel.showSubtitle(for: station))
                                        .font(.caption)
                                        .foregroundStyle(Color.subtitleText)
                                        .lineLimit(1)
                                }

                                Spacer(minLength: 8)

                                Button {
                                    viewModel.toggleFavorite(station)
                                } label: {
                                    Image(systemName: "star.fill")
                                        .foregroundStyle(.yellow)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private var podcastsList: some View {
        List {
            if container.favoritesStore.subscribedPodcastIDs.isEmpty {
                Section {
                    Text("No subscribed podcasts. Open a podcast to subscribe.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            } else {
                Section("Subscribed Podcasts") {
                    ForEach(container.favoritesStore.subscribedPodcastSnapshots) { snapshot in
                        Button {
                            guard let podcast = snapshot.asPodcast else { return }
                            container.selectedRootTab = .podcasts
                            Task {
                                await container.podcastsViewModel.selectPodcast(podcast)
                            }
                        } label: {
                            HStack(spacing: 12) {
                                podcastArtwork(url: snapshot.imageURLString.flatMap(URL.init(string:)))

                                VStack(alignment: .leading, spacing: 4) {
                                    Text(snapshot.title)
                                        .font(container.appSettingsStore.compactRows ? .body : .headline)
                                        .lineLimit(2)
                                        .foregroundStyle(Color.brandText)
                                    if !snapshot.genres.isEmpty {
                                        Text(snapshot.genres.prefix(2).joined(separator: " • "))
                                            .font(.caption2)
                                            .foregroundStyle(Color.subtitleText)
                                            .lineLimit(1)
                                    }
                                }

                                Spacer(minLength: 8)
                            }
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private var episodesList: some View {
        List {
            if container.favoritesStore.savedEpisodeIDs.isEmpty {
                Section {
                    Text("No saved episodes. Tap the bookmark icon on any episode to save it.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            } else {
                Section("Saved Episodes") {
                    ForEach(container.favoritesStore.savedEpisodeSnapshots) { snapshot in
                        Button {
                            guard let episode = snapshot.asEpisode else { return }
                            container.podcastsViewModel.play(episode, podcastTitle: snapshot.podcastTitle)
                        } label: {
                            HStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(snapshot.title)
                                        .font(container.appSettingsStore.compactRows ? .body : .headline)
                                        .lineLimit(2)
                                        .foregroundStyle(Color.brandText)

                                    if let podcastTitle = snapshot.podcastTitle, !podcastTitle.isEmpty {
                                        Text(podcastTitle)
                                            .font(.caption)
                                            .foregroundStyle(Color.subtitleText)
                                            .lineLimit(1)
                                    }

                                    HStack(spacing: 8) {
                                        Text(container.podcastsViewModel.formattedDate(snapshot.pubDate))
                                            .font(.caption2)
                                            .foregroundStyle(Color.subtitleText)
                                        
                                        if snapshot.durationMins > 0 {
                                            Text("\(snapshot.durationMins) min")
                                                .font(.caption2)
                                                .foregroundStyle(Color.subtitleText)
                                        }
                                    }
                                }

                                Spacer(minLength: 8)

                                savedEpisodeDownloadMenu(for: snapshot)

                                Button {
                                    container.favoritesStore.toggleSaved(episodeID: snapshot.id)
                                } label: {
                                    Image(systemName: "bookmark.fill")
                                        .foregroundStyle(.blue)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private var savedSearchesList: some View {
        List {
            if container.podcastsViewModel.savedSearches.isEmpty {
                Section {
                    Text("No saved searches yet. Use Podcasts search, then tap the save-search button.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            } else {
                Section("Saved Searches") {
                    ForEach(Array(container.podcastsViewModel.savedSearches.enumerated()), id: \.offset) { index, query in
                        Button {
                            container.podcastsViewModel.applySavedSearch(query)
                            container.selectedRootTab = .podcasts
                        } label: {
                            HStack {
                                Image(systemName: "magnifyingglass")
                                    .foregroundStyle(.secondary)
                                Text(query)
                                    .foregroundStyle(Color.brandText)
                                Spacer()
                            }
                        }
                        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                            Button("Delete", role: .destructive) {
                                container.podcastsViewModel.removeSavedSearch(at: IndexSet(integer: index))
                            }
                        }
                    }
                    .onDelete { offsets in
                        container.podcastsViewModel.removeSavedSearch(at: offsets)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private var historyList: some View {
        List {
            if container.podcastsViewModel.playedHistory.isEmpty {
                Section {
                    Text("No play history yet. Played podcast episodes will appear here.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            } else {
                Section("Recently Played") {
                    ForEach(Array(container.podcastsViewModel.playedHistory.enumerated()), id: \.offset) { index, entry in
                        Button {
                            guard let episode = entry.asEpisode else { return }
                            container.podcastsViewModel.play(episode, podcastTitle: entry.podcastTitle)
                        } label: {
                            HStack(spacing: 12) {
                                podcastArtwork(url: entry.imageURLString.flatMap(URL.init(string:)))

                                VStack(alignment: .leading, spacing: 4) {
                                    Text(entry.title)
                                        .font(container.appSettingsStore.compactRows ? .body : .headline)
                                        .lineLimit(2)
                                        .foregroundStyle(Color.brandText)

                                    if let podcastTitle = entry.podcastTitle, !podcastTitle.isEmpty {
                                        Text(podcastTitle)
                                            .font(.caption)
                                            .foregroundStyle(Color.subtitleText)
                                            .lineLimit(1)
                                    }

                                    Text(container.podcastsViewModel.formattedDate(entry.pubDate))
                                        .font(.caption2)
                                        .foregroundStyle(Color.subtitleText)
                                }

                                Spacer(minLength: 8)
                            }
                        }
                        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                            Button("Remove", role: .destructive) {
                                container.podcastsViewModel.removePlayedHistory(at: IndexSet(integer: index))
                            }
                        }
                    }
                    .onDelete { offsets in
                        container.podcastsViewModel.removePlayedHistory(at: offsets)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private func stationArtwork(for station: Station) -> some View {
        AsyncImage(url: station.logoURL) { image in
            image
                .resizable()
                .scaledToFill()
        } placeholder: {
            ZStack {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Color(.secondarySystemGroupedBackground))
                Image(systemName: "dot.radiowaves.left.and.right")
                    .foregroundStyle(.secondary)
            }
        }
        .frame(width: 44, height: 44)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private func podcastArtwork(url: URL?) -> some View {
        AsyncImage(url: url) { image in
            image
                .resizable()
                .scaledToFill()
        } placeholder: {
            ZStack {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(Color(.secondarySystemGroupedBackground))
                Image(systemName: "mic.circle.fill")
                    .font(.title3)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(width: 44, height: 44)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    @ViewBuilder
    private func savedEpisodeDownloadMenu(for snapshot: SavedEpisodeSnapshot) -> some View {
        if let episode = snapshot.asEpisode {
            let status = container.episodeDownloadService.status(for: episode)

            switch status {
            case .downloading:
                ProgressView()
                    .frame(width: 28, height: 28)
            case .downloaded:
                Menu {
                    Button("Remove download", role: .destructive) {
                        container.episodeDownloadService.deleteDownload(for: episode)
                        showToast("Download removed")
                    }
                } label: {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                }
                .buttonStyle(.plain)
            case .failed:
                Button {
                    Task {
                        let didDownload = await container.podcastsViewModel.downloadEpisode(episode, podcastTitle: snapshot.podcastTitle)
                        showToast(didDownload ? "Episode downloaded" : "Could not download episode")
                    }
                } label: {
                    Image(systemName: "exclamationmark.circle.fill")
                        .foregroundStyle(.orange)
                }
                .buttonStyle(.plain)
            case .notDownloaded:
                Button {
                    Task {
                        let didDownload = await container.podcastsViewModel.downloadEpisode(episode, podcastTitle: snapshot.podcastTitle)
                        showToast(didDownload ? "Episode downloaded" : "Could not download episode")
                    }
                } label: {
                    Image(systemName: "arrow.down.circle")
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
            }
        } else {
            EmptyView()
        }
    }

    private func showToast(_ message: String) {
        toastMessage = message
        withAnimation(.easeOut(duration: 0.2)) {
            toastVisible = true
        }
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 1_600_000_000)
            withAnimation(.easeIn(duration: 0.2)) {
                toastVisible = false
            }
        }
    }
}

