import SwiftUI

struct PodcastsView: View {
    @ObservedObject var viewModel: PodcastsViewModel
    @EnvironmentObject private var container: AppContainer
    @State private var toastMessage: String?
    @State private var toastVisible = false

    var body: some View {
        Group {
            if let selectedPodcast = viewModel.selectedPodcast {
                episodeList(for: selectedPodcast)
            } else if let error = viewModel.errorMessage {
                VStack(spacing: 16) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.system(size: 48))
                        .foregroundStyle(.orange)
                    Text("Could not load podcasts")
                        .font(.headline)
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                    Button(action: {
                        Task {
                            await viewModel.loadPodcasts()
                        }
                    }) {
                        Label("Try Again", systemImage: "arrow.clockwise")
                            .padding(.horizontal, 24)
                            .padding(.vertical, 12)
                            .background(Color.blue)
                            .foregroundStyle(.white)
                            .cornerRadius(8)
                    }
                }
                .padding()
            } else {
                podcastList
            }
        }
        .navigationTitle(viewModel.selectedPodcast == nil ? "Podcasts" : "Episodes")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $viewModel.searchText, prompt: "Search podcasts")
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
        .task {
            if viewModel.podcasts.isEmpty && viewModel.errorMessage == nil {
                await viewModel.loadPodcasts()
            }
        }
    }

    private var podcastList: some View {
        List {
            Section {
                filterBar
            }

            Section("Podcasts") {
                ForEach(viewModel.filteredPodcasts) { podcast in
                    HStack(spacing: 12) {
                        artwork(url: podcast.imageURL, placeholder: "mic.circle.fill")

                        VStack(alignment: .leading, spacing: 4) {
                            Text(podcast.title)
                                .font(container.appSettingsStore.compactRows ? .body : .headline)
                                .lineLimit(2)
                            if !podcast.description.isEmpty {
                                Text(podcast.description.stripHTMLTags)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(2)
                            }
                            if !podcast.genres.isEmpty {
                                Text(podcast.genres.prefix(2).joined(separator: " • "))
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                        }

                        Spacer(minLength: 8)

                        Button {
                            viewModel.toggleSubscription(for: podcast)
                            let subscribed = viewModel.isSubscribed(to: podcast)
                            showToast(subscribed ? "Subscribed to \(podcast.title)" : "Unsubscribed from \(podcast.title)")
                        } label: {
                            Image(systemName: viewModel.isSubscribed(to: podcast) ? "plus.circle.fill" : "plus.circle")
                                .foregroundStyle(viewModel.isSubscribed(to: podcast) ? .blue : .secondary)
                        }
                        .buttonStyle(.plain)
                    }
                    .contentShape(Rectangle())
                    .onTapGesture {
                        Task {
                            await viewModel.selectPodcast(podcast)
                        }
                    }
                }
            }
        }
        .overlay {
            if viewModel.isLoading {
                ProgressView("Loading podcasts...")
            }
        }
        .refreshable {
            await viewModel.loadPodcasts()
        }
        .listStyle(.insetGrouped)
    }

    private func episodeList(for podcast: Podcast) -> some View {
        List(viewModel.sortedEpisodes) { episode in
            HStack(spacing: 12) {
                ZStack(alignment: .bottomTrailing) {
                    Button {
                        viewModel.play(episode)
                    } label: {
                        artwork(url: episode.imageURL ?? podcast.imageURL, placeholder: "waveform.circle.fill")
                    }
                    .buttonStyle(.plain)

                    if viewModel.isEpisodePlayed(episode) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.caption)
                            .foregroundStyle(.green)
                            .background(
                                Circle()
                                    .fill(Color(.systemBackground))
                                    .frame(width: 14, height: 14)
                            )
                            .offset(x: 2, y: 2)
                    }
                }

                Button {
                    viewModel.play(episode)
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(episode.title)
                            .font(container.appSettingsStore.compactRows ? .body : .headline)
                            .lineLimit(2)
                        
                        HStack(spacing: 8) {
                            Text(viewModel.formattedDate(episode.pubDate))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                            
                            if episode.durationMins > 0 {
                                Text("\(episode.durationMins) min")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        
                        if !episode.description.isEmpty {
                            Text(episode.description.stripHTMLTags)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                        }
                    }
                }
                .buttonStyle(.plain)

                Spacer(minLength: 8)

                Button {
                    viewModel.toggleSavedEpisode(episode)
                    let saved = viewModel.isSavedEpisode(episode)
                    showToast(saved ? "Saved episode" : "Removed saved episode")
                } label: {
                    Image(systemName: viewModel.isSavedEpisode(episode) ? "bookmark.fill" : "bookmark")
                        .foregroundStyle(viewModel.isSavedEpisode(episode) ? .blue : .secondary)
                }
                .buttonStyle(.plain)
            }
        }
        .overlay {
            if viewModel.isLoading {
                ProgressView("Loading episodes...")
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Back") {
                    viewModel.clearSelection()
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker("Sort episodes", selection: $viewModel.episodeSortOption) {
                        ForEach(EpisodeSortOption.allCases) { option in
                            Text(option.rawValue).tag(option)
                        }
                    }
                } label: {
                    Image(systemName: "arrow.up.arrow.down")
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private var filterBar: some View {
        HStack(spacing: 12) {
            Menu {
                Picker("Genre", selection: $viewModel.selectedGenre) {
                    ForEach(viewModel.availableGenres, id: \.self) { genre in
                        Text(genre).tag(genre)
                    }
                }
            } label: {
                filterChip(title: "Genre", value: viewModel.selectedGenre)
            }

            Menu {
                Picker("Sort", selection: $viewModel.selectedSort) {
                    ForEach(PodcastSortOption.allCases) { option in
                        Text(option.rawValue).tag(option)
                    }
                }
            } label: {
                filterChip(title: "Sort", value: viewModel.selectedSort.rawValue)
            }

            Spacer()
        }
    }

    private func filterChip(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.caption)
                .lineLimit(1)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func artwork(url: URL?, placeholder: String) -> some View {
        AsyncImage(url: url) { image in
            image
                .resizable()
                .scaledToFill()
        } placeholder: {
            ZStack {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Color(.secondarySystemGroupedBackground))
                Image(systemName: placeholder)
                    .font(.title3)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(width: 52, height: 52)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
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
