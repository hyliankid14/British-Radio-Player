import UIKit
import SwiftUI

/// Station color palette and fallback badge generator for Apple Watch.
enum WatchArtwork {
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
        "radio5livesportsextra2": Config(backgroundColor: hex(0x000000), label: "5S", circleColor: hex(0x009EAA), badgeLabel: "2"),
        "radio5livesportsextra3": Config(backgroundColor: hex(0x000000), label: "5S", circleColor: hex(0x009EAA), badgeLabel: "3"),
        "radio6": Config(backgroundColor: hex(0x007749), label: "6"),
        "radio6indieforever": Config(backgroundColor: hex(0x0B0F0D), label: "6IF", circleColor: hex(0x007749)),
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

        // Local
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
        "radiolon": Config(backgroundColor: .black, label: "LD"),
        "radiomanchester": Config(backgroundColor: .black, label: "MA"),
        "radiomerseyside": Config(backgroundColor: .black, label: "ME"),
        "radionewcastle": Config(backgroundColor: .black, label: "NE"),
        "radionorfolk": Config(backgroundColor: .black, label: "NO"),
        "radionorthampton": Config(backgroundColor: .black, label: "NT"),
        "radionottingham": Config(backgroundColor: .black, label: "NG"),
        "radiooxford": Config(backgroundColor: .black, label: "OX"),
        "radiosheffield": Config(backgroundColor: .black, label: "SH"),
        "radioshropshire": Config(backgroundColor: .black, label: "SP"),
        "radiosolent": Config(backgroundColor: .black, label: "SO"),
        "radiosolentwestdorset": Config(backgroundColor: .black, label: "WD"),
        "radiosomerset": Config(backgroundColor: .black, label: "ST"),
        "radiostoke": Config(backgroundColor: .black, label: "SK"),
        "radiosuffolk": Config(backgroundColor: .black, label: "SF"),
        "radiosurrey": Config(backgroundColor: .black, label: "SU"),
        "radiosussex": Config(backgroundColor: .black, label: "SX"),
        "radiotees": Config(backgroundColor: .black, label: "TE"),
        "radiothreecounties": Config(backgroundColor: .black, label: "3C"),
        "radiowestmidlands": Config(backgroundColor: .black, label: "WM"),
        "radiowiltshire": Config(backgroundColor: .black, label: "WI"),
        "radioyork": Config(backgroundColor: .black, label: "YO")
    ]

    static func color(stationId: String) -> Color {
        let ui = configs[stationId]?.backgroundColor ?? UIColor(red: 0.15, green: 0.15, blue: 0.15, alpha: 1.0)
        return Color(uiColor: ui)
    }

    static func label(stationId: String) -> String {
        configs[stationId]?.label ?? stationId.prefix(2).uppercased()
    }

    static func render(stationId: String, size: CGSize) -> UIImage? {
        let config = configs[stationId] ?? Config(
            backgroundColor: hex(0x1F2937),
            label: String(stationId.prefix(2)).uppercased()
        )

        UIGraphicsBeginImageContextWithOptions(size, false, 2.0)
        defer { UIGraphicsEndImageContext() }

        let rect = CGRect(origin: .zero, size: size)

        // Background
        config.backgroundColor.setFill()
        let cornerRadius = size.width * 0.22
        let bgPath = UIBezierPath(roundedRect: rect, cornerRadius: cornerRadius)
        bgPath.fill()

        // Center circle if configured
        let circleRect = rect.insetBy(dx: size.width * 0.12, dy: size.height * 0.12)
        config.circleColor.setFill()
        let circlePath = UIBezierPath(ovalIn: circleRect)
        circlePath.fill()

        // Main label
        let fontSize = size.width * (config.label.count > 2 ? 0.30 : 0.38)
        let font = UIFont.systemFont(ofSize: fontSize, weight: .bold)
        let attrs: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: config.textColor
        ]
        let str = NSAttributedString(string: config.label, attributes: attrs)
        let strSize = str.size()
        let strRect = CGRect(
            x: (size.width - strSize.width) / 2,
            y: (size.height - strSize.height) / 2,
            width: strSize.width,
            height: strSize.height
        )
        str.draw(in: strRect)

        return UIGraphicsGetImageFromCurrentImageContext()
    }
}
