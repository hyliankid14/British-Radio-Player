import SwiftUI

enum FavouritesTab {
    case stations
    case podcasts
    case episodes
}

struct FavouritesView: View {
    @ObservedObject var viewModel: RadioViewModel
    @EnvironmentObject private var container: AppContainer
    @State private var selectedTab = FavouritesTab.stations

    private var hasAnyFavourites: Bool {
        !viewModel.favoriteStations.isEmpty ||
        !container.favoritesStore.subscribedPodcastIDs.isEmpty ||
        !container.favoritesStore.savedEpisodeIDs.isEmpty
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
    }

    private var favouritesHeader: some View {
        VStack(spacing: 0) {
            Picker("Favourites", selection: $selectedTab) {
                Text("Stations").tag(FavouritesTab.stations)
                Text("Podcasts").tag(FavouritesTab.podcasts)
                Text("Episodes").tag(FavouritesTab.episodes)
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
                                        .foregroundStyle(.secondary)
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
                    Text("No subscribed podcasts. Add the + button on any podcast to subscribe.")
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
                                            .foregroundStyle(.secondary)
                                            .lineLimit(1)
                                    }
                                }

                                Spacer(minLength: 8)

                                Button {
                                    container.favoritesStore.toggleSubscription(podcastID: snapshot.id)
                                } label: {
                                    Image(systemName: "plus.circle.fill")
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
                                    
                                    HStack(spacing: 8) {
                                        Text(container.podcastsViewModel.formattedDate(snapshot.pubDate))
                                            .font(.caption2)
                                            .foregroundStyle(.secondary)
                                        
                                        if snapshot.durationMins > 0 {
                                            Text("\(snapshot.durationMins) min")
                                                .font(.caption2)
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                }

                                Spacer(minLength: 8)

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
}

