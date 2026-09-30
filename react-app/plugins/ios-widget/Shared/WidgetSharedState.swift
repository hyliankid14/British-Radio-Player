import Foundation

/// The state the home screen widgets render.
///
/// Compiled into both the app and the WidgetKit extension. A widget extension runs in its own
/// process and has no access to the app's storage, so everything it renders comes from this
/// model, written into the shared App Group container by the app and read back by the
/// extension. Nothing in here touches the network or the UI, so both targets can use it.
enum WidgetSharedState {
    /// Must match the App Group registered on the developer account and written into both
    /// entitlements by plugins/withIosWidget.js.
    static let appGroupIdentifier = "group.com.hyliankid14.bbcradioplayer"

    static let stateFileName = "widget-state.json"
    static let catalogueFileName = "widget-stations.json"
    static let artworkDirectoryName = "artwork"

    /// A station a widget can point at. Mirrors what the React layer pushes, so the picker
    /// can never offer a station the app does not play.
    struct Station: Codable, Identifiable, Hashable {
        let id: String
        let title: String
        let category: String
    }

    /// What the player is doing, as the widgets see it.
    struct State: Codable {
        var stationId: String = ""
        var stationTitle: String = ""
        var showLine: String = ""
        var isPlaying: Bool = false
        /// File name of the cached show artwork inside the container's artwork directory.
        var artworkFile: String?

        static let empty = State()
    }

    // MARK: Paths

    static var containerURL: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupIdentifier)
    }

    static func directory(_ name: String) -> URL? {
        guard let container = containerURL else { return nil }
        let directory = container.appendingPathComponent(name, isDirectory: true)
        if !FileManager.default.fileExists(atPath: directory.path) {
            try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        }
        return directory
    }

    // MARK: Reading

    static func loadState() -> State {
        guard
            let url = containerURL?.appendingPathComponent(stateFileName),
            let data = try? Data(contentsOf: url),
            let state = try? JSONDecoder().decode(State.self, from: data)
        else { return .empty }
        return state
    }

    static func loadStations() -> [Station] {
        guard
            let url = containerURL?.appendingPathComponent(catalogueFileName),
            let data = try? Data(contentsOf: url),
            let stations = try? JSONDecoder().decode([Station].self, from: data)
        else { return [] }
        return stations
    }

    static func artworkURL(fileName: String?) -> URL? {
        guard let fileName, !fileName.isEmpty else { return nil }
        return directory(artworkDirectoryName)?.appendingPathComponent(fileName)
    }

    // MARK: Writing (app side only)

    @discardableResult
    static func saveState(_ state: State) -> Bool {
        guard let url = containerURL?.appendingPathComponent(stateFileName),
              let data = try? JSONEncoder().encode(state)
        else { return false }
        try? data.write(to: url, options: .atomic)
        return true
    }

    @discardableResult
    static func saveStations(_ stations: [Station]) -> Bool {
        guard let url = containerURL?.appendingPathComponent(catalogueFileName),
              let data = try? JSONEncoder().encode(stations)
        else { return false }
        try? data.write(to: url, options: .atomic)
        return true
    }
}
