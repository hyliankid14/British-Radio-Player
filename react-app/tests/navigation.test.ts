import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import {
  resolveAppNavigation,
  buildPodcastDetailUrl,
  buildPodcastSearchUrl,
  buildLibraryUrl,
  isKnownAppRoute,
  KNOWN_APP_ROUTES
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

test("resolveAppNavigation handles media playback notification click URLs", () => {
  const tpTarget = resolveAppNavigation("trackplayer://notification.click");
  assert.ok(tpTarget);
  assert.equal(tpTarget.pathname, "/modal/now-playing");

  const bbcTarget = resolveAppNavigation("bbcradioplayer://notification.click");
  assert.ok(bbcTarget);
  assert.equal(bbcTarget.pathname, "/modal/now-playing");

  const relativeTarget = resolveAppNavigation("/notification.click");
  assert.ok(relativeTarget);
  assert.equal(relativeTarget.pathname, "/modal/now-playing");
});

test("resolveAppNavigation handles empty or invalid URLs safely", () => {
  assert.equal(resolveAppNavigation(""), null);
  assert.equal(resolveAppNavigation("   "), null);
  // @ts-expect-error test non-string
  assert.equal(resolveAppNavigation(null), null);
});

test("resolveAppNavigation rejects links that name no screen", () => {
  // "/downloads" was the download notifications' target and matched no route, so tapping
  // one rendered expo-router's "Unmatched Route" screen instead of the library.
  assert.equal(resolveAppNavigation("/downloads"), null);
  assert.equal(resolveAppNavigation("bbcradioplayer:///downloads"), null);
  assert.equal(resolveAppNavigation("/modal/podcasts"), null);
  assert.equal(isKnownAppRoute("/downloads"), false);
  assert.equal(isKnownAppRoute("/modal/podcast-detail"), true);
});

test("redirectSystemPath falls back to the tabs instead of the unmatched route screen", async () => {
  const { redirectSystemPath } = await import("../app/+native-intent.ts");

  assert.equal(redirectSystemPath({ path: "/downloads", initial: true }), "/(tabs)");
  assert.equal(
    redirectSystemPath({ path: "bbcradioplayer:///downloads", initial: false }),
    "/(tabs)"
  );
  assert.equal(
    redirectSystemPath({ path: "bbcradioplayer://downloads", initial: true }),
    "/(tabs)"
  );
});

test("buildLibraryUrl targets the library screen a download notice should open", () => {
  const target = resolveAppNavigation(buildLibraryUrl());
  assert.ok(target);
  assert.equal(target.pathname, "/(tabs)/library");
});

test("KNOWN_APP_ROUTES covers every screen in app/", () => {
  const appRoot = join(import.meta.dirname, "..", "app");
  const missing: string[] = [];

  const walk = (dir: string, prefix: string) => {
    const entries = readdirSync(dir, { withFileTypes: true });
    // Without a layout, expo-router hoists the directory's screens to the nearest layout
    // above it, so `index` only collapses onto the directory path when one is present.
    const hasLayout = entries.some(
      (e) => e.isFile() && e.name.startsWith("_layout")
    );
    for (const entry of entries) {
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), `${prefix}/${entry.name}`);
        continue;
      }
      // `+native-intent`/`+html`/API files are not routes, and `_layout` has no pathname.
      if (entry.name.startsWith("+") || entry.name.startsWith("_")) continue;
      const name = entry.name.replace(/\.(t|j)sx?$/, "");
      if (name.endsWith(".d")) continue;
      const route = name === "index" && hasLayout ? prefix || "/" : `${prefix}/${name}`;
      if (!KNOWN_APP_ROUTES.includes(route)) missing.push(route);
    }
  };

  walk(appRoot, "");
  assert.deepEqual(missing, [], `Add these to KNOWN_APP_ROUTES: ${missing.join(", ")}`);
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

test("now playing navigation fallback returns to main tabs when no history exists", () => {
  let wentBack = false;
  let replacedWith: string | null = null;

  const mockRouter = {
    canGoBack: () => false,
    back: () => {
      wentBack = true;
    },
    replace: (route: string) => {
      replacedWith = route;
    }
  };

  const navigateBack = (router: typeof mockRouter) => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)");
    }
  };

  // When canGoBack is false (cold launch from notification), replace with /(tabs)
  navigateBack(mockRouter);
  assert.equal(wentBack, false);
  assert.equal(replacedWith, "/(tabs)");

  // When canGoBack is true (opened from within app), call router.back()
  wentBack = false;
  replacedWith = null;
  const mockRouterWithHistory = {
    ...mockRouter,
    canGoBack: () => true
  };
  navigateBack(mockRouterWithHistory);
  assert.equal(wentBack, true);
  assert.equal(replacedWith, null);
});

test("prepare launch navigation sets up root tabs for now playing modal", () => {
  const preparedRoutes: any[] = [];
  const mockRouter = {
    navigate: (route: any) => {
      preparedRoutes.push(route);
    }
  };

  const LAUNCH_PODCAST_SCREENS = ["/modal/podcast-detail", "/modal/podcast-search"];
  const prepare = (target: { pathname: string }) => {
    if (LAUNCH_PODCAST_SCREENS.includes(target.pathname)) {
      mockRouter.navigate({ pathname: "/(tabs)/favourites", params: { category: "Subscribed" } });
    } else if (target.pathname === "/modal/now-playing") {
      mockRouter.navigate("/(tabs)");
    }
  };

  prepare({ pathname: "/modal/now-playing" });
  assert.deepEqual(preparedRoutes, ["/(tabs)"]);

  prepare({ pathname: "/modal/podcast-detail" });
  assert.deepEqual(preparedRoutes, [
    "/(tabs)",
    { pathname: "/(tabs)/favourites", params: { category: "Subscribed" } }
  ]);
});

test("redirectSystemPath normalizes custom schemes and notification links without unmatched route errors", async () => {
  const { redirectSystemPath } = await import("../app/+native-intent.ts");

  // Episode notification double-slash and triple-slash deep links
  assert.equal(
    redirectSystemPath({
      path: "bbcradioplayer://modal/podcast-detail?podcastId=p086w16s&episodeId=p086w200",
      initial: true
    }),
    "/modal/podcast-detail?podcastId=p086w16s&episodeId=p086w200"
  );
  assert.equal(
    redirectSystemPath({
      path: "bbcradioplayer:///modal/podcast-detail?podcastId=p086w16s",
      initial: false
    }),
    "/modal/podcast-detail?podcastId=p086w16s"
  );

  // Fallback root custom scheme links route to /(tabs)
  assert.equal(redirectSystemPath({ path: "bbcradioplayer:///", initial: true }), "/(tabs)");
  assert.equal(redirectSystemPath({ path: "bbcradioplayer://", initial: false }), "/(tabs)");
  assert.equal(redirectSystemPath({ path: "/", initial: true }), "/(tabs)");
  assert.equal(redirectSystemPath({ path: "", initial: true }), "/(tabs)");

  // Media notification click
  assert.equal(
    redirectSystemPath({ path: "trackplayer://notification.click", initial: true }),
    "/modal/now-playing"
  );
  assert.equal(
    redirectSystemPath({ path: "bbcradioplayer://notification.click", initial: true }),
    "/modal/now-playing"
  );

  // Search notification
  assert.equal(
    redirectSystemPath({
      path: "bbcradioplayer://podcasts?search=comedy&savedSearchId=search-1",
      initial: true
    }),
    "/modal/podcast-search?search=comedy&savedSearchId=search-1"
  );
});


