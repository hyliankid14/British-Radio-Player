#!/usr/bin/env node
"use strict";

// Generates a station ident PNG in the same style as assets/idents/*.png.
//
// The invariant shared by every existing multi-character ident is a glyph ink
// width of exactly 361px (0.7051 x 512), centred on the canvas. Rather than
// predicting the font size analytically, this renders with scripts/identgen.swift,
// measures the actual rasterised ink box, and iterates on size and offset until
// the target is hit. That keeps the output consistent with how the existing
// assets were produced.
//
// usage:
//   node scripts/make-ident.cjs <label> <out.png> <bgHex> <circleHex> [font] [targetInk]
//
// With targetInk 0 the label is rendered at a fixed size instead of being
// width-normalised (used for single-character idents such as radio6 "6").

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { PNG } = require("pngjs");

const SIZE = 512;
const CENTRE = (SIZE - 1) / 2; // 255.5, matching the existing assets
const SWIFT = path.join(__dirname, "identgen.swift");
const DEFAULT_FONT = "Helvetica-Bold";

function inkBox(file) {
  const png = PNG.sync.read(fs.readFileSync(file));
  let minX = SIZE, maxX = -1, minY = SIZE, maxY = -1, found = false;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (SIZE * y + x) << 2;
      if (png.data[i] > 200 && png.data[i + 1] > 200 && png.data[i + 2] > 200) {
        found = true;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!found) return null;
  return { minX, maxX, minY, maxY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function render(label, out, bg, circle, font, size, offX, offY) {
  execFileSync("swift", [SWIFT, label, out, bg, circle, font,
    String(size), String(offX), String(offY)], { stdio: ["ignore", "ignore", "inherit"] });
}

function main() {
  const [label, out, bg, circle, fontArg, targetArg] = process.argv.slice(2);
  if (!label || !out || !bg || !circle) {
    console.error("usage: make-ident.cjs <label> <out.png> <bgHex> <circleHex> [font] [targetInk]");
    process.exit(2);
  }
  const font = fontArg || DEFAULT_FONT;
  const targetInk = targetArg === undefined ? 361 : Number(targetArg);

  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tmp = path.join(os.tmpdir(), `ident-${process.pid}.png`);

  let size = 300;
  let offX = 0;
  let offY = 0;
  let box = null;
  let converged = false;
  let best = null;

  const measure = (s, ox, oy) => {
    render(label, tmp, bg, circle, font, s, ox, oy);
    const b = inkBox(tmp);
    if (!b) {
      console.error("no label pixels rendered - check the font name");
      process.exit(1);
    }
    return b;
  };

  // Bisect the font size for the target ink width. Ink width is monotonically
  // increasing in font size, and the rasterised measurement is quantised to whole
  // pixels, so the search keeps the closest size seen rather than expecting an
  // exact hit.
  if (targetInk > 0) {
    let lo = 40;
    let hi = 1400;
    for (let iter = 0; iter < 18; iter++) {
      const mid = (lo + hi) / 2;
      const b = measure(mid, 0, 0);
      const err = Math.abs(b.w - targetInk);
      if (!best || err < best.err) best = { size: mid, err, w: b.w, h: b.h };
      if (b.w < targetInk) lo = mid;
      else hi = mid;
      if (hi - lo < 0.25) break;
    }
    size = best.size;
    box = measure(size, 0, 0);
  } else {
    box = measure(size, 0, 0);
  }

  // Then centre the measured ink box. Offsets are absolute, and the render that
  // is finally kept is always one that was actually measured, so integer
  // rasterisation cannot shift the result after the tolerance is met.
  for (let iter = 0; iter < 6; iter++) {
    const centreX = (box.minX + box.maxX) / 2;
    const centreY = (box.minY + box.maxY) / 2;
    const dx = CENTRE - centreX;
    // Positive offsetY moves the ink up the canvas, so the correction inverts.
    const dy = centreY - CENTRE;
    if (Math.abs(dx) <= 0.5 && Math.abs(dy) <= 0.5) {
      converged = true;
      break;
    }
    offX += dx;
    offY += dy;
    box = measure(size, offX, offY);
  }
  if (Math.abs((box.minX + box.maxX) / 2 - CENTRE) <= 0.5
    && Math.abs((box.minY + box.maxY) / 2 - CENTRE) <= 0.5) {
    converged = true;
  }

  fs.copyFileSync(tmp, out);
  if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  if (!converged) console.error("WARNING: centring did not converge");

  const final = inkBox(out);
  if (!final) {
    console.error("final render produced no label pixels");
    process.exit(1);
  }
  console.log(
    `${label}  font=${font} size=${size.toFixed(2)}  ink=${final.w}x${final.h}  ` +
      `x ${final.minX}..${final.maxX} y ${final.minY}..${final.maxY}  ` +
      `centre=${((final.minX + final.maxX) / 2).toFixed(1)},${((final.minY + final.maxY) / 2).toFixed(1)}`
  );
  if (targetInk > 0 && Math.abs(final.w - targetInk) > 1) {
    console.error(`WARNING: ink width ${final.w} != target ${targetInk}`);
    process.exit(1);
  }
}

main();
