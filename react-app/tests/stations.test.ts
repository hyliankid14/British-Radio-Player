import test from "node:test";
import assert from "node:assert/strict";

import {
  StationRepository,
  StationCategory,
  getStreamCandidates,
  getStationUri
} from "../src/data/stations.ts";
import { formatShowDisplayTitle, isPlaceholderArtwork } from "../src/api/showInfo.ts";

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

  // Stream candidates for Radio 5 Live
  const candidatesHigh = getStreamCandidates(r5, "HIGH", false);
  assert.ok(candidatesHigh.length > 0, "Candidates should not be empty");
  assert.ok(candidatesHigh[0].includes("/hls/uk/"), "First candidate for UK should be UK HLS stream");
  assert.ok(candidatesHigh.some(c => c.includes("/hls/nonuk/")), "Candidates should include non-UK fallback");

  // Geo-blocked stream candidates for Radio 5 Live
  const candidatesGeo = getStreamCandidates(r5, "HIGH", true);
  assert.ok(candidatesGeo.length > 0, "Geo candidates should not be empty");
  assert.ok(candidatesGeo[0].includes("/hls/nonuk/"), "First candidate for geo-blocked should be international stream");
  for (const c of candidatesGeo) {
    assert.ok(!c.includes("&uk=1") && !c.includes("/live/uk/") && !c.includes("/hls/uk/"), `Geo-blocked candidate should not be UK-only: ${c}`);
  }

  // Radio 1 UK vs geo-blocked prioritization
  const r1 = StationRepository.getById("radio1")!;
  assert.ok(r1, "Radio 1 must exist");
  const r1UkCandidates = getStreamCandidates(r1, "HIGH", false);
  const r1NonUkCandidates = getStreamCandidates(r1, "HIGH", true);
  assert.ok(r1UkCandidates[0].includes("/hls/uk/"), "UK Radio 1 candidate must prioritize UK HLS");
  assert.ok(r1NonUkCandidates[0].includes("/hls/nonuk/"), "Geo-blocked Radio 1 candidate must prioritize international HLS");

  // UK-only stations (Sports Extra 2 & 3)
  const se2 = StationRepository.getById("radio5livesportsextra2")!;
  assert.ok(se2, "Sports Extra 2 must exist");
  const se2UkCandidates = getStreamCandidates(se2, "HIGH", false);
  const se2GeoCandidates = getStreamCandidates(se2, "HIGH", true);
  assert.ok(se2UkCandidates.length > 0, "Sports Extra 2 has UK stream candidates");
  assert.equal(se2GeoCandidates.length, 0, "Sports Extra 2 has no international stream candidates");
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
    const rawSongArtwork = currentShow?.songImageUrl || currentShow?.rawImageUrl;
    const songArtworkUrl =
      isSongPlaying && rawSongArtwork && !isPlaceholderArtwork(rawSongArtwork, stationLogoUrl)
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

  // Case 6: Song with solid grey placeholder image PID p0bqcdzf -> must fall back to station ident
  const songWithGreyPlaceholder = {
    title: "The Official Chart",
    artist: "Charli XCX",
    track: "Apple",
    songImageUrl: "https://ichef.bbci.co.uk/images/ic/320x320/p0bqcdzf.jpg"
  };
  assert.equal(
    resolveRadioArtwork(songWithGreyPlaceholder, station.logoUrl),
    undefined,
    "Solid grey placeholder p0bqcdzf must be rejected so station ident is used"
  );
});

test("isPlaceholderArtwork - correctly filters placeholder and logo URLs", () => {
  const stationLogo = "https://sounds.files.bbci.co.uk/3.6.4/networks/bbc_radio_one/colour_default.svg";

  // Solid grey placeholder image PID returned by BBC RMS
  assert.equal(isPlaceholderArtwork("https://ichef.bbci.co.uk/images/ic/320x320/p0bqcdzf.jpg"), true);
  assert.equal(isPlaceholderArtwork("https://ichef.bbci.co.uk/images/ic/640x640/p0bqcdzf.jpg"), true);

  // Generic BBC placeholders
  assert.equal(isPlaceholderArtwork("https://ichef.bbci.co.uk/images/ic/320x320/p01tqv8z.jpg"), true);
  assert.equal(isPlaceholderArtwork("https://ichef.bbci.co.uk/images/ic/320x320/default.jpg"), true);
  assert.equal(isPlaceholderArtwork("https://ichef.bbci.co.uk/images/ic/placeholder.png"), true);

  // Empty / invalid
  assert.equal(isPlaceholderArtwork(undefined), true);
  assert.equal(isPlaceholderArtwork(""), true);
  assert.equal(isPlaceholderArtwork("   "), true);
  assert.equal(isPlaceholderArtwork("not-a-url"), true);

  // Station logos
  assert.equal(isPlaceholderArtwork(stationLogo, stationLogo), true);
  assert.equal(isPlaceholderArtwork("https://ichef.bbci.co.uk/images/ic/320x320/blocks-colour-black.png", stationLogo), true);
  assert.equal(isPlaceholderArtwork("https://ichef.bbci.co.uk/services/radio1/logo.png", stationLogo), true);

  // Valid album artwork
  assert.equal(isPlaceholderArtwork("https://ichef.bbci.co.uk/images/ic/320x320/p0customalbum123.jpg", stationLogo), false);
  assert.equal(isPlaceholderArtwork("https://lastfm.freetls.fastly.net/i/u/300x300/abc12345.jpg", stationLogo), false);
});
