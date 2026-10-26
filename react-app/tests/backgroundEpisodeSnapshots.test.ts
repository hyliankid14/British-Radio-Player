import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  MAX_EPISODES_PER_SNAPSHOT,
  MAX_SNAPSHOT_DESCRIPTION_CHARS
} from "../src/podcasts/episodeSnapshot.ts";

/**
 * The Android background worker parses RSS feeds in Kotlin and hands the result to JavaScript
 * verbatim, so the two halves have to agree on the episode shape and the caps. Nothing at
 * runtime enforces that — a drifted constant or a renamed field silently produces snapshots
 * that JS drops or mis-parses — so these guards read the Kotlin source directly.
 */

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const kotlinDir = path.join(rootDir, "modules", "native-android", "android", "src", "main", "java", "com", "hyliankid14", "bbcradioplayer", "nativeandroid");

function kotlin(file: string): string {
  return fs.readFileSync(path.join(kotlinDir, file), "utf8");
}

/** Pulls `private const val NAME = <number>` out of a Kotlin source. */
function kotlinInt(source: string, name: string): number {
  const match = source.match(new RegExp(`\\b${name}\\s*=\\s*(\\d+)`));
  assert.ok(match, `${name} not found in Kotlin source`);
  return Number(match[1]);
}

test("the Kotlin worker caps episodes at the same count as the JS snapshot store", () => {
  assert.equal(kotlinInt(kotlin("RssEpisodes.kt"), "MAX_EPISODES"), MAX_EPISODES_PER_SNAPSHOT);
});

test("the Kotlin worker truncates descriptions at the same length as the JS snapshot store", () => {
  assert.equal(
    kotlinInt(kotlin("RssEpisodes.kt"), "MAX_DESCRIPTION_CHARS"),
    MAX_SNAPSHOT_DESCRIPTION_CHARS
  );
});

test("BackgroundSync reuses the parser's cap rather than restating it", () => {
  // A second copy of 60 in the worker would be one more thing to drift.
  assert.match(kotlin("BackgroundSync.kt"), /MAX_EPISODES_PER_SNAPSHOT\s*=\s*RssEpisodes\.MAX_EPISODES/);
});

test("the Kotlin serialiser emits exactly the JS Episode fields", () => {
  const jsonKeys = [...kotlin("RssEpisodes.kt").matchAll(/\.put\("(\w+)"/g)].map((m) => m[1]);

  // The TS `Episode` interface is the contract; enumerate it from its declaration.
  const source = fs.readFileSync(path.join(rootDir, "src", "api", "podcasts.ts"), "utf8");
  const declaration = source.slice(source.indexOf("export interface Episode {"));
  const body = declaration.slice(0, declaration.indexOf("\n}"));
  const expected = [...body.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]).sort();

  assert.deepEqual([...new Set(jsonKeys)].sort(), expected, "Kotlin toJson() must match Episode");
});

test("the subscription snapshot carries a per-show notify flag on both sides", () => {
  assert.match(kotlin("BackgroundSync.kt"), /val notify: Boolean/);
  assert.match(kotlin("BackgroundSync.kt"), /optBoolean\("notify"/);
  assert.match(fs.readFileSync(path.join(rootDir, "src", "background", "backgroundSync.ts"), "utf8"), /notify: notifySet\.has\(id\)/);
});

test("the snapshot handover is wired through every bridge layer", () => {
  const pairs: [string, string][] = [
    [path.join(kotlinDir, "NativeAndroidModule.kt"), "Function(\"getBackgroundEpisodeSnapshots\")"],
    [path.join(rootDir, "modules/native-android/src/NativeAndroidModule.ts"), "getBackgroundEpisodeSnapshots(): string"],
    [path.join(rootDir, "src/native/nativeAndroid.ts"), "getBackgroundEpisodeSnapshots(): Record<string, BackgroundEpisodeSnapshot>"]
  ];
  for (const [file, needle] of pairs) {
    assert.ok(fs.readFileSync(file, "utf8").includes(needle), `${path.basename(file)} must expose ${needle}`);
  }
});

test("the worker stores feeds for every subscription, and alerts only for armed ones", () => {
  const worker = kotlin("IndexRefreshWorker.kt");
  const saveIndex = worker.indexOf("saveEpisodeSnapshot");
  const notifyGuard = worker.indexOf("if (!subscription.notify) continue");
  assert.ok(saveIndex !== -1, "worker must persist the parsed feed");
  assert.ok(notifyGuard !== -1, "worker must gate notifications per show");
  assert.ok(saveIndex < notifyGuard, "the feed is stored before the notify gate, so unarmed shows still refresh");
});

test("episode snapshots are only persisted for subscriptions", () => {
  // The catalogue runs to ~840 shows; persisting all of them would fill the store with lists
  // nobody revisits.
  const source = fs.readFileSync(path.join(rootDir, "src", "api", "podcasts.ts"), "utf8");
  assert.match(source, /if \(!Preferences\.getSubscribedPodcasts\(\)\.includes\(podcastId\)\) return;/);
});
