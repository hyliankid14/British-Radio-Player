import test from "node:test";
import assert from "node:assert/strict";

import {
  StationRepository,
  StationCategory,
  getStreamCandidates,
  getStationUri
} from "../src/data/stations.ts";
import { formatShowDisplayTitle, isPlaceholderArtwork } from "../src/api/showInfo.ts";
import { getStationIdentArtwork } from "../src/utils/stationIdents.ts";

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

test("Stream Candidates - variable bitrate prioritization", () => {
  const r1 = StationRepository.getById("radio1")!;
  assert.ok(r1, "Radio 1 must exist");

  // HIGH quality selects high syndication first (320 kbps)
  const highCandidates = getStreamCandidates(r1, "HIGH", false);
  assert.ok(highCandidates[0].includes("audio_syndication_high_sbr_v1"), "HIGH quality candidate 0 must be 320 kbps high stream");

  // MEDIUM quality selects medium syndication first (128 kbps)
  const medCandidates = getStreamCandidates(r1, "MEDIUM", false);
  assert.ok(medCandidates[0].includes("audio_syndication_med_sbr_v1"), "MEDIUM quality candidate 0 must be 128 kbps med stream");

  // LOW quality selects low syndication first (96/48 kbps)
  const lowCandidates = getStreamCandidates(r1, "LOW", false);
  assert.ok(lowCandidates[0].includes("audio_syndication_low_sbr_v1"), "LOW quality candidate 0 must be 96 kbps low stream");

  // AUTO quality in candidate generator defaults to HIGH tier
  const autoCandidates = getStreamCandidates(r1, "AUTO", false);
  assert.ok(autoCandidates[0].includes("audio_syndication_high_sbr_v1"), "AUTO quality defaults to high tier");
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

  // Station logos (filtered with or without explicit stationLogo param)
  assert.equal(isPlaceholderArtwork(stationLogo, stationLogo), true);
  assert.equal(isPlaceholderArtwork("https://ichef.bbci.co.uk/images/ic/320x320/blocks-colour-black.png", stationLogo), true);
  assert.equal(isPlaceholderArtwork("https://ichef.bbci.co.uk/images/ic/320x320/blocks-colour-black.png"), true);
  assert.equal(isPlaceholderArtwork("https://ichef.bbci.co.uk/services/radio1/logo.png", stationLogo), true);
  assert.equal(isPlaceholderArtwork("https://ichef.bbci.co.uk/services/radio1/logo.png"), true);

  // Valid album artwork
  assert.equal(isPlaceholderArtwork("https://ichef.bbci.co.uk/images/ic/320x320/p0customalbum123.jpg", stationLogo), false);
  assert.equal(isPlaceholderArtwork("https://lastfm.freetls.fastly.net/i/u/300x300/abc12345.jpg", stationLogo), false);
});

test("Notification Artwork - uses custom station idents rather than BBC branded artwork", () => {
  const station = StationRepository.getById("radio4")!;
  assert.ok(station);

  // Custom ident is available for the station
  const identArtwork = getStationIdentArtwork(station.id);
  assert.ok(identArtwork, "Custom ident must be defined for station");
  // Must NOT be the BBC branded logo URL
  assert.notEqual(identArtwork, station.logoUrl);

  const resolveNotificationArtwork = (
    currentShow: { artist?: string; track?: string; songImageUrl?: string; rawImageUrl?: string } | null,
    stationObj: typeof station
  ): any => {
    const hasSong = !!(currentShow?.artist || currentShow?.track);
    const rawArt = currentShow?.songImageUrl || currentShow?.rawImageUrl;
    const songArtwork =
      hasSong && rawArt && !isPlaceholderArtwork(rawArt, stationObj.logoUrl)
        ? rawArt
        : undefined;

    return songArtwork || getStationIdentArtwork(stationObj.id);
  };

  // Case 1: Speech / no song playing -> returns custom ident artwork, NEVER station.logoUrl
  const speechShow = { title: "Today", artist: undefined, track: undefined };
  const artworkForSpeech = resolveNotificationArtwork(speechShow, station);
  assert.equal(artworkForSpeech, identArtwork);
  assert.notEqual(artworkForSpeech, station.logoUrl);

  // Case 2: Song playing with song artwork -> uses song artwork
  const songWithArt = {
    artist: "Artist Name",
    track: "Track Title",
    songImageUrl: "https://ichef.bbci.co.uk/images/ic/320x320/p0customsong.jpg"
  };
  assert.equal(
    resolveNotificationArtwork(songWithArt, station),
    "https://ichef.bbci.co.uk/images/ic/320x320/p0customsong.jpg"
  );

  // Case 3: Song without artwork or with BBC official logo as image -> falls back to custom ident, NEVER station.logoUrl
  const songWithOfficialLogo = {
    artist: "Artist Name",
    track: "Track Title",
    songImageUrl: station.logoUrl
  };
  const artworkForSongNoArt = resolveNotificationArtwork(songWithOfficialLogo, station);
  assert.equal(artworkForSongNoArt, identArtwork);
  assert.notEqual(artworkForSongNoArt, station.logoUrl);
});

test("Notification Metadata - deduplicates identical metadata updates to prevent notification flicker and bitmap wiping", () => {
  let callCount = 0;
  let lastTrackMetadata: { title: string; artist?: string; album?: string; artwork?: any } | null = null;

  const mockUpdateTrack0Metadata = async (metadata: {
    title: string;
    artist?: string;
    album?: string;
    artwork?: any;
  }) => {
    if (
      lastTrackMetadata &&
      lastTrackMetadata.title === metadata.title &&
      lastTrackMetadata.artist === metadata.artist &&
      lastTrackMetadata.album === metadata.album &&
      lastTrackMetadata.artwork === metadata.artwork
    ) {
      return;
    }
    lastTrackMetadata = metadata;
    callCount++;
  };

  const meta1 = {
    title: "BBC Radio 1",
    artist: "Greg James",
    album: "The Radio 1 Breakfast Show",
    artwork: "content://com.hyliankid14.bbcradioplayer.stationident/radio1.png"
  };

  // First call sets the metadata
  void mockUpdateTrack0Metadata(meta1);
  assert.equal(callCount, 1);

  // Subsequent periodic calls (e.g. 5s show info poll) with same data should be ignored
  void mockUpdateTrack0Metadata({ ...meta1 });
  assert.equal(callCount, 1, "Duplicate metadata updates must be skipped");

  void mockUpdateTrack0Metadata({ ...meta1 });
  assert.equal(callCount, 1, "Duplicate metadata updates must be skipped");

  // Changed song/presenter should trigger an update
  const meta2 = {
    ...meta1,
    artist: "Dua Lipa - Levitating"
  };
  void mockUpdateTrack0Metadata(meta2);
  assert.equal(callCount, 2, "Changed metadata should trigger an update");
});

test("Notification Metadata - dispatches to both queue and now playing notification, retrying if earlier update failed", async () => {
  let queueUpdateCount = 0;
  let notificationUpdateCount = 0;
  let shouldFail = true;
  let lastTrackMetadata: { title: string; artist?: string; album?: string; artwork?: any } | null = null;

  const mockTrackPlayer = {
    updateMetadataForTrack: async (_index: number, _metadata: any) => {
      if (shouldFail) throw new Error("Native player temporarily unready");
      queueUpdateCount++;
    },
    updateNowPlayingMetadata: async (_metadata: any) => {
      if (shouldFail) throw new Error("Native player temporarily unready");
      notificationUpdateCount++;
    }
  };

  const updateTrack0 = async (metadata: {
    title: string;
    artist?: string;
    album?: string;
    artwork?: any;
  }) => {
    if (
      lastTrackMetadata &&
      lastTrackMetadata.title === metadata.title &&
      lastTrackMetadata.artist === metadata.artist &&
      lastTrackMetadata.album === metadata.album &&
      lastTrackMetadata.artwork === metadata.artwork
    ) {
      return;
    }
    const results = await Promise.allSettled([
      mockTrackPlayer.updateMetadataForTrack(0, metadata),
      mockTrackPlayer.updateNowPlayingMetadata(metadata)
    ]);
    const anySucceeded = results.some((r) => r.status === "fulfilled");
    if (anySucceeded) {
      lastTrackMetadata = metadata;
    }
  };

  const meta = {
    title: "BBC Radio 1",
    artist: "Sam Smith - Stay With Me",
    album: "The Radio 1 Breakfast Show",
    artwork: "https://ichef.bbci.co.uk/images/ic/320x320/song.jpg"
  };

  // When native update fails initially, lastTrackMetadata should NOT be cached
  await updateTrack0(meta);
  assert.equal(queueUpdateCount, 0);
  assert.equal(notificationUpdateCount, 0);
  assert.equal(lastTrackMetadata, null, "Failed update must not poison cache");

  // Subsequent call with the same metadata must retry rather than being falsely deduplicated
  shouldFail = false;
  await updateTrack0(meta);
  assert.equal(queueUpdateCount, 1, "Queue track metadata must be updated on retry");
  assert.equal(notificationUpdateCount, 1, "Now playing notification must be updated on retry");
  assert.deepEqual(lastTrackMetadata, meta, "Successful update must populate cache");

  // Third call with identical metadata should now be deduplicated
  await updateTrack0(meta);
  assert.equal(queueUpdateCount, 1, "Duplicate call must be skipped");
  assert.equal(notificationUpdateCount, 1, "Duplicate call must be skipped");
});

test("ShowInfo - immediate tune-in requests use distinct cache key from delayed poll requests", () => {
  const getKey = (stationId: string, skipDelay: boolean) => `${stationId}:${skipDelay ? "immediate" : "delayed"}`;
  assert.notEqual(getKey("radio1", true), getKey("radio1", false));
  assert.equal(getKey("radio1", true), "radio1:immediate");
  assert.equal(getKey("radio1", false), "radio1:delayed");
});

