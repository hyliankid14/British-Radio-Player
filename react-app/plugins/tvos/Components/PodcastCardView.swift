import SwiftUI

struct PodcastCardView: View {
    let podcast: TVPodcast
    @Bindable private var subscriptionManager = TVSubscriptionManager.shared
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ZStack(alignment: .topLeading) {
                AsyncImage(url: URL(string: podcast.imageUrl)) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                    case .failure(_):
                        placeholderView
                    case .empty:
                        ProgressView()
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    @unknown default:
                        placeholderView
                    }
                }
                .frame(width: 250, height: 250)
                .background(Color(white: 0.12))
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                
                // Subscribed star badge overlay (top-left)
                if subscriptionManager.isSubscribed(podcast.id) {
                    VStack {
                        HStack {
                            Image(systemName: "star.fill")
                                .font(.system(size: 13, weight: .bold))
                                .foregroundColor(.yellow)
                                .padding(7)
                                .background(Color.black.opacity(0.65))
                                .clipShape(Circle())
                                .padding(10)
                                .shadow(color: .black.opacity(0.35), radius: 4, x: 0, y: 2)
                                .transition(.scale.combined(with: .opacity))
                            Spacer()
                        }
                        Spacer()
                    }
                }
            }
            
            VStack(alignment: .leading, spacing: 4) {
                TVMarqueeText(text: podcast.title, font: .headline, fontWeight: .semibold, color: .primary)
                
                if let author = podcast.author {
                    TVMarqueeText(text: author, font: .caption, color: .secondary)
                }
            }
            .padding(.horizontal, 14)
            .padding(.top, 2)
            .padding(.bottom, 12)
            .frame(width: 250, alignment: .leading)
        }
    }
    
    private var placeholderView: some View {
        ZStack {
            Color(white: 0.18)
            Image(systemName: "antenna.radiowaves.left.and.right")
                .font(.system(size: 48))
                .foregroundColor(.white.opacity(0.6))
        }
        .frame(width: 250, height: 250)
    }
}

struct EpisodeRowView: View {
    let episode: TVEpisode
    let isCurrentlyPlaying: Bool
    let onSelect: () -> Void
    
    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: 20) {
                if isCurrentlyPlaying {
                    Image(systemName: "speaker.wave.3.fill")
                        .font(.title3)
                        .foregroundColor(.red)
                        .frame(width: 40)
                } else {
                    Image(systemName: "play.circle.fill")
                        .font(.title3)
                        .foregroundColor(.white.opacity(0.8))
                        .frame(width: 40)
                }
                
                VStack(alignment: .leading, spacing: 6) {
                    TVMarqueeText(text: episode.title, font: .headline, fontWeight: .semibold, color: .primary)
                    
                    if let summary = episode.summary, !summary.isEmpty {
                        Text(summary)
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                            .lineLimit(2)
                    }
                    
                    HStack(spacing: 12) {
                        if let pubDate = episode.pubDate {
                            Text(pubDate)
                                .font(.caption2)
                                .foregroundColor(.secondary)
                        }
                        
                        if episode.duration > 0 {
                            let mins = episode.duration / 60
                            Text("\(mins) mins")
                                .font(.caption2)
                                .foregroundColor(.secondary)
                        }
                    }
                }
                
                Spacer()
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 16)
        }
        .buttonStyle(.card)
    }
}
