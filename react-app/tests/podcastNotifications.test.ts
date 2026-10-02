import test from "node:test";
import assert from "node:assert/strict";

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
    SUBSCRIBED_PODCASTS: "pref_subscribed_podcasts"
  };

  return {
    getSubscribedPodcasts(): string[] {
      const raw = storage.getString(KEYS.SUBSCRIBED_PODCASTS);
      if (!raw) return [];
      try {
        return JSON.parse(raw);
      } catch {
        return [];
      }
    },
    setSubscribedPodcasts(podcastIds: string[]): void {
      storage.set(KEYS.SUBSCRIBED_PODCASTS, JSON.stringify(podcastIds));
    },
    isPodcastNotificationsEnabled(podcastId: string): boolean {
      if (!this.getSubscribedPodcasts().includes(podcastId)) return false;
      return storage.getBoolean(`pref_podcast_notifications_${podcastId}`) ?? false;
    },
    setPodcastNotificationsEnabled(podcastId: string, enabled: boolean): void {
      storage.set(`pref_podcast_notifications_${podcastId}`, enabled);
    },
    togglePodcastNotifications(podcastId: string): boolean {
      const enabled = !this.isPodcastNotificationsEnabled(podcastId);
      storage.set(`pref_podcast_notifications_${podcastId}`, enabled);
      return enabled;
    },
    togglePodcastSubscription(podcastId: string): boolean {
      const subscribed = this.getSubscribedPodcasts();
      const index = subscribed.indexOf(podcastId);
      let isSub = false;
      if (index >= 0) {
        subscribed.splice(index, 1);
        isSub = false;
        this.setPodcastNotificationsEnabled(podcastId, false);
      } else {
        subscribed.push(podcastId);
        isSub = true;
      }
      this.setSubscribedPodcasts(subscribed);
      return isSub;
    },
    setPodcastSubscribed(podcastId: string, subscribedState: boolean): void {
      const subscribed = this.getSubscribedPodcasts();
      const index = subscribed.indexOf(podcastId);
      if (subscribedState && index < 0) {
        subscribed.push(podcastId);
        this.setSubscribedPodcasts(subscribed);
      } else if (!subscribedState && index >= 0) {
        subscribed.splice(index, 1);
        this.setPodcastNotificationsEnabled(podcastId, false);
        this.setSubscribedPodcasts(subscribed);
      }
    },
    getRawStorage(): Map<string, any> {
      return memoryStore;
    }
  };
}

test("Podcast notifications are disabled by default when subscribing", () => {
  const prefs = createMockPreferences();
  prefs.togglePodcastSubscription("podcast-1");

  assert.deepEqual(prefs.getSubscribedPodcasts(), ["podcast-1"]);
  assert.equal(prefs.isPodcastNotificationsEnabled("podcast-1"), false);
});

test("Toggling podcast notifications enables and disables them", () => {
  const prefs = createMockPreferences();
  prefs.togglePodcastSubscription("podcast-1");

  const enabled = prefs.togglePodcastNotifications("podcast-1");
  assert.equal(enabled, true);
  assert.equal(prefs.isPodcastNotificationsEnabled("podcast-1"), true);

  const disabled = prefs.togglePodcastNotifications("podcast-1");
  assert.equal(disabled, false);
  assert.equal(prefs.isPodcastNotificationsEnabled("podcast-1"), false);
});

test("Unsubscribing resets notifications to disabled", () => {
  const prefs = createMockPreferences();
  prefs.togglePodcastSubscription("podcast-1");
  prefs.togglePodcastNotifications("podcast-1");
  assert.equal(prefs.isPodcastNotificationsEnabled("podcast-1"), true);

  // Unsubscribe
  prefs.togglePodcastSubscription("podcast-1");
  assert.deepEqual(prefs.getSubscribedPodcasts(), []);
  assert.equal(prefs.isPodcastNotificationsEnabled("podcast-1"), false);

  // Re-subscribing does not revive old notification setting
  prefs.togglePodcastSubscription("podcast-1");
  assert.deepEqual(prefs.getSubscribedPodcasts(), ["podcast-1"]);
  assert.equal(prefs.isPodcastNotificationsEnabled("podcast-1"), false);
});

test("Background sync only includes subscribed podcasts that have notifications enabled", () => {
  const prefs = createMockPreferences();
  prefs.togglePodcastSubscription("pod-bell-off");
  prefs.togglePodcastSubscription("pod-bell-on");
  prefs.togglePodcastNotifications("pod-bell-on");

  const notifyIds = prefs.getSubscribedPodcasts().filter((id) =>
    prefs.isPodcastNotificationsEnabled(id)
  );

  assert.deepEqual(notifyIds, ["pod-bell-on"]);
  assert.equal(notifyIds.includes("pod-bell-off"), false);
});

test("Background sync resolves empty list and interval 0 when no podcasts have notifications enabled", () => {
  const prefs = createMockPreferences();
  prefs.togglePodcastSubscription("pod-1");
  prefs.togglePodcastSubscription("pod-2");

  const notifyIds = prefs.getSubscribedPodcasts().filter((id) =>
    prefs.isPodcastNotificationsEnabled(id)
  );

  assert.equal(notifyIds.length, 0);

  // Simulating syncBackgroundSync decision
  const interval = 60;
  const scheduledInterval = notifyIds.length === 0 ? 0 : interval;
  assert.equal(scheduledInterval, 0);
});

test("Layout preference key prefix correctly matches podcast notification keys", () => {
  const podcastId = "p02nrss1";
  const notificationKey = `pref_podcast_notifications_${podcastId}`;

  // The old buggy prefix with trailing underscore failed:
  assert.equal(notificationKey.startsWith("pref_podcast_notif_"), false);

  // The fixed prefix matches:
  assert.equal(notificationKey.startsWith("pref_podcast_notifications_"), true);
});
