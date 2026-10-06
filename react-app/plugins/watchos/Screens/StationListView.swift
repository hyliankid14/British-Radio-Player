import SwiftUI

struct StationListView: View {
    let stations = WatchStationCatalogue.allStations()
    let categories: [StationCategory] = [.national, .regions, .local]
    
    var body: some View {
        List {
            ForEach(categories, id: \.self) { category in
                Section(header: Text(category.rawValue.capitalized)) {
                    ForEach(stations.filter { $0.category == category }) { station in
                        Button(action: {
                            WatchPlaybackController.shared.playStation(station)
                        }) {
                            VStack(alignment: .leading) {
                                Text(station.title)
                                    .font(.headline)
                            }
                        }
                        .simultaneousGesture(LongPressGesture().onEnded { _ in
                            WatchConnectivityManager.shared.pushFavouriteToggle(stationId: station.id)
                            WKInterfaceDevice.current().play(.success)
                        })
                    }
                }
            }
        }
        .navigationTitle("Stations")
    }
}
