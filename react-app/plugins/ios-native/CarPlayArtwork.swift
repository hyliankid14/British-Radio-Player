import UIKit

/// Offline station artwork for the CarPlay browse grid and now-playing screen.
///
/// Mirrors the Android `AutoArtwork` table: every station is assigned a distinctive
/// background colour plus a short label so the head unit always has usable imagery even
/// when remote artwork is unavailable. Rendering is cached per station and size.
enum CarPlayArtwork {
    struct Config {
        let backgroundColor: UIColor
        let label: String
        var circleColor: UIColor = UIColor(red: 0.10, green: 0.10, blue: 0.10, alpha: 1)
        var textColor: UIColor = .white
        var badgeLabel: String?
    }

    private static func hex(_ value: UInt32) -> UIColor {
        UIColor(
            red: CGFloat((value >> 16) & 0xFF) / 255,
            green: CGFloat((value >> 8) & 0xFF) / 255,
            blue: CGFloat(value & 0xFF) / 255,
            alpha: 1
        )
    }

    private static let circle: UIColor = hex(0x1A1A1A)

    private static let configs: [String: Config] = [
        // National
        "radio1": Config(backgroundColor: hex(0xF5247F), label: "1"),
        "1xtra": Config(backgroundColor: hex(0x231F20), label: "1X", circleColor: hex(0xCC0000)),
        "radio1dance": Config(backgroundColor: hex(0x0D0D0D), label: "1D", circleColor: hex(0xCC0066)),
        "radio1anthems": Config(backgroundColor: hex(0x0056B8), label: "1A"),
        "radio2": Config(backgroundColor: hex(0xE66B21), label: "2"),
        "radio3": Config(backgroundColor: hex(0xC13131), label: "3"),
        "radio3unwind": Config(backgroundColor: hex(0x4A2080), label: "3U", circleColor: hex(0x6A40A0)),
        "radio4": Config(backgroundColor: hex(0x1B6CA8), label: "4"),
        "radio4extra": Config(backgroundColor: hex(0x9B1D73), label: "4+"),
        "radio5live": Config(backgroundColor: hex(0x009EAA), label: "5"),
        "radio5livesportsextra": Config(backgroundColor: hex(0x009EAA), label: "5S"),
        "radio5livesportsextra2": Config(
            backgroundColor: hex(0x000000), label: "5S", circleColor: hex(0x009EAA), badgeLabel: "2"),
        "radio5livesportsextra3": Config(
            backgroundColor: hex(0x000000), label: "5S", circleColor: hex(0x009EAA), badgeLabel: "3"),
        "radio6": Config(backgroundColor: hex(0x007749), label: "6"),
        "radio6indieforever": Config(
            backgroundColor: hex(0x0B0F0D), label: "6IF", circleColor: hex(0x007749)),
        "worldservice": Config(backgroundColor: hex(0xBB1919), label: "WS"),
        "livenews": Config(backgroundColor: hex(0xBB1919), label: "NEWS"),
        "asiannetwork": Config(backgroundColor: hex(0x703FA0), label: "AN"),

        // Regions
        "radiocymru": Config(backgroundColor: hex(0x0057A8), label: "CY"),
        "radiocymru2": Config(backgroundColor: hex(0x007C55), label: "CY2"),
        "radiofoyle": Config(backgroundColor: hex(0x007C55), label: "FO"),
        "radiogaidheal": Config(backgroundColor: hex(0x0093C5), label: "GD"),
        "radioorkney": Config(backgroundColor: hex(0xC43A8A), label: "OR"),
        "radioscotland": Config(backgroundColor: hex(0x7B5EA7), label: "SC"),
        "radioscotlandextra": Config(backgroundColor: hex(0x7B5EA7), label: "SC+"),
        "radioshetland": Config(backgroundColor: hex(0xD4478A), label: "SH"),
        "radioulster": Config(backgroundColor: hex(0x007C55), label: "UL"),
        "radiowales": Config(backgroundColor: hex(0xD84315), label: "WA"),
        "radiowalesextra": Config(backgroundColor: hex(0xD84315), label: "WA+"),

        // Local (England & Channel Islands)
        "radioberkshire": Config(backgroundColor: .black, label: "BE"),
        "radiobristol": Config(backgroundColor: .black, label: "BR"),
        "radiocambridge": Config(backgroundColor: .black, label: "CA"),
        "radiocornwall": Config(backgroundColor: .black, label: "CO"),
        "radiocoventrywarwickshire": Config(backgroundColor: .black, label: "CW"),
        "radiocumbria": Config(backgroundColor: .black, label: "CU"),
        "radioderby": Config(backgroundColor: .black, label: "DE"),
        "radiodevon": Config(backgroundColor: .black, label: "DV"),
        "radioessex": Config(backgroundColor: .black, label: "ES"),
        "radiogloucestershire": Config(backgroundColor: .black, label: "GL"),
        "radioguernsey": Config(backgroundColor: .black, label: "GU"),
        "radioherefordworcester": Config(backgroundColor: .black, label: "HW"),
        "radiohumberside": Config(backgroundColor: .black, label: "HU"),
        "radiojersey": Config(backgroundColor: .black, label: "JE"),
        "radiokent": Config(backgroundColor: .black, label: "KE"),
        "radiolancashire": Config(backgroundColor: .black, label: "LA"),
        "radioleeds": Config(backgroundColor: .black, label: "LE"),
        "radioleicester": Config(backgroundColor: .black, label: "LR"),
        "radiolincolnshire": Config(backgroundColor: .black, label: "LI"),
        "radiolon": Config(backgroundColor: .black, label: "LO"),
        "radiomanchester": Config(backgroundColor: .black, label: "MA"),
        "radiomerseyside": Config(backgroundColor: .black, label: "ME"),
        "radionewcastle": Config(backgroundColor: .black, label: "NE"),
        "radionorfolk": Config(backgroundColor: .black, label: "NF"),
        "radionorthampton": Config(backgroundColor: .black, label: "NO"),
        "radionottingham": Config(backgroundColor: .black, label: "NT"),
        "radiooxford": Config(backgroundColor: .black, label: "OX"),
        "radiosheffield": Config(backgroundColor: .black, label: "SF"),
        "radioshropshire": Config(backgroundColor: .black, label: "SR"),
        "radiosolent": Config(backgroundColor: .black, label: "SO"),
        "radiosolentwestdorset": Config(backgroundColor: .black, label: "SD"),
        "radiosomerset": Config(backgroundColor: .black, label: "SM"),
        "radiostoke": Config(backgroundColor: .black, label: "ST"),
        "radiosuffolk": Config(backgroundColor: .black, label: "SU"),
        "radiosurrey": Config(backgroundColor: .black, label: "SY"),
        "radiosussex": Config(backgroundColor: .black, label: "SX"),
        "radiotees": Config(backgroundColor: .black, label: "TE"),
        "radiothreecounties": Config(backgroundColor: .black, label: "3C"),
        "radiowestmidlands": Config(backgroundColor: .black, label: "WM"),
        "radiowiltshire": Config(backgroundColor: .black, label: "WL"),
        "radioyork": Config(backgroundColor: .black, label: "YO")
    ]

    private static func config(for stationId: String) -> Config {
        if let config = configs[stationId] { return config }
        return Config(
            backgroundColor: hex(0x4A4A8A),
            label: String(stationId.prefix(2)).uppercased(),
            circleColor: circle
        )
    }

    private static var cache: [String: UIImage] = [:]
    private static let cacheLock = NSLock()

    /// Renders the ident for `stationId`, cached per station and point size.
    static func image(for stationId: String, size: CGFloat) -> UIImage {
        let scale = UIScreen.main.scale
        let pixels = max(Int((size * scale).rounded()), 32)
        let key = "\(stationId):\(pixels)"

        cacheLock.lock()
        if let cached = cache[key] {
            cacheLock.unlock()
            return cached
        }
        cacheLock.unlock()

        let rendered = render(config(for: stationId), pixels: pixels)

        cacheLock.lock()
        cache[key] = rendered
        cacheLock.unlock()
        return rendered
    }

    private static func render(_ config: Config, pixels: Int) -> UIImage {
        let size = CGFloat(pixels)
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: size, height: size))
        return renderer.image { context in
            let cg = context.cgContext
            config.backgroundColor.setFill()
            cg.fill(CGRect(x: 0, y: 0, width: size, height: size))

            let center = CGPoint(x: size / 2, y: size / 2)
            let radius = size * 0.42
            config.circleColor.setFill()
            cg.fillEllipse(
                in: CGRect(
                    x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2))

            let normalized = config.label.uppercased()
            let maxWidth = radius * 1.72
            let font = UIFont.systemFont(ofSize: radius * 1.58, weight: .bold)
            let attributes: [NSAttributedString.Key: Any] = [
                .font: font, .foregroundColor: config.textColor, .paragraphStyle: centeredStyle
            ]
            var textSize = (normalized as NSString).size(withAttributes: attributes)
            if textSize.width > maxWidth, textSize.width > 0 {
                let scaled = font.withSize(font.pointSize * (maxWidth / textSize.width))
                let scaledAttributes: [NSAttributedString.Key: Any] = [
                    .font: scaled, .foregroundColor: config.textColor, .paragraphStyle: centeredStyle
                ]
                textSize = (normalized as NSString).size(withAttributes: scaledAttributes)
                draw(
                    normalized, at: center, attributes: scaledAttributes, textSize: textSize)
            } else {
                draw(normalized, at: center, attributes: attributes, textSize: textSize)
            }

            if let badge = config.badgeLabel?.trimmingCharacters(in: .whitespacesAndNewlines),
                !badge.isEmpty {
                let badgeRadius = size * 0.12
                let badgeCenter = CGPoint(
                    x: center.x + radius * 0.78, y: center.y - radius * 0.78)
                hex(0x111111).setFill()
                cg.fillEllipse(
                    in: CGRect(
                        x: badgeCenter.x - badgeRadius, y: badgeCenter.y - badgeRadius,
                        width: badgeRadius * 2, height: badgeRadius * 2))

                let badgeFont = UIFont.systemFont(ofSize: badgeRadius * 1.4, weight: .bold)
                let badgeAttributes: [NSAttributedString.Key: Any] = [
                    .font: badgeFont, .foregroundColor: UIColor.white,
                    .paragraphStyle: centeredStyle
                ]
                let badgeSize = (badge as NSString).size(withAttributes: badgeAttributes)
                draw(
                    badge, at: badgeCenter, attributes: badgeAttributes, textSize: badgeSize)
            }
        }
    }

    private static let centeredStyle: NSMutableParagraphStyle = {
        let style = NSMutableParagraphStyle()
        style.alignment = .center
        return style
    }()

    private static func draw(
        _ text: String, at center: CGPoint, attributes: [NSAttributedString.Key: Any],
        textSize: CGSize
    ) {
        // `UIGraphicsImageRenderer` uses a flipped (top-left origin) coordinate space.
        let rect = CGRect(
            x: center.x - textSize.width / 2,
            y: center.y - textSize.height / 2,
            width: textSize.width,
            height: textSize.height
        )
        (text as NSString).draw(in: rect, withAttributes: attributes)
    }
}
