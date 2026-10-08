import SwiftUI

struct StationListView: View {
    let stations = WatchStationCatalogue.allStations()
    let categories: [StationCategory] = [.national, .regions, .local]
    
    @Bindable var controller = WatchPlaybackController.shared
    @Bindable var connectivity = WatchConnectivityManager.shared
    @Bindable var showManager = StationShowManager.shared

    var body: some View {
        List {
            ForEach(categories, id: \.self) { category in
                Section(header: Text(category.rawValue.capitalized).font(.footnote).bold()) {
                    ForEach(stations.filter { $0.category == category }) { station in
                        StationRowView(
                            station: station,
                            isPlaying: controller.currentStationId == station.id && controller.isPlaying,
                            isFavourite: isFavourite(station.id),
                            onPlay: {
                                controller.playStation(station)
                            },
                            onToggleFavourite: {
                                connectivity.pushFavouriteToggle(stationId: station.id)
                                WKInterfaceDevice.current().play(.click)
                            }
                        )
                    }
                }
            }
        }
        .navigationTitle("Stations")
        .onAppear {
            showManager.prefetch(for: Array(stations.prefix(17)))
        }
    }

    private func isFavourite(_ stationId: String) -> Bool {
        connectivity.appState.favourite_ids?.contains(stationId) ?? false
    }
}

struct StationRowView: View {
    let station: WatchStation
    let isPlaying: Bool
    let isFavourite: Bool
    let onPlay: () -> Void
    let onToggleFavourite: () -> Void
    @Bindable var showManager = StationShowManager.shared

    var body: some View {
        HStack(spacing: 10) {
            Button(action: onPlay) {
                HStack(spacing: 10) {
                    StationIdentView(stationId: station.id, size: 36, cornerRadius: 8)

                    VStack(alignment: .leading, spacing: 2) {
                        MarqueeText(
                            text: station.title,
                            font: .headline,
                            color: isPlaying ? Color.accentColor : Color.primary
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

            if isPlaying {
                Image(systemName: "waveform")
                    .symbolEffect(.variableColor.iterative, isActive: isPlaying)
                    .foregroundStyle(Color.accentColor)
                    .font(.footnote)
            }

            Button(action: onToggleFavourite) {
                Image(systemName: isFavourite ? "star.fill" : "star")
                    .foregroundStyle(isFavourite ? Color.yellow : Color.secondary.opacity(0.6))
                    .font(.body)
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 4)
        }
        .padding(.vertical, 2)
        .onAppear {
            showManager.fetchShow(for: station.serviceId)
        }
    }
}
