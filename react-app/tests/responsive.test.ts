import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateResponsiveLayout,
  fitNowPlayingArtworkSize
} from "../src/theme/responsiveLayout.ts";

// Artwork chrome: artworkContainer marginVertical (12 * 2) + scrollContent padding (16 * 2).
const ARTWORK_CHROME = 56;

test("now playing artwork follows the Kotlin dimens breakpoints", () => {
  assert.equal(calculateResponsiveLayout(411, 891).nowPlayingArtworkSize, 300);
  assert.equal(calculateResponsiveLayout(700, 1000).nowPlayingArtworkSize, 240);
  assert.equal(calculateResponsiveLayout(1000, 1400).nowPlayingArtworkSize, 220);
  // Landscape tablet: sw800dp does not apply below 800dp wide, so the landscape value wins.
  assert.equal(calculateResponsiveLayout(700, 500).nowPlayingArtworkSize, 250);
  assert.equal(calculateResponsiveLayout(360, 640).nowPlayingArtworkSize, 296);
});

test("artwork uses the dimen size until the viewport and details are measured", () => {
  assert.equal(fitNowPlayingArtworkSize(300, 0, 0), 300);
  assert.equal(fitNowPlayingArtworkSize(300, 0, 180), 300);
  assert.equal(fitNowPlayingArtworkSize(300, 500, 0), 300);
});

test("artwork keeps the full dimen size when the details already fit", () => {
  // 300 + 180 details + 56 chrome = 536 <= 620 available viewport.
  assert.equal(fitNowPlayingArtworkSize(300, 620, 180), 300);
});

test("artwork shrinks so the details stay on screen without scrolling", () => {
  // A short viewport that cannot fit a 300dp artwork alongside the details.
  const size = fitNowPlayingArtworkSize(300, 457, 167);
  assert.equal(size, 234);
  // Artwork + details + chrome now exactly fills the viewport.
  assert.equal(size + 167 + ARTWORK_CHROME, 457);
});

test("artwork never exceeds the dimen ceiling even on a very short viewport", () => {
  assert.ok(fitNowPlayingArtworkSize(220, 2000, 20) <= 220);
});

test("artwork never shrinks below the floor on cramped viewports", () => {
  assert.equal(fitNowPlayingArtworkSize(300, 120, 400), 140);
  assert.equal(fitNowPlayingArtworkSize(300, 40, 900), 140);
});

test("artwork shrink is monotonic as the viewport shrinks", () => {
  const sizes = [800, 600, 457, 320, 200].map((h) => fitNowPlayingArtworkSize(300, h, 167));
  for (let i = 1; i < sizes.length; i += 1) {
    assert.ok(sizes[i] <= sizes[i - 1], `expected ${sizes[i]} <= ${sizes[i - 1]}`);
  }
});
