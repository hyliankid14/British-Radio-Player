import test from "node:test";
import assert from "node:assert/strict";

import { normalizeLastPlayed, parseLastPlayed } from "../src/storage/lastPlayed.ts";

test("last played falls back to the last station for installs without a record", () => {
  const parsed = parseLastPlayed(undefined, "radio4");
  assert.deepEqual(parsed, { kind: "station", id: "radio4", podcastId: "", atMs: 0 });
});

test("last played prefers the explicit episode record", () => {
  const raw = JSON.stringify({
    kind: "episode",
    id: "ep-1",
    podcastId: "pod-1",
    atMs: 1700000000000
  });
  assert.deepEqual(parseLastPlayed(raw, "radio4"), {
    kind: "episode",
    id: "ep-1",
    podcastId: "pod-1",
    atMs: 1700000000000
  });
});

test("last played ignores a malformed record and falls back", () => {
  assert.deepEqual(parseLastPlayed("{not json", "radio2"), {
    kind: "station",
    id: "radio2",
    podcastId: "",
    atMs: 0
  });
  assert.equal(parseLastPlayed(JSON.stringify({ id: "   " }), ""), null);
  assert.equal(parseLastPlayed(undefined, undefined), null);
});

test("normalizing stamps a time and trims ids", () => {
  const stamped = normalizeLastPlayed({ kind: "station", id: "  radio1  ", podcastId: "" }, 42);
  assert.deepEqual(stamped, { kind: "station", id: "radio1", podcastId: "", atMs: 42 });

  const kept = normalizeLastPlayed(
    { kind: "episode", id: "ep-9", podcastId: "pod-9", atMs: 1234 },
    42
  );
  assert.deepEqual(kept, { kind: "episode", id: "ep-9", podcastId: "pod-9", atMs: 1234 });

  assert.equal(normalizeLastPlayed({ kind: "episode", id: "", podcastId: "pod" }, 42), null);
});
