import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveAppNavigation,
  buildPodcastDetailUrl,
  buildPodcastSearchUrl
} from "../src/utils/navigationUtils.ts";

test("resolveAppNavigation handles custom scheme podcast detail deep links", () => {
  const target = resolveAppNavigation("bbcradioplayer://modal/podcast-detail?podcastId=p086w16s");
  assert.ok(target);
  assert.equal(target.pathname, "/modal/podcast-detail");
  assert.equal(target.params.podcastId, "p086w16s");
});

test("resolveAppNavigation handles custom scheme triple-slash podcast detail links", () => {
  const target = resolveAppNavigation("bbcradioplayer:///modal/podcast-detail?podcastId=p086w16s");
  assert.ok(target);
  assert.equal(target.pathname, "/modal/podcast-detail");
  assert.equal(target.params.podcastId, "p086w16s");
});

test("resolveAppNavigation handles custom scheme saved search links", () => {
  const target = resolveAppNavigation(
    "bbcradioplayer://podcasts?search=The%20Archers&savedSearchId=search-123"
  );
  assert.ok(target);
  assert.equal(target.pathname, "/modal/podcast-search");
  assert.equal(target.params.search, "The Archers");
  assert.equal(target.params.savedSearchId, "search-123");
});

test("resolveAppNavigation handles relative URLs directly", () => {
  const podcastTarget = resolveAppNavigation("/modal/podcast-detail?podcastId=p02nrss1");
  assert.ok(podcastTarget);
  assert.equal(podcastTarget.pathname, "/modal/podcast-detail");
  assert.equal(podcastTarget.params.podcastId, "p02nrss1");

  const searchTarget = resolveAppNavigation("/podcasts?search=comedy&savedSearchId=fav-1");
  assert.ok(searchTarget);
  assert.equal(searchTarget.pathname, "/modal/podcast-search");
  assert.equal(searchTarget.params.search, "comedy");
  assert.equal(searchTarget.params.savedSearchId, "fav-1");

  const directSearchTarget = resolveAppNavigation("/modal/podcast-search?search=news");
  assert.ok(directSearchTarget);
  assert.equal(directSearchTarget.pathname, "/modal/podcast-search");
  assert.equal(directSearchTarget.params.search, "news");
});

test("resolveAppNavigation handles Last.fm auth links", () => {
  const target = resolveAppNavigation("bbcradioplayer://lastfm-auth?token=auth-tok-123");
  assert.ok(target);
  assert.equal(target.pathname, "/lastfm-auth");
  assert.equal(target.params.token, "auth-tok-123");
});

test("resolveAppNavigation handles widget action links", () => {
  const playTarget = resolveAppNavigation("bbcradioplayer://widget/play?station=radio1");
  assert.ok(playTarget);
  assert.equal(playTarget.pathname, "/(tabs)");
  assert.equal(playTarget.params.station, "radio1");

  const stopTarget = resolveAppNavigation("bbcradioplayer://widget/stop?station=radio2");
  assert.ok(stopTarget);
  assert.equal(stopTarget.pathname, "/(tabs)");
  assert.equal(stopTarget.params.station, "radio2");
});

test("resolveAppNavigation handles new podcast episode notification URL", () => {
  const target = resolveAppNavigation("/modal/podcast-detail?podcastId=p086w16s&episodeId=p086w200");
  assert.ok(target);
  assert.equal(target.pathname, "/modal/podcast-detail");
  assert.equal(target.params.podcastId, "p086w16s");
  assert.equal(target.params.episodeId, "p086w200");
});

test("resolveAppNavigation handles empty or invalid URLs safely", () => {
  assert.equal(resolveAppNavigation(""), null);
  assert.equal(resolveAppNavigation("   "), null);
  // @ts-expect-error test non-string
  assert.equal(resolveAppNavigation(null), null);
});

test("buildPodcastDetailUrl targets a podcast and optionally the notified episode", () => {
  assert.equal(
    buildPodcastDetailUrl("p086w16s"),
    "/modal/podcast-detail?podcastId=p086w16s"
  );

  const withEpisode = buildPodcastDetailUrl("p086w16s", "p086w200");
  const target = resolveAppNavigation(withEpisode);
  assert.ok(target);
  assert.equal(target.pathname, "/modal/podcast-detail");
  assert.equal(target.params.podcastId, "p086w16s");
  assert.equal(target.params.episodeId, "p086w200");
});

test("buildPodcastDetailUrl encodes ids that contain URL-significant characters", () => {
  const target = resolveAppNavigation(buildPodcastDetailUrl("pod cast&1", "ep/2?3"));
  assert.ok(target);
  assert.equal(target.params.podcastId, "pod cast&1");
  assert.equal(target.params.episodeId, "ep/2?3");
});

test("buildPodcastSearchUrl targets a saved search result", () => {
  const target = resolveAppNavigation(
    buildPodcastSearchUrl("The Archers & Friends", "saved search/1")
  );
  assert.ok(target);
  assert.equal(target.pathname, "/modal/podcast-search");
  assert.equal(target.params.search, "The Archers & Friends");
  assert.equal(target.params.savedSearchId, "saved search/1");

  const withoutSavedId = resolveAppNavigation(buildPodcastSearchUrl("comedy"));
  assert.ok(withoutSavedId);
  assert.equal(withoutSavedId.params.search, "comedy");
  assert.equal(withoutSavedId.params.savedSearchId, undefined);
});

test("saved search notification URL keeps the episode and podcast that triggered it", () => {
  const target = resolveAppNavigation(
    buildPodcastSearchUrl("news", "search-1", {
      episodeId: "p01xyz",
      podcastId: "p02abc"
    })
  );
  assert.ok(target);
  assert.equal(target.pathname, "/modal/podcast-search");
  assert.equal(target.params.search, "news");
  assert.equal(target.params.savedSearchId, "search-1");
  assert.equal(target.params.episodeId, "p01xyz");
  assert.equal(target.params.podcastId, "p02abc");
});
