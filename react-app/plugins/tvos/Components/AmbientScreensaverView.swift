import SwiftUI

struct AmbientScreensaverView: View {
    var stationId: String? = nil
    let title: String
    let subtitle: String?
    let logoUrl: String?
    let onDismiss: () -> Void
    
    @State private var offset: CGSize = .zero
    @State private var opacity: Double = 0.8
    @State private var currentTimeString: String = ""
    
    private let timer = Timer.publish(every: 1.0, on: .main, in: .common).autoconnect()
    private let driftTimer = Timer.publish(every: 25.0, on: .main, in: .common).autoconnect()
    
    var body: some View {
        ZStack {
            // Very dark ambient background
            Color.black.ignoresSafeArea()
            
            // Subtle drifting atmospheric glow
            RadialGradient(
                gradient: Gradient(colors: [Color.red.opacity(0.12), Color.clear]),
                center: .center,
                startRadius: 50,
                endRadius: 500
            )
            .offset(offset)
            .animation(.easeInOut(duration: 24), value: offset)
            .ignoresSafeArea()
            
            // Drifting Ambient Elements
            VStack(spacing: 24) {
                if let sid = stationId {
                    TVStationIdentView(stationId: sid, width: 220, height: 125, cornerRadius: 16)
                        .opacity(0.85)
                } else if let logo = logoUrl, let url = URL(string: logo) {
                    AsyncImage(url: url) { image in
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                    } placeholder: {
                        Color.clear
                    }
                    .frame(width: 140, height: 140)
                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .opacity(0.75)
                }
                
                VStack(spacing: 8) {
                    Text(title)
                        .font(.system(size: 38, weight: .semibold, design: .rounded))
                        .foregroundColor(.white.opacity(0.85))
                        .multilineTextAlignment(.center)
                    
                    if let sub = subtitle {
                        Text(sub)
                            .font(.system(size: 26, weight: .regular))
                            .foregroundColor(.white.opacity(0.55))
                            .multilineTextAlignment(.center)
                    }
                }
                
                // Live clock
                Text(currentTimeString)
                    .font(.system(size: 22, weight: .light, design: .monospaced))
                    .foregroundColor(.white.opacity(0.4))
                    .padding(.top, 12)
            }
            .offset(offset)
            .animation(.easeInOut(duration: 24), value: offset)
            .opacity(opacity)
            
            // Subdued helper hint at bottom
            VStack {
                Spacer()
                Text("Press any button on the Siri Remote to restore controls")
                    .font(.caption2)
                    .foregroundColor(.white.opacity(0.3))
                    .padding(.bottom, 40)
            }
        }
        .onAppear {
            updateTime()
            startDrift()
        }
        .onReceive(timer) { _ in
            updateTime()
        }
        .onReceive(driftTimer) { _ in
            startDrift()
        }
        .onTapGesture {
            onDismiss()
        }
    }
    
    private func updateTime() {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        currentTimeString = formatter.string(from: Date())
    }
    
    private func startDrift() {
        let randomX = CGFloat.random(in: -70...70)
        let randomY = CGFloat.random(in: -50...50)
        offset = CGSize(width: randomX, height: randomY)
    }
}
