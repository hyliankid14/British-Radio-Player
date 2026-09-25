import SwiftUI

/// App icon design matching the Android drawable
/// Purple background with white radio and green waveform
struct AppIconView: View {
    var size: CGFloat = 192

    var body: some View {
        Canvas { context, canvasSize in
            // Purple background
            let background = Path(roundedRect: CGRect(origin: .zero, size: canvasSize), cornerRadius: canvasSize.width * 0.1)
            context.fill(background, with: .color(.init(red: 0.384, green: 0, blue: 0.933)))

            let scale = canvasSize.width / 192

            // White radio body (rounded rectangle)
            let radioBody = Path(roundedRect: CGRect(x: 32 * scale, y: 50 * scale, width: 128 * scale, height: 100 * scale), cornerRadius: 10 * scale)
            context.fill(radioBody, with: .color(.white))

            // Light grey inner background
            let innerBackground = Path(roundedRect: CGRect(x: 38 * scale, y: 56 * scale, width: 116 * scale, height: 88 * scale), cornerRadius: 8 * scale)
            context.fill(innerBackground, with: .color(.init(white: 0.949)))

            // Black screen
            let screen = Path(roundedRect: CGRect(x: 52 * scale, y: 68 * scale, width: 88 * scale, height: 40 * scale), cornerRadius: 4 * scale)
            context.fill(screen, with: .color(.black))

            // Green waveform bars
            drawWaveformBar(context, x: 62 * scale, y: 100 * scale, height: 6 * scale, barWidth: 4 * scale)
            drawWaveformBar(context, x: 70 * scale, y: 92 * scale, height: 14 * scale, barWidth: 4 * scale)
            drawWaveformBar(context, x: 78 * scale, y: 96 * scale, height: 10 * scale, barWidth: 4 * scale)
            drawWaveformBar(context, x: 86 * scale, y: 88 * scale, height: 18 * scale, barWidth: 4 * scale)
            drawWaveformBar(context, x: 94 * scale, y: 94 * scale, height: 12 * scale, barWidth: 4 * scale)
            drawWaveformBar(context, x: 102 * scale, y: 100 * scale, height: 6 * scale, barWidth: 4 * scale)

            // Dimple details on radio (speaker dots)
            let dotRadius = 1.5 * scale
            let dotX: [CGFloat] = [60, 70, 80, 90, 100, 110, 120, 130]
            for x in dotX {
                let dotCircle = Path(ellipseIn: CGRect(x: x * scale - dotRadius, y: 120 * scale - dotRadius, width: dotRadius * 2, height: dotRadius * 2))
                context.fill(dotCircle, with: .color(.init(white: 0.9)))
            }
        }
        .frame(width: size, height: size)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: size * 0.2, style: .continuous))
    }

    private func drawWaveformBar(_ context: GraphicsContext, x: CGFloat, y: CGFloat, height: CGFloat, barWidth: CGFloat) {
        let barRect = CGRect(x: x, y: y, width: barWidth, height: height)
        let bar = Path(roundedRect: barRect, cornerRadius: barWidth / 2)
        context.fill(bar, with: .color(.init(red: 0, green: 0.784, blue: 0.325)))
    }
}

#Preview {
    VStack(spacing: 40) {
        AppIconView(size: 180)
            .padding()

        HStack(spacing: 20) {
            AppIconView(size: 120)
            AppIconView(size: 60)
            AppIconView(size: 40)
        }
        .padding()
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color(.systemBackground))
}
