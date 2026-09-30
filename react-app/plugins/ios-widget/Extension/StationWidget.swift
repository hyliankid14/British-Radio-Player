import AppIntents
import SwiftUI
import WidgetKit

// MARK: - Station selection

/// A station offered by the widget's station picker. Backed by the catalogue the app pushed
/// into the shared container, so the picker shows exactly what the app can play.
struct WidgetStationEntity: AppEntity, Hashable {
    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Station")
    static var defaultQuery = WidgetStationQuery()

    let id: String
    let title: String
    let category: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(title)", subtitle: "\(category)")
    }

    init(station: WidgetSharedState.Station) {
        id = station.id
        title = station.title
        category = station.category
    }
}

struct WidgetStationQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [WidgetStationEntity] {
        let wanted = Set(identifiers)
        return WidgetSharedState.loadStations()
            .filter { wanted.contains($0.id) }
            .map(WidgetStationEntity.init)
    }

    func suggestedEntities() async throws -> [WidgetStationEntity] {
        WidgetSharedState.loadStations().map(WidgetStationEntity.init)
    }

    func defaultResult() async -> WidgetStationEntity? {
        try? await suggestedEntities().first
    }
}

/// The per-widget station choice. WidgetKit can only offer this from iOS 17, which is why
/// the extension itself requires iOS 17.
struct StationConfigurationIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Station"
    static var description = IntentDescription("Choose which station this widget plays.")

    @Parameter(title: "Station")
    var station: WidgetStationEntity?

    init() {}

    init(station: WidgetStationEntity?) {
        self.station = station
    }
}

// MARK: - Entries

struct StationEntry: TimelineEntry {
    let date: Date
    let station: WidgetSharedState.Station?
    let stationTitle: String
    let showLine: String
    let isPlaying: Bool
    let artwork: UIImage?
}

enum StationEntryLoader {
    /// Builds the entry for a widget. A widget points at the station chosen for it; only
    /// when that is the station being played does it show live state and show artwork.
    static func load(stationId: String?) -> StationEntry {
        let state = WidgetSharedState.loadState()
        let stations = WidgetSharedState.loadStations()
        let station = stations.first { $0.id == stationId }
            ?? stations.first { $0.id == state.stationId }
            ?? stations.first
        let isCurrent = station.map { $0.id == state.stationId && !state.stationId.isEmpty } ?? false

        return StationEntry(
            date: Date(),
            station: station,
            stationTitle: station?.title ?? state.stationTitle,
            showLine: isCurrent && state.isPlaying ? state.showLine : "",
            isPlaying: isCurrent && state.isPlaying,
            artwork: isCurrent ? Self.artwork(of: state) : nil
        )
    }

    static func placeholder() -> StationEntry {
        StationEntry(
            date: Date(),
            station: WidgetSharedState.Station(id: "radio1", title: "Radio 1", category: "National"),
            stationTitle: "Radio 1",
            showLine: "Tap to play",
            isPlaying: false,
            artwork: nil
        )
    }

    static func timeline(stationId: String?) -> Timeline<StationEntry> {
        // Nothing here changes without the app telling us, and it does that by asking for a
        // reload, so this policy only matters as a backstop.
        let entry = load(stationId: stationId)
        return Timeline(
            entries: [entry],
            policy: .after(Date().addingTimeInterval(30 * 60))
        )
    }

    private static func artwork(of state: WidgetSharedState.State) -> UIImage? {
        guard let url = WidgetSharedState.artworkURL(fileName: state.artworkFile) else { return nil }
        return UIImage(contentsOfFile: url.path)
    }
}

// MARK: - Provider

struct StationIntentProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> StationEntry {
        StationEntryLoader.placeholder()
    }

    func snapshot(for configuration: StationConfigurationIntent, in context: Context) async -> StationEntry {
        context.isPreview ? StationEntryLoader.placeholder() : StationEntryLoader.load(stationId: configuration.station?.id)
    }

    func timeline(for configuration: StationConfigurationIntent, in context: Context) async -> Timeline<StationEntry> {
        StationEntryLoader.timeline(stationId: configuration.station?.id)
    }
}

// MARK: - Widget

/// One station per widget, chosen when the widget is added.
struct StationWidget: Widget {
    static let kind = "StationWidget"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: Self.kind,
            intent: StationConfigurationIntent.self,
            provider: StationIntentProvider()
        ) { entry in
            StationWidgetView(entry: entry)
        }
        .configurationDisplayName("British Radio")
        .description("Listen to BBC radio stations.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

