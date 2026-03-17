import SwiftUI
import CoreMotion

struct PodcastsView: View {
    @ObservedObject var viewModel: PodcastsViewModel
    @EnvironmentObject private var container: AppContainer
    @State private var toastMessage: String?
    @State private var toastVisible = false
    @State private var infoTitle: String = ""
    @State private var infoDescription: String = ""
    @State private var showInfoSheet = false
    @State private var showFullPlayer = false
    @StateObject private var shakeDetector = ShakeToShuffleDetector()

    var body: some View {
        content
            .navigationTitle(viewModel.selectedPodcast?.title ?? "Podcasts")
            .navigationBarTitleDisplayMode(.inline)
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
            .task(id: viewModel.searchText) {
                guard viewModel.selectedPodcast == nil else { return }
                await viewModel.searchEpisodesFromIndex()
            }
            .sheet(isPresented: $showInfoSheet) {
                EpisodeInfoSheet(title: infoTitle, description: infoDescription)
            }
            .fullScreenCover(isPresented: $showFullPlayer) {
                FullPlayerView()
                    .environmentObject(container)
            }
            .onAppear {
                shakeDetector.onShake = { [weak viewModel] in
                    guard let viewModel, viewModel.selectedPodcast == nil else { return }
                    selectRandomPodcast()
                }
                shakeDetector.start()
            }
            .onDisappear {
                shakeDetector.stop()
            }
    }

    @ViewBuilder
    private var content: some View {
        if let selectedPodcast = viewModel.selectedPodcast {
            episodeList(for: selectedPodcast)
        } else if let error = viewModel.errorMessage {
            landingErrorView(error: error)
        } else {
            podcastList
        }
    }


    private func landingErrorView(error: String) -> some View {
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
    }

    private func saveSearchFromInput() {
        let query = viewModel.searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return }
        viewModel.saveCurrentSearch()
        showToast("Saved search")
    }
    private var podcastList: some View {
        List {
            Section {
                searchAndFilterPanel
            }

            if viewModel.indexPodcastCount > 0 || viewModel.indexEpisodeCount > 0 {
                Section {
                    HStack(spacing: 6) {
                        Image(systemName: "tray.full")
                            .foregroundStyle(.secondary)
                        Text("Index: \(viewModel.indexPodcastCount) podcasts, \(viewModel.indexEpisodeCount) episodes")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            if !viewModel.searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Section("Episode Results") {
                    if viewModel.isEpisodeSearchLoading {
                        ProgressView("Searching episodes...")
                    } else if viewModel.episodeSearchResults.isEmpty {
                        Text("No episodes found")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(viewModel.episodeSearchResults) { result in
                            HStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(result.episodeTitle)
                                        .font(.headline)
                                        .lineLimit(2)
                                        .foregroundStyle(Color.brandText)

                                    Text(result.podcastTitle)
                                        .font(.caption)
                                        .foregroundStyle(Color.subtitleText)
                                        .lineLimit(1)

                                    let dateText = viewModel.formattedEpoch(result.pubEpoch)
                                    if !dateText.isEmpty {
                                        Text(dateText)
                                            .font(.caption2)
                                            .foregroundStyle(.secondary)
                                    }
                                }

                                Spacer(minLength: 8)

                                Button {
                                    Task {
                                        await viewModel.openEpisodeSearchResult(result)
                                    }
                                } label: {
                                    Image(systemName: "chevron.right.circle")
                                        .foregroundStyle(.secondary)
                                }
                                .buttonStyle(.plain)

                                Button {
                                    viewModel.playEpisodeSearchResult(result)
                                    showFullPlayer = true
                                } label: {
                                    Image(systemName: "play.circle.fill")
                                        .font(.title3)
                                        .foregroundStyle(.blue)
                                }
                                .buttonStyle(.plain)
                            }
                            .contentShape(Rectangle())
                            .onTapGesture {
                                if result.audioURL != nil {
                                    viewModel.playEpisodeSearchResult(result)
                                    showFullPlayer = true
                                } else {
                                    Task {
                                        await viewModel.openEpisodeSearchResult(result)
                                    }
                                }
                            }
                        }
                    }
                }
            }

            Section("Podcasts") {
                ForEach(viewModel.filteredPodcasts) { podcast in
                    Button {
                        Task {
                            await viewModel.selectPodcast(podcast)
                        }
                    } label: {
                        HStack(spacing: 12) {
                            artwork(url: podcast.imageURL, placeholder: "mic.circle.fill")

                            VStack(alignment: .leading, spacing: 4) {
                                Text(podcast.title)
                                    .font(container.appSettingsStore.compactRows ? .body : .headline)
                                    .lineLimit(2)
                                    .foregroundStyle(Color.brandText)
                                if !podcast.description.isEmpty {
                                    Text(podcast.description.stripHTMLTags)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(2)
                                }
                                if !podcast.genres.isEmpty {
                                    Text(podcast.genres.prefix(2).joined(separator: ", "))
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                            }

                            Spacer(minLength: 8)
                        }
                    }
                    .buttonStyle(.plain)
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
        List {
            Section {
                podcastHeader(for: podcast)
                    .listRowInsets(EdgeInsets(top: 10, leading: 12, bottom: 10, trailing: 12))
            }

            Section("Episodes") {
                ForEach(viewModel.sortedEpisodes) { episode in
                    HStack(spacing: 12) {
                        ZStack(alignment: .bottomTrailing) {
                            artwork(url: episode.imageURL ?? podcast.imageURL, placeholder: "waveform.circle.fill")

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

                        VStack(alignment: .leading, spacing: 4) {
                            Text(episode.title)
                                .font(container.appSettingsStore.compactRows ? .body : .headline)
                                .lineLimit(2)
                                .foregroundStyle(Color.brandText)

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

                        Spacer(minLength: 8)

                        episodeDownloadMenu(for: episode, podcastTitle: podcast.title)

                        Button {
                            viewModel.play(episode)
                            showFullPlayer = true
                        } label: {
                            Image(systemName: "play.circle.fill")
                                .font(.title3)
                                .foregroundStyle(.blue)
                        }
                        .buttonStyle(.plain)
                    }
                    .contentShape(Rectangle())
                    .onTapGesture {
                        viewModel.play(episode)
                        showFullPlayer = true
                    }
                }
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

    private func podcastHeader(for podcast: Podcast) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                AsyncImage(url: podcast.imageURL) { image in
                    image
                        .resizable()
                        .scaledToFill()
                } placeholder: {
                    ZStack {
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(Color(.secondarySystemGroupedBackground))
                        Image(systemName: "mic.circle.fill")
                            .font(.title2)
                            .foregroundStyle(.secondary)
                    }
                }
                .frame(width: 100, height: 100)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

                Text(podcast.description.stripHTMLTags)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(5)
                    .frame(maxHeight: .infinity, alignment: .topLeading)
            }

            if podcast.description.stripHTMLTags.count > 220 {
                Button("Show more") {
                    presentInfo(title: podcast.title, description: podcast.description.stripHTMLTags)
                }
                .font(.caption)
                .foregroundStyle(.blue)
            }

            HStack(spacing: 12) {
                Button {
                    viewModel.toggleSubscription(for: podcast)
                    let subscribed = viewModel.isSubscribed(to: podcast)
                    showToast(subscribed ? "Subscribed to \(podcast.title)" : "Unsubscribed from \(podcast.title)")
                } label: {
                    Text(viewModel.isSubscribed(to: podcast) ? "Subscribed" : "Subscribe")
                        .font(.body.weight(.medium))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(.accentColor)

                if viewModel.isSubscribed(to: podcast) {
                    Button {
                        let podcastID = podcast.id
                        let willEnable = !container.favoritesStore.isNotificationsEnabled(podcastID: podcastID)
                        if willEnable {
                            Task { await container.podcastNotificationService.requestAuthorisation() }
                        }
                        container.favoritesStore.toggleNotifications(podcastID: podcastID)
                    } label: {
                        Image(systemName: container.favoritesStore.isNotificationsEnabled(podcastID: podcast.id) ? "bell.fill" : "bell")
                            .foregroundStyle(container.favoritesStore.isNotificationsEnabled(podcastID: podcast.id) ? .blue : .secondary)
                            .frame(width: 44, height: 44)
                    }
                    .buttonStyle(.plain)
                }

                ShareLink(item: podcast.htmlURL ?? podcast.rssURL) {
                    Image(systemName: "square.and.arrow.up")
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var searchAndFilterPanel: some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)

                TextField("Search podcasts...", text: $viewModel.searchText)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled(true)

                if !viewModel.searchText.isEmpty {
                    Button {
                        viewModel.searchText = ""
                    } label: {
                        Image(systemName: "xmark")
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                }

                Button {
                    selectRandomPodcast()
                } label: {
                    Image(systemName: "shuffle")
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Random podcast")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 12)
            .background(Color(.secondarySystemGroupedBackground))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

            Menu {
                Picker("Genre", selection: $viewModel.selectedGenre) {
                    ForEach(viewModel.availableGenres, id: \.self) { genre in
                        Text(genre).tag(genre)
                    }
                }
            } label: {
                filterRow(title: "Genre", value: viewModel.selectedGenre)
            }

            Menu {
                Picker("Sort", selection: $viewModel.selectedSort) {
                    ForEach(PodcastSortOption.allCases) { option in
                        Text(option.rawValue).tag(option)
                    }
                }
            } label: {
                filterRow(title: "Sort", value: viewModel.selectedSort.rawValue)
            }

            if viewModel.hasActiveFilters {
                Button {
                    viewModel.resetFilters()
                } label: {
                    Text("Reset Filters")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                }
                .buttonStyle(.plain)
                .background(Color.accentColor.opacity(0.35))
                .clipShape(Capsule())
            }

            if !viewModel.searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Button {
                    saveSearchFromInput()
                } label: {
                    Text("Save Search")
                        .font(.subheadline.weight(.semibold))
                }
            }
        }
    }

    private func filterRow(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.headline)
                .foregroundStyle(.secondary)
            HStack {
                Text(value)
                    .font(.title3.weight(.semibold))
                    .lineLimit(1)
                Spacer()
                Image(systemName: "chevron.down")
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func selectRandomPodcast() {
        guard viewModel.selectedPodcast == nil else { return }
        guard !viewModel.filteredPodcasts.isEmpty else {
            showToast("No podcast available for random pick")
            return
        }

        guard let randomPodcast = viewModel.filteredPodcasts.randomElement() else { return }
        Task {
            await viewModel.selectPodcast(randomPodcast)
        }
        showToast("Random: \(randomPodcast.title)")
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

    private func presentInfo(title: String, description: String) {
        infoTitle = title
        infoDescription = description.isEmpty ? "No additional information available." : description
        showInfoSheet = true
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

    @ViewBuilder
    private func episodeDownloadMenu(for episode: Episode, podcastTitle: String?) -> some View {
        let status = container.episodeDownloadService.status(for: episode)

        switch status {
        case .downloading:
            ProgressView()
                .frame(width: 28, height: 28)
        case .downloaded:
            Menu {
                Button("Remove download", role: .destructive) {
                    viewModel.deleteDownloadedEpisode(episode)
                    showToast("Download removed")
                }
            } label: {
                Image(systemName: "checkmark.circle.fill")
                    .font(.title3)
                    .foregroundStyle(.green)
            }
            .buttonStyle(.plain)
        case .failed:
            Button {
                Task {
                    let didDownload = await viewModel.downloadEpisode(episode, podcastTitle: podcastTitle)
                    showToast(didDownload ? "Episode downloaded" : "Could not download episode")
                }
            } label: {
                Image(systemName: "exclamationmark.circle.fill")
                    .font(.title3)
                    .foregroundStyle(.orange)
            }
            .buttonStyle(.plain)
        case .notDownloaded:
            Button {
                Task {
                    let didDownload = await viewModel.downloadEpisode(episode, podcastTitle: podcastTitle)
                    showToast(didDownload ? "Episode downloaded" : "Could not download episode")
                }
            } label: {
                Image(systemName: "arrow.down.circle")
                    .font(.title3)
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
        }
    }
}

private final class ShakeToShuffleDetector: ObservableObject {
    var onShake: (() -> Void)?

    private let motionManager = CMMotionManager()
    private var lastShakeAt: Date = .distantPast
    private let threshold: Double = 2.35
    private let cooldown: TimeInterval = 1.2

    func start() {
        guard motionManager.isAccelerometerAvailable else { return }
        guard !motionManager.isAccelerometerActive else { return }

        motionManager.accelerometerUpdateInterval = 0.12
        motionManager.startAccelerometerUpdates(to: .main) { [weak self] data, _ in
            guard let self, let data else { return }
            let magnitude = sqrt(
                (data.acceleration.x * data.acceleration.x) +
                (data.acceleration.y * data.acceleration.y) +
                (data.acceleration.z * data.acceleration.z)
            )
            guard magnitude > self.threshold else { return }
            guard Date().timeIntervalSince(self.lastShakeAt) > self.cooldown else { return }
            self.lastShakeAt = Date()
            self.onShake?()
        }
    }

    func stop() {
        guard motionManager.isAccelerometerActive else { return }
        motionManager.stopAccelerometerUpdates()
    }
}

private struct EpisodeInfoSheet: View {
    @Environment(\.dismiss) private var dismiss
    let title: String
    let description: String

    var body: some View {
        NavigationStack {
            ScrollView {
                Text(description)
                    .font(.body)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
    }
}
