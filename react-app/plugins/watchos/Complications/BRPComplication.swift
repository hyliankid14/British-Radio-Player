import WidgetKit
import SwiftUI

struct ComplicationEntry: TimelineEntry {
    let date: Date
    let state: WidgetSharedState.State
}

struct ComplicationProvider: TimelineProvider {
    func placeholder(in context: Context) -> ComplicationEntry {
        ComplicationEntry(date: Date(), state: WidgetSharedState.loadState())
    }

    func getSnapshot(in context: Context, completion: @escaping (ComplicationEntry) -> Void) {
        completion(ComplicationEntry(date: Date(), state: WidgetSharedState.loadState()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ComplicationEntry>) -> Void) {
        let state = WidgetSharedState.loadState()
        let entry = ComplicationEntry(date: Date(), state: state)
        let nextUpdate = Calendar.current.date(byAdding: .minute, value: 30, to: Date()) ?? Date().addingTimeInterval(1800)
        completion(Timeline(entries: [entry], policy: .after(nextUpdate)))
    }
}

struct BRPComplication: Widget {
    let kind: String = "BRPComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ComplicationProvider()) { entry in
            BRPComplicationView(entry: entry)
        }
        .configurationDisplayName("BBC Radio Player")
        .description("Shows the currently playing station and show.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular])
    }
}
