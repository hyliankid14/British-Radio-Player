import test from "node:test";
import assert from "node:assert/strict";
import { resolveAppNavigation } from "../src/utils/navigationUtils.ts";

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

test("resolveAppNavigation handles empty or invalid URLs safely", () => {
  assert.equal(resolveAppNavigation(""), null);
  assert.equal(resolveAppNavigation("   "), null);
  // @ts-expect-error test non-string
  assert.equal(resolveAppNavigation(null), null);
});
