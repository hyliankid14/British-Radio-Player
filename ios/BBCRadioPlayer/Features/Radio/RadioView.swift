import SwiftUI

struct RadioView: View {
    @ObservedObject var viewModel: RadioViewModel
    @EnvironmentObject private var container: AppContainer

    var body: some View {
        List {
            Section {
                Picker("Category", selection: $viewModel.selectedCategory) {
                    ForEach(StationCategory.allCases, id: \.self) { category in
                        Text(category.displayName).tag(category)
                    }
                }
                .pickerStyle(.segmented)

                ForEach(viewModel.filteredStations) { station in
                    Button {
                        viewModel.play(station)
                    } label: {
                        HStack(spacing: 12) {
                            stationArtwork(for: station)

                            VStack(alignment: .leading, spacing: 4) {
                                Text(station.title)
                                    .lineLimit(2)
                                    .font(container.appSettingsStore.compactRows ? .body : .headline)
                                Text(viewModel.showSubtitle(for: station))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }

                            Spacer(minLength: 8)

                            Button {
                                viewModel.toggleFavorite(station)
                            } label: {
                                Image(systemName: viewModel.isFavorite(station) ? "star.fill" : "star")
                                    .foregroundStyle(viewModel.isFavorite(station) ? .yellow : .secondary)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Stations")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            viewModel.refreshStationShowTitles()
        }
        .onChange(of: viewModel.selectedCategory) { _ in
            viewModel.refreshStationShowTitles()
        }
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
}
