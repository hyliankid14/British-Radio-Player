import test from "node:test";
import assert from "node:assert/strict";

// In-memory memory store test for Preferences logic
import type { AudioQuality } from "../src/data/stations.ts";

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
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
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

      const updated = [entry, ...recent].slice(0, 20);
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

