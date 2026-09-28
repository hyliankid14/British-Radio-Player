import test from "node:test";
import assert from "node:assert/strict";
import {
  DELETE_PLAYED_PREF_KEY,
  MAX_DOWNLOADS_PREF_KEY,
  MAX_DOWNLOADS_OPTIONS,
  UNLIMITED_DOWNLOADS,
  normaliseMaxDownloads,
  pickDownloadsToRemove
} from "../src/downloads/downloadLimits.ts";

test("download preference keys stay stable for backup compatibility", () => {
  assert.equal(MAX_DOWNLOADS_PREF_KEY, "pref_max_downloads");
  assert.equal(DELETE_PLAYED_PREF_KEY, "pref_delete_played");
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
