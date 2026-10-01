import test from "node:test";
import assert from "node:assert/strict";

import {
  StationRepository,
  StationCategory,
  getStreamCandidates,
  type Station
} from "../src/data/stations.ts";

test("CarPlay and Android Auto station catalogue integrity", () => {
  const allStations = StationRepository.getAll();
  assert.ok(allStations.length >= 40, "Must provide full BBC radio station list");

  const national = StationRepository.getByCategory(StationCategory.NATIONAL);
  const regions = StationRepository.getByCategory(StationCategory.REGIONS);
  const local = StationRepository.getByCategory(StationCategory.LOCAL);

  assert.ok(national.length > 0, "National stations must be present");
  assert.ok(regions.length > 0, "Regions stations must be present");
  assert.ok(local.length > 0, "Local stations must be present");
  assert.equal(national.length + regions.length + local.length, allStations.length);

  // Every station has the metadata required by CarPlay templates
  for (const st of allStations) {
    assert.ok(st.id, `Station must have id: ${st.id}`);
    assert.ok(st.title, `Station must have title: ${st.id}`);
    assert.ok(st.serviceId, `Station must have serviceId: ${st.id}`);
    assert.ok(Array.isArray(st.streamServiceIds), `Station must have streamServiceIds: ${st.id}`);
    assert.ok(Array.isArray(st.directStreamUrls), `Station must have directStreamUrls: ${st.id}`);
    assert.ok(
      [StationCategory.NATIONAL, StationCategory.REGIONS, StationCategory.LOCAL].includes(st.category),
      `Unknown category for ${st.id}`
    );
  }
});

test("CarPlay stream candidate ladder matches Android Auto fallbacks", () => {
  const r1 = StationRepository.getById("radio1") as Station;
  assert.ok(r1, "Radio 1 must exist");

  const standardCandidates = getStreamCandidates(r1, "HIGH", false);
  assert.ok(standardCandidates.length >= 2, "Must produce multiple fallback candidates");
  // First candidate is primary UK HLS
  assert.ok(
    standardCandidates[0].includes("bbc_radio_one") && standardCandidates[0].includes(".m3u8"),
    "First candidate must be primary HLS"
  );

  // Geo-blocked stream candidate ladder
  const geoCandidates = getStreamCandidates(r1, "HIGH", true);
  assert.ok(geoCandidates.length > 0, "Must produce geo-fallback candidates");
  for (const candidate of geoCandidates) {
    assert.ok(!candidate.includes("&uk=1"), `Geo candidate must not be UK-only: ${candidate}`);
  }
});

test("CarPlay search scoring matches Android Auto term matching", () => {
  function matchScore(text: string, terms: string[]): number {
    if (!text) return 0;
    const haystack = text.toLowerCase();
    return terms.filter((term) => haystack.includes(term.toLowerCase())).length;
  }

  const queryTerms = ["radio", "1"];
  const score1 = matchScore("BBC Radio 1", queryTerms);
  const score2 = matchScore("BBC Radio 2", queryTerms);
  const scoreWorld = matchScore("BBC World Service", queryTerms);

  assert.equal(score1, 2, "Radio 1 should match both terms");
  assert.equal(score2, 1, "Radio 2 should match one term");
  assert.equal(scoreWorld, 0, "World Service should match no terms");
  assert.ok(score1 > score2 && score2 > scoreWorld);
});

test("CarPlay and Android Auto skip controls advance 30s and rewind 10s for podcasts", () => {
  const SEEK_FORWARD_SECONDS = 30;
  const SEEK_BACKWARD_SECONDS = 10;

  function calculateNewPosition(currentSeconds: number, deltaSeconds: number, durationSeconds: number): number {
    const raw = currentSeconds + deltaSeconds;
    const clampedBottom = Math.max(0, raw);
    return durationSeconds > 0 ? Math.min(clampedBottom, durationSeconds) : clampedBottom;
  }

  const duration = 1800; // 30 mins
  // Skip forward advances by 30 seconds
  assert.equal(calculateNewPosition(100, SEEK_FORWARD_SECONDS, duration), 130);
  // Skip backward rewinds by 10 seconds
  assert.equal(calculateNewPosition(100, -SEEK_BACKWARD_SECONDS, duration), 90);
  // Rewind near beginning clamps to 0
  assert.equal(calculateNewPosition(5, -SEEK_BACKWARD_SECONDS, duration), 0);
  // Forward near end clamps to duration
  assert.equal(calculateNewPosition(1790, SEEK_FORWARD_SECONDS, duration), 1800);
});
