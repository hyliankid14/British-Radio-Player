import test from "node:test";
import assert from "node:assert/strict";

import { resolveEffectiveAudioQuality } from "../src/data/stations.ts";

test("resolveEffectiveAudioQuality - auto mode enabled (Wi-Fi vs Cellular vs Offline)", () => {
  // Wi-Fi connected -> HIGH (320 kbps)
  const wifiResult = resolveEffectiveAudioQuality("HIGH", true, {
    isOnline: true,
    isWifi: true
  });
  assert.equal(wifiResult, "HIGH", "Wi-Fi in auto mode should select HIGH quality");

  // Cellular connected -> MEDIUM (128 kbps)
  const cellularResult = resolveEffectiveAudioQuality("HIGH", true, {
    isOnline: true,
    isWifi: false
  });
  assert.equal(cellularResult, "MEDIUM", "Cellular in auto mode should select MEDIUM quality");

  // Offline / low connectivity -> LOW (96/48 kbps)
  const offlineResult = resolveEffectiveAudioQuality("HIGH", true, {
    isOnline: false,
    isWifi: false
  });
  assert.equal(offlineResult, "LOW", "Offline state in auto mode should select LOW quality");
});

test("resolveEffectiveAudioQuality - explicit AUTO overrides false preference", () => {
  // Explicitly requested AUTO quality should adapt even if preference was false
  const wifiAuto = resolveEffectiveAudioQuality("AUTO", false, {
    isOnline: true,
    isWifi: true
  });
  assert.equal(wifiAuto, "HIGH", "Explicit AUTO on Wi-Fi should resolve to HIGH");

  const cellAuto = resolveEffectiveAudioQuality("AUTO", false, {
    isOnline: true,
    isWifi: false
  });
  assert.equal(cellAuto, "MEDIUM", "Explicit AUTO on Cellular should resolve to MEDIUM");

  const offlineAuto = resolveEffectiveAudioQuality("AUTO", false, {
    isOnline: false,
    isWifi: false
  });
  assert.equal(offlineAuto, "LOW", "Explicit AUTO when offline should resolve to LOW");
});

test("resolveEffectiveAudioQuality - manual mode respects user choice", () => {
  // Manual HIGH should stay HIGH on cellular
  const manualHighOnCell = resolveEffectiveAudioQuality("HIGH", false, {
    isOnline: true,
    isWifi: false
  });
  assert.equal(manualHighOnCell, "HIGH", "Manual HIGH must not be overridden on cellular");

  // Manual MEDIUM should stay MEDIUM on Wi-Fi
  const manualMedOnWifi = resolveEffectiveAudioQuality("MEDIUM", false, {
    isOnline: true,
    isWifi: true
  });
  assert.equal(manualMedOnWifi, "MEDIUM", "Manual MEDIUM must not be overridden on Wi-Fi");

  // Manual LOW should stay LOW on Wi-Fi
  const manualLowOnWifi = resolveEffectiveAudioQuality("LOW", false, {
    isOnline: true,
    isWifi: true
  });
  assert.equal(manualLowOnWifi, "LOW", "Manual LOW must not be overridden on Wi-Fi");
});
