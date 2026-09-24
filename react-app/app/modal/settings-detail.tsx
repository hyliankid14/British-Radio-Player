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
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { Preferences } from "../../src/storage/preferences";
import { AUDIO_QUALITIES, AudioQuality, StationRepository } from "../../src/data/stations";
import { StationLogo } from "../../src/components/StationLogo";
import { Dropdown, DropdownOption } from "../../src/components/Dropdown";
import { usePlayerStore } from "../../src/store/playerStore";
import { useAppTheme, useThemeMode, setAppTheme, ThemeMode, useIsDarkTheme } from "../../src/theme/colors";
import { NativeAndroid } from "../../src/native/nativeAndroid";
import { LastFmApi } from "../../src/api/lastfm";
import { useDownloadStore } from "../../src/downloads/downloadStore";
import { openDownloadsFolder } from "../../src/downloads/openDownloads";
import { fetchIndexStatus, IndexStatus } from "../../src/podcasts/indexStatus";
import {
  distributionLabel,
  SHOW_GITHUB_LINK,
  SHOW_UPDATE_BUTTON
} from "../../src/config/distribution";
import {
  checkForNewPodcasts,
  ensureNotificationPermissions
} from "../../src/notifications/notifications";

const AUTO_NAME = "Android Auto";

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

const QUALITY_OPTIONS: { value: AudioQuality; label: string; icon?: keyof typeof MaterialIcons.glyphMap }[] = [
  { value: "HIGH", label: "High" },
  { value: "MEDIUM", label: "Medium" },
  { value: "LOW", label: "Low" }
];

const ARTWORK_OPTIONS = [
  { value: "episode", label: "Episode artwork", icon: "image" as const },
  { value: "podcast", label: "Podcast artwork", icon: "album" as const }
];

const SCROLL_OPTIONS = [
  { value: "all", label: "All stations", icon: "radio" as const },
  { value: "favourites", label: "Favourites only", icon: "star" as const }
];

const AUTOPLAY_OPTIONS = [
  { value: "none", label: "Off" },
  { value: "subscriptions", label: "Subscriptions" },
  { value: "all", label: "All podcasts" }
];

const STARTUP_ITEMS = [
  {
    value: "favourites",
    label: "Favourite stations",
    subtitle: "Your starred live stations and quick picks",
    icon: "star" as const
  },
  {
    value: "all_stations",
    label: "All stations",
    subtitle: "Complete national, regional and local BBC stations",
    icon: "radio" as const
  },
  {
    value: "subscribed_podcasts",
    label: "Subscribed podcasts",
    subtitle: "Your subscribed podcast feeds and new episodes",
    icon: "headphones" as const
  },
  {
    value: "playlists",
    label: "Playlists",
    subtitle: "Saved episodes and custom listening queues",
    icon: "bookmark" as const
  }
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
  const insets = useSafeAreaInsets();
  const { section = "about" } = useLocalSearchParams<{ section?: string }>();
  const title = TITLES[String(section)] || "Settings";

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.surface }]} edges={["top"]}>
      {/* Modern Material 3 / iOS Header */}
      <View style={[styles.toolbar, { borderBottomColor: theme.outlineVariant + "25" }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.backButton, { backgroundColor: theme.surfaceVariant + "60" }]}
          accessibilityLabel="Back"
          activeOpacity={0.7}
        >
          <MaterialIcons name="arrow-back" size={22} color={theme.onSurface} />
        </TouchableOpacity>
        <Text style={[styles.toolbarTitle, { color: theme.onSurface }]}>{title}</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: 60 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        {section === "theme" && <ThemePage />}
        {section === "playback" && <PlaybackPage />}
        {section === "lastfm" && <LastFmPage />}
        {section === "android_auto" && Platform.OS === "android" && <AndroidAutoPage />}
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

// ─── THEME PAGE ─────────────────────────────────────────────────────────────

function ThemePage() {
  const theme = useAppTheme();
  const mode = useThemeMode();

  const THEMES: { id: ThemeMode; label: string; description: string; icon: keyof typeof MaterialIcons.glyphMap }[] = [
    { id: "system", label: "System", description: "Follows device mode", icon: "settings-brightness" },
    { id: "light", label: "Light", description: "Clean & bright", icon: "light-mode" },
    { id: "dark", label: "Dark", description: "Gentle on eyes", icon: "dark-mode" }
  ];

  return (
    <>
      <SettingsSectionHeader label="Colour Scheme" />
      <SettingsCard>
        <Text style={[styles.cardTitle, { color: theme.onSurface }]}>Appearance</Text>
        <Text style={[styles.cardSubtitle, { color: theme.onSurfaceVariant, marginBottom: 14 }]}>
          Choose how British Radio Player looks across your device.
        </Text>

        <View style={styles.themeGrid}>
          {THEMES.map((item) => {
            const isSelected = mode === item.id;
            return (
              <TouchableOpacity
                key={item.id}
                style={[
                  styles.themeTile,
                  {
                    backgroundColor: isSelected ? theme.primaryContainer + "30" : theme.surfaceVariant,
                    borderColor: isSelected ? theme.primary : theme.outlineVariant + "35"
                  }
                ]}
                onPress={() => setAppTheme(item.id)}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.themeIconCircle,
                    {
                      backgroundColor: isSelected ? theme.primary : theme.surface,
                      borderColor: isSelected ? theme.primary : theme.outlineVariant + "40"
                    }
                  ]}
                >
                  <MaterialIcons
                    name={item.icon}
                    size={22}
                    color={isSelected ? theme.onPrimary : theme.onSurface}
                  />
                </View>
                <Text
                  style={[
                    styles.themeTileTitle,
                    { color: isSelected ? theme.primary : theme.onSurface, fontWeight: isSelected ? "700" : "600" }
                  ]}
                >
                  {item.label}
                </Text>
                <Text style={[styles.themeTileSubtitle, { color: theme.onSurfaceVariant }]}>
                  {item.description}
                </Text>
                {isSelected ? (
                  <View style={[styles.themeCheckBadge, { backgroundColor: theme.primary }]}>
                    <MaterialIcons name="check" size={14} color={theme.onPrimary} />
                  </View>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </View>
      </SettingsCard>
    </>
  );
}

// ─── PLAYBACK PAGE ──────────────────────────────────────────────────────────

function PlaybackPage() {
  const theme = useAppTheme();
  const { audioQuality, setAudioQuality } = usePlayerStore();
  const [settings, setSettings] = useState<{
    auto: boolean;
    artwork: string;
    pause: boolean;
    scroll: string;
    shake: boolean;
    bluetooth: boolean;
    next: string;
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
    Preferences.setSetting(
      (
        {
          auto: "pref_auto_quality",
          artwork: "pref_podcast_artwork",
          pause: "pref_pause_buffering",
          scroll: "pref_scroll_mode",
          shake: "pref_shake_random",
          bluetooth: "pref_stop_bluetooth",
          next: "pref_autoplay_next"
        } as const
      )[key],
      value
    );
    setSettings((current) => ({ ...current, [key]: value }));
  };

  return (
    <>
      <SettingsSectionHeader label="STREAMING QUALITY" />
      <SettingsCard>
        <SwitchRow
          icon="speed"
          title="Auto-detect based on network"
          subtitle="Automatically chooses the best bitrate for Wi-Fi or cellular"
          value={settings.auto}
          onChange={(value) => update("auto", value)}
        />
        {!settings.auto ? (
          <>
            <ItemSeparator />
            <Text style={[styles.inputLabel, { color: theme.onSurfaceVariant }]}>Manual audio quality</Text>
            <SegmentedControl
              options={QUALITY_OPTIONS}
              value={audioQuality}
              onChange={(value) => {
                update("auto", false);
                void setAudioQuality(value);
              }}
            />
          </>
        ) : null}
      </SettingsCard>

      <SettingsSectionHeader label="PODCAST ARTWORK" />
      <SettingsCard>
        <Text style={[styles.cardTitle, { color: theme.onSurface }]}>Now playing image</Text>
        <Text style={[styles.cardSubtitle, { color: theme.onSurfaceVariant, marginBottom: 12 }]}>
          Choose which artwork is shown during podcast playback
        </Text>
        <SegmentedControl
          options={ARTWORK_OPTIONS}
          value={settings.artwork}
          onChange={(value) => update("artwork", value)}
        />
      </SettingsCard>

      <SettingsSectionHeader label="LIVE RADIO BUFFERING" />
      <SettingsCard>
        <SwitchRow
          icon="pause-circle-outline"
          title="Pause buffering"
          subtitle="Buffer live radio for up to 50 seconds whilst paused so you resume without missing content"
          value={settings.pause}
          onChange={(value) => update("pause", value)}
        />
      </SettingsCard>

      <SettingsSectionHeader label="NAVIGATION & GESTURES" />
      <SettingsCard>
        <Text style={[styles.cardTitle, { color: theme.onSurface }]}>Station skip behaviour</Text>
        <Text style={[styles.cardSubtitle, { color: theme.onSurfaceVariant, marginBottom: 12 }]}>
          Choose how next/previous buttons navigate between stations
        </Text>
        <SegmentedControl
          options={SCROLL_OPTIONS}
          value={settings.scroll}
          onChange={(value) => update("scroll", value)}
        />
        <ItemSeparator />
        <SwitchRow
          icon="vibration"
          title="Shake to select random podcast"
          subtitle="Gently shake your device to discover something new"
          value={settings.shake}
          onChange={(value) => update("shake", value)}
        />
        <ItemSeparator />
        <SwitchRow
          icon="bluetooth-disabled"
          title="Stop playback on Bluetooth disconnect"
          subtitle="Pauses playback when headphones or car audio disconnect"
          value={settings.bluetooth}
          onChange={(value) => update("bluetooth", value)}
        />
      </SettingsCard>

      <SettingsSectionHeader label="CONTINUOUS PLAYBACK" />
      <SettingsCard>
        <Text style={[styles.cardTitle, { color: theme.onSurface }]}>Autoplay next episode</Text>
        <Text style={[styles.cardSubtitle, { color: theme.onSurfaceVariant, marginBottom: 12 }]}>
          Automatically start playing the next episode when current finishes
        </Text>
        <SegmentedControl
          options={AUTOPLAY_OPTIONS}
          value={settings.next}
          onChange={(value) => update("next", value)}
        />
      </SettingsCard>
    </>
  );
}

// ─── STARTUP PAGE ───────────────────────────────────────────────────────────

function StartupPage() {
  const theme = useAppTheme();
  const [current, setCurrent] = useState<string>(
    Preferences.getSetting<string>("pref_startup_page", "all_stations")
  );

  const update = (value: string) => {
    Preferences.setSetting("pref_startup_page", value);
    setCurrent(value);
  };

  return (
    <>
      <SettingsSectionHeader label="DEFAULT SCREEN" />
      <SettingsCard>
        <Text style={[styles.cardTitle, { color: theme.onSurface }]}>Startup page</Text>
        <Text style={[styles.cardSubtitle, { color: theme.onSurfaceVariant, marginBottom: 14 }]}>
          Choose which screen opens when launching the app
          {Platform.OS === "android" ? ` and ${AUTO_NAME}` : ""}.
        </Text>

        <View style={styles.radioList}>
          {STARTUP_ITEMS.map((item, index) => {
            const isSelected = current === item.value;
            const isLast = index === STARTUP_ITEMS.length - 1;
            return (
              <React.Fragment key={item.value}>
                <TouchableOpacity
                  style={[
                    styles.radioRow,
                    isSelected && { backgroundColor: theme.primaryContainer + "25" }
                  ]}
                  onPress={() => update(item.value)}
                  activeOpacity={0.7}
                >
                  <View
                    style={[
                      styles.iconCircle,
                      {
                        backgroundColor: isSelected ? theme.primary : theme.surfaceVariant,
                        borderColor: isSelected ? theme.primary : theme.outlineVariant + "40"
                      }
                    ]}
                  >
                    <MaterialIcons
                      name={item.icon}
                      size={20}
                      color={isSelected ? theme.onPrimary : theme.onSurface}
                    />
                  </View>
                  <View style={styles.flex}>
                    <Text
                      style={[
                        styles.radioLabel,
                        {
                          color: isSelected ? theme.primary : theme.onSurface,
                          fontWeight: isSelected ? "600" : "500"
                        }
                      ]}
                    >
                      {item.label}
                    </Text>
                    <Text style={[styles.radioSubtitle, { color: theme.onSurfaceVariant }]}>
                      {item.subtitle}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.radioCircle,
                      {
                        borderColor: isSelected ? theme.primary : theme.outline,
                        backgroundColor: isSelected ? theme.primary : "transparent"
                      }
                    ]}
                  >
                    {isSelected ? (
                      <View style={[styles.radioInnerDot, { backgroundColor: theme.onPrimary }]} />
                    ) : null}
                  </View>
                </TouchableOpacity>
                {!isLast && <ItemSeparator />}
              </React.Fragment>
            );
          })}
        </View>
      </SettingsCard>
    </>
  );
}

// ─── BACKUP PAGE ────────────────────────────────────────────────────────────

function BackupPage() {
  const theme = useAppTheme();
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [lastBackup, setLastBackup] = useState<string>(
    Preferences.getSetting("pref_last_backup_at", "")
  );

  const exportSettings = async () => {
    setIsExporting(true);
    try {
      const json = Preferences.exportBackup();
      const file = new File(
        Paths.cache,
        `british-radio-backup-${new Date().toISOString().slice(0, 10)}.json`
      );
      file.create({ intermediates: true, overwrite: true });
      file.write(json);

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: "application/json",
          dialogTitle: "Export British Radio Player settings",
          UTI: "public.json"
        });
      } else {
        await Share.share({ title: "British Radio Player Backup", message: json });
      }

      const now = new Date().toISOString();
      Preferences.setSetting("pref_last_backup_at", now);
      setLastBackup(now);
    } catch (error) {
      Alert.alert("Export failed", error instanceof Error ? error.message : "Could not export settings.");
    } finally {
      setIsExporting(false);
    }
  };

  const importSettings = async () => {
    let documentPicker: typeof import("expo-document-picker");
    try {
      documentPicker = require("expo-document-picker") as typeof import("expo-document-picker");
    } catch {
      Alert.alert(
        "Import unavailable",
        "This build does not include the document picker. Rebuild the app before importing a backup."
      );
      return;
    }
    let result: Awaited<ReturnType<typeof documentPicker.getDocumentAsync>>;
    try {
      result = await documentPicker.getDocumentAsync({
        type: ["application/json", "text/plain"],
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
      const uri = result.assets[0].uri;
      let json = "";
      try {
        json = await new File(uri).text();
      } catch {
        json = await (await fetch(uri)).text();
      }
      const imported = Preferences.importKotlinBackup(json) || Preferences.importBackup(json);
      Alert.alert(
        imported ? "Import successful" : "Import failed",
        imported
          ? "Your settings, favorites and playlists have been restored."
          : "The selected file is not a valid British Radio Player backup."
      );
    } catch {
      Alert.alert("Import failed", "The selected backup could not be read.");
    } finally {
      setIsImporting(false);
    }
  };

  const formattedDate = lastBackup
    ? new Date(lastBackup).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      })
    : "Never backed up";

  return (
    <>
      <SettingsSectionHeader label="EXPORT & RESTORE" />
      <SettingsCard>
        <View style={styles.heroHeader}>
          <View style={[styles.heroIconCircle, { backgroundColor: theme.primaryContainer }]}>
            <MaterialIcons name="cloud-sync" size={30} color={theme.onPrimaryContainer} />
          </View>
          <View style={styles.flex}>
            <Text style={[styles.cardTitle, { color: theme.onSurface }]}>Settings & Library</Text>
            <Text style={[styles.cardSubtitle, { color: theme.onSurfaceVariant }]}>
              Export your subscriptions, playlists, and settings to a JSON file or restore them anytime.
            </Text>
          </View>
        </View>

        <View style={[styles.statusBox, { backgroundColor: theme.surfaceVariant }]}>
          <MaterialIcons
            name={lastBackup ? "check-circle" : "history"}
            size={20}
            color={lastBackup ? "#4CAF50" : theme.onSurfaceVariant}
          />
          <View style={styles.flex}>
            <Text style={[styles.statusLabel, { color: theme.onSurfaceVariant }]}>Last backup</Text>
            <Text style={[styles.statusValue, { color: theme.onSurface }]}>{formattedDate}</Text>
          </View>
        </View>

        <View style={styles.buttonGroup}>
          <PrimaryButton
            icon="file-upload"
            label={isExporting ? "Exporting…" : "Export settings"}
            disabled={isExporting}
            onPress={() => void exportSettings()}
          />
          <SecondaryButton
            icon="file-download"
            label={isImporting ? "Importing…" : "Import settings"}
            disabled={isImporting}
            onPress={() => void importSettings()}
          />
        </View>
      </SettingsCard>
    </>
  );
}

// ─── LAST.FM PAGE ───────────────────────────────────────────────────────────

function LastFmPage() {
  const theme = useAppTheme();
  const [settings, setSettings] = useState(Preferences.getLastFm());

  useEffect(() => {
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

  const isConnected = !!settings.sessionKey;

  return (
    <>
      <SettingsSectionHeader label="ACCOUNT" />
      <SettingsCard>
        <View style={styles.heroHeader}>
          <View
            style={[
              styles.heroIconCircle,
              { backgroundColor: isConnected ? "#4CAF5020" : theme.primaryContainer }
            ]}
          >
            <MaterialIcons
              name="music-note"
              size={28}
              color={isConnected ? "#4CAF50" : theme.onPrimaryContainer}
            />
          </View>
          <View style={styles.flex}>
            <Text style={[styles.cardTitle, { color: theme.onSurface }]}>Last.fm Scrobbler</Text>
            <Text style={[styles.cardSubtitle, { color: theme.onSurfaceVariant }]}>
              {isConnected
                ? `Linked as ${settings.username}`
                : "Connect your Last.fm account to automatically scrobble songs from live BBC radio"}
            </Text>
          </View>
        </View>

        {isConnected ? (
          <SecondaryButton
            icon="link-off"
            label="Disconnect Last.fm"
            onPress={() => {
              Preferences.clearLastFmSession();
              setSettings(Preferences.getLastFm());
            }}
          />
        ) : (
          <PrimaryButton
            icon="link"
            label="Connect to Last.fm"
            onPress={connect}
          />
        )}
      </SettingsCard>

      <SettingsSectionHeader label="SCROBBLING OPTIONS" />
      <SettingsCard>
        <SwitchRow
          icon="cloud-upload"
          title="Direct Last.fm scrobbling"
          subtitle="Send Now Playing updates and scrobbles to your linked profile"
          value={settings.direct && isConnected}
          disabled={!isConnected}
          onChange={(value) => {
            Preferences.setLastFmDirect(value);
            setSettings(Preferences.getLastFm());
          }}
        />
        {Platform.OS === "android" ? (
          <>
            <ItemSeparator />
            <SwitchRow
              icon="sensors"
              title="External scrobbler broadcasts"
              subtitle="Broadcast track metadata to third-party Android scrobbler apps"
              value={settings.broadcast}
              onChange={(value) => {
                Preferences.setLastFmBroadcast(value);
                setSettings(Preferences.getLastFm());
              }}
            />
          </>
        ) : null}
        <ItemSeparator />
        <SwitchRow
          icon="podcasts"
          title="Scrobble podcasts"
          subtitle="Also track and scrobble podcast episodes as audio tracks"
          value={settings.podcasts}
          onChange={(value) => {
            Preferences.setLastFmPodcasts(value);
            setSettings(Preferences.getLastFm());
          }}
        />
      </SettingsCard>

      <SettingsSectionHeader label="ACTIVITY & INFO" />
      <SettingsCard>
        <Text style={[styles.cardTitle, { color: theme.onSurface }]}>Recent scrobbles</Text>
        <Text style={[styles.cardSubtitle, { color: theme.onSurfaceVariant, marginBottom: 12 }]}>
          {Preferences.getLastFmLastScrobbled() || "No tracks scrobbled yet"}
        </Text>
        <ItemSeparator />
        <Text style={[styles.inputLabel, { color: theme.onSurfaceVariant, marginTop: 8 }]}>How scrobbling works</Text>
        <Text style={[styles.body, { color: theme.onSurfaceVariant }]}>
          BBC Radio Player reads live song titles from BBC RMS streams (Radio 1, 2, 6 Music, 1Xtra).
          {"\n\n"}
          Songs are marked "Now Playing" immediately, and scrobbled after listening to at least 50% of the song or 4 minutes.
        </Text>
      </SettingsCard>
    </>
  );
}

// ─── ANDROID AUTO PAGE ──────────────────────────────────────────────────────

function AndroidAutoPage() {
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

  return (
    <>
      <SettingsSectionHeader label="DEFAULT STATION" />
      <SettingsCard>
        <Text style={[styles.cardTitle, { color: useAppTheme().onSurface }]}>Startup station</Text>
        <Text style={[styles.cardSubtitle, { color: useAppTheme().onSurfaceVariant, marginBottom: 12 }]}>
          Station selected automatically when {AUTO_NAME} opens
        </Text>
        <Dropdown
          value={settings.station}
          options={stationOptions}
          placeholder="Select a station"
          onChange={(value) => update("station", value)}
          renderLeading={(option) => <StationLeading stationId={option.value} />}
        />
      </SettingsCard>

      <SettingsSectionHeader label="IN-CAR PLAYBACK" />
      <SettingsCard>
        <SwitchRow
          icon="play-circle-outline"
          title="Automatically resume playback"
          subtitle={`Resume the last played station when ${AUTO_NAME} connects`}
          value={settings.autoResume}
          onChange={(value) => update("autoResume", value)}
        />
        <ItemSeparator />
        <SwitchRow
          icon="visibility-off"
          title="Hide played episodes"
          subtitle="Hide episodes already completed from in-car podcast lists"
          value={settings.hidePlayed}
          onChange={(value) => update("hidePlayed", value)}
        />
      </SettingsCard>
    </>
  );
}

function StationLeading({ stationId, size = 26 }: { stationId: string; size?: number }) {
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

// ─── ALARM PAGE ─────────────────────────────────────────────────────────────

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

  const DAYS = [
    { id: "0", label: "S", full: "Sun" },
    { id: "1", label: "M", full: "Mon" },
    { id: "2", label: "T", full: "Tue" },
    { id: "3", label: "W", full: "Wed" },
    { id: "4", label: "T", full: "Thu" },
    { id: "5", label: "F", full: "Fri" },
    { id: "6", label: "S", full: "Sat" }
  ];

  return (
    <>
      <SettingsSectionHeader label="RADIO ALARM" />
      <SettingsCard>
        <SwitchRow
          icon="alarm"
          title="Enable alarm"
          subtitle="Wake up to your favourite BBC radio station"
          value={settings.enabled}
          onChange={(value) => update("enabled", value)}
        />
      </SettingsCard>

      <SettingsSectionHeader label="ALARM TIME & SCHEDULE" />
      <SettingsCard>
        <Text style={[styles.cardTitle, { color: theme.onSurface }]}>Wake-up time</Text>
        <Text style={[styles.cardSubtitle, { color: theme.onSurfaceVariant, marginBottom: 12 }]}>
          Tap hour or minute to adjust
        </Text>

        <View style={styles.timeBox}>
          <TouchableOpacity
            style={[styles.timeSegment, { backgroundColor: theme.surfaceVariant, borderColor: theme.outlineVariant + "40" }]}
            onPress={() => update("hour", (Number(settings.hour) + 1) % 24)}
            accessibilityLabel="Increase alarm hour"
          >
            <Text style={[styles.timeText, { color: theme.onSurface }]}>
              {String(settings.hour).padStart(2, "0")}
            </Text>
            <Text style={[styles.timeSubtext, { color: theme.onSurfaceVariant }]}>HR</Text>
          </TouchableOpacity>

          <Text style={[styles.timeColon, { color: theme.onSurfaceVariant }]}>:</Text>

          <TouchableOpacity
            style={[styles.timeSegment, { backgroundColor: theme.surfaceVariant, borderColor: theme.outlineVariant + "40" }]}
            onPress={() => update("minute", (Number(settings.minute) + 5) % 60)}
            accessibilityLabel="Increase alarm minutes"
          >
            <Text style={[styles.timeText, { color: theme.onSurface }]}>
              {String(settings.minute).padStart(2, "0")}
            </Text>
            <Text style={[styles.timeSubtext, { color: theme.onSurfaceVariant }]}>MIN</Text>
          </TouchableOpacity>
        </View>

        <ItemSeparator />
        <Text style={[styles.inputLabel, { color: theme.onSurfaceVariant }]}>Repeat on days</Text>
        <View style={styles.daysRow}>
          {DAYS.map((d) => {
            const active = String(settings.days).split(",").includes(d.id);
            return (
              <TouchableOpacity
                key={d.id}
                onPress={() => {
                  const values = new Set(String(settings.days).split(",").filter(Boolean));
                  if (active) values.delete(d.id);
                  else values.add(d.id);
                  update("days", Array.from(values).sort().join(","));
                }}
                style={[
                  styles.dayChip,
                  {
                    backgroundColor: active ? theme.primary : theme.surfaceVariant,
                    borderColor: active ? theme.primary : theme.outlineVariant + "40"
                  }
                ]}
                activeOpacity={0.7}
              >
                <Text
                  style={{
                    color: active ? theme.onPrimary : theme.onSurface,
                    fontWeight: active ? "700" : "500",
                    fontSize: 14
                  }}
                >
                  {d.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <ItemSeparator />
        <Text style={[styles.inputLabel, { color: theme.onSurfaceVariant }]}>Station</Text>
        <Dropdown
          value={settings.station}
          options={stationOptions}
          placeholder="Select alarm station"
          onChange={(value) => update("station", value)}
          renderLeading={(option) => <StationLeading stationId={option.value} />}
        />

        <ItemSeparator />
        <SwitchRow
          icon="volume-up"
          title="Gentle wake-up (gradual volume)"
          subtitle="Slowly increases volume to prevent waking up with a shock"
          value={settings.ramp}
          onChange={(value) => update("ramp", value)}
        />

        {!settings.ramp ? (
          <View style={{ marginTop: 8 }}>
            <Text style={[styles.inputLabel, { color: theme.onSurfaceVariant }]}>
              Volume level ({settings.volume}/10)
            </Text>
            <View style={styles.volumeSlider}>
              {Array.from({ length: 10 }, (_, index) => {
                const value = index + 1;
                const isActive = value <= Number(settings.volume);
                return (
                  <TouchableOpacity
                    key={value}
                    onPress={() => update("volume", value)}
                    style={[
                      styles.volumeStep,
                      {
                        backgroundColor: isActive ? theme.primary : theme.surfaceVariant,
                        borderColor: isActive ? theme.primary : theme.outlineVariant + "30"
                      }
                    ]}
                    accessibilityLabel={`Set alarm volume to ${value}`}
                  />
                );
              })}
            </View>
          </View>
        ) : null}
      </SettingsCard>
    </>
  );
}

// ─── SUBSCRIPTIONS PAGE ─────────────────────────────────────────────────────

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
    Preferences.setSetting(
      (
        {
          refresh: "pref_subscription_refresh",
          auto: "pref_auto_download",
          limit: "pref_auto_download_limit",
          saved: "pref_auto_download_saved",
          wifi: "pref_download_wifi",
          deletePlayed: "pref_delete_played"
        } as const
      )[key],
      value
    );
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const deleteAllDownloads = () => {
    Alert.alert("Delete all downloads?", "All downloaded podcast episodes will be removed from your device.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete all",
        style: "destructive",
        onPress: () => {
          const removed = useDownloadStore.getState().removeAll();
          Alert.alert("Downloads deleted", removed > 0 ? "All downloaded episodes have been removed." : "No downloads found.");
        }
      }
    ]);
  };

  return (
    <>
      <SettingsSectionHeader label="EPISODE UPDATES" />
      <SettingsCard>
        <Text style={[styles.cardTitle, { color: useAppTheme().onSurface }]}>Check frequency</Text>
        <Text style={[styles.cardSubtitle, { color: useAppTheme().onSurfaceVariant, marginBottom: 12 }]}>
          How frequently British Radio Player checks subscribed feeds for new episodes
        </Text>
        <Dropdown
          value={settings.refresh}
          options={REFRESH_OPTIONS}
          onChange={(value) => update("refresh", value)}
        />
      </SettingsCard>

      <SettingsSectionHeader label="AUTOMATIC DOWNLOADS" />
      <SettingsCard>
        <SwitchRow
          icon="file-download"
          title="Auto-download subscribed podcasts"
          subtitle="Automatically download new episodes when published"
          value={settings.auto}
          onChange={(value) => update("auto", value)}
        />
        {settings.auto ? (
          <>
            <ItemSeparator />
            <Text style={[styles.inputLabel, { color: useAppTheme().onSurfaceVariant }]}>Download limit per podcast</Text>
            <Dropdown
              value={settings.limit}
              options={DOWNLOAD_LIMIT_OPTIONS}
              onChange={(value) => update("limit", value)}
            />
          </>
        ) : null}
        <ItemSeparator />
        <SwitchRow
          icon="bookmark"
          title="Auto-download saved episodes"
          subtitle="Automatically download episodes added to your Saved playlist"
          value={settings.saved}
          onChange={(value) => update("saved", value)}
        />
        <ItemSeparator />
        <SwitchRow
          icon="wifi"
          title="Download on Wi-Fi only"
          subtitle="Avoid using cellular data for automatic episode downloads"
          value={settings.wifi}
          onChange={(value) => update("wifi", value)}
        />
        <ItemSeparator />
        <SwitchRow
          icon="done-all"
          title="Delete when completed"
          subtitle="Automatically remove downloads once an episode is fully played"
          value={settings.deletePlayed}
          onChange={(value) => update("deletePlayed", value)}
        />
      </SettingsCard>

      <SettingsSectionHeader label="DOWNLOAD MANAGEMENT" />
      <SettingsCard>
        <View style={styles.buttonGroup}>
          <SecondaryButton
            icon="folder-open"
            label="Open downloads folder"
            onPress={() => void openDownloadsFolder()}
          />
          <DestructiveButton
            icon="delete-sweep"
            label="Delete all downloads"
            onPress={deleteAllDownloads}
          />
        </View>
      </SettingsCard>
    </>
  );
}

// ─── INDEXING PAGE ──────────────────────────────────────────────────────────

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

  return (
    <>
      <SettingsSectionHeader label="CATALOGUE OPTIONS" />
      <SettingsCard>
        <SwitchRow
          icon="notifications-active"
          title="Notify on new podcasts"
          subtitle="Alert me when brand new BBC podcasts are discovered in the index"
          value={notifications}
          onChange={(value) => void toggleNotifications(value)}
        />
        <ItemSeparator />
        <SwitchRow
          icon="translate"
          title="Exclude non-English podcasts"
          subtitle="Hides BBC World Service foreign language editions from search & lists"
          value={excludeEnglish}
          onChange={toggleExcludeEnglish}
        />
      </SettingsCard>

      <SettingsSectionHeader label="CLOUD INDEX STATUS" />
      <SettingsCard>
        <View style={styles.statusRow}>
          <Text style={[styles.statusItemLabel, { color: theme.onSurfaceVariant }]}>Index updated</Text>
          <Text style={[styles.statusItemValue, { color: theme.onSurface }]}>
            {loading ? "Loading…" : formatTimestamp(status?.generatedAt)}
          </Text>
        </View>
        <ItemSeparator />
        <View style={styles.statusRow}>
          <Text style={[styles.statusItemLabel, { color: theme.onSurfaceVariant }]}>Total podcasts indexed</Text>
          <Text style={[styles.statusItemValue, { color: theme.primary, fontWeight: "700" }]}>
            {loading ? "…" : status ? `${status.podcastCount}` : "—"}
          </Text>
        </View>
        <ItemSeparator />
        <View style={styles.statusRow}>
          <Text style={[styles.statusItemLabel, { color: theme.onSurfaceVariant }]}>Total episodes</Text>
          <Text style={[styles.statusItemValue, { color: theme.onSurface }]}>
            {loading ? "…" : status ? `${status.episodeCount}` : "—"}
          </Text>
        </View>

        <View style={{ marginTop: 14 }}>
          <SecondaryButton
            icon="refresh"
            label={loading ? "Refreshing…" : "Refresh index status"}
            disabled={loading}
            onPress={() => void loadStatus()}
          />
        </View>
      </SettingsCard>
    </>
  );
}

// ─── PRIVACY PAGE ───────────────────────────────────────────────────────────

function PrivacyPage() {
  const [enabled, setEnabled] = useState<boolean>(Preferences.getSetting("pref_analytics", false));
  return (
    <>
      <SettingsSectionHeader label="PRIVACY & METRICS" />
      <SettingsCard>
        <SwitchRow
          icon="analytics"
          title="Enable anonymous analytics"
          subtitle="Helps improve playback stability and station coverage. No personal data, identifiers or locations are collected."
          value={enabled}
          onChange={(value) => {
            Preferences.setSetting("pref_analytics", value);
            Preferences.setSetting("pref_analytics_prompted", true);
            setEnabled(value);
          }}
        />
        <ItemSeparator />
        <SecondaryButton
          icon="privacy-tip"
          label="View privacy statement"
          onPress={() =>
            Alert.alert(
              "Privacy Statement",
              "British Radio Player collects completely anonymous station and podcast play events to diagnose playback issues. No personal accounts, device IDs, or tracking cookies are ever transmitted."
            )
          }
        />
      </SettingsCard>
    </>
  );
}

// ─── ABOUT PAGE ─────────────────────────────────────────────────────────────

function AboutPage() {
  const theme = useAppTheme();
  const [checking, setChecking] = useState(false);
  const currentVersion = Constants.expoConfig?.version ?? "2.0.0";

  const checkForUpdates = async () => {
    setChecking(true);
    try {
      const info = await NativeAndroid.checkForUpdate(currentVersion);
      if (!info) {
        Alert.alert("Update check failed", "Could not check for updates right now.");
      } else if (info.available) {
        Alert.alert(
          `Update available: ${info.version}`,
          `You are on ${currentVersion}. Download and install the latest update?`,
          [
            { text: "Later", style: "cancel" },
            {
              text: "Download & Install",
              onPress: () => NativeAndroid.downloadAndInstallUpdate(info.apkUrl, info.apkName)
            }
          ]
        );
      } else {
        Alert.alert("Up to date", `British Radio Player is on the latest version (${currentVersion}).`);
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <SettingsCard>
        <View style={styles.aboutHero}>
          <View style={[styles.aboutLogoBox, { backgroundColor: theme.primaryContainer }]}>
            <MaterialIcons name="radio" size={36} color={theme.onPrimaryContainer} />
          </View>
          <Text style={[styles.aboutAppTitle, { color: theme.onSurface }]}>British Radio Player</Text>
          <View style={[styles.aboutBadge, { backgroundColor: theme.surfaceVariant }]}>
            <Text style={[styles.aboutBadgeText, { color: theme.onSurfaceVariant }]}>
              v{currentVersion} • {distributionLabel()}
            </Text>
          </View>
        </View>

        <Text style={[styles.aboutParagraph, { color: theme.onSurfaceVariant }]}>
          An open-source, unofficial third-party app for listening to BBC live radio and podcast feeds.
          Not affiliated with or endorsed by the British Broadcasting Corporation.
        </Text>

        <View style={styles.buttonGroup}>
          {SHOW_GITHUB_LINK ? (
            <SecondaryButton
              icon="code"
              label="View on GitHub"
              onPress={() => void Linking.openURL("https://github.com/hyliankid14/British-Radio-Player")}
            />
          ) : null}
          {SHOW_UPDATE_BUTTON ? (
            <PrimaryButton
              icon="system-update"
              label={checking ? "Checking for updates…" : "Check for updates"}
              disabled={checking}
              onPress={() => void checkForUpdates()}
            />
          ) : null}
        </View>
      </SettingsCard>
    </>
  );
}

// ─── REUSABLE MODERN COMPONENTS ─────────────────────────────────────────────

function SettingsSectionHeader({ label }: { label: string }) {
  const theme = useAppTheme();
  return (
    <Text style={[styles.sectionHeader, { color: theme.primary }]}>{label.toUpperCase()}</Text>
  );
}

function SettingsCard({ children }: { children: React.ReactNode }) {
  const theme = useAppTheme();
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.surfaceContainer,
          borderColor: theme.outlineVariant + "25"
        }
      ]}
    >
      {children}
    </View>
  );
}

function ItemSeparator() {
  const theme = useAppTheme();
  return <View style={[styles.separator, { backgroundColor: theme.outlineVariant + "25" }]} />;
}

function SwitchRow({
  icon,
  title,
  subtitle,
  value,
  disabled,
  onChange
}: {
  icon?: keyof typeof MaterialIcons.glyphMap;
  title: string;
  subtitle: string;
  value: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  const theme = useAppTheme();
  const isDark = useIsDarkTheme();

  // Distinctive high-contrast toggle styling for both dark and light modes
  const activeTrack = isDark ? "#A078FF" : theme.primary;
  const inactiveTrack = isDark ? "#38353F" : "#E2E2E6";
  const activeThumb = "#FFFFFF";
  const inactiveThumb = isDark ? "#A5A0AD" : "#F4F3F7";

  return (
    <View style={styles.switchRow}>
      {icon ? (
        <View
          style={[
            styles.iconCircle,
            {
              backgroundColor: value
                ? (isDark ? "#A078FF25" : theme.primaryContainer + "40")
                : theme.surfaceVariant,
              borderColor: value
                ? (isDark ? "#A078FF50" : theme.primary + "30")
                : "transparent"
            }
          ]}
        >
          <MaterialIcons
            name={icon}
            size={20}
            color={
              disabled
                ? theme.outline
                : value
                ? (isDark ? "#D0BCFF" : theme.primary)
                : theme.onSurface
            }
          />
        </View>
      ) : null}
      <View style={styles.flex}>
        <Text
          style={[
            styles.switchTitle,
            { color: disabled ? theme.onSurfaceVariant : theme.onSurface }
          ]}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.switchSubtitle, { color: theme.onSurfaceVariant }]}>{subtitle}</Text>
        ) : null}
      </View>
      <View style={styles.switchControl}>
        <Switch
          value={value}
          disabled={disabled}
          onValueChange={onChange}
          trackColor={{
            false: inactiveTrack,
            true: activeTrack
          }}
          thumbColor={value ? activeThumb : inactiveThumb}
          ios_backgroundColor={inactiveTrack}
        />
      </View>
    </View>
  );
}

function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange
}: {
  options: { value: T; label: string; icon?: keyof typeof MaterialIcons.glyphMap }[];
  value: T;
  onChange: (val: T) => void;
}) {
  const theme = useAppTheme();
  return (
    <View style={[styles.segmentedContainer, { backgroundColor: theme.surfaceVariant }]}>
      {options.map((option) => {
        const isSelected = option.value === value;
        return (
          <TouchableOpacity
            key={String(option.value)}
            style={[
              styles.segmentItem,
              isSelected && {
                backgroundColor: theme.primaryContainer,
                elevation: 2,
                shadowColor: "#000000",
                shadowOpacity: 0.15,
                shadowRadius: 4,
                shadowOffset: { width: 0, height: 1 }
              }
            ]}
            onPress={() => onChange(option.value)}
            activeOpacity={0.7}
          >
            {option.icon ? (
              <MaterialIcons
                name={option.icon}
                size={16}
                color={isSelected ? theme.onPrimaryContainer : theme.onSurfaceVariant}
              />
            ) : null}
            <Text
              style={[
                styles.segmentText,
                {
                  color: isSelected ? theme.onPrimaryContainer : theme.onSurfaceVariant,
                  fontWeight: isSelected ? "700" : "500"
                }
              ]}
              numberOfLines={1}
            >
              {option.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function PrimaryButton({
  icon,
  label,
  onPress,
  disabled
}: {
  icon?: keyof typeof MaterialIcons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useAppTheme();
  return (
    <TouchableOpacity
      style={[
        styles.primaryButton,
        { backgroundColor: theme.primary },
        disabled && styles.disabled
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
    >
      {icon ? <MaterialIcons name={icon} size={20} color={theme.onPrimary} /> : null}
      <Text style={[styles.primaryButtonText, { color: theme.onPrimary }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function SecondaryButton({
  icon,
  label,
  onPress,
  disabled
}: {
  icon?: keyof typeof MaterialIcons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useAppTheme();
  return (
    <TouchableOpacity
      style={[
        styles.secondaryButton,
        { backgroundColor: theme.surfaceVariant, borderColor: theme.outlineVariant + "40" },
        disabled && styles.disabled
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
    >
      {icon ? <MaterialIcons name={icon} size={20} color={theme.primary} /> : null}
      <Text style={[styles.secondaryButtonText, { color: theme.primary }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function DestructiveButton({
  icon,
  label,
  onPress,
  disabled
}: {
  icon?: keyof typeof MaterialIcons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.secondaryButton,
        { backgroundColor: "#BA1A1A14", borderColor: "#BA1A1A30" },
        disabled && styles.disabled
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
    >
      {icon ? <MaterialIcons name={icon} size={20} color="#BA1A1A" /> : null}
      <Text style={[styles.secondaryButtonText, { color: "#BA1A1A" }]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── STYLES ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  toolbar: {
    height: 60,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12
  },
  toolbarTitle: { fontSize: 20, fontWeight: "700", letterSpacing: -0.2 },
  content: { paddingHorizontal: 16, paddingTop: 12 },
  sectionHeader: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.9,
    marginBottom: 8,
    marginTop: 14,
    marginLeft: 4
  },
  card: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    marginBottom: 8,
    overflow: "hidden"
  },
  cardTitle: { fontSize: 16, fontWeight: "600" },
  cardSubtitle: { fontSize: 13, lineHeight: 18, marginTop: 3 },
  separator: { height: StyleSheet.hairlineWidth, marginVertical: 12 },
  flex: { flex: 1 },
  disabled: { opacity: 0.45 },
  inputLabel: { fontSize: 13, fontWeight: "600", marginBottom: 6 },
  body: { fontSize: 13, lineHeight: 19 },

  // SwitchRow
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 52
  },
  switchTitle: { fontSize: 15, fontWeight: "500" },
  switchSubtitle: { fontSize: 12.5, lineHeight: 17, marginTop: 2 },
  switchControl: { marginLeft: 12, justifyContent: "center" },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12
  },

  // SegmentedControl
  segmentedContainer: {
    flexDirection: "row",
    borderRadius: 14,
    padding: 4,
    marginVertical: 6
  },
  segmentItem: {
    flex: 1,
    minHeight: 38,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 8
  },
  segmentText: { fontSize: 13.5 },

  // Buttons
  primaryButton: {
    minHeight: 48,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 20,
    marginVertical: 6
  },
  primaryButtonText: { fontSize: 15, fontWeight: "600" },
  secondaryButton: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 20,
    marginVertical: 6
  },
  secondaryButtonText: { fontSize: 15, fontWeight: "600" },
  buttonGroup: { marginTop: 8 },

  // Theme Page
  themeGrid: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4
  },
  themeTile: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 16,
    padding: 12,
    alignItems: "center",
    justifyContent: "center",
    position: "relative"
  },
  themeIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8
  },
  themeTileTitle: { fontSize: 14, marginBottom: 2 },
  themeTileSubtitle: { fontSize: 11, textAlign: "center" },
  themeCheckBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center"
  },

  // Startup Radio List
  radioList: { marginTop: 4 },
  radioRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 12
  },
  radioLabel: { fontSize: 15 },
  radioSubtitle: { fontSize: 12, marginTop: 1 },
  radioCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 12
  },
  radioInnerDot: { width: 8, height: 8, borderRadius: 4 },

  // Backup Page Hero
  heroHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14
  },
  heroIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14
  },
  statusBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    marginVertical: 10
  },
  statusLabel: { fontSize: 12, fontWeight: "500" },
  statusValue: { fontSize: 14, fontWeight: "600", marginTop: 1 },

  // Alarm Time
  timeBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 12
  },
  timeSegment: {
    minWidth: 84,
    minHeight: 74,
    borderWidth: 1,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    padding: 8
  },
  timeText: { fontSize: 32, fontWeight: "700" },
  timeSubtext: { fontSize: 10, fontWeight: "600", marginTop: 2 },
  timeColon: { fontSize: 32, fontWeight: "600", marginHorizontal: 12 },
  daysRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginVertical: 8
  },
  dayChip: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center"
  },
  volumeSlider: {
    height: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginVertical: 10
  },
  volumeStep: { flex: 1, height: 14, borderRadius: 7, borderWidth: 1 },

  // Status Rows
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4
  },
  statusItemLabel: { fontSize: 14 },
  statusItemValue: { fontSize: 14, fontWeight: "500" },

  // About Hero
  aboutHero: {
    alignItems: "center",
    paddingVertical: 12
  },
  aboutLogoBox: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10
  },
  aboutAppTitle: { fontSize: 20, fontWeight: "700" },
  aboutBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: 6
  },
  aboutBadgeText: { fontSize: 12, fontWeight: "500" },
  aboutParagraph: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    paddingHorizontal: 8,
    marginVertical: 12
  },

  stationPlaceholder: { alignItems: "center", justifyContent: "center" }
});
