import test from "node:test";
import assert from "node:assert/strict";
import { findNextEpisodeToPlay, parseEpisodePubDateEpoch } from "../src/podcasts/autoplayNext.ts";
import type { Episode } from "../src/api/podcasts.ts";

test("parseEpisodePubDateEpoch parses RFC 2822 dates and returns epoch ms", () => {
  const parsed = parseEpisodePubDateEpoch("Fri, 02 Jan 2026 12:00:00 GMT");
  assert.equal(parsed, Date.parse("Fri, 02 Jan 2026 12:00:00 GMT"));
  assert.equal(parseEpisodePubDateEpoch(""), 0);
  assert.equal(parseEpisodePubDateEpoch(undefined), 0);
  assert.equal(parseEpisodePubDateEpoch("invalid"), 0);
});

test("findNextEpisodeToPlay advances to next oldest episode for oldest_first podcasts", () => {
  const episodes: Episode[] = [
    {
      id: "ep3",
      title: "Episode 3",
      pubDate: "2026-01-03T10:00:00Z",
      audioUrl: "https://example.com/ep3.mp3"
    },
    {
      id: "ep1",
      title: "Episode 1",
      pubDate: "2026-01-01T10:00:00Z",
      audioUrl: "https://example.com/ep1.mp3"
    },
    {
      id: "ep2",
      title: "Episode 2",
      pubDate: "2026-01-02T10:00:00Z",
      audioUrl: "https://example.com/ep2.mp3"
    }
  ];

  const current = episodes[1]; // ep1 (oldest)
  const isPlayed = (id: string) => id === "ep1";

  const next = findNextEpisodeToPlay(episodes, current, "oldest_first", isPlayed);
  assert.ok(next);
  assert.equal(next.id, "ep2");
});

test("findNextEpisodeToPlay skips already played episodes to pick the next oldest unplayed episode", () => {
  const episodes: Episode[] = [
    {
      id: "ep1",
      title: "Episode 1",
      pubDate: "2026-01-01T10:00:00Z",
      audioUrl: "https://example.com/ep1.mp3"
    },
    {
      id: "ep2",
      title: "Episode 2",
      pubDate: "2026-01-02T10:00:00Z",
      audioUrl: "https://example.com/ep2.mp3"
    },
    {
      id: "ep3",
      title: "Episode 3",
      pubDate: "2026-01-03T10:00:00Z",
      audioUrl: "https://example.com/ep3.mp3"
    }
  ];

  // ep1 just finished, ep2 was already played in the past
  const current = episodes[0]; // ep1
  const isPlayed = (id: string) => id === "ep1" || id === "ep2";

  const next = findNextEpisodeToPlay(episodes, current, "oldest_first", isPlayed);
  assert.ok(next);
  assert.equal(next.id, "ep3");
});

test("findNextEpisodeToPlay matches normalized IDs between URN and canonical format", () => {
  const episodes: Episode[] = [
    {
      id: "urn:bbc:podcast:w3ct998z",
      title: "Episode 1",
      pubDate: "2026-01-01T10:00:00Z",
      audioUrl: "https://example.com/ep1.mp3"
    },
    {
      id: "urn:bbc:podcast:w3ct999a",
      title: "Episode 2",
      pubDate: "2026-01-02T10:00:00Z",
      audioUrl: "https://example.com/ep2.mp3"
    }
  ];

  // currentEpisode has canonical/downloaded ID format "w3ct998z"
  const current: Episode = {
    id: "w3ct998z",
    title: "Episode 1",
    pubDate: "2026-01-01T10:00:00Z",
    audioUrl: "https://example.com/ep1.mp3"
  };

  const isPlayed = (id: string) => id === "w3ct998z" || id === "urn:bbc:podcast:w3ct998z";

  const next = findNextEpisodeToPlay(episodes, current, "oldest_first", isPlayed);
  assert.ok(next);
  assert.equal(next.id, "urn:bbc:podcast:w3ct999a");
});

test("findNextEpisodeToPlay returns undefined when all subsequent episodes are played", () => {
  const episodes: Episode[] = [
    {
      id: "ep1",
      title: "Episode 1",
      pubDate: "2026-01-01T10:00:00Z",
      audioUrl: "https://example.com/ep1.mp3"
    },
    {
      id: "ep2",
      title: "Episode 2",
      pubDate: "2026-01-02T10:00:00Z",
      audioUrl: "https://example.com/ep2.mp3"
    }
  ];

  // ep2 just finished and ep1 was already played
  const current = episodes[1]; // ep2 (latest)
  const isPlayed = () => true;

  const next = findNextEpisodeToPlay(episodes, current, "oldest_first", isPlayed);
  assert.equal(next, undefined);
});

test("findNextEpisodeToPlay falls back to publication date matching if current episode ID is missing from list", () => {
  const episodes: Episode[] = [
    {
      id: "remote_ep1",
      title: "Episode 1",
      pubDate: "2026-01-01T10:00:00Z",
      audioUrl: "https://example.com/ep1.mp3"
    },
    {
      id: "remote_ep2",
      title: "Episode 2",
      pubDate: "2026-01-05T10:00:00Z",
      audioUrl: "https://example.com/ep2.mp3"
    }
  ];

  // currentEpisode is from a local file with a generated ID, but known pubDate
  const current: Episode = {
    id: "local_custom_id",
    title: "Episode 1 Different Title",
    pubDate: "2026-01-01T10:00:00Z",
    audioUrl: "https://example.com/local.mp3"
  };

  const isPlayed = (id: string) => id === "local_custom_id" || id === "remote_ep1";

  const next = findNextEpisodeToPlay(episodes, current, "oldest_first", isPlayed);
  assert.ok(next);
  assert.equal(next.id, "remote_ep2");
});

test("findNextEpisodeToPlay supports newest_first order advancing to next unplayed episode", () => {
  const episodes: Episode[] = [
    {
      id: "ep3",
      title: "Episode 3",
      pubDate: "2026-01-03T10:00:00Z",
      audioUrl: "https://example.com/ep3.mp3"
    },
    {
      id: "ep2",
      title: "Episode 2",
      pubDate: "2026-01-02T10:00:00Z",
      audioUrl: "https://example.com/ep2.mp3"
    },
    {
      id: "ep1",
      title: "Episode 1",
      pubDate: "2026-01-01T10:00:00Z",
      audioUrl: "https://example.com/ep1.mp3"
    }
  ];

  const current = episodes[0]; // ep3 (newest)
  const isPlayed = (id: string) => id === "ep3";

  const next = findNextEpisodeToPlay(episodes, current, "newest_first", isPlayed);
  assert.ok(next);
  assert.equal(next.id, "ep2");
});
