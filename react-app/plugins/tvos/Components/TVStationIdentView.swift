import SwiftUI
import UIKit

struct TVStationIdentView: View {
    let stationId: String
    var width: CGFloat = 320
    var height: CGFloat = 180
    var cornerRadius: CGFloat = 16
    
    // Station brand color lookup table (matching StationArtwork.kt and StationLogo.tsx)
    private static let stationColors: [String: Color] = [
        "radio1": Color(red: 0xF5/255.0, green: 0x24/255.0, blue: 0x7F/255.0),
        "1xtra": Color(red: 0x23/255.0, green: 0x1F/255.0, blue: 0x20/255.0),
        "radio1dance": Color(red: 0x0D/255.0, green: 0x0D/255.0, blue: 0x0D/255.0),
        "radio1anthems": Color(red: 0x00/255.0, green: 0x56/255.0, blue: 0xB8/255.0),
        "radio2": Color(red: 0xE6/255.0, green: 0x6B/255.0, blue: 0x21/255.0),
        "radio3": Color(red: 0xC1/255.0, green: 0x31/255.0, blue: 0x31/255.0),
        "radio3unwind": Color(red: 0x4A/255.0, green: 0x20/255.0, blue: 0x80/255.0),
        "radio4": Color(red: 0x1B/255.0, green: 0x6C/255.0, blue: 0xA8/255.0),
        "radio4extra": Color(red: 0x9B/255.0, green: 0x1D/255.0, blue: 0x73/255.0),
        "radio5live": Color(red: 0x00/255.0, green: 0x9E/255.0, blue: 0xAA/255.0),
        "radio5livesportsextra": Color(red: 0x00/255.0, green: 0x9E/255.0, blue: 0xAA/255.0),
        "radio5livesportsextra2": Color.black,
        "radio5livesportsextra3": Color.black,
        "radio6": Color(red: 0x00/255.0, green: 0x77/255.0, blue: 0x49/255.0),
        "radio6indieforever": Color(red: 0x0B/255.0, green: 0x0F/255.0, blue: 0x0D/255.0),
        "worldservice": Color(red: 0xBB/255.0, green: 0x19/255.0, blue: 0x19/255.0),
        "livenews": Color(red: 0xBB/255.0, green: 0x19/255.0, blue: 0x19/255.0),
        "asiannetwork": Color(red: 0x70/255.0, green: 0x3F/255.0, blue: 0xA0/255.0),
        // Regions
        "radiocymru": Color(red: 0x00/255.0, green: 0x57/255.0, blue: 0xA8/255.0),
        "radiocymru2": Color(red: 0x00/255.0, green: 0x7C/255.0, blue: 0x55/255.0),
        "radiofoyle": Color(red: 0x00/255.0, green: 0x7C/255.0, blue: 0x55/255.0),
        "radiogaidheal": Color(red: 0x00/255.0, green: 0x93/255.0, blue: 0xC5/255.0),
        "radioorkney": Color(red: 0xC4/255.0, green: 0x3A/255.0, blue: 0x8A/255.0),
        "radioscotland": Color(red: 0x7B/255.0, green: 0x5E/255.0, blue: 0xA7/255.0),
        "radioscotlandextra": Color(red: 0x7B/255.0, green: 0x5E/255.0, blue: 0xA7/255.0),
        "radioshetland": Color(red: 0xD4/255.0, green: 0x47/255.0, blue: 0x8A/255.0),
        "radioulster": Color(red: 0x00/255.0, green: 0x7C/255.0, blue: 0x55/255.0),
        "radiowales": Color(red: 0xD8/255.0, green: 0x43/255.0, blue: 0x15/255.0),
        "radiowalesextra": Color(red: 0xD8/255.0, green: 0x43/255.0, blue: 0x15/255.0)
    ]
    
    private var identBackgroundColor: Color {
        Self.stationColors[stationId] ?? Color.black
    }
    
    var body: some View {
        ZStack {
            identBackgroundColor
            
            if let uiImage = loadIdentImage() {
                Image(uiImage: uiImage)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(
                        width: min(width, height) * 0.88,
                        height: min(width, height) * 0.88
                    )
            } else {
                fallbackView
            }
        }
        .frame(width: width, height: height)
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
    }
    
    private func loadIdentImage() -> UIImage? {
        // Try named asset first
        if let img = UIImage(named: stationId) {
            return img
        }
        // Try file in bundle resources
        if let path = Bundle.main.path(forResource: stationId, ofType: "png"),
           let img = UIImage(contentsOfFile: path) {
            return img
        }
        return nil
    }
    
    private var fallbackView: some View {
        ZStack {
            Color(white: 0.18)
            VStack(spacing: 8) {
                Image(systemName: "radio.fill")
                    .font(.system(size: height * 0.28))
                    .foregroundColor(.white.opacity(0.8))
                Text(stationId.uppercased())
                    .font(.system(size: 16, weight: .bold))
                    .foregroundColor(.white.opacity(0.7))
            }
        }
    }
}
