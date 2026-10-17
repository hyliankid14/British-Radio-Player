import test from "node:test";
import assert from "node:assert/strict";
import {
  sortPlaylistEntries,
  findNextPlaylistEpisodeToPlay,
  findPreviousPlaylistEpisodeToPlay,
  getPlaylistEntriesForPlayback,
  type SavedEpisodeEntry,
  type PlaylistStorageReader
} from "../src/podcasts/playlistPlayback.ts";

function createEntry(id: string, title: string, pubDate: string): SavedEpisodeEntry {
  return {
    id,
    title,
    description: `Description for ${title}`,
    pubDate,
    durationMins: 30,
    imageUrl: `https://example.com/${id}.jpg`,
    audioUrl: `https://example.com/${id}.mp3`,
    podcastId: "test-podcast",
    podcastTitle: "Test Podcast"
  };
}

test("sortPlaylistEntries orders newest first", () => {
  const entries = [
    createEntry("ep-old", "Old Episode", "2026-01-01T10:00:00Z"),
    createEntry("ep-new", "New Episode", "2026-03-01T10:00:00Z"),
    createEntry("ep-mid", "Mid Episode", "2026-02-01T10:00:00Z")
  ];

  const sorted = sortPlaylistEntries(entries, "newest_first");
  assert.deepEqual(sorted.map((e) => e.id), ["ep-new", "ep-mid", "ep-old"]);
});

test("sortPlaylistEntries orders oldest first", () => {
  const entries = [
    createEntry("ep-new", "New Episode", "2026-03-01T10:00:00Z"),
    createEntry("ep-old", "Old Episode", "2026-01-01T10:00:00Z"),
    createEntry("ep-mid", "Mid Episode", "2026-02-01T10:00:00Z")
  ];

  const sorted = sortPlaylistEntries(entries, "oldest_first");
  assert.deepEqual(sorted.map((e) => e.id), ["ep-old", "ep-mid", "ep-new"]);
});

test("sortPlaylistEntries orders by title alphabetically", () => {
  const entries = [
    createEntry("ep-c", "Charlie", "2026-01-01T10:00:00Z"),
    createEntry("ep-a", "Alpha", "2026-02-01T10:00:00Z"),
    createEntry("ep-b", "Bravo", "2026-03-01T10:00:00Z")
  ];

  const sorted = sortPlaylistEntries(entries, "title");
  assert.deepEqual(sorted.map((e) => e.id), ["ep-a", "ep-b", "ep-c"]);
});

test("sortPlaylistEntries orders by manual order", () => {
  const entries = [
    createEntry("ep-1", "Episode 1", "2026-01-01T10:00:00Z"),
    createEntry("ep-2", "Episode 2", "2026-02-01T10:00:00Z"),
    createEntry("ep-3", "Episode 3", "2026-03-01T10:00:00Z")
  ];

  const sorted = sortPlaylistEntries(entries, "manual", ["ep-2", "ep-3", "ep-1"]);
  assert.deepEqual(sorted.map((e) => e.id), ["ep-2", "ep-3", "ep-1"]);
});

test("findNextPlaylistEpisodeToPlay plays from first to last in playlist order", () => {
  const playlist = [
    createEntry("ep-1", "Track 1", "2026-01-01T10:00:00Z"),
    createEntry("ep-2", "Track 2", "2026-01-02T10:00:00Z"),
    createEntry("ep-3", "Track 3", "2026-01-03T10:00:00Z")
  ];

  // From first episode (ep-1) -> advances to next (ep-2)
  const next1 = findNextPlaylistEpisodeToPlay(playlist, "ep-1");
  assert.equal(next1?.id, "ep-2");

  // From second episode (ep-2) -> advances to next (ep-3)
  const next2 = findNextPlaylistEpisodeToPlay(playlist, "ep-2");
  assert.equal(next2?.id, "ep-3");

  // From last episode (ep-3) -> finishes (undefined)
  const next3 = findNextPlaylistEpisodeToPlay(playlist, "ep-3");
  assert.equal(next3, undefined);
});

test("findNextPlaylistEpisodeToPlay skips already played episodes when isPlayed is provided", () => {
  const playlist = [
    createEntry("ep-1", "Track 1", "2026-01-01T10:00:00Z"),
    createEntry("ep-2", "Track 2", "2026-01-02T10:00:00Z"),
    createEntry("ep-3", "Track 3", "2026-01-03T10:00:00Z"),
    createEntry("ep-4", "Track 4", "2026-01-04T10:00:00Z")
  ];

  const playedSet = new Set(["ep-1", "ep-2"]);
  const isPlayed = (id: string) => playedSet.has(id);

  // When ep-1 ends, ep-2 is played so it skips to ep-3
  const next = findNextPlaylistEpisodeToPlay(playlist, "ep-1", isPlayed);
  assert.equal(next?.id, "ep-3");

  // When ep-3 ends, advances to ep-4
  const nextAfter3 = findNextPlaylistEpisodeToPlay(playlist, "ep-3", isPlayed);
  assert.equal(nextAfter3?.id, "ep-4");
});

test("findNextPlaylistEpisodeToPlay returns undefined when all subsequent episodes are played", () => {
  const playlist = [
    createEntry("ep-1", "Track 1", "2026-01-01T10:00:00Z"),
    createEntry("ep-2", "Track 2", "2026-01-02T10:00:00Z"),
    createEntry("ep-3", "Track 3", "2026-01-03T10:00:00Z")
  ];

  const playedSet = new Set(["ep-1", "ep-2", "ep-3"]);
  const isPlayed = (id: string) => playedSet.has(id);

  const next = findNextPlaylistEpisodeToPlay(playlist, "ep-1", isPlayed);
  assert.equal(next, undefined);
});

test("findNextPlaylistEpisodeToPlay falls back to first unplayed episode if current ID is not in playlist", () => {
  const playlist = [
    createEntry("ep-1", "Track 1", "2026-01-01T10:00:00Z"),
    createEntry("ep-2", "Track 2", "2026-01-02T10:00:00Z"),
    createEntry("ep-3", "Track 3", "2026-01-03T10:00:00Z")
  ];

  const playedSet = new Set(["ep-1"]);
  const isPlayed = (id: string) => playedSet.has(id);

  const next = findNextPlaylistEpisodeToPlay(playlist, "unknown-id", isPlayed);
  assert.equal(next?.id, "ep-2");
});

test("findNextPlaylistEpisodeToPlay normalizes URN episode IDs", () => {
  const playlist = [
    createEntry("urn:bbc:podcast:p0123456", "Track 1", "2026-01-01T10:00:00Z"),
    createEntry("urn:bbc:podcast:p0123457", "Track 2", "2026-01-02T10:00:00Z")
  ];

  // Look up using canonical ID
  const next = findNextPlaylistEpisodeToPlay(playlist, "p0123456");
  assert.equal(next?.id, "urn:bbc:podcast:p0123457");
});

test("findPreviousPlaylistEpisodeToPlay returns previous episode in playlist order", () => {
  const playlist = [
    createEntry("ep-1", "Track 1", "2026-01-01T10:00:00Z"),
    createEntry("ep-2", "Track 2", "2026-01-02T10:00:00Z"),
    createEntry("ep-3", "Track 3", "2026-01-03T10:00:00Z")
  ];

  // Previous from ep-3 is ep-2
  const prev3 = findPreviousPlaylistEpisodeToPlay(playlist, "ep-3");
  assert.equal(prev3?.id, "ep-2");

  // Previous from ep-2 is ep-1
  const prev2 = findPreviousPlaylistEpisodeToPlay(playlist, "ep-2");
  assert.equal(prev2?.id, "ep-1");

  // Previous from first episode (ep-1) is undefined
  const prev1 = findPreviousPlaylistEpisodeToPlay(playlist, "ep-1");
  assert.equal(prev1, undefined);
});

test("handles empty playlist gracefully", () => {
  assert.equal(findNextPlaylistEpisodeToPlay([], "any-id"), undefined);
  assert.equal(findPreviousPlaylistEpisodeToPlay([], "any-id"), undefined);
  assert.deepEqual(sortPlaylistEntries([], "newest_first"), []);
});

test("getPlaylistEntriesForPlayback returns correctly sorted entries using storage reader", () => {
  const entries = [
    createEntry("ep-old", "Old Episode", "2026-01-01T10:00:00Z"),
    createEntry("ep-new", "New Episode", "2026-03-01T10:00:00Z"),
    createEntry("ep-mid", "Mid Episode", "2026-02-01T10:00:00Z")
  ];

  const mockReader: PlaylistStorageReader = {
    getPodcastPlaylistEntries: (id) => (id === "my-playlist" ? entries : []),
    getDownloadedEntries: () => ({}),
    getPlaylistSort: () => "newest_first",
    getPlaylistManualOrder: () => [],
    getHidePlayedEpisodesInPlaylists: () => false,
    getPlayedEpisodeIdSet: () => new Set<string>(),
    isEpisodeDownloaded: () => true
  };

  const result = getPlaylistEntriesForPlayback("my-playlist", { reader: mockReader });
  assert.deepEqual(result.map((e) => e.id), ["ep-new", "ep-mid", "ep-old"]);
});

