import WidgetKit
import SwiftUI

struct BRPComplicationView: View {
    var entry: ComplicationEntry

    @Environment(\.widgetFamily) var family

    var body: some View {
        switch family {
        case .accessoryCircular:
            CircularView(state: entry.state)
        case .accessoryRectangular:
            RectangularView(state: entry.state)
        default:
            Text("BBC")
        }
    }
}

struct CircularView: View {
    let state: WidgetSharedState.State

    var body: some View {
        VStack {
            Image(systemName: state.isPlaying ? "radio.fill" : "radio")
                .font(.title3)
        }
        .containerBackground(for: .widget) {
            Color.clear
        }
    }
}

struct RectangularView: View {
    let state: WidgetSharedState.State

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(state.stationTitle.isEmpty ? "BBC Radio" : state.stationTitle)
                .font(.headline)
                .bold()
                .lineLimit(1)

            Text(state.showLine.isEmpty ? (state.isPlaying ? "On air" : "Not playing") : state.showLine)
                .font(.caption2)
                .lineLimit(1)
        }
        .containerBackground(for: .widget) {
            Color.clear
        }
    }
}
