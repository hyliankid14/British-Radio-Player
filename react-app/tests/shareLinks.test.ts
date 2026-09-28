import test from "node:test";
import assert from "node:assert/strict";
import {
  WEB_PLAYER_BASE_URL,
  buildEpisodeShareMessage,
  buildEpisodeShareUrl,
  buildPodcastShareMessage,
  buildPodcastShareUrl,
  normalizeBbcAudioUrl,
  stripHtml,
  summarizeText,
  type ShareableEpisode,
  type ShareablePodcast
} from "../src/utils/shareLinks.ts";

/** Mirrors how docs/index.html reads a shared link out of the location hash. */
function parseWebPlayerUrl(url: string): { route: string; params: Record<string, string> } {
  assert.ok(url.startsWith(`${WEB_PLAYER_BASE_URL}/#/`), `unexpected base: ${url}`);
  const [route, query = ""] = url.slice(url.indexOf("#") + 1).split("?");
  const params: Record<string, string> = {};
  new URLSearchParams(query).forEach((value, key) => {
    params[key] = value;
  });
  return { route, params };
}

const podcast: ShareablePodcast = {
  id: "p00tgwjb",
  title: "The Archers",
  description: "The world's longest-running soap opera.",
  imageUrl: "https://ichef.bbci.co.uk/images/ic/640x640/p00tgwjb.jpg",
  rssUrl: "https://podcasts.files.bbci.co.uk/p00tgwjb.rss"
};

const episode: ShareableEpisode = {
  id: "p00tgwjb1",
  title: "Drama at the fold",
  description: "Jill catches Rob in a lie.",
  imageUrl: "https://ichef.bbci.co.uk/images/ic/640x640/p00tgwjb1.jpg",
  audioUrl: "https://podcasts.files.bbci.co.uk/p00tgwjb1.mp3",
  pubDate: "Mon, 01 Sep 2025 00:00:00 GMT",
  durationMins: 43,
  podcastId: "p00tgwjb"
};

test("podcast share links point at the web player, not the BBC page", () => {
  const url = buildPodcastShareUrl(podcast, "A daily dose of rural drama.");

  assert.ok(!url.includes("bbc.co.uk/programmes"));
  const { route, params } = parseWebPlayerUrl(url);
  assert.equal(route, "/p/p00tgwjb");
  assert.equal(params.title, "The Archers");
  assert.equal(params.desc, "A daily dose of rural drama.");
  assert.equal(params.img, podcast.imageUrl);
  assert.equal(params.rss, podcast.rssUrl);
});

test("podcast share links fall back to a bare route when metadata is missing", () => {
  const url = buildPodcastShareUrl({
    id: "p02nrss1",
    title: "",
    description: "",
    imageUrl: "",
    rssUrl: ""
  });

  assert.equal(url, `${WEB_PLAYER_BASE_URL}/#/p/p02nrss1`);
});

test("episode share links use the podcastId/episodeId web player route", () => {
  const url = buildEpisodeShareUrl(episode, "The Archers", "Jill catches Rob in a lie.");
  const { route, params } = parseWebPlayerUrl(url);

  assert.equal(route, "/e/p00tgwjb/p00tgwjb1");
  assert.equal(params.title, "Drama at the fold");
  assert.equal(params.podcast, "The Archers");
  assert.equal(params.podcastId, "p00tgwjb");
  assert.equal(params.audio, episode.audioUrl);
  assert.equal(params.date, episode.pubDate);
  assert.equal(params.duration, "43");
});

test("share link parameters survive the round trip through the web player", () => {
  const awkward: ShareablePodcast = {
    id: "p01x",
    title: "100% Pure & Fresh #1",
    description: "Salt & pepper, R&D, 50/50.",
    imageUrl: "",
    rssUrl: "https://podcasts.files.bbci.co.uk/p01x.rss"
  };

  const { params } = parseWebPlayerUrl(buildPodcastShareUrl(awkward, "Salt & pepper, R&D, 50/50."));
  assert.equal(params.title, "100% Pure & Fresh #1");
  assert.equal(params.desc, "Salt & pepper, R&D, 50/50.");
});

test("ids containing URL-significant characters are encoded", () => {
  const url = buildPodcastShareUrl({ ...podcast, id: "pod cast&1" }, "");
  assert.ok(url.includes("/#/p/pod%20cast%261"));
  assert.equal(parseWebPlayerUrl(url).route, "/p/pod%20cast%261");
});

test("broken BBC media-selector paths are repaired before they are shared", () => {
  // /mediaselector/b6/ 404s; only /6/ resolves, and http:// is blocked as
  // mixed content on the https web player.
  assert.equal(
    normalizeBbcAudioUrl(
      "https://open.live.bbc.co.uk/mediaselector/b6/redir/version/2.0/mediaset/audio-nondrm-download-rss-low/proto/https/vpid/p0pcjgh9.mp3"
    ),
    "https://open.live.bbc.co.uk/mediaselector/6/redir/version/2.0/mediaset/audio-nondrm-download-rss-low/proto/https/vpid/p0pcjgh9.mp3"
  );

  assert.equal(
    normalizeBbcAudioUrl(
      "http://open.live.bbc.co.uk/mediaselector/6/redir/version/2.0/mediaset/audio-nondrm-download-rss-low/proto/http/vpid/p0pcjgh9.mp3"
    ),
    "https://open.live.bbc.co.uk/mediaselector/6/redir/version/2.0/mediaset/audio-nondrm-download-rss-low/proto/https/vpid/p0pcjgh9.mp3"
  );

  assert.equal(normalizeBbcAudioUrl(""), "");
  assert.equal(normalizeBbcAudioUrl("https://example.com/a.mp3"), "https://example.com/a.mp3");
});

test("episode share links carry a playable audio URL", () => {
  const { params } = parseWebPlayerUrl(
    buildEpisodeShareUrl(
      { ...episode, audioUrl: "http://open.live.bbc.co.uk/mediaselector/b6/redir/vpid/p0pcjgh9.mp3" },
      "The Documentary Podcast"
    )
  );

  assert.equal(params.audio, "https://open.live.bbc.co.uk/mediaselector/6/redir/vpid/p0pcjgh9.mp3");
});

test("share messages name the content and carry the link", () => {
  const message = buildPodcastShareMessage("The Archers", "Rural drama.", "https://is.gd/x");

  assert.ok(message.startsWith('Check out "The Archers" - Rural drama.'));
  assert.ok(message.includes("https://is.gd/x"));
  assert.ok(message.includes("British Radio Player app installed"));

  const noSummary = buildPodcastShareMessage("The Archers", "", "https://is.gd/x");
  assert.ok(noSummary.startsWith('Check out "The Archers"\n'));

  const episodeMessage = buildEpisodeShareMessage(
    "Drama at the fold",
    "The Archers",
    "Jill catches Rob.",
    "https://is.gd/y"
  );
  assert.ok(episodeMessage.startsWith('Listen to "Drama at the fold" from The Archers - Jill catches Rob.'));
  assert.ok(episodeMessage.includes("https://is.gd/y"));
});

test("summarizeText strips markup and returns an empty string for blank feeds", () => {
  assert.equal(stripHtml("<p>Hello &amp; goodbye</p>"), "Hello & goodbye");
  assert.equal(summarizeText(""), "");
  assert.equal(summarizeText("   "), "");
  assert.equal(summarizeText("<p></p>"), "");
});

test("summarizeText keeps paragraph boundaries as sentence boundaries", () => {
  const summary = summarizeText(
    "<p>The global news podcast from the BBC World Service.</p>" +
      "<p>News and analysis, interviews and debate.</p>" +
      "<p>Presented by the BBC's international team of correspondents.</p>"
  );

  assert.ok(!summary.includes("Service.News"), `sentences were welded together: ${summary}`);
  assert.ok(!summary.includes("<"), "must not leak markup");
  assert.ok(summary.includes(". "), `expected a spaced sentence separator: ${summary}`);
});

test("summarizeText keeps at most two sentences and ends with full stops", () => {
  const summary = summarizeText(
    "Welcome to the show where the Archers discuss their week. " +
      "Pip has news about her garden. Eddie is planning another prank. " +
      "Jill and Rob argue about the new shop."
  );

  assert.ok(summary.length > 0);
  assert.ok(summary.endsWith("."));
  assert.ok(!summary.includes("</"), "must not leak markup");
  const sentences = summary.replace(/\.$/, "").split(". ");
  assert.ok(sentences.length <= 2, `expected at most 2 sentences, got: ${summary}`);
});

test("summarizeText handles feeds with no sentence punctuation", () => {
  const summary = summarizeText(
    "A long running story about the village of Ambridge, told by the residents themselves"
  );
  assert.ok(summary.length > 0);
});
