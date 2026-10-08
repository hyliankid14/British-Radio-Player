import SwiftUI
import UIKit

/// Renders a station ident using pre-bundled assets or a high-quality fallback badge.
struct StationIdentView: View {
    let stationId: String
    var size: CGFloat = 36
    var cornerRadius: CGFloat = 8

    var body: some View {
        Group {
            if let image = UIImage(named: stationId) ?? UIImage(contentsOfFile: identPath) {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
            } else if let fallback = WatchArtwork.render(stationId: stationId, size: CGSize(width: size * 2, height: size * 2)) {
                Image(uiImage: fallback)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
            } else {
                ZStack {
                    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                        .fill(WatchArtwork.color(stationId: stationId))
                    Text(stationLabel)
                        .font(.system(size: size * 0.38, weight: .bold))
                        .foregroundStyle(.white)
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
    }

    private var identPath: String {
        Bundle.main.path(forResource: stationId, ofType: "png") ?? ""
    }

    private var stationLabel: String {
        WatchArtwork.label(stationId: stationId)
    }
}
