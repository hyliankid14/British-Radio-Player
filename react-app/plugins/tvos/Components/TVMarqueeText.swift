import SwiftUI

private struct TVTextWidthPreferenceKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}

struct TVMarqueeText: View {
    let text: String
    var font: Font = .body
    var fontWeight: Font.Weight = .regular
    var color: Color = .primary
    var alignment: Alignment = .leading
    
    @State private var offset: CGFloat = 0
    @State private var textWidth: CGFloat = 0
    
    var body: some View {
        if text.isEmpty {
            EmptyView()
        } else {
            Text(" ")
                .font(font)
                .fontWeight(fontWeight)
                .opacity(0)
                .frame(maxWidth: .infinity, alignment: alignment)
                .overlay(alignment: .leading) {
                    GeometryReader { containerGeo in
                        let cWidth = containerGeo.size.width
                        let isOverflowing = textWidth > cWidth && cWidth > 0
                        let initialX = (alignment == .center && !isOverflowing) ? max(0, (cWidth - textWidth) / 2) : 0
                        
                        Text(text)
                            .font(font)
                            .fontWeight(fontWeight)
                            .foregroundColor(color)
                            .lineLimit(1)
                            .fixedSize(horizontal: true, vertical: false)
                            .background(
                                GeometryReader { textGeo in
                                    Color.clear
                                        .preference(key: TVTextWidthPreferenceKey.self, value: textGeo.size.width)
                                }
                            )
                            .offset(x: isOverflowing ? offset : initialX)
                            .onPreferenceChange(TVTextWidthPreferenceKey.self) { measuredWidth in
                                self.textWidth = measuredWidth
                                updateAnimation(measuredWidth: measuredWidth, containerWidth: cWidth)
                            }
                            .onChange(of: cWidth) { _, newWidth in
                                updateAnimation(measuredWidth: self.textWidth, containerWidth: newWidth)
                            }
                    }
                    .clipped()
                }
                .id(text)
        }
    }
    
    private func updateAnimation(measuredWidth: CGFloat, containerWidth: CGFloat) {
        if measuredWidth > containerWidth && containerWidth > 0 {
            let diff = measuredWidth - containerWidth
            let duration = max(3.0, Double(diff) / 25.0)
            DispatchQueue.main.async {
                withAnimation(
                    .easeInOut(duration: duration)
                    .delay(1.5)
                    .repeatForever(autoreverses: true)
                ) {
                    offset = -diff
                }
            }
        } else {
            offset = 0
        }
    }
}
