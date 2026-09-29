import test from "node:test";
import assert from "node:assert/strict";
import { isTopLevelTabRoute } from "../src/navigation/tabBarVisibility.ts";

test("the four top-level tabs keep the main navigation", () => {
  assert.equal(isTopLevelTabRoute(["(tabs)", "favourites"]), true);
  assert.equal(isTopLevelTabRoute(["(tabs)", "index"]), true);
  assert.equal(isTopLevelTabRoute(["(tabs)", "podcasts"]), true);
  assert.equal(isTopLevelTabRoute(["(tabs)", "settings"]), true);
  // An index route drops its trailing "index" segment.
  assert.equal(isTopLevelTabRoute(["(tabs)"]), true);
});

test("drill-down modals hide the main navigation", () => {
  assert.equal(isTopLevelTabRoute(["modal", "podcast-detail"]), false);
  assert.equal(isTopLevelTabRoute(["modal", "episode-detail"]), false);
  assert.equal(isTopLevelTabRoute(["modal", "playlist-detail"]), false);
  assert.equal(isTopLevelTabRoute(["modal", "podcast-search"]), false);
  assert.equal(isTopLevelTabRoute(["modal", "schedule"]), false);
  assert.equal(isTopLevelTabRoute(["modal", "now-playing"]), false);
  assert.equal(isTopLevelTabRoute(["modal", "settings-detail"]), false);
  assert.equal(isTopLevelTabRoute(["lastfm-auth"]), false);
});

test("an unresolved route hides the main navigation rather than flashing it", () => {
  assert.equal(isTopLevelTabRoute([]), false);
});
