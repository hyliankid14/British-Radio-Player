import SwiftUI

struct SearchView: View {
    @Bindable var controller = TVPlaybackController.shared
    @Bindable var podcastManager = TVPodcastManager.shared
    @Bindable var subscriptionManager = TVSubscriptionManager.shared
    let onNavigateToNowPlaying: () -> Void
    
    @State private var searchText: String = ""
    @State private var remotePodcasts: [TVPodcast] = []
    @State private var isSearchingRemote: Bool = false
    @FocusState private var isSearchFieldFocused: Bool
    
    private var trimmedQuery: String {
        searchText.trimmingCharacters(in: .whitespaces)
    }
    
    var displayedPodcasts: [TVPodcast] {
        if trimmedQuery.isEmpty {
            return []
        }
        let local = podcastManager.searchPodcasts(matching: trimmedQuery)
        var seenIds = Set(local.map { $0.id })
        var combined = local
        for pod in remotePodcasts {
            if seenIds.insert(pod.id).inserted {
                combined.append(pod)
            }
        }
        return combined
    }
    
    private let quickSuggestions: [String] = [
        "Americast", "Newscast", "CrowdScience", "Comedy", "History",
        "The Archers", "Science", "Drama", "Business", "Football"
    ]
    
    var body: some View {
        NavigationStack {
            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: 30) {
                    
                    // Native Apple TV Text Input Field
                    VStack(alignment: .leading, spacing: 14) {
                        Text("Search Podcasts")
                            .font(.title)
                            .fontWeight(.bold)
                        
                        HStack(spacing: 16) {
                            Image(systemName: "magnifyingglass")
                                .font(.title3)
                                .foregroundColor(isSearchFieldFocused ? .black : .secondary)
                            
                            TextField("Search podcasts by title, topic, or host…", text: $searchText)
                                .font(.title3)
                                .foregroundColor(isSearchFieldFocused ? .black : .primary)
                                .submitLabel(.search)
                                .focused($isSearchFieldFocused)
                                .onSubmit {
                                    triggerRemoteSearch(query: searchText)
                                }
                            
                            if !searchText.isEmpty {
                                Button(action: {
                                    searchText = ""
                                    remotePodcasts = []
                                }) {
                                    Image(systemName: "xmark.circle.fill")
                                        .font(.title3)
                                        .foregroundColor(isSearchFieldFocused ? .black.opacity(0.6) : .secondary)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.horizontal, 24)
                        .padding(.vertical, 16)
                        .background(
                            RoundedRectangle(cornerRadius: 16, style: .continuous)
                                .fill(isSearchFieldFocused ? Color.white : Color.white.opacity(0.12))
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 16, style: .continuous)
                                .stroke(isSearchFieldFocused ? Color.clear : Color.white.opacity(0.2), lineWidth: 1)
                        )
                        .shadow(color: isSearchFieldFocused ? Color.white.opacity(0.35) : Color.clear, radius: 14, x: 0, y: 5)
                        .scaleEffect(isSearchFieldFocused ? 1.02 : 1.0)
                        .animation(.spring(response: 0.25, dampingFraction: 0.7), value: isSearchFieldFocused)
                    }
                    .padding(.horizontal, 90)
                    .padding(.top, 24)
                    
                    // Quick Suggestions Carousel
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 32) {
                            Text("Suggestions:")
                                .font(.headline)
                                .foregroundColor(.secondary)
                                .fixedSize()
                                .padding(.trailing, 4)
                            
                            ForEach(quickSuggestions, id: \.self) { item in
                                Button(action: {
                                    searchText = item
                                    triggerRemoteSearch(query: item)
                                }) {
                                    Text(item)
                                        .font(.subheadline)
                                        .fontWeight(.medium)
                                        .fixedSize()
                                        .padding(.horizontal, 18)
                                        .padding(.vertical, 10)
                                }
                                .buttonStyle(.card)
                            }
                        }
                        .padding(.horizontal, 90)
                        .padding(.vertical, 20)
                    }
                    
                    // Results or Defaults
                    if trimmedQuery.isEmpty {
                        // Initial recommendations (Podcasts only)
                        VStack(alignment: .leading, spacing: 36) {
                            let subscribed = podcastManager.subscribedPodcasts()
                            if !subscribed.isEmpty {
                                VStack(alignment: .leading, spacing: 16) {
                                    Text("Subscribed Podcasts")
                                        .font(.title2)
                                        .fontWeight(.bold)
                                    
                                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 250, maximum: 250), spacing: 36)], spacing: 36) {
                                        ForEach(subscribed) { podcast in
                                            NavigationLink(destination: EpisodeListView(podcast: podcast, onNavigateToNowPlaying: onNavigateToNowPlaying)) {
                                                PodcastCardView(podcast: podcast)
                                            }
                                            .buttonStyle(.card)
                                        }
                                    }
                                }
                            }
                            
                            if !podcastManager.featuredPodcasts.isEmpty {
                                VStack(alignment: .leading, spacing: 16) {
                                    Text("Popular Podcasts")
                                        .font(.title2)
                                        .fontWeight(.bold)
                                    
                                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 250, maximum: 250), spacing: 36)], spacing: 36) {
                                        ForEach(podcastManager.featuredPodcasts) { podcast in
                                            NavigationLink(destination: EpisodeListView(podcast: podcast, onNavigateToNowPlaying: onNavigateToNowPlaying)) {
                                                PodcastCardView(podcast: podcast)
                                            }
                                            .buttonStyle(.card)
                                        }
                                    }
                                }
                            }
                        }
                        .padding(.horizontal, 90)
                        .padding(.bottom, 40)
                    } else {
                        // Results matching search query (Podcasts only)
                        VStack(alignment: .leading, spacing: 24) {
                            HStack {
                                Text("Podcasts (\(displayedPodcasts.count))")
                                    .font(.title2)
                                    .fontWeight(.bold)
                                    
                                if isSearchingRemote {
                                    ProgressView()
                                        .scaleEffect(0.8)
                                        .padding(.leading, 8)
                                }
                            }
                            
                            if !displayedPodcasts.isEmpty {
                                LazyVGrid(columns: [GridItem(.adaptive(minimum: 250, maximum: 250), spacing: 36)], spacing: 36) {
                                    ForEach(displayedPodcasts) { podcast in
                                        NavigationLink(destination: EpisodeListView(podcast: podcast, onNavigateToNowPlaying: onNavigateToNowPlaying)) {
                                            PodcastCardView(podcast: podcast)
                                        }
                                        .buttonStyle(.card)
                                    }
                                }
                            } else if !isSearchingRemote {
                                VStack(spacing: 16) {
                                    Image(systemName: "antenna.radiowaves.left.and.right")
                                        .font(.system(size: 48))
                                        .foregroundColor(.secondary)
                                    Text("No podcasts matched \"\(searchText)\".")
                                        .font(.title3)
                                        .foregroundColor(.secondary)
                                    Text("Try searching by podcast title, genre, topic, or host.")
                                        .font(.subheadline)
                                        .foregroundColor(.secondary.opacity(0.8))
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.top, 40)
                            }
                        }
                        .padding(.horizontal, 90)
                        .padding(.bottom, 40)
                    }
                }
            }
            .onChange(of: searchText) { _, newValue in
                triggerRemoteSearch(query: newValue)
            }
            .onReceive(NotificationCenter.default.publisher(for: Notification.Name("BRPTVSearch"))) { notif in
                if let q = notif.userInfo?["query"] as? String {
                    searchText = q
                    triggerRemoteSearch(query: q)
                }
            }
        }
    }
    
    private func triggerRemoteSearch(query: String) {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else {
            remotePodcasts = []
            isSearchingRemote = false
            return
        }
        
        isSearchingRemote = true
        podcastManager.searchRemotePodcasts(matching: q) { fetched in
            DispatchQueue.main.async {
                self.remotePodcasts = fetched
                self.isSearchingRemote = false
            }
        }
    }
}
