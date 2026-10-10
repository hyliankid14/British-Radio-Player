import SwiftUI

struct SettingsView: View {
    @State private var screensaverTimeout: Double = {
        let val = UserDefaults.standard.double(forKey: "tv_screensaver_timeout")
        return val > 0 ? val : 180.0
    }()
    
    var body: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 48) {
                Text("Settings")
                    .font(.title)
                    .fontWeight(.bold)
                    .padding(.top, 24)
                
                // OLED Ambient Screensaver Section
                VStack(alignment: .leading, spacing: 16) {
                    Text("OLED Burn-in Protection & Ambient Mode")
                        .font(.title3)
                        .fontWeight(.semibold)
                    Text("Dim and slowly drift station artwork during extended radio listening.")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                    
                    HStack(spacing: 28) {
                        ForEach([60.0, 180.0, 300.0, 600.0], id: \.self) { seconds in
                            let label = "\(Int(seconds / 60)) min"
                            Button(action: {
                                screensaverTimeout = seconds
                                UserDefaults.standard.set(seconds, forKey: "tv_screensaver_timeout")
                            }) {
                                HStack(spacing: 10) {
                                    if screensaverTimeout == seconds {
                                        Image(systemName: "checkmark.circle.fill")
                                            .foregroundColor(.red)
                                    }
                                    Text(label)
                                        .font(.headline)
                                }
                                .padding(.horizontal, 24)
                                .padding(.vertical, 14)
                            }
                            .buttonStyle(.card)
                        }
                    }
                    .padding(.vertical, 8)
                }
                
                // About Section
                VStack(alignment: .leading, spacing: 8) {
                    Text("British Radio Player for Apple TV")
                        .font(.headline)
                        .foregroundColor(.primary)
                    Text("Version 2.1.0 • Built with native SwiftUI for tvOS")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                    Text("Direct simulcasts streamed via live HLS audio networks.")
                        .font(.caption)
                        .foregroundColor(.secondary.opacity(0.8))
                }
                .padding(.top, 16)
            }
            .padding(.horizontal, 90)
            .padding(.bottom, 60)
        }
    }
}
