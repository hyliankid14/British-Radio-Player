import SwiftUI
import WidgetKit

/// The widget's contents: softened show artwork behind the station name, a line for what is
/// on, and a play/stop control. Mirrors the Android widget, including the wording ladder,
/// so the same station reads the same way on both platforms.
struct StationWidgetView: View {
    let entry: StationEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        ZStack {
            backdrop
            content
        }
        .modifier(WidgetContainerBackground())
    }

    // MARK: Backdrop

    @ViewBuilder
    private var backdrop: some View {
        if let artwork = entry.artwork {
            Image(uiImage: artwork)
                .resizable()
                .scaledToFill()
                .blur(radius: 18)
                .overlay(Color.black.opacity(0.55))
        } else {
            StationArtworkBackdrop(stationId: entry.station?.id)
        }
    }

    // MARK: Content

    private var content: some View {
        VStack {
            Spacer(minLength: 0)
            HStack(alignment: .bottom, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.stationTitle)
                        .font(.system(size: titleSize, weight: .bold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .foregroundStyle(.white)
                    Text(subtitle)
                        .font(.system(size: subtitleSize))
                        .lineLimit(family == .systemSmall ? 1 : 2)
                        .foregroundStyle(.white.opacity(0.85))
                }
                Spacer(minLength: 0)
                PlayStopButton(entry: entry, size: buttonSize)
            }
        }
        .padding(padding)
        .shadow(color: .black.opacity(0.6), radius: 2, y: 1)
        .widgetURL(StationWidgetView.playURL(for: entry, family: family))
    }

    /// The same ladder the Android widget uses, so a station reads the same on both:
    /// what is on, then the station name, then "Live now" when the show is the generic
    /// BBC Radio placeholder. Nothing playing means an invitation to tap.
    private var subtitle: String {
        if !entry.showLine.isEmpty { return entry.showLine }
        if !entry.isPlaying { return "Tap to play" }
        return entry.stationTitle.isEmpty ? liveNow : entry.stationTitle
    }

    private var padding: CGFloat {
        switch family {
        case .systemSmall: return 10
        case .systemMedium: return 12
        default: return 14
        }
    }

    private var titleSize: CGFloat {
        switch family {
        case .systemSmall: return 15
        case .systemMedium: return 17
        default: return 20
        }
    }

    private var subtitleSize: CGFloat {
        switch family {
        case .systemSmall: return 12
        case .systemMedium: return 14
        default: return 16
        }
    }

    private var buttonSize: CGFloat {
        switch family {
        case .systemSmall: return 30
        case .systemMedium: return 34
        default: return 38
        }
    }

    private var liveNow: String { "Live now" }

    private static func playURL(for entry: StationEntry, family: WidgetFamily) -> URL? {
        let action = (family == .systemSmall && entry.isPlaying) ? "stop" : "play"
        if let stationId = entry.station?.id, !stationId.isEmpty {
            return URL(string: "bbcradioplayer://widget/\(action)?station=\(stationId)")
        }
        return URL(string: "bbcradioplayer://widget/\(action)")
    }
}

// MARK: - Controls

/// Playback lives in the React layer, so a tap hands the request to the app through a link
/// rather than trying to control playback from the extension.
private struct PlayStopButton: View {
    let entry: StationEntry
    let size: CGFloat

    var body: some View {
        let action = entry.isPlaying ? "stop" : "play"
        let urlString: String = {
            if let stationId = entry.station?.id, !stationId.isEmpty {
                return "bbcradioplayer://widget/\(action)?station=\(stationId)"
            }
            return "bbcradioplayer://widget/\(action)"
        }()
        if let url = URL(string: urlString) {
            Link(destination: url) {
                Image(systemName: entry.isPlaying ? "stop.fill" : "play.fill")
                    .font(.system(size: size * 0.42, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: size, height: size)
                    .background(Circle().fill(Color(red: 0.38, green: 0, blue: 0.93).opacity(0.87)))
            }
        }
    }
}

// MARK: - Generated artwork

/// Stand-in artwork drawn from the station id, so the widget is never blank and never needs
/// the network. Matches the Android widget falling back to generated station artwork.
private struct StationArtworkBackdrop: View {
    let stationId: String?

    var body: some View {
        GeometryReader { geometry in
            let side = min(geometry.size.width, geometry.size.height)
            ZStack {
                LinearGradient(
                    colors: [background.opacity(0.95), background.opacity(0.55)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                Circle()
                    .fill(Color.black.opacity(0.55))
                    .frame(width: side * 0.8, height: side * 0.8)
                Text(label)
                    .font(.system(size: side * 0.3, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
            }
        }
    }

    private var label: String {
        guard let stationId, !stationId.isEmpty else { return "BBC" }
        return stationId
            .replacingOccurrences(of: "radio", with: "")
            .uppercased()
            .prefix(3)
            .description
    }

    /// A stable colour per station, so a widget always looks the same.
    private var background: Color {
        let hash = abs(stationId?.hashValue ?? 0)
        return Color(
            hue: Double(hash % 360) / 360,
            saturation: 0.45,
            brightness: 0.48
        )
    }
}

// MARK: - Container background

/// iOS 17 requires widgets to declare their background through `containerBackground`.
private struct WidgetContainerBackground: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 17.0, *) {
            content.containerBackground(.clear, for: .widget)
        } else {
            content
        }
    }
}
