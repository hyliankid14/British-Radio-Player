import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View
} from "react-native";
import * as Linking from "expo-linking";
import Constants from "expo-constants";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { Preferences } from "../../src/storage/preferences";
import { AUDIO_QUALITIES, AudioQuality } from "../../src/data/stations";
import { StationRepository } from "../../src/data/stations";
import { StationLogo } from "../../src/components/StationLogo";
import { Dropdown, DropdownOption } from "../../src/components/Dropdown";
import { usePlayerStore } from "../../src/store/playerStore";
import { useAppTheme, useThemeMode, setAppTheme, ThemeMode } from "../../src/theme/colors";
import { NativeAndroid } from "../../src/native/nativeAndroid";
import { LastFmApi } from "../../src/api/lastfm";
import { useDownloadStore } from "../../src/downloads/downloadStore";
import { openDownloadsFolder } from "../../src/downloads/openDownloads";
import { fetchIndexStatus, IndexStatus } from "../../src/podcasts/indexStatus";
import {
  checkForNewPodcasts,
  ensureNotificationPermissions
} from "../../src/notifications/notifications";

const AUTO_NAME = Platform.OS === "ios" ? "CarPlay" : "Android Auto";

const TITLES: Record<string, string> = {
  theme: "Theme",
  playback: "Playback",
  lastfm: "Last.fm Scrobbler",
  alarm: "Alarm",
  startup_page: "Startup page",
  android_auto: AUTO_NAME,
  subscriptions: "Subscriptions",
  indexing: "Indexing",
  backup: "Backup",
  privacy: "Privacy",
  about: "About"
};

const THEME_OPTIONS: DropdownOption<ThemeMode>[] = [
  { value: "system", label: "Match system" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" }
];

const QUALITY_OPTIONS: DropdownOption<AudioQuality>[] = (
  ["HIGH", "MEDIUM", "LOW", "AUTO"] as AudioQuality[]
).map((value) => ({ value, label: AUDIO_QUALITIES[value].label }));

const ARTWORK_OPTIONS: DropdownOption<string>[] = [
  { value: "episode", label: "Episode artwork" },
  { value: "podcast", label: "Podcast artwork" }
];

const SCROLL_OPTIONS: DropdownOption<string>[] = [
  { value: "all", label: "Scroll all stations" },
  { value: "favourites", label: "Scroll favourites only" }
];

const AUTOPLAY_OPTIONS: DropdownOption<string>[] = [
  { value: "all", label: "All podcasts" },
  { value: "subscriptions", label: "Subscriptions only" },
  { value: "none", label: "None" }
];

const STARTUP_OPTIONS: DropdownOption<string>[] = [
  { value: "favourites", label: "Favourite stations" },
  { value: "all_stations", label: "All stations" },
  { value: "subscribed_podcasts", label: "Subscribed podcasts" },
  { value: "playlists", label: "Playlists" }
];

const REFRESH_OPTIONS: DropdownOption<number>[] = [0, 15, 30, 60, 120, 360, 720, 1440].map(
  (value) => ({
    value,
    label:
      value === 0
        ? "Disabled"
        : value >= 60
        ? `${value / 60} hour${value === 60 ? "" : "s"}`
        : `${value} minutes`
  })
);

const DOWNLOAD_LIMIT_OPTIONS: DropdownOption<number>[] = [1, 2, 3, 5, 10].map((value) => ({
  value,
  label: value === 1 ? "Latest episode" : `${value} episodes`
}));

export default function SettingsDetail() {
  const theme = useAppTheme();
  const router = useRouter();
  const { section = "about" } = useLocalSearchParams<{ section?: string }>();
  const title = TITLES[String(section)] || "Settings";
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.surface }]} edges={["top"]}>
      <View style={[styles.toolbar, { backgroundColor: theme.surfaceContainer }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityLabel="Back">
          <MaterialIcons name="arrow-back" size={24} color={theme.onSurface} />
        </TouchableOpacity>
        <Text style={[styles.toolbarTitle, { color: theme.onSurface }]}>{title}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {section === "theme" && <ThemePage />}
        {section === "playback" && <PlaybackPage />}
        {section === "lastfm" && <LastFmPage />}
        {section === "android_auto" && <AndroidAutoPage />}
        {section === "backup" && <BackupPage />}
        {section === "about" && <AboutPage />}
        {section === "privacy" && <PrivacyPage />}
        {section === "alarm" && <AlarmPage />}
        {section === "subscriptions" && <SubscriptionsPage />}
        {section === "indexing" && <IndexingPage />}
        {section === "startup_page" && <StartupPage />}
      </ScrollView>
    </SafeAreaView>
  );
}

function ThemePage() {
  const mode = useThemeMode();
  return (
    <Card title="Colour scheme" subtitle="Choose the app colour scheme">
      <Dropdown
        value={mode}
        options={THEME_OPTIONS}
        onChange={setAppTheme}
      />
    </Card>
  );
}

function PlaybackPage() {
  const { audioQuality, setAudioQuality } = usePlayerStore();
  const [settings, setSettings] = useState<{
    auto: boolean; artwork: string; pause: boolean; scroll: string;
    shake: boolean; bluetooth: boolean; next: string;
  }>({
    auto: Preferences.getSetting("pref_auto_quality", true),
    artwork: Preferences.getSetting("pref_podcast_artwork", "episode"),
    pause: Preferences.getSetting("pref_pause_buffering", true),
    scroll: Preferences.getSetting("pref_scroll_mode", "all"),
    shake: Preferences.getSetting("pref_shake_random", false),
    bluetooth: Preferences.getSetting("pref_stop_bluetooth", false),
    next: Preferences.getSetting("pref_autoplay_next", "none")
  });
  const update = (key: keyof typeof settings, value: string | boolean) => {
    Preferences.setSetting(({ auto: "pref_auto_quality", artwork: "pref_podcast_artwork", pause: "pref_pause_buffering", scroll: "pref_scroll_mode", shake: "pref_shake_random", bluetooth: "pref_stop_bluetooth", next: "pref_autoplay_next" } as const)[key], value);
    setSettings((current) => ({ ...current, [key]: value }));
  };
  return <>
    <Card title="Audio quality" subtitle="Choose the stream quality used for playback">
      <SwitchRow title="Auto-detect based on network" subtitle="Automatically select the best available bitrate" value={settings.auto} onChange={(value) => update("auto", value)} />
      <Dropdown
        value={audioQuality}
        options={QUALITY_OPTIONS}
        disabled={settings.auto}
        onChange={(value) => { update("auto", false); void setAudioQuality(value); }}
      />
    </Card>
    <Card title="Podcast artwork" subtitle="Choose which artwork is shown during podcast playback">
      <Dropdown value={settings.artwork} options={ARTWORK_OPTIONS} onChange={(value) => update("artwork", value)} />
    </Card>
    <Card title="Live radio pause behaviour" subtitle="Configure buffering when live radio is paused">
      <SwitchRow title="Pause buffering (resume playback)" subtitle="Buffer live radio for up to 50 seconds whilst paused" value={settings.pause} onChange={(value) => update("pause", value)} />
    </Card>
    <Card title="Next/previous behaviour" subtitle="Choose how station navigation works">
      <Dropdown value={settings.scroll} options={SCROLL_OPTIONS} onChange={(value) => update("scroll", value)} />
      <SwitchRow title="Shake to select a random podcast" subtitle="" value={settings.shake} onChange={(value) => update("shake", value)} />
      <SwitchRow title="Stop playback when Bluetooth device disconnects" subtitle="" value={settings.bluetooth} onChange={(value) => update("bluetooth", value)} />
    </Card>
    <Card title="Automatically play next episode when completed" subtitle="Choose which episodes may continue automatically">
      <Dropdown value={settings.next} options={AUTOPLAY_OPTIONS} onChange={(value) => update("next", value)} />
    </Card>
  </>;
}

function LastFmPage() {
  const [settings, setSettings] = useState(Preferences.getLastFm());
  useEffect(() => {
    // The root layout performs the OAuth token exchange; refresh the page when it lands.
    const subscription = Preferences.onChanged((key) => {
      if (key.startsWith("pref_lastfm")) setSettings(Preferences.getLastFm());
    });
    return () => subscription.remove();
  }, []);
  const connect = async () => {
    if (!LastFmApi.isConfigured()) {
      Alert.alert("Last.fm setup required", "Configure the Last.fm API key and secret before connecting.");
      return;
    }
    await Linking.openURL(LastFmApi.authUrl());
  };
  return <>
    <Card title="Account" subtitle={settings.username ? `Connected as ${settings.username}` : "Connect your Last.fm account to scrobble songs directly"}>
      <PrimaryButton
        label={settings.sessionKey ? "Disconnect Last.fm" : "Connect to Last.fm"}
        onPress={settings.sessionKey ? () => {
          Preferences.clearLastFmSession();
          setSettings(Preferences.getLastFm());
        } : connect}
      />
    </Card>
    <Card title="Scrobbling options" subtitle="Control which playback events are sent to scrobbling services">
      <SwitchRow title="Direct Last.fm scrobbling" subtitle="Send Now Playing and scrobbles to your linked profile" value={settings.direct && !!settings.sessionKey} disabled={!settings.sessionKey} onChange={(value) => { Preferences.setLastFmDirect(value); setSettings(Preferences.getLastFm()); }} />
      {Platform.OS === "android" && (
        <SwitchRow title="External scrobbler broadcasts" subtitle="Broadcast tracks to third-party scrobbler apps" value={settings.broadcast} onChange={(value) => { Preferences.setLastFmBroadcast(value); setSettings(Preferences.getLastFm()); }} />
      )}
      <SwitchRow title="Scrobble podcasts" subtitle="Also scrobble podcast episodes as tracks" value={settings.podcasts} onChange={(value) => { Preferences.setLastFmPodcasts(value); setSettings(Preferences.getLastFm()); }} />
    </Card>
    <Card title="Recent activity" subtitle="Last.fm scrobbling status">
      <BodyText>{Preferences.getLastFmLastScrobbled() || "No tracks scrobbled yet"}</BodyText>
    </Card>
    <Card title="How Scrobbling Works">
      <BodyText>
        BBC Radio Player detects songs played on live BBC music stations (such as Radio 1, Radio 2, 6 Music, and 1Xtra) using the BBC RMS feed.
        {"\n\n"}
        Tracks are marked 'Now Playing' as soon as they start, and are submitted as scrobbles once you have listened for at least 50% of the song's duration or 4 minutes.
      </BodyText>
    </Card>
  </>;
}

function AndroidAutoPage() {
  const theme = useAppTheme();
  const stations = StationRepository.getAll();
  const stationOptions: DropdownOption<string>[] = [
    { value: "", label: "No station selected" },
    ...stations.map((station) => ({ value: station.id, label: station.title }))
  ];
  const [settings, setSettings] = useState({
    station: Preferences.getSetting("pref_carplay_station", ""),
    autoResume: Preferences.getSetting("pref_carplay_auto_resume", true),
    hidePlayed: Preferences.getSetting("pref_carplay_hide_played", false)
  });
  const update = (key: keyof typeof settings, value: string | boolean) => {
    const preferenceKey = {
      station: "pref_carplay_station",
      autoResume: "pref_carplay_auto_resume",
      hidePlayed: "pref_carplay_hide_played"
    }[key];
    Preferences.setSetting(preferenceKey, value);
    setSettings((current) => ({ ...current, [key]: value }));
  };

  return <>
    <Card title="Default station" subtitle={`Station selected when ${AUTO_NAME} starts playback`}>
      <Dropdown
        value={settings.station}
        options={stationOptions}
        placeholder="Select a station"
        onChange={(value) => update("station", value)}
        renderLeading={(option) => <StationLeading stationId={option.value} />}
      />
    </Card>
    <Card title="Playback" subtitle={`Control playback behaviour in ${AUTO_NAME}`}>
      <SwitchRow
        title="Automatically resume playback"
        subtitle={`Resume the last station when ${AUTO_NAME} connects`}
        value={settings.autoResume}
        onChange={(value) => update("autoResume", value)}
      />
      <SwitchRow
        title="Hide played episodes"
        subtitle="Hide episodes already marked as played"
        value={settings.hidePlayed}
        onChange={(value) => update("hidePlayed", value)}
      />
    </Card>
  </>;
}

function StationLeading({ stationId, size = 28 }: { stationId: string; size?: number }) {
  const theme = useAppTheme();
  if (stationId) return <StationLogo stationId={stationId} size={size} borderRadius={6} />;
  return (
    <View
      style={[
        styles.stationPlaceholder,
        { width: size, height: size, borderRadius: 6, backgroundColor: theme.surfaceVariant }
      ]}
    >
      <MaterialIcons name="block" size={Math.round(size * 0.6)} color={theme.onSurfaceVariant} />
    </View>
  );
}

function BackupPage() {
  const [isImporting, setIsImporting] = useState(false);
  const importSettings = async () => {
    let documentPicker: typeof import("expo-document-picker");
    try {
      // Lazy loading keeps older native builds usable until they are rebuilt
      // with expo-document-picker included.
      documentPicker = require("expo-document-picker") as typeof import("expo-document-picker");
    } catch {
      Alert.alert(
        "Import unavailable",
        "This build does not include the iOS document picker. Rebuild the app before importing a backup."
      );
      return;
    }
    let result: Awaited<ReturnType<typeof documentPicker.getDocumentAsync>>;
    try {
      result = await documentPicker.getDocumentAsync({
        type: "application/json",
        copyToCacheDirectory: true,
        multiple: false
      });
    } catch {
      Alert.alert("Import failed", "The document picker could not be opened.");
      return;
    }
    if (result.canceled || !result.assets?.[0]) return;
    setIsImporting(true);
    try {
      const response = await fetch(result.assets[0].uri);
      const json = await response.text();
      const imported = Preferences.importKotlinBackup(json) || Preferences.importBackup(json);
      Alert.alert(
        imported ? "Import successful" : "Import failed",
        imported ? "Your settings have been restored." : "The selected file is not a valid BBC Radio Player backup."
      );
    } catch {
      Alert.alert("Import failed", "The selected backup could not be read.");
    } finally {
      setIsImporting(false);
    }
  };
  const lastBackup = Preferences.getSetting("pref_last_backup_at", "");
  return (
    <Card title="Export & import" subtitle="Export and import app settings">
      <PrimaryButton
        label="Export settings"
        onPress={() => {
          Preferences.setSetting("pref_last_backup_at", new Date().toISOString());
          void Share.share({ title: "British Radio Player Backup", message: Preferences.exportBackup() });
        }}
      />
      <BodyText>Last backup: {lastBackup ? new Date(lastBackup).toLocaleString() : "Never"}</BodyText>
      <SecondaryButton
        label={isImporting ? "Importing…" : "Import settings"}
        disabled={isImporting}
        onPress={() => void importSettings()}
      />
    </Card>
  );
}

function AboutPage() {
  const [checking, setChecking] = useState(false);
  const currentVersion = Constants.expoConfig?.version ?? "1.0.0";

  const checkForUpdates = async () => {
    setChecking(true);
    try {
      const info = await NativeAndroid.checkForUpdate(currentVersion);
      if (!info) {
        Alert.alert("Update check failed", "Update checks are only available in the Android build. iOS updates are delivered through the App Store.");
      } else if (info.available) {
        Alert.alert(
          `Update available: ${info.version}`,
          `You are on ${currentVersion}. Download and install the latest version?`,
          [
            { text: "Later", style: "cancel" },
            {
              text: "Download",
              onPress: () => NativeAndroid.downloadAndInstallUpdate(info.apkUrl, info.apkName)
            }
          ]
        );
      } else {
        Alert.alert("Up to date", `You are running the latest version (${currentVersion}).`);
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <Card title="British Radio Player" subtitle={`Version ${currentVersion}`}>
      <BodyText>
        Unofficial third-party client. BBC and station trademarks are property of the British
        Broadcasting Corporation. Streams use public BBC APIs.
      </BodyText>
      <BodyText>Licensed under the GNU General Public License v3.0.</BodyText>
      <SecondaryButton
        label="View source on GitHub"
        onPress={() => void Linking.openURL("https://github.com/hyliankid14/British-Radio-Player")}
      />
      <PrimaryButton
        label={checking ? "Checking…" : "Check for updates"}
        disabled={checking}
        onPress={() => void checkForUpdates()}
      />
    </Card>
  );
}

function StartupPage() {
  const [current, setCurrent] = useState<string>(
    Preferences.getSetting<string>("pref_startup_page", "all_stations")
  );
  const update = (value: string) => {
    Preferences.setSetting("pref_startup_page", value);
    setCurrent(value);
  };
  return (
    <Card title="Default screen" subtitle={`Applies to the app and ${AUTO_NAME}`}>
      <Dropdown value={current} options={STARTUP_OPTIONS} onChange={update} />
    </Card>
  );
}

function PrivacyPage() {
  const [enabled, setEnabled] = useState<boolean>(Preferences.getSetting("pref_analytics", false));
  return <>
    <Card title="Analytics" subtitle="Help improve British Radio Player with anonymous usage data">
      <SwitchRow title="Enable analytics" subtitle="No personal information or device identifiers are collected" value={enabled} onChange={(value) => { Preferences.setSetting("pref_analytics", value); setEnabled(value); }} />
    </Card>
    <Card title="Privacy policy" subtitle="Review how data is handled">
      <SecondaryButton
        label="View privacy policy"
        onPress={() => Alert.alert("Privacy Policy", "Analytics are anonymous and used only to understand station, podcast, and playback usage. No personal information, device identifiers, or location data are collected.")}
      />
    </Card>
  </>;
}

function AlarmPage() {
  const theme = useAppTheme();
  const stations = StationRepository.getAll();
  const stationOptions: DropdownOption<string>[] = [
    { value: "", label: "No station selected" },
    ...stations.map((station) => ({ value: station.id, label: station.title }))
  ];
  const [settings, setSettings] = useState({
    enabled: Preferences.getSetting("pref_alarm_enabled", false),
    hour: Preferences.getSetting("pref_alarm_hour", 7),
    minute: Preferences.getSetting("pref_alarm_minute", 0),
    station: Preferences.getSetting("pref_alarm_station", ""),
    ramp: Preferences.getSetting("pref_alarm_ramp", true),
    volume: Preferences.getSetting("pref_alarm_volume", 5),
    days: Preferences.getSetting("pref_alarm_days", "1,2,3,4,5")
  });
  const update = (key: string, value: string | number | boolean) => {
    Preferences.setSetting(`pref_alarm_${key}`, value);
    setSettings((current) => ({ ...current, [key]: value }));
  };

  // Keep the native exact alarm in sync with the stored settings.
  useEffect(() => {
    const mask = String(settings.days)
      .split(",")
      .filter(Boolean)
      .reduce((acc, day) => acc | (1 << Number(day)), 0);
    if (settings.enabled && settings.station) {
      NativeAndroid.requestNotificationPermission();
      NativeAndroid.scheduleAlarm(
        Number(settings.hour),
        Number(settings.minute),
        mask,
        String(settings.station),
        Boolean(settings.ramp),
        Number(settings.volume)
      );
    } else {
      NativeAndroid.cancelAlarm();
    }
  }, [settings]);
  return (
    <Card title="Enable alarm" subtitle="Wake-up alarms and station start options">
      <SwitchRow title="Enable alarm" subtitle="Start the selected station at the scheduled time" value={settings.enabled} onChange={(value) => update("enabled", value)} />
      <Text style={[styles.subheading, { color: theme.onSurfaceVariant }]}>Alarm time</Text>
      <View style={styles.inline}>
        <TouchableOpacity style={[styles.valueButton, { borderColor: theme.outline }]} onPress={() => update("hour", (Number(settings.hour) + 1) % 24)} accessibilityLabel="Increase alarm hour">
          <Text style={[styles.valueText, { color: theme.onSurface }]}>{String(settings.hour).padStart(2, "0")}</Text>
        </TouchableOpacity>
        <Text style={[styles.colon, { color: theme.onSurface }]}>:</Text>
        <TouchableOpacity style={[styles.valueButton, { borderColor: theme.outline }]} onPress={() => update("minute", (Number(settings.minute) + 5) % 60)} accessibilityLabel="Increase alarm minutes">
          <Text style={[styles.valueText, { color: theme.onSurface }]}>{String(settings.minute).padStart(2, "0")}</Text>
        </TouchableOpacity>
      </View>
      <Text style={[styles.subheading, { color: theme.onSurfaceVariant }]}>Days of the week</Text>
      <View style={styles.days}>
        {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => {
          const active = String(settings.days).split(",").includes(String(index));
          return (
            <TouchableOpacity
              key={`${day}-${index}`}
              onPress={() => {
                const values = new Set(String(settings.days).split(",").filter(Boolean));
                if (active) values.delete(String(index)); else values.add(String(index));
                update("days", Array.from(values).sort().join(","));
              }}
              style={[
                styles.day,
                { borderColor: theme.outline },
                active && { backgroundColor: theme.primary, borderColor: theme.primary }
              ]}
            >
              <Text style={{ color: active ? theme.onPrimary : theme.onSurface }}>{day}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={[styles.subheading, { color: theme.onSurfaceVariant }]}>Station</Text>
      <Dropdown
        value={settings.station}
        options={stationOptions}
        placeholder="Select a station"
        onChange={(value) => update("station", value)}
        renderLeading={(option) => <StationLeading stationId={option.value} />}
      />
      <SwitchRow title="Progressive radio volume (slowly gets louder)" subtitle="" value={settings.ramp} onChange={(value) => update("ramp", value)} />
      <View style={{ opacity: settings.ramp ? 0.45 : 1 }}>
        <Text style={[styles.subheading, { color: theme.onSurfaceVariant }]}>Manual alarm volume ({settings.volume}/10)</Text>
        <View style={styles.sliderLabels}>
          <Text style={[styles.sliderLabel, { color: theme.onSurfaceVariant }]}>1</Text>
          <Text style={[styles.sliderLabel, { color: theme.onSurfaceVariant }]}>10</Text>
        </View>
        <View style={styles.volumeSlider}>
          {Array.from({ length: 10 }, (_, index) => {
            const value = index + 1;
            return (
              <TouchableOpacity
                key={value}
                disabled={settings.ramp}
                onPress={() => update("volume", value)}
                style={[
                  styles.volumeStep,
                  { backgroundColor: value <= Number(settings.volume) ? theme.primary : theme.outlineVariant }
                ]}
                accessibilityLabel={`Set alarm volume to ${value}`}
              />
            );
          })}
        </View>
      </View>
    </Card>
  );
}

function SubscriptionsPage() {
  const [settings, setSettings] = useState({
    refresh: Preferences.getSetting("pref_subscription_refresh", 60),
    auto: Preferences.getSetting("pref_auto_download", false),
    limit: Preferences.getSetting("pref_auto_download_limit", 1),
    saved: Preferences.getSetting("pref_auto_download_saved", false),
    wifi: Preferences.getSetting("pref_download_wifi", true),
    deletePlayed: Preferences.getSetting("pref_delete_played", false)
  });
  const update = (key: keyof typeof settings, value: string | number | boolean) => {
    Preferences.setSetting(({ refresh: "pref_subscription_refresh", auto: "pref_auto_download", limit: "pref_auto_download_limit", saved: "pref_auto_download_saved", wifi: "pref_download_wifi", deletePlayed: "pref_delete_played" } as const)[key], value);
    setSettings((current) => ({ ...current, [key]: value }));
  };
  const deleteAllDownloads = () => {
    Alert.alert("Delete all downloads?", "Downloaded episodes will be removed from this device.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          const removed = useDownloadStore.getState().removeAll();
          Alert.alert("Downloads", removed > 0 ? "All downloaded episodes have been deleted." : "There were no downloads to delete.");
        }
      }
    ]);
  };
  return <>
    <Card title="Subscription notifications" subtitle="Check for new episodes every">
      <Dropdown value={settings.refresh} options={REFRESH_OPTIONS} onChange={(value) => update("refresh", value)} />
    </Card>
    <Card title="Podcast downloads" subtitle="Manage automatic podcast downloads">
      <SwitchRow title="Auto-download subscribed podcasts" subtitle="" value={settings.auto} onChange={(value) => update("auto", value)} />
      <Dropdown value={settings.limit} options={DOWNLOAD_LIMIT_OPTIONS} disabled={!settings.auto} onChange={(value) => update("limit", value)} />
      <SwitchRow title="Auto-download saved episodes" subtitle="" value={settings.saved} onChange={(value) => update("saved", value)} />
      <SwitchRow title="Download on WiFi only" subtitle="" value={settings.wifi} onChange={(value) => update("wifi", value)} />
      <SwitchRow title="Delete episode when played to completion" subtitle="" value={settings.deletePlayed} onChange={(value) => update("deletePlayed", value)} />
      <SecondaryButton label="Open downloads" onPress={() => void openDownloadsFolder()} />
      <SecondaryButton label="Delete all downloads" onPress={deleteAllDownloads} />
    </Card>
  </>;
}

function IndexingPage() {
  const theme = useAppTheme();
  const [notifications, setNotifications] = useState<boolean>(
    Preferences.getSetting<boolean>("pref_n_notifications", false)
  );
  const [excludeEnglish, setExcludeEnglish] = useState<boolean>(
    Preferences.getSetting<boolean>("pref_exclude_non_english", false)
  );
  const [status, setStatus] = useState<IndexStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    const result = await fetchIndexStatus();
    setStatus(result);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const toggleNotifications = async (value: boolean) => {
    if (value) {
      const granted = await ensureNotificationPermissions();
      if (!granted) {
        Alert.alert(
          "Notifications disabled",
          "Enable notifications for British Radio Player in system settings to receive new podcast alerts."
        );
        return;
      }
    }
    Preferences.setSetting("pref_n_notifications", value);
    setNotifications(value);
    if (value) void checkForNewPodcasts(true);
  };

  const toggleExcludeEnglish = (value: boolean) => {
    Preferences.setSetting("pref_exclude_non_english", value);
    setExcludeEnglish(value);
  };

  const formatTimestamp = (iso?: string) => {
    if (!iso) return "—";
    const parsed = new Date(iso);
    return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleString();
  };

  const statusValue = (value: string) => (loading ? "Loading…" : value);

  return <>
    <Card title="Indexing options" subtitle="Configure podcast catalogue notifications and filtering">
      <SwitchRow
        title="Notify me when new podcasts are added"
        subtitle=""
        value={notifications}
        onChange={(value) => void toggleNotifications(value)}
      />
      <SwitchRow
        title="Exclude non-English podcasts"
        subtitle="Hide BBC World Service language editions from lists and search"
        value={excludeEnglish}
        onChange={toggleExcludeEnglish}
      />
    </Card>
    <Card title="Index status" subtitle="Live from the cloud index">
      <Text style={[styles.subheading, { color: theme.onSurfaceVariant }]}>Updates</Text>
      <BodyText>Index last updated: {statusValue(formatTimestamp(status?.generatedAt))}</BodyText>
      <BodyText>Most popular updated: {statusValue(formatTimestamp(status?.popularGeneratedAt))}</BodyText>
      <Text style={[styles.subheading, { color: theme.onSurfaceVariant }]}>Coverage</Text>
      <BodyText>
        {statusValue(status ? `${status.podcastCount} podcasts indexed` : "— podcasts indexed")}
      </BodyText>
      <BodyText>
        {statusValue(status ? `${status.episodeCount} episodes indexed` : "— episodes indexed")}
      </BodyText>
      <SecondaryButton
        label={loading ? "Refreshing…" : "Refresh"}
        disabled={loading}
        onPress={() => void loadStatus()}
      />
      {!loading && !status ? (
        <BodyText>Could not reach the cloud index. Check your connection and try again.</BodyText>
      ) : null}
    </Card>
  </>;
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  const theme = useAppTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.surfaceContainer, borderColor: theme.outlineVariant }]}>
      <Text style={[styles.cardTitle, { color: theme.onSurface }]}>{title}</Text>
      {subtitle ? (
        <Text style={[styles.cardSubtitle, { color: theme.onSurfaceVariant }]}>{subtitle}</Text>
      ) : null}
      {children}
    </View>
  );
}

function SwitchRow({ title, subtitle, value, disabled, onChange }: { title: string; subtitle: string; value: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  const theme = useAppTheme();
  return (
    <View style={[styles.switchRow, { borderTopColor: theme.outlineVariant }]}>
      <View style={styles.flex}>
        <Text style={[styles.optionText, { color: disabled ? theme.onSurfaceVariant : theme.onSurface }]}>{title}</Text>
        {subtitle ? <Text style={[styles.cardSubtitle, { color: theme.onSurfaceVariant }]}>{subtitle}</Text> : null}
      </View>
      <View style={styles.switchControl}>
        <Switch value={value} disabled={disabled} onValueChange={onChange} />
      </View>
    </View>
  );
}

function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const theme = useAppTheme();
  return (
    <TouchableOpacity
      style={[styles.primaryButton, { backgroundColor: theme.primary }, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={[styles.primaryButtonText, { color: theme.onPrimary }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function SecondaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const theme = useAppTheme();
  return (
    <TouchableOpacity
      style={[styles.secondaryButton, { borderColor: theme.outline }, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={[styles.secondaryButtonText, { color: theme.primary }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function BodyText({ children }: { children: React.ReactNode }) {
  const theme = useAppTheme();
  return <Text style={[styles.body, { color: theme.onSurfaceVariant }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  toolbar: { height: 56, flexDirection: "row", alignItems: "center", elevation: 4 },
  backButton: { width: 56, height: 56, alignItems: "center", justifyContent: "center" },
  toolbarTitle: { fontSize: 22, fontWeight: "600" },
  content: { padding: 16, paddingBottom: 40 },
  card: { borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 16 },
  cardTitle: { fontSize: 20, fontWeight: "600" },
  cardSubtitle: { fontSize: 14, lineHeight: 20, marginTop: 4 },
  optionText: { fontSize: 16 },
  switchRow: { minHeight: 72, flexDirection: "row", alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth, marginTop: 8 },
  switchControl: { alignSelf: "stretch", justifyContent: "center" },
  flex: { flex: 1, paddingRight: 12 },
  disabled: { opacity: 0.5 },
  primaryButton: { minHeight: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", marginVertical: 16 },
  primaryButtonText: { fontSize: 15, fontWeight: "600" },
  secondaryButton: { minHeight: 44, borderRadius: 22, borderWidth: 1, alignItems: "center", justifyContent: "center", marginVertical: 8 },
  secondaryButtonText: { fontSize: 15, fontWeight: "600" },
  body: { fontSize: 15, lineHeight: 22, marginTop: 16 },
  subheading: { fontSize: 14, fontWeight: "600", marginTop: 18, marginBottom: 4 },
  inline: { flexDirection: "row", alignItems: "center", marginVertical: 8 },
  valueButton: { minWidth: 64, minHeight: 44, borderWidth: 1, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  valueText: { fontSize: 18 },
  colon: { fontSize: 20, marginHorizontal: 8 },
  days: { flexDirection: "row", justifyContent: "space-between", marginVertical: 10 },
  day: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  stationPlaceholder: { alignItems: "center", justifyContent: "center" },
  sliderLabels: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  sliderLabel: { fontSize: 13 },
  volumeSlider: { height: 28, flexDirection: "row", alignItems: "center", gap: 4, marginVertical: 8 },
  volumeStep: { flex: 1, height: 6, borderRadius: 3 }
});
