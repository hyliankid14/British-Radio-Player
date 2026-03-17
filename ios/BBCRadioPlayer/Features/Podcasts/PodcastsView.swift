import SwiftUI
import CoreMotion

// MARK: - PodcastsView

struct PodcastsView: View {
    @ObservedObject var viewModel: PodcastsViewModel
    @EnvironmentObject private var container: AppContainer
    @State private var toastMessage: String?
    @State private var toastVisible = false
    @State private var showFullPlayer = false
    @State private var isEpisodeViewPresented = false
    @StateObject private var shakeDetector = ShakeToShuffleDetector()

    var body: some View {
        podcastList
            .navigationTitle("Podcasts")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(isPresented: $isEpisodeViewPresented) {
                if let podcast = viewModel.selectedPodcast {
                    PodcastEpisodeView(podcast: podcast, viewModel: viewModel, showFullPlayer: $showFullPlayer)
                        .environmentObject(container)
                }
            }
            .overlay(alignment: .bottom) {
                if toastVisible, let msg = toastMessage {
                    Text(msg)
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
                await viewModel.searchEpisodesFromIndex()
            }
            .fullScreenCover(isPresented: $showFullPlayer) {
                FullPlayerView().environmentObject(container)
            }
            .onAppear {
                shakeDetector.onShake = { [weak viewModel] in
                    guard let vm = viewModel, vm.selectedPodcast == nil else { return }
                    guard let random = vm.filteredPodcasts.randomElement() else { return }
                    Task { @MainActor in
                        self.openPodcast(random)
                    }
                }
                shakeDetector.start()
            }
            .onDisappear { shakeDetector.stop() }
    }

    @MainActor
    private func openPodcast(_ podcast: Podcast) {
        viewModel.selectedPodcast = podcast
        isEpisodeViewPresented = true
    }

    private func openPodcast(byID podcastID: String) {
        Task {
            if viewModel.podcasts.isEmpty {
                await viewModel.loadPodcasts()
            }
            guard let podcast = viewModel.podcasts.first(where: { $0.id == podcastID }) else { return }
            await MainActor.run {
                openPodcast(podcast)
            }
        }
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
                    if viewModel.showEpisodeSearchSpinner {
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
                                    openPodcast(byID: result.podcastID)
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
                                    openPodcast(byID: result.podcastID)
                                }
                            }
                        }
                    }
                }
            }

            Section("Podcasts") {
                if viewModel.isLoading && viewModel.filteredPodcasts.isEmpty {
                    HStack { Spacer(); ProgressView("Loading…"); Spacer() }
                } else if let error = viewModel.errorMessage, viewModel.podcasts.isEmpty {
                    VStack(spacing: 12) {
                        Text(error).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
                        Button("Try Again") { Task { await viewModel.loadPodcasts() } }
                    }
                    .padding(.vertical, 8)
                } else {
                    ForEach(viewModel.filteredPodcasts) { podcast in
                        HStack(spacing: 12) {
                            artwork(url: podcast.imageURL, placeholder: "mic.circle.fill")
                            VStack(alignment: .leading, spacing: 4) {
                                Text(podcast.title)
                                    .font(container.appSettingsStore.compactRows ? .body : .headline)
                                    .lineLimit(2)
                                    .foregroundStyle(Color.brandText)
                                if !podcast.description.isEmpty {
                                    Text(podcast.description.stripHTMLTags)
                                        .font(.caption).foregroundStyle(.secondary).lineLimit(2)
                                }
                                if !podcast.genres.isEmpty {
                                    Text(podcast.genres.prefix(2).joined(separator: ", "))
                                        .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                                }
                            }
                            Spacer(minLength: 8)
                            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                        }
                        .contentShape(Rectangle())
                        .onTapGesture {
                            dismissKeyboard()
                            openPodcast(podcast)
                        }
                    }
                }
            }
        }
        .overlay {
            if viewModel.isLoading && viewModel.podcasts.isEmpty {
                ProgressView("Loading podcasts…")
            }
        }
        .refreshable { await viewModel.loadPodcasts() }
        .scrollDismissesKeyboard(.immediately)
        .listStyle(.insetGrouped)
    }

    private var searchAndFilterPanel: some View {
        VStack(spacing: 6) {
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
            .padding(.vertical, 8)
            .background(Color(.secondarySystemGroupedBackground))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

            HStack(spacing: 8) {
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
            }

            HStack(spacing: 8) {
                Button {
                    viewModel.resetFilters()
                } label: {
                    Text("Reset Filters")
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 9)
                }
                .buttonStyle(.plain)
                .background(Color.accentColor.opacity(0.35))
                .clipShape(Capsule())

                if !viewModel.searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Button {
                        saveSearchFromInput()
                    } label: {
                        Image(systemName: "bookmark")
                            .font(.subheadline.weight(.semibold))
                            .frame(width: 42, height: 36)
                    }
                    .buttonStyle(.plain)
                    .background(Color(.secondarySystemGroupedBackground))
                    .clipShape(Capsule())
                    .accessibilityLabel("Save Search")
                }
            }
        }
    }

    private func filterRow(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption2)
                .foregroundStyle(.secondary)
            HStack {
                Text(value)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                Spacer()
                Image(systemName: "chevron.down")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func saveSearchFromInput() {
        let q = viewModel.searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return }
        viewModel.saveCurrentSearch()
        showToast("Saved search")
    }

    private func selectRandomPodcast() {
        guard !viewModel.filteredPodcasts.isEmpty else { return }
        guard let random = viewModel.filteredPodcasts.randomElement() else { return }
        openPodcast(random)
        showToast("Random: \(random.title)")
    }

    private func dismissKeyboard() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
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
        withAnimation(.easeOut(duration: 0.2)) { toastVisible = true }
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 1_600_000_000)
            withAnimation(.easeIn(duration: 0.2)) { toastVisible = false }
        }
    }
}

// MARK: - PodcastEpisodeView

struct PodcastEpisodeView: View {
    let podcast: Podcast
    @ObservedObject var viewModel: PodcastsViewModel
    @Binding var showFullPlayer: Bool
    @EnvironmentObject private var container: AppContainer
    @State private var showInfoSheet = false
    @State private var localEpisodes: [Episode] = []
    @State private var isLoadingEpisodes = false
    @State private var localErrorMessage: String?

    private var cleanedPodcastDescription: String {
        let stripped = podcast.description.stripHTMLTags
        if !stripped.isEmpty {
            return stripped
        }
        return podcast.description.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var displayedEpisodes: [Episode] {
        viewModel.sortEpisodesForDisplay(localEpisodes)
    }

    var body: some View {
        List {
            Section {
                podcastHeader
                    .listRowInsets(EdgeInsets(top: 10, leading: 12, bottom: 10, trailing: 12))
            }

            Section("Episodes") {
                if isLoadingEpisodes && displayedEpisodes.isEmpty {
                    HStack { Spacer(); ProgressView("Loading episodes…"); Spacer() }
                } else if displayedEpisodes.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(localErrorMessage ?? "No episodes available right now.")
                            .font(.subheadline).foregroundStyle(.secondary)
                        Button("Retry") { Task { await reloadEpisodes() } }
                            .font(.subheadline.weight(.semibold))
                    }
                    .padding(.vertical, 4)
                } else {
                    ForEach(displayedEpisodes) { episode in
                        HStack(spacing: 12) {
                            ZStack(alignment: .bottomTrailing) {
                                episodeArtwork(url: episode.imageURL ?? podcast.imageURL)
                                if viewModel.isEpisodePlayed(episode) {
                                    Image(systemName: "checkmark.circle.fill")
                                        .font(.caption).foregroundStyle(.green)
                                        .background(Circle().fill(Color(.systemBackground)).frame(width: 14, height: 14))
                                        .offset(x: 2, y: 2)
                                }
                            }

                            VStack(alignment: .leading, spacing: 4) {
                                Text(episode.title)
                                    .font(container.appSettingsStore.compactRows ? .body : .headline)
                                    .lineLimit(2).foregroundStyle(Color.brandText)
                                HStack(spacing: 8) {
                                    Text(viewModel.formattedDate(episode.pubDate))
                                        .font(.caption2).foregroundStyle(.secondary)
                                    if episode.durationMins > 0 {
                                        Text("\(episode.durationMins) min")
                                            .font(.caption2).foregroundStyle(.secondary)
                                    }
                                }
                                if !episode.description.isEmpty {
                                    Text(episode.description.stripHTMLTags)
                                        .font(.caption).foregroundStyle(.secondary).lineLimit(2)
                                }
                            }

                            Spacer(minLength: 8)
                            episodeDownloadMenu(for: episode)
                            Button {
                                viewModel.play(episode)
                                showFullPlayer = true
                            } label: {
                                Image(systemName: "play.circle.fill").font(.title3).foregroundStyle(.blue)
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
        }
        .listStyle(.insetGrouped)
        .navigationTitle(podcast.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker("Sort", selection: $viewModel.episodeSortOption) {
                        ForEach(EpisodeSortOption.allCases) { Text($0.rawValue).tag($0) }
                    }
                } label: { Image(systemName: "arrow.up.arrow.down") }
            }
        }
        .sheet(isPresented: $showInfoSheet) {
            EpisodeInfoSheet(title: podcast.title, description: cleanedPodcastDescription)
        }
        .task(id: podcast.id) {
            await reloadEpisodes()
        }
    }

    private func reloadEpisodes() async {
        isLoadingEpisodes = true
        localErrorMessage = nil
        let result = await viewModel.loadEpisodesForDisplay(for: podcast)
        localEpisodes = result.episodes
        localErrorMessage = result.errorMessage
        isLoadingEpisodes = false
    }

    private var podcastHeader: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                AsyncImage(url: podcast.imageURL) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    ZStack {
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(Color(.secondarySystemGroupedBackground))
                        Image(systemName: "mic.circle.fill").font(.title2).foregroundStyle(.secondary)
                    }
                }
                .frame(width: 100, height: 100)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

                VStack(alignment: .leading, spacing: 8) {
                    Text(cleanedPodcastDescription)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .lineLimit(5)

                    if cleanedPodcastDescription.count > 220 {
                        Button("Show more") {
                            showInfoSheet = true
                        }
                        .font(.caption)
                        .foregroundStyle(.blue)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .topLeading)
            }

            HStack(spacing: 12) {
                Button {
                    viewModel.toggleSubscription(for: podcast)
                } label: {
                    Text(viewModel.isSubscribed(to: podcast) ? "Subscribed" : "Subscribe")
                        .font(.body.weight(.medium)).frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered).tint(.accentColor)

                if viewModel.isSubscribed(to: podcast) {
                    Button {
                        let id = podcast.id
                        if !container.favoritesStore.isNotificationsEnabled(podcastID: id) {
                            Task { await container.podcastNotificationService.requestAuthorisation() }
                        }
                        container.favoritesStore.toggleNotifications(podcastID: id)
                    } label: {
                        Image(systemName: container.favoritesStore.isNotificationsEnabled(podcastID: podcast.id)
                              ? "bell.fill" : "bell")
                        .foregroundStyle(container.favoritesStore.isNotificationsEnabled(podcastID: podcast.id)
                                         ? .blue : .secondary)
                        .frame(width: 44, height: 44)
                    }
                    .buttonStyle(.plain)
                }

                ShareLink(item: podcast.htmlURL ?? podcast.rssURL) {
                    Image(systemName: "square.and.arrow.up").frame(width: 44, height: 44)
                }.buttonStyle(.plain)
            }
        }
    }

    private func episodeArtwork(url: URL?) -> some View {
        AsyncImage(url: url) { image in
            image.resizable().scaledToFill()
        } placeholder: {
            ZStack {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Color(.secondarySystemGroupedBackground))
                Image(systemName: "waveform.circle.fill").font(.title3).foregroundStyle(.secondary)
            }
        }
        .frame(width: 52, height: 52)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    @ViewBuilder
    private func episodeDownloadMenu(for episode: Episode) -> some View {
        let status = container.episodeDownloadService.status(for: episode)
        switch status {
        case .downloading:
            ProgressView().frame(width: 28, height: 28)
        case .downloaded:
            Menu {
                Button("Remove download", role: .destructive) {
                    viewModel.deleteDownloadedEpisode(episode)
                }
            } label: {
                Image(systemName: "checkmark.circle.fill").font(.title3).foregroundStyle(.green)
            }.buttonStyle(.plain)
        case .failed:
            Button {
                Task { _ = await viewModel.downloadEpisode(episode, podcastTitle: podcast.title) }
            } label: {
                Image(systemName: "exclamationmark.circle.fill").font(.title3).foregroundStyle(.orange)
            }.buttonStyle(.plain)
        case .notDownloaded:
            Button {
                Task { _ = await viewModel.downloadEpisode(episode, podcastTitle: podcast.title) }
            } label: {
                Image(systemName: "arrow.down.circle").font(.title3).foregroundStyle(.secondary)
            }.buttonStyle(.plain)
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
        let displayDescription = description.trimmingCharacters(in: .whitespacesAndNewlines)

        NavigationStack {
            ScrollView {
                Text(displayDescription.isEmpty ? "No additional information available." : displayDescription)
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
