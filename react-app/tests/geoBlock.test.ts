import test from "node:test";
import assert from "node:assert/strict";

import {
  probeGeoBlock,
  isStationUkOnly,
  isSportsStation,
  configureGeoBlockedStorage,
  getGeoBlockedState,
  setGeoBlockedState
} from "../src/utils/geoBlock.ts";

test("geoBlock - station classification helpers", () => {
  assert.equal(isStationUkOnly("radio5livesportsextra2"), true);
  assert.equal(isStationUkOnly("radio5livesportsextra3"), true);
  assert.equal(isStationUkOnly("radio1"), false);
  assert.equal(isStationUkOnly("radio5live"), false);

  assert.equal(isSportsStation("radio5live"), true);
  assert.equal(isSportsStation("radio5livesportsextra"), true);
  assert.equal(isSportsStation("radio1"), false);
  assert.equal(isSportsStation("worldservice"), false);
});

test("geoBlock - storage delegate integration", () => {
  let mockBlocked = false;
  configureGeoBlockedStorage({
    getGeoBlocked: () => mockBlocked,
    setGeoBlocked: (val: boolean) => {
      mockBlocked = val;
    }
  });

  setGeoBlockedState(true);
  assert.equal(getGeoBlockedState(), true);
  assert.equal(mockBlocked, true);

  setGeoBlockedState(false);
  assert.equal(getGeoBlockedState(), false);
  assert.equal(mockBlocked, false);
});

test("geoBlock - probeGeoBlock detects 200 OK as UK access", async () => {
  let mockBlocked = true;
  configureGeoBlockedStorage({
    getGeoBlocked: () => mockBlocked,
    setGeoBlocked: (val: boolean) => {
      mockBlocked = val;
    }
  });

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (url: any) => {
      if (String(url).includes("as-hls-uk")) {
        return { ok: true, status: 200 } as any;
      }
      return { ok: false, status: 404 } as any;
    }) as any;

    const isBlocked = await probeGeoBlock(true);
    assert.equal(isBlocked, false);
    assert.equal(mockBlocked, false);
    assert.equal(getGeoBlockedState(), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("geoBlock - probeGeoBlock detects 403 Forbidden as regional geo-block", async () => {
  let mockBlocked = false;
  configureGeoBlockedStorage({
    getGeoBlocked: () => mockBlocked,
    setGeoBlocked: (val: boolean) => {
      mockBlocked = val;
    }
  });

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (url: any) => {
      if (String(url).includes("as-hls-uk")) {
        return { ok: false, status: 403 } as any;
      }
      return { ok: false, status: 404 } as any;
    }) as any;

    const isBlocked = await probeGeoBlock(true);
    assert.equal(isBlocked, true);
    assert.equal(mockBlocked, true);
    assert.equal(getGeoBlockedState(), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("geoBlock - probeGeoBlock fallback to non-UK endpoint when UK endpoint errors", async () => {
  let mockBlocked = false;
  configureGeoBlockedStorage({
    getGeoBlocked: () => mockBlocked,
    setGeoBlocked: (val: boolean) => {
      mockBlocked = val;
    }
  });

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (url: any) => {
      if (String(url).includes("as-hls-uk")) {
        throw new Error("Network request failed");
      }
      if (String(url).includes("nonuk")) {
        return { ok: true, status: 200 } as any;
      }
      return { ok: false, status: 404 } as any;
    }) as any;

    const isBlocked = await probeGeoBlock(true);
    assert.equal(isBlocked, true);
    assert.equal(mockBlocked, true);
    assert.equal(getGeoBlockedState(), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
