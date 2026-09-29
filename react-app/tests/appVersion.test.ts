import test from "node:test";
import assert from "node:assert/strict";
import {
  bumpPatchVersion,
  debugVersionTag,
  resolveAppVersion
} from "../src/utils/appVersion.ts";

test("bumpPatchVersion increments the patch component", () => {
  assert.equal(bumpPatchVersion("2.0.0"), "2.0.1");
  assert.equal(bumpPatchVersion("1.2.9"), "1.2.10");
  assert.equal(bumpPatchVersion("2.0.0 "), "2.0.1");
});

test("bumpPatchVersion leaves non-semver versions unchanged", () => {
  assert.equal(bumpPatchVersion("2.0"), "2.0");
  assert.equal(bumpPatchVersion("2.0.1-beta"), "2.0.1-beta");
  assert.equal(bumpPatchVersion("unknown"), "unknown");
});

test("resolveAppVersion only bumps debug builds", () => {
  assert.equal(resolveAppVersion("2.0.0", false), "2.0.0");
  assert.equal(resolveAppVersion("2.0.0", true), "2.0.1");
});

test("debugVersionTag adds a single -debug suffix", () => {
  assert.equal(debugVersionTag("2.0.1", true), "2.0.1-debug");
  assert.equal(debugVersionTag("2.0.1", false), "2.0.1");
  assert.equal(debugVersionTag("2.0.1-debug", true), "2.0.1-debug");
});
