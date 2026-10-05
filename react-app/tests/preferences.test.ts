import test from "node:test";
import assert from "node:assert/strict";

// In-memory memory store test for Preferences logic
import type { AudioQuality } from "../src/data/stations.ts";
import { normalizeEpisodeId } from "../src/downloads/downloadLimits.ts";

function createMockPreferences() {
  const memoryStore = new Map<string, any>();
  const storage = {
    getString: (key: string) => memoryStore.get(key),
    set: (key: string, value: any) => memoryStore.set(key, value),
    getBoolean: (key: string) => memoryStore.get(key),
    getNumber: (key: string) => memoryStore.get(key),
    remove: (key: string) => memoryStore.delete(key),
    clearAll: () => memoryStore.clear()
  };

  const KEYS = {
    FAVORITES: "pref_favorite_stations",
    AUDIO_QUALITY: "pref_audio_quality",
    GEO_BLOCKED: "pref_geo_blocked",
    THEME: "pref_theme_mode",
    LAST_STATION: "pref_last_station_id"
  };

  return {
    getFavorites(): string[] {
      const raw = storage.getString(KEYS.FAVORITES);
      if (!raw) return [];
      try {
        return JSON.parse(raw);
      } catch {
        return [];
      }
    },
    setFavorites(stationIds: string[]): void {
      storage.set(KEYS.FAVORITES, JSON.stringify(stationIds));
    },
    toggleFavorite(stationId: string): boolean {
      const favorites = this.getFavorites();
      const index = favorites.indexOf(stationId);
      let isFav = false;
      if (index >= 0) {
        favorites.splice(index, 1);
        isFav = false;
      } else {
        favorites.push(stationId);
        isFav = true;
      }
      this.setFavorites(favorites);
      return isFav;
    },
    isFavorite(stationId: string): boolean {
      return this.getFavorites().includes(stationId);
    },
    getAudioQuality(): AudioQuality {
      return (storage.getString(KEYS.AUDIO_QUALITY) as AudioQuality) || "HIGH";
    },
    setAudioQuality(quality: AudioQuality): void {
      storage.set(KEYS.AUDIO_QUALITY, quality);
    },
    getGeoBlocked(): boolean {
      return storage.getBoolean(KEYS.GEO_BLOCKED) ?? false;
    },
    setGeoBlocked(val: boolean): void {
      storage.set(KEYS.GEO_BLOCKED, val);
    },
    exportBackup(): string {
      return JSON.stringify({
        favorites: this.getFavorites(),
        audioQuality: this.getAudioQuality(),
        geoBlocked: this.getGeoBlocked(),
        lastfm: {
          username: this.getLastFm().username,
          sessionKey: this.getLastFm().sessionKey,
          recentScrobbles: this.getLastFmRecentScrobbles().slice(0, 5),
          lastScrobbled: this.getLastFmLastScrobbled()
        },
        lastfm_prefs: {
          username: this.getLastFm().username,
          session_key: this.getLastFm().sessionKey,
          recent_scrobbles: this.getLastFmRecentScrobbles().slice(0, 5),
          last_scrobbled_track: this.getLastFmLastScrobbled()
        },
        exportedAt: new Date().toISOString(),
        version: 1
      }, null, 2);
    },
    importBackup(jsonString: string): boolean {
      try {
        const data = JSON.parse(jsonString);
        if (Array.isArray(data.favorites)) this.setFavorites(data.favorites);
        if (data.audioQuality) this.setAudioQuality(data.audioQuality);
        if (typeof data.geoBlocked === "boolean") this.setGeoBlocked(data.geoBlocked);
        if (data.lastfm) {
          if (Array.isArray(data.lastfm.recentScrobbles)) {
            this.setLastFmRecentScrobbles(data.lastfm.recentScrobbles);
          } else if (typeof data.lastfm.lastScrobbled === "string") {
            this.setLastFmLastScrobbled(data.lastfm.lastScrobbled);
          }
          if (data.lastfm.username && data.lastfm.sessionKey) {
            this.setLastFmSession(data.lastfm.username, data.lastfm.sessionKey);
          }
        }
        return true;
      } catch {
        return false;
      }
    },
    importKotlinBackup(jsonString: string): boolean {
      try {
        const root = JSON.parse(jsonString) as Record<string, any>;
        const lastfm = root.lastfm_prefs || {};
        if (Array.isArray(lastfm.recent_scrobbles)) {
          this.setLastFmRecentScrobbles(lastfm.recent_scrobbles);
        } else if (typeof lastfm.last_scrobbled_track === "string" && lastfm.last_scrobbled_track.trim().length > 0) {
          this.setLastFmLastScrobbled(lastfm.last_scrobbled_track);
        }
        if (typeof lastfm.username === "string" && typeof lastfm.session_key === "string" && lastfm.session_key) {
          this.setLastFmSession(lastfm.username, lastfm.session_key);
        }
        return true;
      } catch {
        return false;
      }
    },
    getPodcastHistory(): any[] {
      const raw = storage.getString("pref_podcast_history");
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed)
          ? parsed.filter((entry) => entry && typeof entry.id === "string")
          : [];
      } catch {
        return [];
      }
    },
    addPodcastHistory(entry: any): void {
      if (!entry?.id) return;
      const epId = String(entry.id).trim();
      if (!epId) return;
      const existing = this.getPodcastHistory().filter((item) => item.id !== epId);
      const record = {
        id: epId,
        title: String(entry.title || "").trim(),
        description: String(entry.description || "").trim(),
        imageUrl: String(entry.imageUrl || "").trim(),
        audioUrl: String(entry.audioUrl || "").trim(),
        pubDate: String(entry.pubDate || "").trim(),
        durationMins: Number(entry.durationMins || 0),
        podcastId: String(entry.podcastId || "").trim(),
        podcastTitle: String(entry.podcastTitle || "").trim(),
        playedAtMs:
          typeof entry.playedAtMs === "number" && entry.playedAtMs > 0 ? entry.playedAtMs : Date.now()
      };
      storage.set("pref_podcast_history", JSON.stringify([record, ...existing].slice(0, 20)));
    },
    removePodcastHistoryEntry(id: string): void {
      storage.set(
        "pref_podcast_history",
        JSON.stringify(this.getPodcastHistory().filter((item) => item.id !== id))
      );
    },
    clearPodcastHistory(): void {
      storage.set("pref_podcast_history", JSON.stringify([]));
    },
    getLastFmRecentScrobbles(): any[] {
      const raw = storage.getString("pref_lastfm_recent_scrobbles");
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return parsed;
        } catch {
          // fallback below
        }
      }
      const single = storage.getString("pref_lastfm_last_scrobbled");
      if (single) {
        const stored = storage.getNumber("pref_lastfm_last_scrobbled_time_ms");
        const timeMs =
          typeof stored === "number" && Number.isFinite(stored) && stored > 0 ? stored : 0;
        const parts = single.split(" - ");
        return [{
          artist: parts[0] || "",
          track: parts.slice(1).join(" - ") || parts[0] || "",
          timestampMs: timeMs
        }];
      }
      return [];
    },
    addLastFmRecentScrobble(entry: any): void {
      if (!entry.artist?.trim() && !entry.track?.trim()) return;
      const sameTrack = (item: any) =>
        item.artist.toLowerCase() === entry.artist.toLowerCase() &&
        item.track.toLowerCase() === entry.track.toLowerCase();
      const recent = this.getLastFmRecentScrobbles().filter(
        (item) => item.timestampMs > 0 || !sameTrack(item)
      );
      const isDup = recent.some(
        (item) => Math.abs(item.timestampMs - entry.timestampMs) < 60_000 && sameTrack(item)
      );
      if (isDup) return;

      const updated = [entry, ...recent]
        .sort((a: any, b: any) => b.timestampMs - a.timestampMs)
        .slice(0, 20);
      storage.set("pref_lastfm_recent_scrobbles", JSON.stringify(updated));
      storage.set("pref_lastfm_last_scrobbled", `${entry.artist} - ${entry.track}`);
      storage.set("pref_lastfm_last_scrobbled_time_ms", entry.timestampMs);
    },
    getLastFmLastScrobbled(): string {
      const recent = this.getLastFmRecentScrobbles();
      if (recent.length > 0) {
        return `${recent[0].artist} - ${recent[0].track}`;
      }
      return storage.getString("pref_lastfm_last_scrobbled") || "";
    },
    setLastFmLastScrobbled(value: string): void {
      storage.set("pref_lastfm_last_scrobbled", value);
      if (value) {
        const parts = value.split(" - ");
        this.addLastFmRecentScrobble({
          artist: parts[0] || "",
          track: parts.slice(1).join(" - ") || parts[0] || "",
          timestampMs: Date.now()
        });
      }
    },
    setLastFmRecentScrobbles(entries: any[]): void {
      storage.set("pref_lastfm_recent_scrobbles", JSON.stringify(entries.slice(0, 20)));
      if (entries.length > 0) {
        storage.set("pref_lastfm_last_scrobbled", `${entries[0].artist} - ${entries[0].track}`);
        storage.set("pref_lastfm_last_scrobbled_time_ms", entries[0].timestampMs || 0);
      } else {
        storage.remove("pref_lastfm_last_scrobbled");
        storage.remove("pref_lastfm_last_scrobbled_time_ms");
      }
    },
    getLastFm() {
      return {
        username: storage.getString("pref_lastfm_username") || "",
        sessionKey: storage.getString("pref_lastfm_session_key") || "",
        direct: storage.getBoolean("pref_lastfm_direct") ?? false,
        broadcast: storage.getBoolean("pref_lastfm_broadcast") ?? true,
        podcasts: storage.getBoolean("pref_lastfm_podcasts") ?? false
      };
    },
    setLastFmSession(username: string, sessionKey: string): void {
      storage.set("pref_lastfm_username", username);
      storage.set("pref_lastfm_session_key", sessionKey);
    },
    clearLastFmSession(): void {
      storage.remove("pref_lastfm_username");
      storage.remove("pref_lastfm_session_key");
    },
    getFailedAutoDownloads(): Record<string, { timestampMs: number; count: number }> {
      const raw = storage.getString("pref_failed_auto_downloads");
      if (!raw) return {};
      try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
      } catch {
        return {};
      }
    },
    recordFailedAutoDownload(episodeId: string): void {
      if (!episodeId) return;
      const norm = normalizeEpisodeId(episodeId) || episodeId;
      const records = this.getFailedAutoDownloads();
      const existing = records[norm] || records[episodeId] || { count: 0, timestampMs: 0 };
      records[norm] = {
        count: existing.count + 1,
        timestampMs: Date.now()
      };
      if (episodeId !== norm) delete records[episodeId];
      storage.set("pref_failed_auto_downloads", JSON.stringify(records));
    },
    clearFailedAutoDownload(episodeId: string): void {
      if (!episodeId) return;
      const norm = normalizeEpisodeId(episodeId) || episodeId;
      const records = this.getFailedAutoDownloads();
      let changed = false;
      for (const key of Object.keys(records)) {
        if (key === episodeId || normalizeEpisodeId(key) === norm) {
          delete records[key];
          changed = true;
        }
      }
      if (changed) {
        storage.set("pref_failed_auto_downloads", JSON.stringify(records));
      }
    },
    isAutoDownloadBlocked(episodeId: string): boolean {
      if (!episodeId) return false;
      const norm = normalizeEpisodeId(episodeId) || episodeId;
      const records = this.getFailedAutoDownloads();
      const entry = records[norm] || records[episodeId];
      if (!entry) return false;
      const cooldownMs = entry.count >= 2 ? 24 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000;
      return Date.now() - entry.timestampMs < cooldownMs;
    },
    getPlayedEpisodeIds(): string[] {
      const raw = storage.getString("pref_played_episode_ids");
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
      } catch {
        return [];
      }
    },
    markEpisodePlayed(episodeId: string): void {
      if (!episodeId) return;
      const played = this.getPlayedEpisodeIds();
      if (!played.includes(episodeId)) {
        storage.set("pref_played_episode_ids", JSON.stringify([...played, episodeId]));
      }
    },
    isEpisodePlayed(episodeId: string): boolean {
      if (!episodeId) return false;
      const played = this.getPlayedEpisodeIds();
      if (played.includes(episodeId)) return true;
      const norm = normalizeEpisodeId(episodeId);
      if (norm && played.includes(norm)) return true;
      for (const id of played) {
        if (normalizeEpisodeId(id) === (norm || episodeId)) return true;
      }
      return false;
    },
    storage
  };
}

test("Preferences - toggleFavorite and persistence", () => {
  const prefs = createMockPreferences();
  assert.deepEqual(prefs.getFavorites(), []);

  // Toggle on radio1
  const isFav = prefs.toggleFavorite("radio1");
  assert.equal(isFav, true);
  assert.equal(prefs.isFavorite("radio1"), true);

  // Toggle off radio1
  const isFavOff = prefs.toggleFavorite("radio1");
  assert.equal(isFavOff, false);
  assert.equal(prefs.isFavorite("radio1"), false);
});

test("Preferences - backup export & import compatibility", () => {
  const prefs = createMockPreferences();
  prefs.setFavorites(["radio1", "radio3unwind", "worldservice"]);
  prefs.setAudioQuality("LOW");
  prefs.setGeoBlocked(true);

  const backup = prefs.exportBackup();
  assert.ok(backup.includes("radio3unwind"));
  assert.ok(backup.includes("LOW"));

  // Reset preferences
  prefs.setFavorites(["radio2"]);
  prefs.setAudioQuality("HIGH");
  prefs.setGeoBlocked(false);

  // Import backup
  const imported = prefs.importBackup(backup);
  assert.equal(imported, true);
  assert.deepEqual(prefs.getFavorites(), ["radio1", "radio3unwind", "worldservice"]);
  assert.equal(prefs.getAudioQuality(), "LOW");
  assert.equal(prefs.getGeoBlocked(), true);
});

test("Preferences - podcast history tracking and ordering", () => {
  const prefs = createMockPreferences();
  assert.deepEqual(prefs.getPodcastHistory(), []);

  // Add first episode
  prefs.addPodcastHistory({
    id: "ep-1",
    title: "Episode 1",
    podcastId: "pod-1",
    podcastTitle: "Podcast One",
    playedAtMs: 1000
  });
  let history = prefs.getPodcastHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0].id, "ep-1");
  assert.equal(history[0].title, "Episode 1");
  assert.equal(history[0].podcastTitle, "Podcast One");

  // Add second episode - must prepend
  prefs.addPodcastHistory({
    id: "ep-2",
    title: "Episode 2",
    podcastId: "pod-1",
    podcastTitle: "Podcast One",
    playedAtMs: 2000
  });
  history = prefs.getPodcastHistory();
  assert.equal(history.length, 2);
  assert.equal(history[0].id, "ep-2");
  assert.equal(history[1].id, "ep-1");

  // Re-playing ep-1 moves it back to top
  prefs.addPodcastHistory({
    id: "ep-1",
    title: "Episode 1 (Updated)",
    podcastId: "pod-1",
    podcastTitle: "Podcast One",
    playedAtMs: 3000
  });
  history = prefs.getPodcastHistory();
  assert.equal(history.length, 2);
  assert.equal(history[0].id, "ep-1");
  assert.equal(history[0].title, "Episode 1 (Updated)");
  assert.equal(history[1].id, "ep-2");

  // Max 20 entries truncation
  for (let i = 3; i <= 25; i++) {
    prefs.addPodcastHistory({
      id: `ep-${i}`,
      title: `Episode ${i}`,
      podcastId: "pod-1",
      podcastTitle: "Podcast One"
    });
  }
  history = prefs.getPodcastHistory();
  assert.equal(history.length, 20);
  assert.equal(history[0].id, "ep-25");
  // Oldest ep-2 and ep-1 should be evicted past 20 items
  assert.equal(history.some((e) => e.id === "ep-2"), false);

  // Remove entry
  prefs.removePodcastHistoryEntry("ep-25");
  history = prefs.getPodcastHistory();
  assert.equal(history.length, 19);
  assert.equal(history[0].id, "ep-24");

  // Clear history
  prefs.clearPodcastHistory();
  assert.deepEqual(prefs.getPodcastHistory(), []);
});

test("Preferences - Last.fm recent scrobbles history, ordering, deduplication, and fallback", () => {
  const prefs = createMockPreferences();

  // Test fallback to single LASTFM_LAST_SCROBBLED if recent list empty
  prefs.setLastFmLastScrobbled("Dua Lipa - Training Season");
  let scrobbles = prefs.getLastFmRecentScrobbles();
  assert.equal(scrobbles.length, 1);
  assert.equal(scrobbles[0].artist, "Dua Lipa");
  assert.equal(scrobbles[0].track, "Training Season");
  assert.equal(prefs.getLastFmLastScrobbled(), "Dua Lipa - Training Season");

  // Add another scrobble
  const now = Date.now();
  prefs.addLastFmRecentScrobble({
    artist: "Chappell Roan",
    track: "Good Luck, Babe!",
    stationName: "Radio 1",
    timestampMs: now + 5000
  });

  scrobbles = prefs.getLastFmRecentScrobbles();
  assert.equal(scrobbles.length, 2);
  assert.equal(scrobbles[0].artist, "Chappell Roan");
  assert.equal(scrobbles[0].track, "Good Luck, Babe!");
  assert.equal(scrobbles[0].stationName, "Radio 1");
  assert.equal(prefs.getLastFmLastScrobbled(), "Chappell Roan - Good Luck, Babe!");

  // Deduplication within 60s
  prefs.addLastFmRecentScrobble({
    artist: "Chappell Roan",
    track: "Good Luck, Babe!",
    stationName: "Radio 1",
    timestampMs: now + 6000
  });
  scrobbles = prefs.getLastFmRecentScrobbles();
  assert.equal(scrobbles.length, 2);

  // Add multiple tracks and verify 20 items cap
  for (let i = 1; i <= 25; i++) {
    prefs.addLastFmRecentScrobble({
      artist: `Artist ${i}`,
      track: `Track ${i}`,
      stationName: "Radio 2",
      timestampMs: now + 100_000 + i * 70_000
    });
  }

  scrobbles = prefs.getLastFmRecentScrobbles();
  assert.equal(scrobbles.length, 20);
  assert.equal(scrobbles[0].artist, "Artist 25");
  assert.equal(scrobbles[0].track, "Track 25");
});

test("Preferences - legacy single scrobble without a stored time does not fabricate now", () => {
  const prefs = createMockPreferences();

  // Pre-4.0 installs and the Android legacy migration persisted only the
  // "artist - track" string, with no accompanying timestamp.
  prefs.storage.set("pref_lastfm_last_scrobbled", "Dua Lipa - Training Season");

  const before = Date.now();
  const scrobbles = prefs.getLastFmRecentScrobbles();
  const after = Date.now();

  assert.equal(scrobbles.length, 1);
  assert.equal(scrobbles[0].artist, "Dua Lipa");
  assert.equal(scrobbles[0].track, "Training Season");
  // Must be falsy so formatSongPlayedAt renders no time at all, rather than
  // drifting forward to the current time on every read.
  assert.equal(scrobbles[0].timestampMs, 0);

  // A second read must not advance the value either.
  assert.equal(prefs.getLastFmRecentScrobbles()[0].timestampMs, 0);
  assert.ok(after >= before);
});

test("Preferences - legacy single scrobble keeps a real stored time when present", () => {
  const prefs = createMockPreferences();
  const scrobbledAt = Date.now() - 6 * 60 * 60 * 1000;

  prefs.storage.set("pref_lastfm_last_scrobbled", "Chappell Roan - Good Luck, Babe!");
  prefs.storage.set("pref_lastfm_last_scrobbled_time_ms", scrobbledAt);

  const scrobbles = prefs.getLastFmRecentScrobbles();
  assert.equal(scrobbles.length, 1);
  assert.equal(scrobbles[0].timestampMs, scrobbledAt);
});

test("Preferences - failed auto-download tracking and cooldown blocking", () => {
  const prefs = createMockPreferences();
  const rawId = "urn:bbc:podcast:w3ct998z";
  const canonicalId = "w3ct998z";

  assert.equal(prefs.isAutoDownloadBlocked(rawId), false);
  assert.equal(prefs.isAutoDownloadBlocked(canonicalId), false);

  // Record a failure
  prefs.recordFailedAutoDownload(rawId);
  assert.equal(prefs.isAutoDownloadBlocked(rawId), true);
  assert.equal(prefs.isAutoDownloadBlocked(canonicalId), true);

  // Clear failure
  prefs.clearFailedAutoDownload(canonicalId);
  assert.equal(prefs.isAutoDownloadBlocked(rawId), false);
  assert.equal(prefs.isAutoDownloadBlocked(canonicalId), false);
});

test("Preferences - isEpisodePlayed matches canonical and URN ID formats", () => {
  const prefs = createMockPreferences();
  const rawUrn = "urn:bbc:podcast:w3ct998z";
  const canonical = "w3ct998z";

  assert.equal(prefs.isEpisodePlayed(rawUrn), false);
  assert.equal(prefs.isEpisodePlayed(canonical), false);

  // Mark using URN format
  prefs.markEpisodePlayed(rawUrn);
  assert.equal(prefs.isEpisodePlayed(rawUrn), true);
  assert.equal(prefs.isEpisodePlayed(canonical), true);

  // Another episode marked with canonical format
  prefs.markEpisodePlayed("p02nq0lx");
  assert.equal(prefs.isEpisodePlayed("p02nq0lx"), true);
  assert.equal(prefs.isEpisodePlayed("urn:bbc:podcast:p02nq0lx"), true);
});

test("Preferences - Last.fm recent scrobbles and session preserved in backup export and restore", () => {
  const prefs = createMockPreferences();
  const now = Date.now();

  // Add 6 recent scrobbles
  for (let i = 1; i <= 6; i++) {
    prefs.addLastFmRecentScrobble({
      artist: `Artist ${i}`,
      track: `Track ${i}`,
      stationName: "BBC Radio 1",
      timestampMs: now + i * 100_000
    });
  }
  prefs.setLastFmSession("testuser", "testsessionkey123");

  const recentBefore = prefs.getLastFmRecentScrobbles();
  assert.equal(recentBefore.length, 6);
  assert.equal(recentBefore[0].artist, "Artist 6");

  // Export backup
  const backupJson = prefs.exportBackup();
  const parsedBackup = JSON.parse(backupJson);

  // Backup should contain top 5 scrobbles and credentials
  assert.ok(parsedBackup.lastfm_prefs);
  assert.equal(parsedBackup.lastfm_prefs.username, "testuser");
  assert.equal(parsedBackup.lastfm_prefs.session_key, "testsessionkey123");
  assert.equal(parsedBackup.lastfm_prefs.recent_scrobbles.length, 5);
  assert.equal(parsedBackup.lastfm_prefs.recent_scrobbles[0].artist, "Artist 6");
  assert.equal(parsedBackup.lastfm_prefs.recent_scrobbles[4].artist, "Artist 2");

  // Clear preferences to simulate fresh reinstall
  prefs.clearLastFmSession();
  prefs.setLastFmRecentScrobbles([]);
  assert.equal(prefs.getLastFm().username, "");
  assert.equal(prefs.getLastFmRecentScrobbles().length, 0);

  // Restore via importKotlinBackup (standard backup format)
  const success = prefs.importKotlinBackup(backupJson);
  assert.equal(success, true);
  assert.equal(prefs.getLastFm().username, "testuser");
  assert.equal(prefs.getLastFm().sessionKey, "testsessionkey123");

  const restored = prefs.getLastFmRecentScrobbles();
  assert.equal(restored.length, 5);
  assert.equal(restored[0].artist, "Artist 6");
  assert.equal(restored[0].track, "Track 6");
  assert.equal(restored[4].artist, "Artist 2");
  assert.equal(restored[4].track, "Track 2");
});

test("Preferences - Kotlin backup restore falls back to single last_scrobbled_track when recent_scrobbles missing", () => {
  const prefs = createMockPreferences();
  const legacyBackup = JSON.stringify({
    lastfm_prefs: {
      username: "legacyuser",
      session_key: "legacysession",
      last_scrobbled_track: "Dua Lipa - Training Season"
    }
  });

  const success = prefs.importKotlinBackup(legacyBackup);
  assert.equal(success, true);
  assert.equal(prefs.getLastFm().username, "legacyuser");
  assert.equal(prefs.getLastFm().sessionKey, "legacysession");

  const scrobbles = prefs.getLastFmRecentScrobbles();
  assert.equal(scrobbles.length, 1);
  assert.equal(scrobbles[0].artist, "Dua Lipa");
  assert.equal(scrobbles[0].track, "Training Season");
});



test("Preferences - recent scrobbles stay newest first when delivered out of order", () => {
  // Regression: the outbox delivers a backlog newest entry first, so simply prepending
  // left the oldest scrobble of the batch at the head of the list. "Last scrobbled" and
  // its listened-time label both read from the head, so they showed a stale track and an
  // incorrect time whenever anything had queued up.
  const prefs = createMockPreferences();
  const base = 1_700_000_000_000;

  // Delivered newest first, as the queue does.
  for (const offset of [200_000, 100_000, 0]) {
    prefs.addLastFmRecentScrobble({
      artist: `Artist ${offset / 100_000}`,
      track: `Track ${offset / 100_000}`,
      stationName: "Radio 1",
      timestampMs: base + offset
    });
  }

  const scrobbles = prefs.getLastFmRecentScrobbles();
  assert.deepEqual(
    scrobbles.map((entry) => entry.timestampMs),
    [base + 200_000, base + 100_000, base],
    "the list is ordered by listen time, not by delivery order"
  );
  assert.equal(prefs.getLastFmLastScrobbled(), "Artist 2 - Track 2");
});
