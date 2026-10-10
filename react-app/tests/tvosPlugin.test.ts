import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('tvOS plugin and sources are properly configured', () => {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const rootDir = path.resolve(currentDir, '..');
  const appJsonPath = path.join(rootDir, 'app.json');
  const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));

  // Verify plugin registration in app.json
  assert.ok(
    appJson.expo.plugins.includes('./plugins/withTvOS'),
    'withTvOS plugin should be registered in app.json'
  );

  const tvosDir = path.join(rootDir, 'plugins', 'tvos');
  assert.ok(fs.existsSync(tvosDir), 'tvos plugin directory must exist');

  // Verify App entry and navigation
  assert.ok(fs.existsSync(path.join(tvosDir, 'App', 'BRPTVApp.swift')), 'BRPTVApp.swift must exist');
  assert.ok(fs.existsSync(path.join(tvosDir, 'App', 'ContentView.swift')), 'ContentView.swift must exist');

  // Verify Screens
  assert.ok(fs.existsSync(path.join(tvosDir, 'Screens', 'HomeView.swift')), 'HomeView.swift must exist');
  assert.ok(fs.existsSync(path.join(tvosDir, 'Screens', 'StationsView.swift')), 'StationsView.swift must exist');
  assert.ok(fs.existsSync(path.join(tvosDir, 'Screens', 'PodcastsView.swift')), 'PodcastsView.swift must exist');
  assert.ok(fs.existsSync(path.join(tvosDir, 'Screens', 'EpisodeListView.swift')), 'EpisodeListView.swift must exist');
  assert.ok(fs.existsSync(path.join(tvosDir, 'Screens', 'NowPlayingView.swift')), 'NowPlayingView.swift must exist');
  assert.ok(fs.existsSync(path.join(tvosDir, 'Screens', 'SearchView.swift')), 'SearchView.swift must exist');
  assert.ok(fs.existsSync(path.join(tvosDir, 'Screens', 'SettingsView.swift')), 'SettingsView.swift must exist');

  // Verify Components
  assert.ok(fs.existsSync(path.join(tvosDir, 'Components', 'StationCardView.swift')), 'StationCardView.swift must exist');
  assert.ok(fs.existsSync(path.join(tvosDir, 'Components', 'PodcastCardView.swift')), 'PodcastCardView.swift must exist');
  assert.ok(fs.existsSync(path.join(tvosDir, 'Components', 'LiveBadgeView.swift')), 'LiveBadgeView.swift must exist');
  assert.ok(fs.existsSync(path.join(tvosDir, 'Components', 'AmbientScreensaverView.swift')), 'AmbientScreensaverView.swift must exist');

  // Verify Playback and Models
  assert.ok(fs.existsSync(path.join(tvosDir, 'Playback', 'TVModels.swift')), 'TVModels.swift must exist');
  assert.ok(fs.existsSync(path.join(tvosDir, 'Playback', 'TVStationCatalogue.swift')), 'TVStationCatalogue.swift must exist');
  assert.ok(fs.existsSync(path.join(tvosDir, 'Playback', 'TVPlaybackController.swift')), 'TVPlaybackController.swift must exist');
  assert.ok(fs.existsSync(path.join(tvosDir, 'Playback', 'TVNowPlayingMetadata.swift')), 'TVNowPlayingMetadata.swift must exist');
  assert.ok(fs.existsSync(path.join(tvosDir, 'Playback', 'TVPodcastManager.swift')), 'TVPodcastManager.swift must exist');
  assert.ok(fs.existsSync(path.join(tvosDir, 'Playback', 'TVFavouritesManager.swift')), 'TVFavouritesManager.swift must exist');
  assert.ok(fs.existsSync(path.join(tvosDir, 'Playback', 'TVScrobbleManager.swift')), 'TVScrobbleManager.swift must exist');

  // Verify Top Shelf extension
  assert.ok(fs.existsSync(path.join(tvosDir, 'TopShelf', 'ContentProvider.swift')), 'ContentProvider.swift must exist');
  assert.ok(fs.existsSync(path.join(tvosDir, 'BRPTVTopShelf-Info.plist')), 'BRPTVTopShelf-Info.plist must exist');

  // Verify Info.plist & entitlements
  assert.ok(fs.existsSync(path.join(tvosDir, 'BRPTV-Info.plist')), 'BRPTV-Info.plist must exist');
  assert.ok(fs.existsSync(path.join(tvosDir, 'BRPTV.entitlements')), 'BRPTV.entitlements must exist');
  assert.ok(fs.existsSync(path.join(tvosDir, 'PrivacyInfo.xcprivacy')), 'PrivacyInfo.xcprivacy must exist');

  // Check Info.plist content for audio background mode
  const infoPlist = fs.readFileSync(path.join(tvosDir, 'BRPTV-Info.plist'), 'utf8');
  assert.ok(infoPlist.includes('<string>audio</string>'), 'BRPTV-Info.plist must declare audio background mode');
  assert.ok(infoPlist.includes('bbcradioplayer'), 'BRPTV-Info.plist must declare bbcradioplayer URL scheme');

  // Verify launcher icon and logo assets
  assert.ok(fs.existsSync(path.join(tvosDir, 'Assets', 'AppIcon.brandassets')), 'AppIcon.brandassets must exist');
  assert.ok(fs.existsSync(path.join(tvosDir, 'app-logo.png')), 'app-logo.png must exist');
});
