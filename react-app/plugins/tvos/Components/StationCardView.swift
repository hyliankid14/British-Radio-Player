import SwiftUI

struct StationCardView: View {
    let station: TVStation
    let isCurrentlyPlaying: Bool
    let onSelect: () -> Void
    
    @Bindable private var favouritesManager = TVFavouritesManager.shared
    @State private var liveShowTitle: String? = nil
    @State private var feedbackText: String? = nil
    @State private var feedbackIcon: String? = nil
    @State private var showFeedback = false
    
    private var isFavourite: Bool {
        favouritesManager.isFavourite(station.id)
    }
    
    private var currentShowText: String {
        if let liveShow = liveShowTitle, !liveShow.isEmpty {
            return liveShow
        }
        if let cached = TVNowPlayingMetadata.shared.showTitle(for: station.serviceId), !cached.isEmpty {
            return cached
        }
        return "Live on Air"
    }
    
    var body: some View {
        Button(action: onSelect) {
            VStack(alignment: .leading, spacing: 12) {
                ZStack {
                    // Station Ident
                    TVStationIdentView(stationId: station.id, width: 320, height: 180)
                    
                    // Favourite badge overlay (top-left)
                    if isFavourite {
                        VStack {
                            HStack {
                                Image(systemName: "star.fill")
                                    .font(.system(size: 13, weight: .bold))
                                    .foregroundColor(.yellow)
                                    .padding(7)
                                    .background(Color.black.opacity(0.65))
                                    .clipShape(Circle())
                                    .padding(10)
                                    .transition(.scale.combined(with: .opacity))
                                Spacer()
                            }
                            Spacer()
                        }
                    }
                    
                    // Playing badge overlay (top-right)
                    if isCurrentlyPlaying {
                        VStack {
                            HStack {
                                Spacer()
                                HStack(spacing: 6) {
                                    Image(systemName: "waveform")
                                        .symbolEffect(.variableColor.iterative, options: .repeating)
                                        .foregroundColor(.white)
                                    Text("Playing")
                                        .font(.system(size: 13, weight: .bold))
                                        .foregroundColor(.white)
                                }
                                .padding(.horizontal, 10)
                                .padding(.vertical, 5)
                                .background(Color.red.opacity(0.85))
                                .clipShape(Capsule())
                                .padding(10)
                            }
                            Spacer()
                        }
                    }
                    
                    // Feedback overlay when hold toggles favourite
                    if showFeedback, let text = feedbackText, let icon = feedbackIcon {
                        HStack(spacing: 8) {
                            Image(systemName: icon)
                                .font(.system(size: 16, weight: .bold))
                                .foregroundColor(text == "Favourited" ? .yellow : .white)
                            Text(text)
                                .font(.headline)
                                .fontWeight(.bold)
                                .foregroundColor(.white)
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(.ultraThinMaterial)
                        .background(Color.black.opacity(0.75))
                        .clipShape(Capsule())
                        .shadow(color: .black.opacity(0.5), radius: 10, x: 0, y: 4)
                        .transition(.scale.combined(with: .opacity))
                    }
                }
                .frame(width: 320, height: 180)
                
                // Station Meta
                VStack(alignment: .leading, spacing: 5) {
                    TVMarqueeText(text: station.title, font: .headline, fontWeight: .semibold, color: .primary)
                    
                    TVMarqueeText(
                        text: currentShowText,
                        font: .caption,
                        color: currentShowText == "Live on Air" ? .secondary.opacity(0.8) : .secondary
                    )
                }
                .padding(.horizontal, 18)
                .padding(.top, 2)
                .padding(.bottom, 14)
                .frame(width: 320, alignment: .leading)
            }
        }
        .buttonStyle(.card)
        .contextMenu {
            Button {
                triggerToggleFavourite()
            } label: {
                Label(
                    isFavourite ? "Remove from Favourites" : "Add to Favourites",
                    systemImage: isFavourite ? "star.slash" : "star.fill"
                )
            }
            
            Button {
                onSelect()
            } label: {
                Label("Play Station", systemImage: "play.fill")
            }
        }
        .task(id: station.serviceId) {
            if let cached = TVNowPlayingMetadata.shared.showTitle(for: station.serviceId) {
                liveShowTitle = cached
            } else {
                TVNowPlayingMetadata.shared.fetchShowTitle(for: station.serviceId) { title in
                    if let title = title {
                        self.liveShowTitle = title
                    }
                }
            }
        }
    }
    
    private func triggerToggleFavourite() {
        let willBeFavourite = !isFavourite
        withAnimation(.spring(response: 0.35, dampingFraction: 0.6)) {
            favouritesManager.toggleFavourite(station.id)
            feedbackText = willBeFavourite ? "Favourited" : "Removed"
            feedbackIcon = willBeFavourite ? "star.fill" : "star.slash"
            showFeedback = true
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
            withAnimation(.easeOut(duration: 0.3)) {
                showFeedback = false
            }
        }
    }
    
    private var placeholderView: some View {
        ZStack {
            Color(white: 0.15)
            Image(systemName: "radio")
                .font(.system(size: 40))
                .foregroundColor(.white.opacity(0.6))
        }
        .frame(width: 320, height: 180)
    }
}
