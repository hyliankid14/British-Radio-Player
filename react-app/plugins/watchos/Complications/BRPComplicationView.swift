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
    let state: WidgetSharedState
    
    var body: some View {
        if let logoUrl = state.logoUrl, let url = URL(string: logoUrl) {
            AsyncImage(url: url) { image in
                image.resizable().aspectRatio(contentMode: .fit)
            } placeholder: {
                Text("BBC")
            }
            .clipShape(Circle())
        } else {
            Text("BBC")
                .bold()
        }
    }
}

struct RectangularView: View {
    let state: WidgetSharedState
    
    var body: some View {
        VStack(alignment: .leading) {
            Text(state.stationTitle ?? "BBC Radio")
                .font(.headline)
                .bold()
            
            Text(state.showTitle ?? "Not playing")
                .font(.caption2)
                .lineLimit(1)
        }
    }
}
