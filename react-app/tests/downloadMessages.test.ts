import test from "node:test";
import assert from "node:assert/strict";
import { downloadFinishedNotice, downloadStartedBody } from "../src/notifications/downloadMessages.ts";

test("downloadStartedBody pluralises the episode count", () => {
  assert.equal(downloadStartedBody(1), "Downloading 1 episode…");
  assert.equal(downloadStartedBody(4), "Downloading 4 episodes…");
});

test("downloadStartedBody names the episode when only one title is provided", () => {
  assert.equal(downloadStartedBody(1, ["The Archers"]), `Downloading "The Archers"…`);
});

test("downloadStartedBody uses the count when multiple titles are provided", () => {
  assert.equal(downloadStartedBody(3, ["Ep A", "Ep B", "Ep C"]), "Downloading 3 episodes…");
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

test("downloadFinishedNotice reports the failures alongside the successes (no titles)", () => {
  assert.deepEqual(downloadFinishedNotice(2, 1), {
    title: "Downloads complete",
    body: "2 episodes downloaded — Could not download 1 episode"
  });
});

test("downloadFinishedNotice names a single failed episode", () => {
  assert.deepEqual(downloadFinishedNotice(1, 1, ["The Archers"]), {
    title: "Downloads complete",
    body: `1 episode downloaded — Could not download "The Archers"`
  });
});

test("downloadFinishedNotice reports an all-failure burst without titles", () => {
  assert.deepEqual(downloadFinishedNotice(0, 2), {
    title: "Download failed",
    body: "Could not download 2 episodes"
  });
});

test("downloadFinishedNotice names a single failed episode in an all-failure burst", () => {
  assert.deepEqual(downloadFinishedNotice(0, 1, ["Desert Island Discs"]), {
    title: "Download failed",
    body: `Could not download "Desert Island Discs"`
  });
});

test("downloadFinishedNotice names two failed episodes with 'or'", () => {
  assert.deepEqual(downloadFinishedNotice(0, 2, ["Ep A", "Ep B"]), {
    title: "Download failed",
    body: `Could not download "Ep A" or "Ep B"`
  });
});

test("downloadFinishedNotice names two episodes and shows a remainder for three failures", () => {
  assert.deepEqual(downloadFinishedNotice(0, 3, ["Ep A", "Ep B", "Ep C"]), {
    title: "Download failed",
    body: `Could not download "Ep A", "Ep B" or 1 more`
  });
});

test("downloadFinishedNotice names two episodes and shows a remainder for four failures", () => {
  assert.deepEqual(downloadFinishedNotice(0, 4, ["Ep A", "Ep B", "Ep C", "Ep D"]), {
    title: "Download failed",
    body: `Could not download "Ep A", "Ep B" or 2 more`
  });
});

test("downloadFinishedNotice mixes named failures with successes", () => {
  assert.deepEqual(downloadFinishedNotice(3, 2, ["The News", "The Archers"]), {
    title: "Downloads complete",
    body: `3 episodes downloaded — Could not download "The News" or "The Archers"`
  });
});
