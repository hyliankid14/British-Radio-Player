import test from "node:test";
import assert from "node:assert/strict";

import {
  StationRepository,
  StationCategory,
  getStreamCandidates,
  getStationUri
} from "../src/data/stations.ts";
import { formatShowDisplayTitle } from "../src/api/showInfo.ts";

test("StationRepository - catalogue integrity", () => {
  const stations = StationRepository.getAll();
  assert.ok(stations.length >= 40, `Expected at least 40 stations, found ${stations.length}`);

  const national = StationRepository.getByCategory(StationCategory.NATIONAL);
  const regions = StationRepository.getByCategory(StationCategory.REGIONS);
  const local = StationRepository.getByCategory(StationCategory.LOCAL);

  assert.ok(national.length > 0, "Expected national stations");
  assert.ok(regions.length > 0, "Expected regional stations");
  assert.ok(local.length > 0, "Expected local stations");

  const r1 = StationRepository.getById("radio1");
  assert.ok(r1, "Radio 1 must exist");
  assert.equal(r1.serviceId, "bbc_radio_one");
  assert.equal(r1.category, StationCategory.NATIONAL);
});

test("Stream Candidates - candidate prioritization and fallbacks", () => {
  const r5 = StationRepository.getById("radio5live");
  assert.ok(r5, "Radio 5 Live must exist");

  // getStationUri bitrate checks
  const uriHigh = getStationUri(r5, "HIGH");
  assert.ok(uriHigh.includes("bitrate=320000"), "High URI should match 320000 bitrate");
  const uriLow = getStationUri(r5, "LOW");
  assert.ok(uriLow.includes("bitrate=48000"), "Low URI should match 48000 bitrate");

  // Stream candidates
  const candidatesHigh = getStreamCandidates(r5, "HIGH", false);
  assert.ok(candidatesHigh.length > 0, "Candidates should not be empty");

  // Geo-blocked stream candidates
  const candidatesGeo = getStreamCandidates(r5, "HIGH", true);
  assert.ok(candidatesGeo.length > 0, "Geo candidates should not be empty");
  for (const c of candidatesGeo) {
    assert.ok(!c.includes("&uk=1"), `Geo-blocked candidate should not be UK-only: ${c}`);
  }
});

test("ShowInfo - formatShowDisplayTitle", () => {
  // 1. Song with artist and track
  const songShow = {
    title: "The Breakfast Show",
    artist: "Dua Lipa",
    track: "Levitating"
  };
  assert.equal(formatShowDisplayTitle(songShow), "Dua Lipa - Levitating");

  // 2. Track only
  const trackOnly = {
    title: "Late Night Beats",
    track: "Midnight City"
  };
  assert.equal(formatShowDisplayTitle(trackOnly), "Midnight City");

  // 3. Episode title with show title
  const episodeShow = {
    title: "In Our Time",
    episodeTitle: "The Rosetta Stone"
  };
  assert.equal(formatShowDisplayTitle(episodeShow), "In Our Time — The Rosetta Stone");

  // 4. Fallback to show title
  const basicShow = {
    title: "News at Ten"
  };
  assert.equal(formatShowDisplayTitle(basicShow), "News at Ten");
});
