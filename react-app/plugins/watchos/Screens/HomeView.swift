import SwiftUI

struct HomeView: View {
    @Bindable var controller = WatchPlaybackController.shared
    @Bindable var connectivity = WatchConnectivityManager.shared
    @Bindable var showManager = StationShowManager.shared

    var body: some View {
        List {
            // App Title Header (single line, compact, centered)
            Section {
                Text("British Radio Player")
                    .font(.headline)
                    .bold()
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity, alignment: .center)
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: -4, leading: 0, bottom: -10, trailing: 0))

            // Active Now Playing banner if audio is playing or loaded
            if controller.currentStationId != nil || controller.currentEpisodeId != nil || controller.isPlaying {
                Section {
                    NavigationLink(destination: NowPlayingView()) {
                        NowPlayingCardView(
                            controller: controller,
                            stationId: controller.currentStationId ?? ""
                        )
                    }
                    .listRowBackground(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(Color.secondary.opacity(0.2))
                    )
                }
            }

            // Favourites Section
            let ids = connectivity.appState.favourite_ids ?? []
            let order = connectivity.appState.favourite_order ?? []
            let favourites = WatchStationCatalogue.favourites(from: ids, order: order)

            Section(header: Label("Favourites", systemImage: "star.fill").font(.footnote).bold().foregroundStyle(.yellow)) {
                if !favourites.isEmpty {
                    ForEach(favourites) { station in
                        HStack(spacing: 10) {
                            Button(action: {
                                controller.playStation(station)
                            }) {
                                HStack(spacing: 10) {
                                    StationIdentView(stationId: station.id, size: 36, cornerRadius: 8)

                                    VStack(alignment: .leading, spacing: 2) {
                                        MarqueeText(
                                            text: station.title,
                                            font: .headline,
                                            color: controller.currentStationId == station.id ? Color.accentColor : Color.primary
                                        )

                                        if let show = showManager.showTitle(for: station.serviceId), !show.isEmpty {
                                            MarqueeText(
                                                text: show,
                                                font: .caption2,
                                                color: .secondary
                                            )
                                        }
                                    }
                                    Spacer(minLength: 4)
                                }
                            }
                            .buttonStyle(.plain)

                            if controller.currentStationId == station.id && controller.isPlaying {
                                Image(systemName: "waveform")
                                    .symbolEffect(.variableColor.iterative, isActive: controller.isPlaying)
                                    .foregroundStyle(Color.accentColor)
                                    .font(.footnote)
                            }

                            Button(action: {
                                connectivity.pushFavouriteToggle(stationId: station.id)
                                WKInterfaceDevice.current().play(.click)
                            }) {
                                Image(systemName: "star.fill")
                                    .foregroundStyle(Color.yellow)
                                    .font(.body)
                            }
                            .buttonStyle(.plain)
                            .padding(.horizontal, 2)
                        }
                        .padding(.vertical, 2)
                        .onAppear {
                            showManager.fetchShow(for: station.serviceId)
                        }
                    }
                } else {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("No favourites yet")
                            .font(.caption)
                            .bold()
                        Text("Star stations in All Stations below or in the phone app.")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 2)
                }
            }

            // Browse Section
            Section(header: Text("Browse").font(.footnote).bold()) {
                NavigationLink(destination: StationListView()) {
                    HStack(spacing: 12) {
                        Image(systemName: "list.bullet")
                            .frame(width: 24, alignment: .center)
                        Text("All Stations")
                    }
                    .font(.headline)
                    .padding(.vertical, 4)
                }

                NavigationLink(destination: PodcastListView()) {
                    HStack(spacing: 12) {
                        Image(systemName: "antenna.radiowaves.left.and.right")
                            .frame(width: 24, alignment: .center)
                        Text("Podcasts")
                    }
                    .font(.headline)
                    .padding(.vertical, 4)
                }
            }
        }
        .listSectionSpacing(6)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            let ids = connectivity.appState.favourite_ids ?? []
            let order = connectivity.appState.favourite_order ?? []
            let favs = WatchStationCatalogue.favourites(from: ids, order: order)
            showManager.prefetch(for: favs)
        }
    }
}

struct NowPlayingCardView: View {
    let controller: WatchPlaybackController
    let stationId: String
    @Bindable var metadata = NowPlayingMetadata.shared

    var body: some View {
        HStack(spacing: 10) {
            let podImgUrl = controller.currentEpisodePodcast?.imageUrl ?? (controller.currentEpisode.flatMap { ep in WatchPodcastManager.shared.subscribedPodcasts.first(where: { $0.id == ep.podcastId })?.imageUrl ?? ep.imageUrl })
            if let imgUrl = podImgUrl, !imgUrl.isEmpty, let url = URL(string: imgUrl) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                            .frame(width: 40, height: 40)
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    default:
                        podcastPlaceholder
                    }
                }
                .frame(width: 40, height: 40)
            } else if controller.currentEpisode != nil {
                podcastPlaceholder
            } else if let artworkUrl = metadata.rmsArtworkUrl, let url = URL(string: artworkUrl) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                            .frame(width: 40, height: 40)
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    default:
                        StationIdentView(stationId: stationId, size: 40, cornerRadius: 8)
                    }
                }
                .frame(width: 40, height: 40)
            } else {
                StationIdentView(stationId: stationId, size: 40, cornerRadius: 8)
            }

            VStack(alignment: .leading, spacing: 2) {
                MarqueeText(text: stationTitle, font: .headline)

                MarqueeText(
                    text: subtitle,
                    font: .caption2,
                    color: .secondary
                )
            }

            Spacer()

            Button(action: {
                controller.togglePlayPause()
            }) {
                Image(systemName: controller.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                    .font(.title2)
                    .foregroundStyle(Color.accentColor)
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, 4)
    }

    private var stationTitle: String {
        if let id = controller.currentStationId {
            return WatchStationCatalogue.findById(id)?.title ?? "Radio"
        }
        if let pod = controller.currentEpisodePodcast {
            return pod.title
        }
        if let ep = controller.currentEpisode,
           let found = WatchPodcastManager.shared.subscribedPodcasts.first(where: { $0.id == ep.podcastId }) {
            return found.title
        }
        return "Podcast"
    }

    private var subtitle: String {
        if let ep = controller.currentEpisode {
            return ep.title
        }
        return metadata.showTitle.isEmpty ? "Now Playing" : metadata.showTitle
    }

    private var podcastPlaceholder: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Color.secondary.opacity(0.25))
            Image(systemName: "waveform.and.mic")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .frame(width: 40, height: 40)
    }
}

struct TextWidthPreferenceKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}

struct MarqueeText: View {
    let text: String
    let font: Font
    var color: Color = .primary
    var isBold: Bool = false
    var alignment: Alignment = .leading
    
    @State private var offset: CGFloat = 0
    @State private var textWidth: CGFloat = 0
    
    var body: some View {
        if text.isEmpty {
            EmptyView()
        } else {
            Text(" ")
                .font(font)
                .fontWeight(isBold ? .bold : .regular)
                .opacity(0)
                .frame(maxWidth: .infinity, alignment: alignment)
                .overlay(alignment: .leading) {
                    GeometryReader { containerGeo in
                        let cWidth = containerGeo.size.width
                        let isOverflowing = textWidth > cWidth && cWidth > 0
                        let initialX = (alignment == .center && !isOverflowing) ? max(0, (cWidth - textWidth) / 2) : 0
                        
                        Text(text)
                            .font(font)
                            .fontWeight(isBold ? .bold : .regular)
                            .foregroundStyle(color)
                            .lineLimit(1)
                            .fixedSize(horizontal: true, vertical: false)
                            .background(
                                GeometryReader { textGeo in
                                    Color.clear
                                        .preference(key: TextWidthPreferenceKey.self, value: textGeo.size.width)
                                }
                            )
                            .offset(x: isOverflowing ? offset : initialX)
                            .onPreferenceChange(TextWidthPreferenceKey.self) { newWidth in
                                self.textWidth = newWidth
                                if newWidth > cWidth && cWidth > 0 {
                                    let diff = newWidth - cWidth
                                    let duration = max(2.5, Double(diff) / 22.0)
                                    withAnimation(
                                        .easeInOut(duration: duration)
                                        .delay(1.5)
                                        .repeatForever(autoreverses: true)
                                    ) {
                                        offset = -diff
                                    }
                                } else {
                                    offset = 0
                                }
                            }
                    }
                    .clipped()
                }
                .id(text)
        }
    }
}
