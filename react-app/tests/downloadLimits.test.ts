import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTO_DOWNLOAD_LIMIT_OPTIONS,
  AUTO_DOWNLOAD_LIMIT_PREF_KEY,
  DELETE_PLAYED_PREF_KEY,
  MAX_DOWNLOADS_PREF_KEY,
  MAX_DOWNLOADS_OPTIONS,
  UNLIMITED_DOWNLOADS,
  buildDownloadDisplayName,
  isAutomaticDownload,
  newestEpisodeIds,
  normaliseAutoDownloadLimit,
  normaliseMaxDownloads,
  pickDownloadsToRemove,
  pickPerPodcastDownloadsToRemove,
  pickStaleAutomaticDownloads,
  sanitizeFileName,
  sortEpisodesNewestFirst
} from "../src/downloads/downloadLimits.ts";

test("download preference keys stay stable for backup compatibility", () => {
  assert.equal(MAX_DOWNLOADS_PREF_KEY, "pref_max_downloads");
  assert.equal(DELETE_PLAYED_PREF_KEY, "pref_delete_played");
  assert.equal(AUTO_DOWNLOAD_LIMIT_PREF_KEY, "pref_auto_download_limit");
});

test("normaliseMaxDownloads treats zero and invalid values as unlimited", () => {
  assert.equal(normaliseMaxDownloads(undefined), UNLIMITED_DOWNLOADS);
  assert.equal(normaliseMaxDownloads(null), UNLIMITED_DOWNLOADS);
  assert.equal(normaliseMaxDownloads(0), UNLIMITED_DOWNLOADS);
  assert.equal(normaliseMaxDownloads(-5), UNLIMITED_DOWNLOADS);
  assert.equal(normaliseMaxDownloads(NaN), UNLIMITED_DOWNLOADS);
  assert.equal(normaliseMaxDownloads("nonsense"), UNLIMITED_DOWNLOADS);
});

test("normaliseMaxDownloads keeps whole positive values", () => {
  assert.equal(normaliseMaxDownloads(1), 1);
  assert.equal(normaliseMaxDownloads(10), 10);
  assert.equal(normaliseMaxDownloads("20"), 20);
  assert.equal(normaliseMaxDownloads(7.9), 7);
});

test("the offered maximum always includes unlimited", () => {
  assert.equal(MAX_DOWNLOADS_OPTIONS[0], UNLIMITED_DOWNLOADS);
  assert.ok(MAX_DOWNLOADS_OPTIONS.every((value) => value === 0 || value > 0));
});

test("pickDownloadsToRemove never removes anything when unlimited", () => {
  const records = { a: { downloadedAtMs: 1 }, b: { downloadedAtMs: 2 }, c: { downloadedAtMs: 3 } };
  assert.deepEqual(pickDownloadsToRemove(records, 0), []);
  assert.deepEqual(pickDownloadsToRemove(records, UNLIMITED_DOWNLOADS), []);
});

test("pickDownloadsToRemove keeps every download when under the cap", () => {
  const records = { a: { downloadedAtMs: 1 }, b: { downloadedAtMs: 2 } };
  assert.deepEqual(pickDownloadsToRemove(records, 2), []);
  assert.deepEqual(pickDownloadsToRemove(records, 50), []);
});

test("pickDownloadsToRemove deletes the oldest downloads first", () => {
  const records = {
    newest: { downloadedAtMs: 300 },
    oldest: { downloadedAtMs: 100 },
    middle: { downloadedAtMs: 200 }
  };
  assert.deepEqual(pickDownloadsToRemove(records, 2), ["oldest"]);
  assert.deepEqual(pickDownloadsToRemove(records, 1), ["oldest", "middle"]);
  assert.deepEqual(pickDownloadsToRemove(records, 0), []);
});

test("pickDownloadsToRemove treats missing download times as oldest", () => {
  const records = {
    known: { downloadedAtMs: 500 },
    unknown: {}
  };
  assert.deepEqual(pickDownloadsToRemove(records, 1), ["unknown"]);
});

test("pickDownloadsToRemove is deterministic for identical download times", () => {
  const records = {
    b: { downloadedAtMs: 100 },
    a: { downloadedAtMs: 100 },
    c: { downloadedAtMs: 100 }
  };
  assert.deepEqual(pickDownloadsToRemove(records, 1), ["a", "b"]);
  assert.deepEqual(pickDownloadsToRemove(records, 2), ["a"]);
});

test("pickDownloadsToRemove ignores empty records and handles an empty library", () => {
  assert.deepEqual(pickDownloadsToRemove({}, 5), []);
  const records = { a: { downloadedAtMs: 1 }, stale: undefined };
  assert.deepEqual(pickDownloadsToRemove(records, 1), []);
});

test("pickDownloadsToRemove backs past a protected download to still meet the cap", () => {
  const records = { oldest: { downloadedAtMs: 100 }, middle: { downloadedAtMs: 200 } };
  assert.deepEqual(pickDownloadsToRemove(records, 1, ["oldest"]), ["middle"]);
  assert.deepEqual(pickDownloadsToRemove(records, 1, ["oldest", "middle"]), []);
});

test("normaliseAutoDownloadLimit never falls back to unlimited", () => {
  assert.equal(normaliseAutoDownloadLimit(undefined), 1);
  assert.equal(normaliseAutoDownloadLimit(null), 1);
  assert.equal(normaliseAutoDownloadLimit(0), 1);
  assert.equal(normaliseAutoDownloadLimit(-5), 1);
  assert.equal(normaliseAutoDownloadLimit(NaN), 1);
  assert.equal(normaliseAutoDownloadLimit("nonsense"), 1);
});

test("normaliseAutoDownloadLimit keeps whole positive values", () => {
  assert.equal(normaliseAutoDownloadLimit(1), 1);
  assert.equal(normaliseAutoDownloadLimit(2), 2);
  assert.equal(normaliseAutoDownloadLimit("10"), 10);
  assert.equal(normaliseAutoDownloadLimit(7.9), 7);
});

test("the per-podcast limit is always a real positive cap", () => {
  assert.ok(AUTO_DOWNLOAD_LIMIT_OPTIONS.length > 0);
  assert.ok(AUTO_DOWNLOAD_LIMIT_OPTIONS.every((value) => value >= 1));
});

test("records written before the flag existed count as automatic", () => {
  assert.equal(isAutomaticDownload(undefined), false);
  assert.equal(isAutomaticDownload({}), true);
  assert.equal(isAutomaticDownload({ isAutoDownloaded: true }), true);
  assert.equal(isAutomaticDownload({ isAutoDownloaded: false }), false);
});

test("pickPerPodcastDownloadsToRemove trims each podcast over its own cap", () => {
  const records = {
    p1old: { downloadedAtMs: 100, isAutoDownloaded: true, entry: { podcastId: "p1" } },
    p1mid: { downloadedAtMs: 200, isAutoDownloaded: true, entry: { podcastId: "p1" } },
    p1new: { downloadedAtMs: 300, isAutoDownloaded: true, entry: { podcastId: "p1" } },
    p2only: { downloadedAtMs: 400, isAutoDownloaded: true, entry: { podcastId: "p2" } }
  };
  assert.deepEqual(pickPerPodcastDownloadsToRemove(records, 2), ["p1old"]);
  assert.deepEqual(pickPerPodcastDownloadsToRemove(records, 1), ["p1old", "p1mid"]);
  assert.deepEqual(pickPerPodcastDownloadsToRemove(records, 3), []);
});

test("pickPerPodcastDownloadsToRemove never deletes a manual download", () => {
  const records = {
    manual: { downloadedAtMs: 100, isAutoDownloaded: false, entry: { podcastId: "p1" } },
    oldestAuto: { downloadedAtMs: 200, isAutoDownloaded: true, entry: { podcastId: "p1" } },
    newestAuto: { downloadedAtMs: 300, isAutoDownloaded: true, entry: { podcastId: "p1" } }
  };
  assert.deepEqual(pickPerPodcastDownloadsToRemove(records, 1), ["oldestAuto"]);
  assert.deepEqual(pickPerPodcastDownloadsToRemove(records, 2), []);
});

test("pickPerPodcastDownloadsToRemove leaves unattributed records alone", () => {
  const records = {
    orphan: { downloadedAtMs: 100, isAutoDownloaded: true },
    another: { downloadedAtMs: 200, isAutoDownloaded: true }
  };
  assert.deepEqual(pickPerPodcastDownloadsToRemove(records, 1), []);
  assert.deepEqual(pickPerPodcastDownloadsToRemove({}, 1), []);
});

test("pickPerPodcastDownloadsToRemove protects the streaming episode", () => {
  const records = {
    oldest: { downloadedAtMs: 100, isAutoDownloaded: true, entry: { podcastId: "p1" } },
    middle: { downloadedAtMs: 200, isAutoDownloaded: true, entry: { podcastId: "p1" } },
    newest: { downloadedAtMs: 300, isAutoDownloaded: true, entry: { podcastId: "p1" } }
  };
  // The streaming episode still occupies a slot, so the other two go instead of
  // leaving the podcast permanently one over its cap.
  assert.deepEqual(pickPerPodcastDownloadsToRemove(records, 1, ["oldest"]), ["middle", "newest"]);
  assert.deepEqual(pickPerPodcastDownloadsToRemove(records, 3, ["oldest"]), []);
  assert.deepEqual(pickPerPodcastDownloadsToRemove(records, 1, ["oldest", "middle", "newest"]), []);
});

test("sortEpisodesNewestFirst orders newest first without mutating the input", () => {
  const episodes = [
    { id: "old", pubDate: "2026-01-01T00:00:00Z" },
    { id: "new", pubDate: "2026-03-01T00:00:00Z" },
    { id: "mid", pubDate: "2026-02-01T00:00:00Z" }
  ];
  assert.deepEqual(
    sortEpisodesNewestFirst(episodes).map((episode) => episode.id),
    ["new", "mid", "old"]
  );
  assert.deepEqual(episodes.map((episode) => episode.id), ["old", "new", "mid"]);
});

test("sortEpisodesNewestFirst puts undated episodes last", () => {
  const episodes = [
    { id: "undated" },
    { id: "dated", pubDate: "2026-02-01T00:00:00Z" }
  ];
  assert.deepEqual(
    sortEpisodesNewestFirst(episodes).map((episode) => episode.id),
    ["dated", "undated"]
  );
});

test("newestEpisodeIds selects the rolling window over every episode, not just missing ones", () => {
  // The bug this guards against: with a limit of 3, a podcast holding the three
  // newest episodes (e10, e9, e8) receives e11. Selecting from the missing episodes
  // alone would return [e11, e7, e6] and evict e10, e9 and e8. The window must be
  // the newest three of the whole feed — e11, e10, e9 — so old back-catalogue
  // episodes are never downloaded to replace newer downloads.
  const episodes = Array.from({ length: 11 }, (_, index) => ({
    id: `e${index + 1}`,
    pubDate: `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00Z`
  }));
  assert.deepEqual(newestEpisodeIds(episodes, 3), ["e11", "e10", "e9"]);
});

test("newestEpisodeIds caps the window at the available episode count", () => {
  const episodes = [
    { id: "a", pubDate: "2026-01-01T00:00:00Z" },
    { id: "b", pubDate: "2026-01-02T00:00:00Z" }
  ];
  assert.deepEqual(newestEpisodeIds(episodes, 5), ["b", "a"]);
  assert.deepEqual(newestEpisodeIds([], 3), []);
});

test("pickStaleAutomaticDownloads reports automatic downloads outside the window", () => {
  const records = {
    e8: { downloadedAtMs: 100, isAutoDownloaded: true, entry: { podcastId: "p1" } },
    e9: { downloadedAtMs: 200, isAutoDownloaded: true, entry: { podcastId: "p1" } },
    e10: { downloadedAtMs: 300, isAutoDownloaded: true, entry: { podcastId: "p1" } }
  };
  assert.deepEqual(pickStaleAutomaticDownloads(records, "p1", ["e11", "e10", "e9"]), ["e8"]);
  assert.deepEqual(pickStaleAutomaticDownloads(records, "p1", ["e10", "e9", "e8"]), []);
});

test("pickStaleAutomaticDownloads never removes manual, other-podcast or protected downloads", () => {
  const records = {
    manual: { downloadedAtMs: 100, isAutoDownloaded: false, entry: { podcastId: "p1" } },
    otherPodcast: { downloadedAtMs: 100, isAutoDownloaded: true, entry: { podcastId: "p2" } },
    orphan: { downloadedAtMs: 100, isAutoDownloaded: true },
    playing: { downloadedAtMs: 100, isAutoDownloaded: true, entry: { podcastId: "p1" } },
    stale: { downloadedAtMs: 100, isAutoDownloaded: true, entry: { podcastId: "p1" } }
  };
  assert.deepEqual(pickStaleAutomaticDownloads(records, "p1", [], ["playing"]), ["stale"]);
});

test("sanitizeFileName strips invalid Android filesystem characters", () => {
  assert.equal(sanitizeFileName("How many dead people are on the internet?"), "How many dead people are on the internet_");
  assert.equal(sanitizeFileName("Power Players: Does Xbox have a future?"), "Power Players_ Does Xbox have a future_");
  assert.equal(sanitizeFileName('Episode "quoted" / with \\ slashes <and> pipes|*'), "Episode _quoted_ _ with _ slashes _and_ pipes__");
});

test("buildDownloadDisplayName creates safe, bounded display names", () => {
  const name1 = buildDownloadDisplayName(
    "How many dead people are on the internet?",
    "w3ct8k7g",
    ".mp3"
  );
  assert.equal(name1, "How many dead people are on the internet_ - w3ct8k7g.mp3");

  const name2 = buildDownloadDisplayName(
    "Power Players: Does Xbox have a future?",
    "w3ct8glv",
    ".mp3"
  );
  assert.equal(name2, "Power Players_ Does Xbox have a future_ - w3ct8glv.mp3");

  const longTitle = "A".repeat(200);
  const nameLong = buildDownloadDisplayName(longTitle, "ep123", ".mp3");
  assert.equal(nameLong, `${"A".repeat(100)} - ep123.mp3`);

  const nameWorldCup = buildDownloadDisplayName(
    "How much luck do you need to win the World Cup?",
    "w3ct998z",
    ".mp3"
  );
  assert.equal(nameWorldCup, "How much luck do you need to win the World Cup_ - w3ct998z.mp3");

  const nameWithColonsInId = buildDownloadDisplayName(
    "Episode Title",
    "urn:bbc:podcast:w3ct998z",
    ".mp3"
  );
  assert.equal(nameWithColonsInId, "Episode Title - urn_bbc_podcast_w3ct998z.mp3");
});

