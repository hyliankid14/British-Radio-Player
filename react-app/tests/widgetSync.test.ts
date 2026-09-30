import test from "node:test";
import assert from "node:assert/strict";

import {
  buildWidgetCatalogueJson,
  formatWidgetShowLine,
  isSameWidgetState,
  parseWidgetAction,
  parseWidgetActionUrl,
  resolveWidgetArtwork,
  resolveWidgetLiveState
} from "../src/widgets/widgetSync.ts";
import { StationRepository } from "../src/data/stations.ts";

// Placeholder detection as the app does it: BBC station logos must never become widget art.
const neverPlaceholder = () => false;
const alwaysPlaceholder = () => true;

test("Widget show line prefers the song, then the episode, then the programme", () => {
  assert.equal(formatWidgetShowLine({ artist: "Pink Floyd", track: "Time" }), "Pink Floyd - Time");
  assert.equal(formatWidgetShowLine({ track: "Time" }), "Time");
  assert.equal(formatWidgetShowLine({ artist: "Pink Floyd" }), "Pink Floyd");
  assert.equal(formatWidgetShowLine({ title: "The News", episodeTitle: "12 June" }), "12 June");
  assert.equal(formatWidgetShowLine({ title: "The News" }), "The News");
});

test("Widget show line drops the generic BBC Radio placeholder and empty shows", () => {
  assert.equal(formatWidgetShowLine({ title: "BBC Radio" }), "");
  assert.equal(formatWidgetShowLine({ title: "bbc radio", episodeTitle: "Today" }), "Today");
  assert.equal(formatWidgetShowLine({}), "");
  assert.equal(formatWidgetShowLine(null), "");
  assert.equal(formatWidgetShowLine(undefined), "");
});

test("Widget artwork prefers song art and rejects BBC station logos", () => {
  const show = { songImageUrl: "https://example.com/song.jpg", imageUrl: "https://example.com/logo.png" };
  assert.equal(resolveWidgetArtwork(show, undefined, neverPlaceholder), "https://example.com/song.jpg");

  // The station logo is the placeholder, so it is rejected and the next candidate is used.
  const logo = "https://sounds.files.bbci.co.uk/3.11.1/services/radio1/blocks-colour-black_600x600.png";
  assert.equal(resolveWidgetArtwork({ imageUrl: logo }, logo, (url) => url === logo), "");
  assert.equal(resolveWidgetArtwork(undefined, undefined, alwaysPlaceholder), "");
});

test("Widget live state is empty unless a station is loaded", () => {
  const state = resolveWidgetLiveState({
    stationId: null,
    isPlaying: true,
    show: { title: "The News" },
    isPlaceholderArtwork: neverPlaceholder
  });
  assert.deepEqual(state, { stationId: "", stationTitle: "", showLine: "", isPlaying: false, artworkUrl: "" });
});

test("Widget live state carries the show only while that station is playing", () => {
  const playing = resolveWidgetLiveState({
    stationId: "radio1",
    stationTitle: "Radio 1",
    show: { artist: "Pink Floyd", track: "Time", songImageUrl: "https://example.com/a.jpg" },
    isPlaying: true,
    isPlaceholderArtwork: neverPlaceholder
  });
  assert.equal(playing.showLine, "Pink Floyd - Time");
  assert.equal(playing.artworkUrl, "https://example.com/a.jpg");
  assert.equal(playing.isPlaying, true);

  // Paused, the widget must not claim a song is on: the artwork and the line both go.
  const paused = resolveWidgetLiveState({
    stationId: "radio1",
    stationTitle: "Radio 1",
    show: { artist: "Pink Floyd", track: "Time", songImageUrl: "https://example.com/a.jpg" },
    isPlaying: false,
    isPlaceholderArtwork: neverPlaceholder
  });
  assert.equal(paused.showLine, "");
  assert.equal(paused.artworkUrl, "");
  assert.equal(paused.isPlaying, false);
});

test("Repeated pushes are recognised as identical so a redraw can be skipped", () => {
  const state = resolveWidgetLiveState({
    stationId: "radio1",
    stationTitle: "Radio 1",
    show: { artist: "Pink Floyd", track: "Time" },
    isPlaying: true,
    isPlaceholderArtwork: neverPlaceholder
  });
  assert.equal(isSameWidgetState(state, { ...state }), true);
  assert.equal(isSameWidgetState(state, { ...state, isPlaying: false }), false);
  assert.equal(isSameWidgetState(state, { ...state, showLine: "Something else" }), false);
  assert.equal(isSameWidgetState(state, { ...state, artworkUrl: "https://example.com/a.jpg" }), false);
});

test("Widget catalogue carries only what the native pickers need", () => {
  const parsed = JSON.parse(buildWidgetCatalogueJson(StationRepository.getAll()));
  assert.ok(parsed.stations.length > 0);
  assert.equal(parsed.stations.length, StationRepository.getAll().length);
  for (const station of parsed.stations) {
    assert.deepEqual(Object.keys(station).sort(), ["category", "id", "title"]);
  }
  assert.ok(parsed.stations.some((station: { id: string }) => station.id === "radio1"));
});

test("Queued widget taps parse only into known actions", () => {
  assert.deepEqual(parseWidgetAction('{"action":"play","stationId":"radio4"}'), {
    action: "play",
    stationId: "radio4"
  });
  assert.deepEqual(parseWidgetAction('{"action":"stop","stationId":null}'), {
    action: "stop",
    stationId: null
  });
  assert.equal(parseWidgetAction('{"action":"skip"}'), null);
  assert.equal(parseWidgetAction("not json"), null);
  assert.equal(parseWidgetAction(""), null);
  assert.equal(parseWidgetAction(null), null);
});

test("iOS widget links become actions, and other deep links are left alone", () => {
  assert.deepEqual(parseWidgetActionUrl("bbcradioplayer://widget/play?station=radio6"), {
    action: "play",
    stationId: "radio6"
  });
  assert.deepEqual(parseWidgetActionUrl("bbcradioplayer://widget/stop?station=radio6"), {
    action: "stop",
    stationId: "radio6"
  });
  assert.equal(parseWidgetActionUrl("bbcradioplayer://modal/podcast-detail"), null);
  assert.equal(parseWidgetActionUrl("https://example.com/widget/play"), null);
  assert.equal(parseWidgetActionUrl(null), null);
});
