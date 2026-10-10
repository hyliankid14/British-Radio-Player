import SwiftUI

struct LiveBadgeView: View {
    var bitrateText: String? = nil
    
    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(Color.red)
                .frame(width: 10, height: 10)
                .shadow(color: .red.opacity(0.8), radius: 4)
            
            Text("LIVE")
                .font(.system(size: 14, weight: .bold))
                .foregroundColor(.white)
            
            if let bitrate = bitrateText {
                Text("• \(bitrate)")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(.white.opacity(0.7))
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .background(Color.black.opacity(0.6))
        .clipShape(Capsule())
    }
}
