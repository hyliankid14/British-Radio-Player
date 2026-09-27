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

test("Now Playing Artwork - fallback to station ident when song has no artwork", () => {
  const station = StationRepository.getById("radio1")!;
  assert.ok(station);

  const resolveRadioArtwork = (
    currentShow: { artist?: string; track?: string; songImageUrl?: string; rawImageUrl?: string; imageUrl?: string } | null,
    stationLogoUrl: string
  ): string | undefined => {
    const isSongPlaying = !!(currentShow?.artist || currentShow?.track);
    const isOfficialLogo =
      (currentShow?.imageUrl === stationLogoUrl ||
        currentShow?.imageUrl?.includes("/services/") ||
        currentShow?.imageUrl?.includes("blocks-colour-black") ||
        currentShow?.songImageUrl === stationLogoUrl ||
        currentShow?.songImageUrl?.includes("/services/") ||
        currentShow?.songImageUrl?.includes("blocks-colour-black"));

    const rawSongArtwork = currentShow?.songImageUrl || currentShow?.rawImageUrl;
    const songArtworkUrl =
      isSongPlaying && rawSongArtwork && !isOfficialLogo
        ? rawSongArtwork
        : undefined;

    return songArtworkUrl;
  };

  // Case 1: Song is playing with artwork -> use song artwork
  const songWithArt = {
    title: "Breakfast Show",
    artist: "Dua Lipa",
    track: "Levitating",
    songImageUrl: "https://ichef.bbci.co.uk/images/ic/320x320/song123.jpg",
    imageUrl: "https://ichef.bbci.co.uk/images/ic/320x320/song123.jpg"
  };
  assert.equal(
    resolveRadioArtwork(songWithArt, station.logoUrl),
    "https://ichef.bbci.co.uk/images/ic/320x320/song123.jpg"
  );

  // Case 2: Song is playing WITHOUT artwork -> falls back to undefined (rendering StationLogo ident)
  // Even if an ESS schedule show image exists on the show object
  const songWithoutArt = {
    title: "Breakfast Show",
    artist: "The Beatles",
    track: "Hey Jude",
    songImageUrl: undefined,
    rawImageUrl: undefined,
    imageUrl: undefined // showInfo clears imageUrl when song is playing without RMS artwork
  };
  assert.equal(
    resolveRadioArtwork(songWithoutArt, station.logoUrl),
    undefined,
    "Should return undefined so component falls back to StationLogo ident"
  );

  // Case 3: Song without artwork but with ESS show banner -> must NOT use show banner, must fall back to station ident
  const songWithEssShowImageOnly = {
    title: "Radio 1 Dance Anthems",
    artist: "Calvin Harris",
    track: "Miracle",
    songImageUrl: undefined,
    rawImageUrl: undefined,
    imageUrl: "https://ichef.bbci.co.uk/images/ic/320x320/p0showbanner.jpg"
  };
  assert.equal(
    resolveRadioArtwork(songWithEssShowImageOnly, station.logoUrl),
    undefined,
    "Must not fall back to schedule/presenter image when song has no artwork"
  );

  // Case 4: Song with official BBC station logo as its image -> must reject and fall back to ident
  const songWithOfficialLogo = {
    title: "Late Night Beats",
    artist: "Fred Again",
    track: "Adore U",
    songImageUrl: station.logoUrl
  };
  assert.equal(
    resolveRadioArtwork(songWithOfficialLogo, station.logoUrl),
    undefined,
    "Must not use official logo; falls back to station ident"
  );

  // Case 5: No song playing (speech/talk show) -> falls back to station ident
  const talkShow = {
    title: "Radio 1 Newsbeat",
    imageUrl: "https://ichef.bbci.co.uk/images/ic/320x320/p0newsbeat.jpg"
  };
  assert.equal(
    resolveRadioArtwork(talkShow, station.logoUrl),
    undefined,
    "Speech/talk show with no song should return undefined to show station ident"
  );
});
