import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('watchOS plugin and sources are properly configured for voice and playback', () => {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const rootDir = path.resolve(currentDir, '..');
  const appJsonPath = path.join(rootDir, 'app.json');
  const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));

  // Verify plugin registration in app.json
  assert.ok(
    appJson.expo.plugins.includes('./plugins/withWatchOS'),
    'withWatchOS plugin should be registered in app.json'
  );

  const watchDir = path.join(rootDir, 'plugins', 'watchos');
  assert.ok(fs.existsSync(watchDir), 'watchos plugin directory must exist');

  // Verify App entry
  assert.ok(fs.existsSync(path.join(watchDir, 'App', 'BRPWatchApp.swift')), 'BRPWatchApp.swift must exist');
  assert.ok(fs.existsSync(path.join(watchDir, 'App', 'ContentView.swift')), 'ContentView.swift must exist');

  // Verify Playback and Siri intents
  assert.ok(fs.existsSync(path.join(watchDir, 'Playback', 'WatchPlaybackController.swift')), 'WatchPlaybackController.swift must exist');
  assert.ok(fs.existsSync(path.join(watchDir, 'Playback', 'WatchSiriIntents.swift')), 'WatchSiriIntents.swift must exist');

  // Verify Info.plist & entitlements
  assert.ok(fs.existsSync(path.join(watchDir, 'BRPWatch-Info.plist')), 'BRPWatch-Info.plist must exist');
  assert.ok(fs.existsSync(path.join(watchDir, 'BRPWatch.entitlements')), 'BRPWatch.entitlements must exist');

  // Check Info.plist content for audio background mode, URL schemes, and SiriKit
  const infoPlist = fs.readFileSync(path.join(watchDir, 'BRPWatch-Info.plist'), 'utf8');
  assert.ok(infoPlist.includes('<string>audio</string>'), 'BRPWatch-Info.plist must declare audio background mode');
  assert.ok(infoPlist.includes('bbcradioplayer'), 'BRPWatch-Info.plist must declare bbcradioplayer URL scheme');
  assert.ok(infoPlist.includes('INPlayMediaIntent'), 'BRPWatch-Info.plist must declare INPlayMediaIntent');
  assert.ok(infoPlist.includes('INAlternativeAppNames'), 'BRPWatch-Info.plist must declare INAlternativeAppNames');

  // Verify played episode resolution in watch sources uses WatchConnectivityManager
  const watchAppSwift = fs.readFileSync(path.join(watchDir, 'App', 'BRPWatchApp.swift'), 'utf8');
  assert.ok(watchAppSwift.includes('WatchConnectivityManager.shared.isEpisodePlayed'), 'BRPWatchApp must use WatchConnectivityManager.shared.isEpisodePlayed');
  assert.ok(!watchAppSwift.includes('WatchSharedState.shared.isEpisodePlayed'), 'BRPWatchApp must not reference nonexistent WatchSharedState.shared');

  const watchSiriSwift = fs.readFileSync(path.join(watchDir, 'Playback', 'WatchSiriIntents.swift'), 'utf8');
  assert.ok(watchSiriSwift.includes('WatchConnectivityManager.shared.isEpisodePlayed'), 'WatchSiriIntents must use WatchConnectivityManager.shared.isEpisodePlayed');
  assert.ok(!watchSiriSwift.includes('WatchSharedState.shared.isEpisodePlayed'), 'WatchSiriIntents must not reference nonexistent WatchSharedState.shared');
  const watchSiriShortcuts = watchSiriSwift.slice(watchSiriSwift.indexOf('struct WatchSiriShortcutsProvider'));
  assert.ok(!watchSiriShortcuts.includes('\\(\\.$query)'), 'WatchSiriShortcutsProvider must not interpolate non-AppEntity query into shortcut phrases');

  const watchSharedStateSwift = fs.readFileSync(path.join(watchDir, 'Sync', 'WatchSharedState.swift'), 'utf8');
  assert.ok(watchSharedStateSwift.includes('typealias WatchSharedState = WatchConnectivityManager'), 'WatchSharedState.swift must typealias WatchSharedState');
});
