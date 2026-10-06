import WidgetKit
import SwiftUI
import AppIntents

struct ComplicationEntry: TimelineEntry {
    let date: Date
    let state: WidgetSharedState
}

struct BRPConfigurationIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Configuration"
    static var description = IntentDescription("Configures the complication.")
}

struct ComplicationProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> ComplicationEntry {
        ComplicationEntry(date: Date(), state: WidgetSharedState.loadState())
    }

    func snapshot(for configuration: BRPConfigurationIntent, in context: Context) async -> ComplicationEntry {
        ComplicationEntry(date: Date(), state: WidgetSharedState.loadState())
    }

    func timeline(for configuration: BRPConfigurationIntent, in context: Context) async -> Timeline<ComplicationEntry> {
        let state = WidgetSharedState.loadState()
        let entry = ComplicationEntry(date: Date(), state: state)
        
        let nextUpdate = Calendar.current.date(byAdding: .minute, value: 30, to: Date())!
        return Timeline(entries: [entry], policy: .after(nextUpdate))
    }
}

struct BRPComplication: Widget {
    let kind: String = "BRPComplication"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: kind, intent: BRPConfigurationIntent.self, provider: ComplicationProvider()) { entry in
            BRPComplicationView(entry: entry)
        }
        .configurationDisplayName("BBC Radio Player")
        .description("Shows the currently playing station and show.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular])
    }
}
