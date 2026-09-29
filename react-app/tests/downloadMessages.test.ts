import test from "node:test";
import assert from "node:assert/strict";
import { downloadFinishedNotice, downloadStartedBody } from "../src/notifications/downloadMessages.ts";

test("downloadStartedBody pluralises the episode count", () => {
  assert.equal(downloadStartedBody(1), "Downloading 1 episode…");
  assert.equal(downloadStartedBody(4), "Downloading 4 episodes…");
});

test("downloadFinishedNotice is silent when nothing ran", () => {
  assert.equal(downloadFinishedNotice(0, 0), null);
});

test("downloadFinishedNotice summarises successful downloads", () => {
  assert.deepEqual(downloadFinishedNotice(1, 0), {
    title: "Downloads complete",
    body: "1 episode downloaded"
  });
  assert.deepEqual(downloadFinishedNotice(3, 0), {
    title: "Downloads complete",
    body: "3 episodes downloaded"
  });
});

test("downloadFinishedNotice reports the failures alongside the successes", () => {
  assert.deepEqual(downloadFinishedNotice(2, 1), {
    title: "Downloads complete",
    body: "2 episodes downloaded, 1 episode failed"
  });
});

test("downloadFinishedNotice reports an all-failure burst", () => {
  assert.deepEqual(downloadFinishedNotice(0, 2), {
    title: "Download failed",
    body: "Could not download 2 episodes"
  });
});
