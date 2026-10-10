import SwiftUI

struct StationsView: View {
    @Bindable var controller = TVPlaybackController.shared
    let onNavigateToNowPlaying: () -> Void
    
    @State private var selectedCategory: TVStationCategory = .national
    
    var body: some View {
        VStack(alignment: .leading, spacing: 32) {
            
            // Category Selector
            HStack(spacing: 32) {
                ForEach(TVStationCategory.allCases) { category in
                    Button(action: {
                        selectedCategory = category
                    }) {
                        Text(category.title)
                            .font(.headline)
                            .padding(.horizontal, 24)
                            .padding(.vertical, 12)
                    }
                    .buttonStyle(.card)
                }
            }
            .padding(.horizontal, 90)
            .padding(.top, 24)
            .padding(.bottom, 6)
            
            // Grid of Stations for Selected Category
            ScrollView(.vertical, showsIndicators: false) {
                let stations = TVStationCatalogue.stations(for: selectedCategory)
                
                LazyVGrid(
                    columns: [
                        GridItem(.adaptive(minimum: 320, maximum: 380), spacing: 40)
                    ],
                    spacing: 40
                ) {
                    ForEach(stations) { station in
                        StationCardView(
                            station: station,
                            isCurrentlyPlaying: controller.currentStation?.id == station.id && controller.isPlaying,
                            onSelect: {
                                controller.playStation(station)
                                onNavigateToNowPlaying()
                            }
                        )
                    }
                }
                .padding(.horizontal, 90)
                .padding(.vertical, 24)
            }
        }
    }
}
