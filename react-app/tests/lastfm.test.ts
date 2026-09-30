import test from "node:test";
import assert from "node:assert/strict";

// The api_sig implementation moved to the signing proxy (api/lastfm_proxy.py) so the
// shared secret is no longer shipped in the JS bundle. Its digest is pinned by
// test_matches_the_known_good_digest in api/test_lastfm_proxy.py; the check here is
// that this build carries no Last.fm secret at all.

test("the app bundle carries no Last.fm shared secret", () => {
  const secret = process.env.EXPO_PUBLIC_LASTFM_API_SECRET;
  assert.equal(
    secret,
    undefined,
    "EXPO_PUBLIC_LASTFM_API_SECRET must not be defined — Expo inlines it into the " +
      "shipped JS bundle. Signing belongs to the first-party proxy."
  );
});

import { calculateScrobbleThresholdMs } from "../src/audio/scrobbleThreshold.ts";

test("calculateScrobbleThresholdMs enforces Last.fm scrobble criteria", () => {
  // Unknown or 0 duration (live radio default) -> 60 seconds
  assert.equal(calculateScrobbleThresholdMs(0), 60_000);
  assert.equal(calculateScrobbleThresholdMs(-10), 60_000);

  // Short track (40s): 50% is 20s, but minimum threshold is 30s
  assert.equal(calculateScrobbleThresholdMs(40), 30_000);

  // Standard track (180s / 3m): 50% is 90s
  assert.equal(calculateScrobbleThresholdMs(180), 90_000);

  // 4-minute track (240s): 50% is 120s
  assert.equal(calculateScrobbleThresholdMs(240), 120_000);

  // Long track (600s / 10m): 50% is 300s, but maximum threshold is 240s (4m)
  assert.equal(calculateScrobbleThresholdMs(600), 240_000);
});

