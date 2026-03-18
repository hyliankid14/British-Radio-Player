#!/usr/bin/env python3
"""
Generate iOS app icon PNGs from the Android vector drawable design.

The Android adaptive icon uses a 108dp canvas.
For iOS we render the full canvas as a square (iOS applies corner rounding at runtime).
"""

from PIL import Image, ImageDraw
import os
import math

# Android viewport
VP = 108.0

ICON_DIR = os.path.join(
    os.path.dirname(__file__),
    '../ios/BBCRadioPlayer/Assets/Assets.xcassets/AppIcon.appiconset'
)

def hex_color(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def draw_icon(size: int) -> Image.Image:
    img = Image.new('RGB', (size, size))
    draw = ImageDraw.Draw(img)

    # Scale the radio outward from the canvas centre so the icon fills
    # slightly more of the purple background.
    EXPAND = 1.18
    VC = VP / 2  # 54.0

    def tp(v):
        """Expand a viewport *coordinate* then convert to pixels."""
        return (VC + (v - VC) * EXPAND) * size / VP

    def ep(length):
        """Convert a viewport *length/radius* to expanded pixel length."""
        return length * EXPAND * size / VP

    def r(x1, y1, x2, y2):
        return [tp(x1), tp(y1), tp(x2), tp(y2)]

    def rr(x1, y1, x2, y2, radius_dp, **kwargs):
        draw.rounded_rectangle(r(x1, y1, x2, y2), radius=ep(radius_dp), **kwargs)

    # ── Background ──────────────────────────────────────────────────────
    draw.rectangle([0, 0, size, size], fill=hex_color('#6200EE'))

    # ── Radio body ──────────────────────────────────────────────────────
    rr(26, 30, 82, 78, 4, fill=hex_color('#E6E8EB'))

    # Bezel shadow strip (top few rows)
    rr(26, 30, 82, 38, 4, fill=hex_color('#D0D4D9'))
    draw.rectangle(r(26, 34, 82, 38), fill=hex_color('#D0D4D9'))

    # ── Screen ──────────────────────────────────────────────────────────
    rr(34, 35, 74, 57, 1.7, fill=hex_color('#26344A'))

    # Screen shine (thin top strip)
    rr(34, 35, 74, 38.5, 1.7, fill=hex_color('#1F2A38'))
    draw.rectangle(r(34, 37, 74, 38.5), fill=hex_color('#1F2A38'))

    # ── Equaliser bars – left (light blue) ──────────────────────────────
    lc = hex_color('#5DADE2')
    for (x, ys) in [
        (38,   [52, 48.7, 45.4, 42.1]),
        (41.8, [52, 48.7, 45.4, 42.1, 38.8]),
        (45.6, [52, 48.7, 45.4, 42.1, 38.8, 35.5]),
        (49.4, [52, 48.7, 45.4, 42.1]),
        (53.2, [52, 48.7, 45.4]),
        (57,   [52, 48.7, 45.4, 42.1]),
    ]:
        for y in ys:
            draw.rectangle(r(x, y, x + 2.8, y + 2.5), fill=lc)

    # ── Separator bar (orange) ───────────────────────────────────────────
    draw.rectangle(r(60.8, 35, 63.6, 57), fill=hex_color('#FFA500'))

    # ── Equaliser bars – right (darker blue) ────────────────────────────
    rc = hex_color('#2E5B8A')
    for (x, ys) in [
        (64.6, [52, 48.7, 45.4]),
        (68.4, [52, 48.7, 45.4, 42.1, 38.8]),
    ]:
        for y in ys:
            draw.rectangle(r(x, y, x + 2.8, y + 2.5), fill=rc)

    # ── Speaker slits ────────────────────────────────────────────────────
    sc_c = hex_color('#8B95A3')
    for y in [63.5, 66.5, 69.5]:
        draw.rounded_rectangle(r(50, y, 58, y + 2), radius=ep(1), fill=sc_c)

    # ── Knobs — all arithmetic done in pixel space ───────────────────────
    def draw_knob(cx, cy):
        cx_px = tp(cx)
        cy_px = tp(cy)
        r8    = ep(8)
        r65   = ep(6.5)
        r08   = ep(0.8)
        off   = ep(0.7)   # shadow offset

        # Outer ring
        draw.ellipse([cx_px - r8, cy_px - r8, cx_px + r8, cy_px + r8],
                     fill=hex_color('#5A6B7A'))
        # Shadow (offset slightly down-right)
        draw.ellipse([cx_px - r65 + off, cy_px - r65 + off,
                      cx_px + r65 + off, cy_px + r65 + off],
                     fill=hex_color('#3D4A5C'))
        # Inner surface
        draw.ellipse([cx_px - r65, cy_px - r65, cx_px + r65, cy_px + r65],
                     fill=hex_color('#6E7F8E'))
        # Indicator (small white rectangle near top of knob)
        ind_top = cy_px - ep(5.3)
        draw.rounded_rectangle(
            [cx_px - r08, ind_top, cx_px + r08, ind_top + ep(2.4)],
            radius=max(1, round(r08)),
            fill=hex_color('#FFFFFF')
        )

    draw_knob(39, 67.5)
    draw_knob(69, 67.5)

    return img


SIZES = {
    'Icon-1024.png':   1024,
    'Icon-60@3x.png':   180,
    'Icon-60@2x.png':   120,
    'Icon-83.5@2x.png': 167,
    'Icon-76@2x.png':   152,
    'Icon-76@1x.png':    76,
    'Icon-40@3x.png':   120,
    'Icon-40@2x.png':    80,
    'Icon-40@1x.png':    40,
    'Icon-29@3x.png':    87,
    'Icon-29@2x.png':    58,
    'Icon-29@1x.png':    29,
    'Icon-20@3x.png':    60,
    'Icon-20@2x.png':    40,
    'Icon-20@1x.png':    20,
}

if __name__ == '__main__':
    os.makedirs(ICON_DIR, exist_ok=True)
    # Render at full resolution once, then downsample
    master = draw_icon(1024)
    for filename, px in SIZES.items():
        if px == 1024:
            img = master
        else:
            img = master.resize((px, px), Image.LANCZOS)
        out = os.path.join(ICON_DIR, filename)
        img.save(out, 'PNG')
        print(f'  {filename} ({px}×{px})')
    print('Done.')
