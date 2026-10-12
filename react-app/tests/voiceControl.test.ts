import test from "node:test";
import assert from "node:assert/strict";

import {
  parseVoiceActionUrl,
  matchStationForVoiceQuery,
  matchPodcastForVoiceQuery,
  selectEpisodeForVoicePlayback
} from "../src/voice/voiceControl.ts";
import { StationRepository } from "../src/data/stations.ts";
import type { Episode, Podcast } from "../src/api/podcasts.ts";

test("parseVoiceActionUrl parses valid station and podcast URLs", () => {
  assert.deepEqual(parseVoiceActionUrl("bbcradioplayer://voice/play?station=radio1"), {
    action: "play",
    stationId: "radio1",
    podcastId: null,
    episodeId: null,
    query: null,
    random: false
  });

  assert.deepEqual(parseVoiceActionUrl("bbcradioplayer://voice/play?podcast=p086w16s"), {
    action: "play",
    stationId: null,
    podcastId: "p086w16s",
    episodeId: null,
    query: null,
    random: false
  });

  assert.deepEqual(
    parseVoiceActionUrl("bbcradioplayer://voice/play?podcast=p086w16s&episode=p086w200"),
    {
      action: "play",
      stationId: null,
      podcastId: "p086w16s",
      episodeId: "p086w200",
      query: null,
      random: false
    }
  );
});

test("parseVoiceActionUrl parses voice queries, random flags, and playback controls", () => {
  assert.deepEqual(
    parseVoiceActionUrl("bbcradioplayer://voice/play?query=Desert%20Island%20Discs"),
    {
      action: "play",
      stationId: null,
      podcastId: null,
      episodeId: null,
      query: "Desert Island Discs",
      random: false
    }
  );

  assert.deepEqual(parseVoiceActionUrl("bbcradioplayer://voice/play?random=true"), {
    action: "play",
    stationId: null,
    podcastId: null,
    episodeId: null,
    query: null,
    random: true
  });

  assert.deepEqual(parseVoiceActionUrl("bbcradioplayer://voice/play?random=1"), {
    action: "play",
    stationId: null,
    podcastId: null,
    episodeId: null,
    query: null,
    random: true
  });

  assert.deepEqual(parseVoiceActionUrl("bbcradioplayer://voice/play?resume=true"), {
    action: "resume",
    stationId: null,
    podcastId: null,
    episodeId: null,
    query: null,
    random: false
  });

  assert.deepEqual(parseVoiceActionUrl("bbcradioplayer://voice/resume"), {
    action: "resume",
    stationId: null,
    podcastId: null,
    episodeId: null,
    query: null,
    random: false
  });

  assert.deepEqual(parseVoiceActionUrl("bbcradioplayer://voice/stop"), {
    action: "stop",
    stationId: null,
    podcastId: null,
    episodeId: null,
    query: null,
    random: false
  });
});

test("parseVoiceActionUrl rejects non-voice or malformed URLs", () => {
  assert.equal(parseVoiceActionUrl(null), null);
  assert.equal(parseVoiceActionUrl(undefined), null);
  assert.equal(parseVoiceActionUrl(""), null);
  assert.equal(parseVoiceActionUrl("https://example.com/voice/play"), null);
  assert.equal(parseVoiceActionUrl("bbcradioplayer://widget/play?station=radio1"), null);
  assert.equal(parseVoiceActionUrl("bbcradioplayer://voice/invalidaction"), null);
});

test("matchStationForVoiceQuery accurately identifies stations by spoken titles, numbers, and aliases", () => {
  const allStations = StationRepository.getAll();

  const r1 = matchStationForVoiceQuery("Radio 1", allStations);
  assert.ok(r1);
  assert.equal(r1.id, "radio1");

  const r1SpokenWord = matchStationForVoiceQuery("Radio One", allStations);
  assert.ok(r1SpokenWord);
  assert.equal(r1SpokenWord.id, "radio1");

  const r2 = matchStationForVoiceQuery("BBC Radio 2", allStations);
  assert.ok(r2);
  assert.equal(r2.id, "radio2");

  const r4 = matchStationForVoiceQuery("radio 4", allStations);
  assert.ok(r4);
  assert.equal(r4.id, "radio4");

  const r4Extra = matchStationForVoiceQuery("Radio 4 Extra", allStations);
  assert.ok(r4Extra);
  assert.equal(r4Extra.id, "radio4extra");

  const r6 = matchStationForVoiceQuery("6 Music", allStations);
  assert.ok(r6);
  assert.equal(r6.id, "radio6");

  const r6Spoken = matchStationForVoiceQuery("Radio Six Music", allStations);
  assert.ok(r6Spoken);
  assert.equal(r6Spoken.id, "radio6");

  const wales = matchStationForVoiceQuery("Radio Wales", allStations);
  assert.ok(wales);
  assert.equal(wales.id, "radiowales");

  const scotland = matchStationForVoiceQuery("BBC Radio Scotland", allStations);
  assert.ok(scotland);
  assert.equal(scotland.id, "radioscotland");

  const unmatched = matchStationForVoiceQuery("Completely Unrelated Query 12345", allStations);
  assert.equal(unmatched, null);
});

test("matchPodcastForVoiceQuery matches podcasts by title and description", () => {
  const samplePodcasts: Podcast[] = [
    {
      id: "p02nq0gn",
      title: "The Archers",
      description: "Contemporary drama in a rural setting.",
      rssUrl: "https://podcasts.files.bbci.co.uk/p02nq0gn.rss",
      htmlUrl: "",
      imageUrl: "",
      genres: ["Drama"],
      typicalDurationMins: 13
    },
    {
      id: "p002vsxs",
      title: "Desert Island Discs",
      description: "Eight tracks, a book and a luxury: what would you take to a desert island?",
      rssUrl: "https://podcasts.files.bbci.co.uk/p002vsxs.rss",
      htmlUrl: "",
      imageUrl: "",
      genres: ["Interview"],
      typicalDurationMins: 45
    },
    {
      id: "p004y29g",
      title: "In Our Time",
      description: "Melvyn Bragg and guests discuss the history of ideas.",
      rssUrl: "https://podcasts.files.bbci.co.uk/p004y29g.rss",
      htmlUrl: "",
      imageUrl: "",
      genres: ["History"],
      typicalDurationMins: 45
    }
  ];

  const archers = matchPodcastForVoiceQuery("The Archers", samplePodcasts);
  assert.ok(archers);
  assert.equal(archers.id, "p02nq0gn");

  const did = matchPodcastForVoiceQuery("desert island discs", samplePodcasts);
  assert.ok(did);
  assert.equal(did.id, "p002vsxs");

  const inOurTime = matchPodcastForVoiceQuery("in our time", samplePodcasts);
  assert.ok(inOurTime);
  assert.equal(inOurTime.id, "p004y29g");

  // Description match
  const melvyn = matchPodcastForVoiceQuery("Melvyn Bragg", samplePodcasts);
  assert.ok(melvyn);
  assert.equal(melvyn.id, "p004y29g");

  const unmatched = matchPodcastForVoiceQuery("Unrelated Podcast", samplePodcasts);
  assert.equal(unmatched, null);
});

test("selectEpisodeForVoicePlayback skips played episodes and falls back to first", () => {
  const episodes: Episode[] = [
    {
      id: "ep-1",
      title: "Episode 1",
      description: "",
      audioUrl: "https://audio.com/1.mp3",
      imageUrl: "",
      pubDate: "",
      durationMins: 30,
      podcastId: "p1"
    },
    {
      id: "ep-2",
      title: "Episode 2",
      description: "",
      audioUrl: "https://audio.com/2.mp3",
      imageUrl: "",
      pubDate: "",
      durationMins: 30,
      podcastId: "p1"
    },
    {
      id: "ep-3",
      title: "Episode 3",
      description: "",
      audioUrl: "https://audio.com/3.mp3",
      imageUrl: "",
      pubDate: "",
      durationMins: 30,
      podcastId: "p1"
    }
  ];

  // When no episodes are played, returns the first (ep-1)
  const firstChoice = selectEpisodeForVoicePlayback(episodes, () => false);
  assert.equal(firstChoice?.id, "ep-1");

  // When ep-1 is played, returns ep-2
  const playedSet = new Set(["ep-1"]);
  const secondChoice = selectEpisodeForVoicePlayback(episodes, (id) => playedSet.has(id));
  assert.equal(secondChoice?.id, "ep-2");

  // When ep-1 and ep-2 are played, returns ep-3
  playedSet.add("ep-2");
  const thirdChoice = selectEpisodeForVoicePlayback(episodes, (id) => playedSet.has(id));
  assert.equal(thirdChoice?.id, "ep-3");

  // When all episodes are played, falls back to the first episode (ep-1)
  playedSet.add("ep-3");
  const fallbackChoice = selectEpisodeForVoicePlayback(episodes, (id) => playedSet.has(id));
  assert.equal(fallbackChoice?.id, "ep-1");

  // Empty list returns null
  assert.equal(selectEpisodeForVoicePlayback([], () => false), null);
});
