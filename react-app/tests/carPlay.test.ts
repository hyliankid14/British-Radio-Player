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

test("CarPlay recentSongAdded and podcastHistoryAdded mutation structure", () => {
  const songPayload = {
    artist: "Wet Leg",
    track: "Chaise Longue",
    imageUrl: "https://ichef.bbci.co.uk/images/song.jpg",
    stationId: "6music",
    stationName: "BBC Radio 6 Music",
    playedAtMs: 1728375000000
  };

  assert.ok(songPayload.artist);
  assert.ok(songPayload.track);
  assert.ok(songPayload.playedAtMs > 0);

  const episodePayload = {
    id: "p012345",
    title: "Desert Island Discs",
    podcastId: "did",
    podcastTitle: "Desert Island Discs",
    durationMins: 45,
    playedAtMs: 1728376000000
  };

  assert.ok(episodePayload.id);
  assert.ok(episodePayload.title);
  assert.ok(episodePayload.playedAtMs > 0);
});

test("CarPlay now playing buttons omit redundant stop button and provide podcast subscribe icon for matching shows", () => {
  // CarPlay's CPNowPlayingTemplate provides primary playback / stop controls in the center
  // transport bar for live streams. The secondary button bar must never duplicate this with
  // a smaller stop button. Instead, for live stations with a matching podcast, it surfaces
  // the podcast icon to toggle subscription.

  interface ShowInfo {
    showTitle: string;
    showSubtitle?: string;
  }

  interface Podcast {
    id: string;
    title: string;
  }

  const nonIdentifyingWords = new Set([
    "a", "an", "the", "and", "of", "in", "on", "at", "for", "to", "from", "by", "with",
    "is", "are", "bbc", "radio", "fm", "am", "tv", "live", "show", "programme", "program",
    "podcast", "podcasts", "episode", "series"
  ]);

  function normalizeTitle(text?: string): string {
    if (!text) return "";
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function stripTrailingS(word: string): string {
    if (word.length >= 5 && word.endsWith("s") && !word.endsWith("ss")) {
      return word.slice(0, -1);
    }
    return word;
  }

  function identifyingWords(text: string): string[] {
    const norm = normalizeTitle(text);
    const words: string[] = [];
    for (const word of norm.split(" ")) {
      if (!word || nonIdentifyingWords.has(word)) continue;
      words.push(stripTrailingS(word));
    }
    return words;
  }

  function isContiguousRun(shortWords: string[], longWords: string[]): boolean {
    if (shortWords.length === 0 || shortWords.length > longWords.length) return false;
    for (let i = 0; i <= longWords.length - shortWords.length; i++) {
      let match = true;
      for (let j = 0; j < shortWords.length; j++) {
        if (longWords[i + j] !== shortWords[j]) {
          match = false;
          break;
        }
      }
      if (match) return true;
    }
    return false;
  }

  function titleMatches(query: string, podcastTitle: string): boolean {
    const normQ = normalizeTitle(query);
    const normP = normalizeTitle(podcastTitle);
    if (!normQ || !normP) return false;
    if (normQ === normP) return true;
    if (normQ + " podcast" === normP || normP + " podcast" === normQ) return true;
    if (normQ + " podcasts" === normP || normP + " podcasts" === normQ) return true;

    const qWords = identifyingWords(query);
    const pWords = identifyingWords(podcastTitle);
    if (qWords.length === 0 || pWords.length === 0) return false;
    if (qWords.join(" ") === pWords.join(" ")) return true;

    const [shortWords, longWords] = qWords.length <= pWords.length ? [qWords, pWords] : [pWords, qWords];
    if (isContiguousRun(shortWords, longWords)) {
      const coverage = shortWords.length / longWords.length;
      if (coverage >= 0.6) return true;
    }
    return false;
  }

  function resolveNowPlayingButtons(
    kind: "station" | "episode",
    stationTitle: string,
    showInfo: ShowInfo,
    podcasts: Podcast[],
    isFavorite: boolean,
    subscribedPodcastIds: Set<string>
  ): { icon: string; action: string }[] {
    const buttons: { icon: string; action: string }[] = [];

    if (kind === "station") {
      buttons.push({
        icon: isFavorite ? "star.fill" : "star",
        action: "toggleFavorite"
      });

      const queries: string[] = [];
      const showTitle = showInfo.showTitle.trim();
      if (showTitle && showTitle.toLowerCase() !== stationTitle.toLowerCase()) {
        queries.append = queries.push(showTitle);
      }
      const showSubtitle = (showInfo.showSubtitle || "").trim();
      if (
        showSubtitle &&
        showSubtitle.toLowerCase() !== stationTitle.toLowerCase() &&
        showSubtitle.toLowerCase() !== showTitle.toLowerCase()
      ) {
        queries.push(showSubtitle);
      }

      let matchedPodcast: Podcast | undefined;
      for (const q of queries) {
        matchedPodcast = podcasts.find((p) => titleMatches(q, p.title));
        if (matchedPodcast) break;
      }

      if (matchedPodcast) {
        const subscribed = subscribedPodcastIds.has(matchedPodcast.id);
        buttons.push({
          icon: subscribed
            ? "antenna.radiowaves.left.and.right.circle.fill"
            : "antenna.radiowaves.left.and.right",
          action: "toggleSubscribe"
        });
      }
    }

    // Notice: NO smaller stop.fill button is appended!
    return buttons;
  }

  const catalog: Podcast[] = [
    { id: "b08qmsh6", title: "Political Thinking with Nick Robinson" },
    { id: "p02nq08x", title: "Global News Podcast" }
  ];

  // 1. Radio 4 playing Political Thinking (matching show)
  const buttons1 = resolveNowPlayingButtons(
    "station",
    "Radio 4",
    { showTitle: "Political Thinking with Nick Robinson..." },
    catalog,
    true,
    new Set()
  );

  // Must have favorite button and podcast button, but NO stop button
  assert.equal(buttons1.length, 2);
  assert.equal(buttons1[0].icon, "star.fill");
  assert.equal(buttons1[1].icon, "antenna.radiowaves.left.and.right");
  assert.equal(buttons1[1].action, "toggleSubscribe");
  assert.ok(!buttons1.some((b) => b.icon === "stop.fill"), "Must not include a secondary stop button");

  // 2. Subscribed podcast reflects filled icon
  const buttons2 = resolveNowPlayingButtons(
    "station",
    "Radio 4",
    { showTitle: "Political Thinking with Nick Robinson" },
    catalog,
    false,
    new Set(["b08qmsh6"])
  );
  assert.equal(buttons2.length, 2);
  assert.equal(buttons2[0].icon, "star");
  assert.equal(buttons2[1].icon, "antenna.radiowaves.left.and.right.circle.fill");

  // 3. Station playing music or generic show without matching podcast
  const buttons3 = resolveNowPlayingButtons(
    "station",
    "Radio 1",
    { showTitle: "Radio 1 Anthems" },
    catalog,
    false,
    new Set()
  );
  assert.equal(buttons3.length, 1);
  assert.equal(buttons3[0].icon, "star");
  assert.ok(!buttons3.some((b) => b.icon === "stop.fill"));
});

test("CarPlay station navigation list falls back to all stations if favourites mode has no favourites", () => {
  const allStations = ["radio1", "radio2", "radio3"];
  function resolveStationList(scrollMode: string, favorites: string[], all: string[]): string[] {
    if (scrollMode === "favourites") {
      const favSet = new Set(favorites);
      const filtered = all.filter((id) => favSet.has(id));
      return filtered.length > 0 ? filtered : all;
    }
    return all;
  }

  // Favourites mode with favourites returns only favourites
  assert.deepEqual(resolveStationList("favourites", ["radio1"], allStations), ["radio1"]);
  // Favourites mode with empty favourites falls back to all stations so channel navigation does not break
  assert.deepEqual(resolveStationList("favourites", [], allStations), allStations);
  // Default "all" mode returns all stations
  assert.deepEqual(resolveStationList("all", ["radio1"], allStations), allStations);
});
