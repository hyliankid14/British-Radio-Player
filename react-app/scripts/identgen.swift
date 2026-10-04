import AppKit
import CoreText
import Foundation
import ImageIO

// Renders a 512x512 station ident in the app's procedural artwork style:
// full-bleed background, centred circle (r=210), white bold label.
//
// This tool does not try to predict the right font size. It renders at whatever
// size and offset it is given, and the caller (scripts/make-ident.cjs) measures
// the resulting pixels and iterates. Rasterised geometry is therefore always
// driven by measurement, matching how the existing assets were produced.
//
// usage: identgen <label> <out.png> <bgHex> <circleHex> <fontName> <fontSize> <offsetX> <offsetY>

let SIZE = 512.0
let CIRCLE_RADIUS = 210.0
let CENTRE = SIZE / 2.0

struct RGB {
    let r, g, b: Double
    static func parse(_ hex: String) -> RGB {
        var s = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
        let v = UInt64(s, radix: 16) ?? 0
        return RGB(r: Double((v >> 16) & 0xFF) / 255.0,
                   g: Double((v >> 8) & 0xFF) / 255.0,
                   b: Double(v & 0xFF) / 255.0)
    }
}

let args = CommandLine.arguments
guard args.count >= 9 else {
    FileHandle.standardError.write(
        "usage: identgen <label> <out.png> <bgHex> <circleHex> <fontName> <fontSize> <offsetX> <offsetY>\n"
            .data(using: .utf8)!)
    exit(2)
}
let label = args[1]
let outPath = args[2]
let bg = RGB.parse(args[3])
let circle = RGB.parse(args[4])
let fontName = args[5]
let fontSize = CGFloat(Double(args[6]) ?? 0)
let offsetX = CGFloat(Double(args[7]) ?? 0)
let offsetY = CGFloat(Double(args[8]) ?? 0)

// The bitmap must be tagged sRGB and encoded without a further colour transform.
// A Generic RGB context round-tripped through NSBitmapImageRep shifts channel
// values (e.g. #007749 -> #00875B), which would put the artwork off-palette
// from the rest of assets/idents.
// CGColor(red:green:blue:alpha:) builds a colour in the generic RGB space
// (gamma 1.8). Compositing that into an sRGB context applies a colour transform
// that shifts every channel (#007749 -> #00875B). Constructing colours directly
// in sRGB keeps the artwork exactly on-palette with assets/idents.
let srgb = CGColorSpace(name: CGColorSpace.sRGB)!
guard let ctx = CGContext(data: nil, width: Int(SIZE), height: Int(SIZE),
                          bitsPerComponent: 8, bytesPerRow: 0, space: srgb,
                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
    fatalError("cannot create bitmap context")
}

ctx.setFillColor(CGColor(srgbRed: bg.r, green: bg.g, blue: bg.b, alpha: 1))
ctx.fill(CGRect(x: 0, y: 0, width: SIZE, height: SIZE))
ctx.setFillColor(CGColor(srgbRed: circle.r, green: circle.g, blue: circle.b, alpha: 1))
ctx.fillEllipse(in: CGRect(x: CENTRE - CIRCLE_RADIUS, y: CENTRE - CIRCLE_RADIUS,
                           width: CIRCLE_RADIUS * 2, height: CIRCLE_RADIUS * 2))

// White is set through the text attribute so CoreText cannot fall back to black.
let font = CTFontCreateWithName(fontName as CFString, fontSize, nil)
let attr: [NSAttributedString.Key: Any] = [
    kCTFontAttributeName as NSAttributedString.Key: font,
    kCTForegroundColorAttributeName as NSAttributedString.Key: CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 1),
]
let line = CTLineCreateWithAttributedString(NSAttributedString(string: label, attributes: attr))
let ink = CTLineGetBoundsWithOptions(line, .useGlyphPathBounds)

ctx.textMatrix = .identity
ctx.textPosition = CGPoint(
    x: CENTRE + offsetX - (ink.minX + ink.maxX) / 2,
    y: CENTRE + offsetY - (ink.minY + ink.maxY) / 2
)
CTLineDraw(line, ctx)

guard let image = ctx.makeImage() else { fatalError("makeImage failed") }
let url = URL(fileURLWithPath: outPath) as CFURL
guard let dest = CGImageDestinationCreateWithURL(url, "public.png" as CFString, 1, nil) else {
    fatalError("cannot create png destination")
}
// No destination properties: the CGImage is already sRGB-tagged by the context,
// so ImageIO writes the samples through unchanged.
CGImageDestinationAddImage(dest, image, nil)
guard CGImageDestinationFinalize(dest) else { fatalError("png encode failed") }
