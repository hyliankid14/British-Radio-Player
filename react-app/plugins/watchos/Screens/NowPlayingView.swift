import SwiftUI
import AVFoundation

struct NowPlayingView: View {
    @Bindable var controller = WatchPlaybackController.shared
    @Bindable var metadata = NowPlayingMetadata.shared
    
    @State private var volume: Double = 0.5
    
    var body: some View {
        VStack {
            if let logoUrl = controller.currentStationId.flatMap({ WatchStationCatalogue.findById($0)?.logoUrl }) {
                AsyncImage(url: URL(string: logoUrl)) { image in
                    image.resizable().aspectRatio(contentMode: .fit)
                } placeholder: {
                    ProgressView()
                }
                .frame(height: 60)
            }
            
            Text(metadata.showTitle.isEmpty ? (controller.currentStationId.flatMap { WatchStationCatalogue.findById($0)?.title } ?? "Loading...") : metadata.showTitle)
                .font(.footnote)
                .lineLimit(2)
                .multilineTextAlignment(.center)
            
            HStack {
                Button(action: {
                    controller.seekBy(-10)
                }) {
                    Image(systemName: "gobackward.10")
                }
                
                Button(action: {
                    controller.togglePlayPause()
                }) {
                    Image(systemName: controller.isPlaying ? "pause.fill" : "play.fill")
                        .font(.title)
                }
                
                Button(action: {
                    controller.seekBy(30)
                }) {
                    Image(systemName: "goforward.30")
                }
            }
            .padding(.vertical, 8)
            
            Text(metadata.showDetail)
                .font(.caption2)
                .lineLimit(1)
        }
        .focusable()
        .digitalCrownRotation($volume, from: 0.0, through: 1.0, by: 0.1, sensitivity: .low, isContinuous: false, isHapticFeedbackEnabled: true)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button("Low") { UserDefaults.standard.set("low", forKey: "watch_audio_quality") }
                    Button("Standard") { UserDefaults.standard.set("standard", forKey: "watch_audio_quality") }
                    Button("High") { UserDefaults.standard.set("high", forKey: "watch_audio_quality") }
                } label: {
                    Image(systemName: "waveform")
                }
            }
        }
    }
}
