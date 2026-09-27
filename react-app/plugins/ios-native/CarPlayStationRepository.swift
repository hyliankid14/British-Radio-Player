import Foundation

/// Station catalogue for CarPlay.
///
/// The list is owned by the React `StationRepository` and reaches the car through the
/// shared snapshot, so CarPlay and Android Auto always present the same stations,
/// titles and stream fallbacks.
enum CarPlayStationRepository {
    static var all: [CarPlayStation] {
        CarPlayState.shared.snapshot.stations.map(CarPlayStation.init(record:))
    }

    static func stations(for category: CarPlayStationCategory) -> [CarPlayStation] {
        all.filter { $0.category == category }
    }

    static func station(id: String) -> CarPlayStation? {
        guard !id.isEmpty else { return nil }
        return all.first { $0.id == id }
    }
}
