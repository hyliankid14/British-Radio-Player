import test from "node:test";
import assert from "node:assert/strict";

import {
  parseAutoPayload,
  applyAutoMutation,
  applyAutoMutations,
  type AutoMutationSink
} from "../src/auto/autoMutations.ts";

function createMockSink(): AutoMutationSink & {
  recentSongs: Array<{ artist: string; track: string; imageUrl: string; stationId: string; stationName: string }>;
  podcastHistory: Array<any>;
  favorites: string[];
  subscribed: string[];
  savedEpisodes: Map<string, any>;
  playedEpisodes: Map<string, { podcastId?: string; pubDateEpochMs?: number }>;
  progress: Map<string, number>;
  lastPlayed: any;
  lastStationId: string;
  playbackStartedEvents: any[];
} {
  return {
    recentSongs: [],
    podcastHistory: [],
    favorites: [],
    subscribed: [],
    savedEpisodes: new Map(),
    playedEpisodes: new Map(),
    progress: new Map(),
    lastPlayed: null,
    lastStationId: "",
    playbackStartedEvents: [],

    getFavorites() {
      return [...this.favorites];
    },
    setFavorites(stationIds) {
      this.favorites = [...stationIds];
    },
    getSubscribedPodcasts() {
      return [...this.subscribed];
    },
    setSubscribedPodcasts(ids) {
      this.subscribed = [...ids];
    },
    addPodcastPlaylistEntry(_playlist, entry) {
      this.savedEpisodes.set(entry.id, entry);
    },
    removePodcastPlaylistEntry(_playlist, episodeId) {
      this.savedEpisodes.delete(episodeId);
    },
    markEpisodePlayed(episodeId, podcastId, pubDateEpochMs) {
      this.playedEpisodes.set(episodeId, { podcastId, pubDateEpochMs });
    },
    setEpisodeProgress(episodeId, positionSec) {
      this.progress.set(episodeId, positionSec);
    },
    addPodcastHistory(entry) {
      const existing = this.podcastHistory.filter((item) => item.id !== entry.id);
      this.podcastHistory = [entry, ...existing].slice(0, 20);
    },
    setLastPlayed(entry) {
      this.lastPlayed = entry;
    },
    setLastStationId(stationId) {
      this.lastStationId = stationId;
    },
    addRecentSong(song) {
      if (!song.artist.trim() && !song.track.trim()) return;
      this.recentSongs.unshift(song);
    },
    onPlaybackStarted(payload) {
      this.playbackStartedEvents.push(payload);
    }
  };
}

// ---------------------------------------------------------------------------
// parseAutoPayload
// ---------------------------------------------------------------------------

test("parseAutoPayload handles JSON strings", () => {
  const json = JSON.stringify({ artist: "Dua Lipa", track: "Levitating" });
  const result = parseAutoPayload(json);
  assert.equal(result.artist, "Dua Lipa");
  assert.equal(result.track, "Levitating");
});

test("parseAutoPayload handles pre-parsed objects", () => {
  const obj = { artist: "Oasis", track: "Wonderwall" };
  const result = parseAutoPayload(obj);
  assert.equal(result.artist, "Oasis");
  assert.equal(result.track, "Wonderwall");
});

test("parseAutoPayload unwraps event object wrapping payload", () => {
  const event = {
    type: "recentSongAdded",
    payload: { artist: "Blur", track: "Parklife" }
  };
  const result = parseAutoPayload(event);
  assert.equal(result.artist, "Blur");
  assert.equal(result.track, "Parklife");
});

test("parseAutoPayload handles malformed strings and non-objects gracefully", () => {
  assert.deepEqual(parseAutoPayload("{invalid json"), {});
  assert.deepEqual(parseAutoPayload(""), {});
  assert.deepEqual(parseAutoPayload(null), {});
  assert.deepEqual(parseAutoPayload(undefined), {});
  assert.deepEqual(parseAutoPayload(42), {});
});

// ---------------------------------------------------------------------------
// recentSongAdded
// ---------------------------------------------------------------------------

test("applyAutoMutation(recentSongAdded) records song with stringified payload", () => {
  const sink = createMockSink();
  applyAutoMutation(
    {
      type: "recentSongAdded",
      payload: JSON.stringify({
        artist: "Radiohead",
        track: "Creep",
        imageUrl: "https://ichef.bbci.co.uk/images/song.jpg",
        stationId: "radio1",
        stationName: "BBC Radio 1"
      })
    },
    sink
  );

  assert.equal(sink.recentSongs.length, 1);
  assert.equal(sink.recentSongs[0].artist, "Radiohead");
  assert.equal(sink.recentSongs[0].track, "Creep");
  assert.equal(sink.recentSongs[0].imageUrl, "https://ichef.bbci.co.uk/images/song.jpg");
  assert.equal(sink.recentSongs[0].stationId, "radio1");
  assert.equal(sink.recentSongs[0].stationName, "BBC Radio 1");
});

test("applyAutoMutation(recentSongAdded) records song with object payload", () => {
  const sink = createMockSink();
  applyAutoMutation(
    {
      type: "recentSongAdded",
      payload: {
        artist: "The Beatles",
        track: "Hey Jude",
        imageUrl: "https://ichef.bbci.co.uk/images/beatles.jpg",
        stationId: "radio2",
        stationName: "BBC Radio 2"
      }
    },
    sink
  );

  assert.equal(sink.recentSongs.length, 1);
  assert.equal(sink.recentSongs[0].artist, "The Beatles");
  assert.equal(sink.recentSongs[0].track, "Hey Jude");
});

test("applyAutoMutation(recentSongAdded) ignores empty artist and track", () => {
  const sink = createMockSink();
  applyAutoMutation(
    {
      type: "recentSongAdded",
      payload: {
        artist: "   ",
        track: "",
        stationId: "radio1"
      }
    },
    sink
  );

  assert.equal(sink.recentSongs.length, 0);
});

// ---------------------------------------------------------------------------
// podcastHistoryAdded
// ---------------------------------------------------------------------------

test("applyAutoMutation(podcastHistoryAdded) appends to podcast history", () => {
  const sink = createMockSink();
  applyAutoMutation(
    {
      type: "podcastHistoryAdded",
      payload: JSON.stringify({
        id: "p001ep01",
        title: "The Mystery of Oak Island",
        description: "An exciting deep dive into history",
        imageUrl: "https://ichef.bbci.co.uk/images/ep.jpg",
        audioUrl: "https://audio.bbci.co.uk/ep.mp3",
        pubDate: "2026-10-01T12:00:00Z",
        durationMins: 45,
        podcastId: "p001",
        podcastTitle: "History Hour",
        playedAtMs: 1728374400000
      })
    },
    sink
  );

  assert.equal(sink.podcastHistory.length, 1);
  const entry = sink.podcastHistory[0];
  assert.equal(entry.id, "p001ep01");
  assert.equal(entry.title, "The Mystery of Oak Island");
  assert.equal(entry.podcastId, "p001");
  assert.equal(entry.podcastTitle, "History Hour");
  assert.equal(entry.durationMins, 45);
  assert.equal(entry.playedAtMs, 1728374400000);
});

test("applyAutoMutation(podcastHistoryAdded) falls back to podcastImageUrl", () => {
  const sink = createMockSink();
  applyAutoMutation(
    {
      type: "podcastHistoryAdded",
      payload: {
        id: "p002ep01",
        title: "News Episode",
        podcastImageUrl: "https://ichef.bbci.co.uk/images/podcast.jpg",
        podcastId: "p002",
        podcastTitle: "BBC Global News"
      }
    },
    sink
  );

  assert.equal(sink.podcastHistory.length, 1);
  assert.equal(sink.podcastHistory[0].imageUrl, "https://ichef.bbci.co.uk/images/podcast.jpg");
});

test("applyAutoMutation(podcastHistoryAdded) ignores entry without id", () => {
  const sink = createMockSink();
  applyAutoMutation(
    {
      type: "podcastHistoryAdded",
      payload: {
        id: "",
        title: "No ID Episode"
      }
    },
    sink
  );

  assert.equal(sink.podcastHistory.length, 0);
});

// ---------------------------------------------------------------------------
// playbackStarted
// ---------------------------------------------------------------------------

test("applyAutoMutation(playbackStarted) for episode updates podcast history and triggers playback handler", () => {
  const sink = createMockSink();
  applyAutoMutation(
    {
      type: "playbackStarted",
      payload: {
        kind: "episode",
        id: "ep-auto-1",
        title: "Episode One from Car",
        subtitle: "Car Podcast Series",
        imageUrl: "https://ichef.bbci.co.uk/images/car-ep.jpg",
        audioUrl: "https://audio.bbci.co.uk/ep1.mp3",
        podcastId: "pod-auto",
        durationMins: 30,
        playedAtMs: 1728375000000
      }
    },
    sink
  );

  assert.equal(sink.podcastHistory.length, 1);
  assert.equal(sink.podcastHistory[0].id, "ep-auto-1");
  assert.equal(sink.podcastHistory[0].podcastTitle, "Car Podcast Series");
  assert.equal(sink.playbackStartedEvents.length, 1);
  assert.equal(sink.playbackStartedEvents[0].kind, "episode");
});

test("applyAutoMutation(playbackStarted) for station triggers playback handler", () => {
  const sink = createMockSink();
  applyAutoMutation(
    {
      type: "playbackStarted",
      payload: {
        kind: "station",
        id: "radio4",
        title: "BBC Radio 4"
      }
    },
    sink
  );

  assert.equal(sink.podcastHistory.length, 0);
  assert.equal(sink.playbackStartedEvents.length, 1);
  assert.equal(sink.playbackStartedEvents[0].id, "radio4");
});

// ---------------------------------------------------------------------------
// applyAutoMutations (Queue draining)
// ---------------------------------------------------------------------------

test("applyAutoMutations drains mixed queue of car events in order", () => {
  const sink = createMockSink();
  const queue = [
    {
      type: "recentSongAdded",
      payload: {
        artist: "Arctic Monkeys",
        track: "Do I Wanna Know?",
        imageUrl: "https://img.jpg",
        stationId: "6music",
        stationName: "BBC Radio 6 Music"
      }
    },
    {
      type: "podcastHistoryAdded",
      payload: {
        id: "ep-999",
        title: "Infinite Monkey Cage",
        podcastId: "imc",
        podcastTitle: "The Infinite Monkey Cage",
        durationMins: 45
      }
    },
    {
      type: "favoriteToggled",
      payload: {
        stationId: "radio1",
        favorite: true
      }
    },
    {
      type: "episodeProgress",
      payload: {
        episodeId: "ep-999",
        positionMs: 120000
      }
    }
  ];

  applyAutoMutations(queue, sink);

  assert.equal(sink.recentSongs.length, 1);
  assert.equal(sink.recentSongs[0].artist, "Arctic Monkeys");

  assert.equal(sink.podcastHistory.length, 1);
  assert.equal(sink.podcastHistory[0].id, "ep-999");

  assert.deepEqual(sink.favorites, ["radio1"]);
  assert.equal(sink.progress.get("ep-999"), 120); // 120,000ms -> 120 seconds
});
