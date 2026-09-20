import React, { useEffect, useState } from "react";
import {
  Alert,
  Modal,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View
} from "react-native";
import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { Preferences } from "../../src/storage/preferences";
import { AUDIO_QUALITIES, AudioQuality } from "../../src/data/stations";
import { StationRepository } from "../../src/data/stations";
import { StationLogo } from "../../src/components/StationLogo";
import { usePlayerStore } from "../../src/store/playerStore";
import { useAppTheme } from "../../src/theme/colors";
import { LastFmApi } from "../../src/api/lastfm";

const TITLES: Record<string, string> = {
  theme: "Theme",
  playback: "Playback",
  lastfm: "Last.fm Scrobbler",
  alarm: "Alarm",
  startup_page: "Startup page",
  carplay: "CarPlay",
  subscriptions: "Subscriptions",
  indexing: "Indexing",
  backup: "Backup",
  privacy: "Privacy",
  about: "About"
};

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
        {section === "carplay" && <CarPlayPage />}
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
  const theme = useAppTheme();
  const current = Preferences.getTheme();
  return <Card title="Theme" subtitle="Choose the app colour scheme">
    {(["light", "dark", "system"] as const).map((value) => (
      <Option key={value} label={value === "system" ? "Match system" : value[0].toUpperCase() + value.slice(1)} selected={current === value} onPress={() => Preferences.setTheme(value)} theme={theme} />
    ))}
  </Card>;
}

function PlaybackPage() {
  const theme = useAppTheme();
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
      {(["HIGH", "MEDIUM", "LOW", "AUTO"] as AudioQuality[]).map((value) => (
        <Option key={value} label={AUDIO_QUALITIES[value].label} selected={audioQuality === value && !settings.auto} onPress={() => { update("auto", false); void setAudioQuality(value); }} theme={theme} />
      ))}
    </Card>
    <Card title="Podcast Artwork" subtitle="Choose which artwork is shown during podcast playback">
      <Option label="Episode artwork" selected={settings.artwork === "episode"} onPress={() => update("artwork", "episode")} theme={theme} />
      <Option label="Podcast artwork" selected={settings.artwork === "podcast"} onPress={() => update("artwork", "podcast")} theme={theme} />
    </Card>
    <Card title="Live Radio Pause Behaviour" subtitle="Configure buffering when live radio is paused">
      <SwitchRow title="Pause buffering (resume playback)" subtitle="Buffer live radio for up to 50 seconds whilst paused" value={settings.pause} onChange={(value) => update("pause", value)} />
    </Card>
    <Card title="Next/Previous Behaviour" subtitle="Choose how station navigation works">
      <Option label="Scroll All Stations" selected={settings.scroll === "all"} onPress={() => update("scroll", "all")} theme={theme} />
      <Option label="Scroll Favourites Only" selected={settings.scroll === "favourites"} onPress={() => update("scroll", "favourites")} theme={theme} />
      <SwitchRow title="Shake to select a random podcast" subtitle="" value={settings.shake} onChange={(value) => update("shake", value)} />
      <SwitchRow title="Stop playback when Bluetooth device disconnects" subtitle="" value={settings.bluetooth} onChange={(value) => update("bluetooth", value)} />
    </Card>
    <Card title="Automatically play next episode when completed" subtitle="Choose which episodes may continue automatically">
      <Option label="All podcasts" selected={settings.next === "all"} onPress={() => update("next", "all")} theme={theme} />
      <Option label="Subscriptions only" selected={settings.next === "subscriptions"} onPress={() => update("next", "subscriptions")} theme={theme} />
      <Option label="None" selected={settings.next === "none"} onPress={() => update("next", "none")} theme={theme} />
    </Card>
  </>;
}

function LastFmPage() {
  const theme = useAppTheme();
  const [settings, setSettings] = useState(Preferences.getLastFm());
  useEffect(() => {
    const onUrl = async ({ url }: { url: string }) => {
      const token = Linking.parse(url).queryParams?.token;
      if (typeof token !== "string") return;
      try {
        const session = await LastFmApi.exchangeToken(token);
        Preferences.setLastFmSession(session.username, session.sessionKey);
        setSettings(Preferences.getLastFm());
        Alert.alert("Last.fm connected", `Connected as ${session.username}.`);
      } catch (error) {
        Alert.alert("Last.fm connection failed", error instanceof Error ? error.message : "Could not connect.");
      }
    };
    const subscription = Linking.addEventListener("url", onUrl);
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
      <TouchableOpacity style={styles.primaryButton} onPress={settings.sessionKey ? () => {
      Preferences.clearLastFmSession();
      setSettings(Preferences.getLastFm());
    } : connect}>
        <Text style={styles.primaryButtonText}>{settings.sessionKey ? "Disconnect Last.fm" : "Connect to Last.fm"}</Text>
      </TouchableOpacity>
    </Card>
    <Card title="Scrobbling Options" subtitle="Control which playback events are sent to scrobbling services">
      <SwitchRow title="Direct Last.fm Scrobbling" subtitle="Send Now Playing and scrobbles to your linked profile" value={settings.direct && !!settings.sessionKey} disabled={!settings.sessionKey} onChange={(value) => { Preferences.setLastFmDirect(value); setSettings(Preferences.getLastFm()); }} />
      <SwitchRow title="External Scrobbler Broadcasts" subtitle="Broadcast tracks to third-party scrobbler apps" value={settings.broadcast} onChange={(value) => { Preferences.setLastFmBroadcast(value); setSettings(Preferences.getLastFm()); }} />
      <SwitchRow title="Scrobble Podcasts" subtitle="Also scrobble podcast episodes as tracks" value={settings.podcasts} onChange={(value) => { Preferences.setLastFmPodcasts(value); setSettings(Preferences.getLastFm()); }} />
    </Card>
    <Card title="Recent Activity" subtitle="Last.fm scrobbling status">
      <Text style={styles.body}>{Preferences.getLastFmLastScrobbled() || "No tracks scrobbled yet"}</Text>
    </Card>
  </>;
}

function CarPlayPage() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const stations = StationRepository.getAll();
  const [settings, setSettings] = useState({
    station: Preferences.getSetting("pref_carplay_station", ""),
    autoResume: Preferences.getSetting("pref_carplay_auto_resume", true),
    hidePlayed: Preferences.getSetting("pref_carplay_hide_played", false)
  });
  const [stationPickerVisible, setStationPickerVisible] = useState(false);
  const selectedStation = stations.find((station) => station.id === settings.station);
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
    <Card title="Default station" subtitle="Station selected when CarPlay starts playback">
      <TouchableOpacity
        style={[styles.dropdown, { borderColor: theme.outline, backgroundColor: theme.surfaceContainer }]}
        onPress={() => setStationPickerVisible(true)}
        activeOpacity={0.7}
      >
        <Text style={[styles.dropdownText, { color: selectedStation ? theme.onSurface : theme.onSurfaceVariant }]}>
          {selectedStation?.title || "Select a station"}
        </Text>
        <MaterialIcons name="arrow-drop-down" size={24} color={theme.onSurfaceVariant} />
      </TouchableOpacity>
    </Card>
    <Card title="Playback" subtitle="Control playback behaviour in CarPlay">
      <SwitchRow
        title="Automatically resume playback"
        subtitle="Resume the last station when CarPlay connects"
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
    <Modal visible={stationPickerVisible} animationType="slide" onRequestClose={() => setStationPickerVisible(false)}>
      <View style={[styles.stationPicker, { backgroundColor: theme.surface, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={[styles.stationPickerHeader, { borderBottomColor: theme.outlineVariant }]}>
          <Text style={[styles.stationPickerTitle, { color: theme.onSurface }]}>Select a CarPlay station</Text>
          <TouchableOpacity style={styles.stationPickerClose} onPress={() => setStationPickerVisible(false)} accessibilityLabel="Cancel station selection">
            <MaterialIcons name="close" size={24} color={theme.onSurface} />
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.stationPickerContent}>
          <TouchableOpacity style={styles.stationOption} onPress={() => { update("station", ""); setStationPickerVisible(false); }}>
            <View style={styles.stationOptionPlaceholder}><MaterialIcons name="block" size={24} color={theme.onSurfaceVariant} /></View>
            <Text style={[styles.stationOptionText, { color: theme.onSurface }]}>No station selected</Text>
          </TouchableOpacity>
          {stations.map((station) => (
            <TouchableOpacity key={station.id} style={styles.stationOption} onPress={() => { update("station", station.id); setStationPickerVisible(false); }}>
              <StationLogo stationId={station.id} size={48} borderRadius={10} />
              <Text style={[styles.stationOptionText, { color: theme.onSurface }]} numberOfLines={1}>{station.title}</Text>
              {settings.station === station.id && <MaterialIcons name="check" size={22} color={theme.primary} />}
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    </Modal>
  </>;
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
  return <>
    <Card title="Backup & restore" subtitle="Export and import app settings">
    <TouchableOpacity style={styles.primaryButton} onPress={() => Share.share({ title: "British Radio Player Backup", message: Preferences.exportBackup() })}>
      <Text style={styles.primaryButtonText}>Export settings</Text>
    </TouchableOpacity>
    <Text style={styles.body}>Last backup: Never</Text>
    <TouchableOpacity style={styles.secondaryButton} onPress={() => void importSettings()} disabled={isImporting}>
      <Text style={styles.secondaryButtonText}>{isImporting ? "Importing…" : "Import settings"}</Text>
    </TouchableOpacity>
    </Card>
  </>;
}

function AboutPage() {
  return <Card title="About British Radio Player" subtitle="App version and acknowledgements">
    <Text style={styles.body}>Unofficial third-party client. BBC and station trademarks are property of the British Broadcasting Corporation. Streams use public BBC APIs.</Text>
  </Card>;
}

function StartupPage() {
  const theme = useAppTheme();
  const current = Preferences.getSetting("pref_startup_page", "all_stations");
  return <Card title="Startup page" subtitle="Applies to the app and CarPlay">
    {[
      ["favourites", "Favourite Stations"],
      ["all_stations", "All Stations"],
      ["subscribed_podcasts", "Subscribed Podcasts"],
      ["playlists", "Playlists"]
    ].map(([value, label]) => <Option key={value} label={label} selected={current === value} onPress={() => Preferences.setSetting("pref_startup_page", value)} theme={theme} />)}
  </Card>;
}

function PrivacyPage() {
  const [enabled, setEnabled] = useState<boolean>(Preferences.getSetting("pref_analytics", false));
  return <>
    <Card title="Analytics" subtitle="Help improve British Radio Player with anonymous usage data">
    <SwitchRow title="Enable Analytics" subtitle="No personal information or device identifiers are collected" value={enabled} onChange={(value) => { Preferences.setSetting("pref_analytics", value); setEnabled(value); }} />
    </Card>
    <Card title="Privacy Policy" subtitle="Review how data is handled">
    <TouchableOpacity style={styles.secondaryButton} onPress={() => Alert.alert("Privacy Policy", "Analytics are anonymous and used only to understand station, podcast, and playback usage. No personal information, device identifiers, or location data are collected.")}>
      <Text style={styles.secondaryButtonText}>View Privacy Policy</Text>
    </TouchableOpacity>
    </Card>
  </>;
}

function AlarmPage() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const stations = StationRepository.getAll();
  const [settings, setSettings] = useState({
    enabled: Preferences.getSetting("pref_alarm_enabled", false),
    hour: Preferences.getSetting("pref_alarm_hour", 7),
    minute: Preferences.getSetting("pref_alarm_minute", 0),
    station: Preferences.getSetting("pref_alarm_station", ""),
    ramp: Preferences.getSetting("pref_alarm_ramp", true),
    volume: Preferences.getSetting("pref_alarm_volume", 5),
    days: Preferences.getSetting("pref_alarm_days", "1,2,3,4,5")
  });
  const [stationPickerVisible, setStationPickerVisible] = useState(false);
  const update = (key: string, value: string | number | boolean) => {
    Preferences.setSetting(`pref_alarm_${key}`, value);
    setSettings((current) => ({ ...current, [key]: value }));
  };
  const selectedStation = stations.find((station) => station.id === settings.station);
  const chooseStation = () => setStationPickerVisible(true);
  return <Card title="Enable Alarm" subtitle="Wake-up alarms and station start options">
    <SwitchRow title="Enable Alarm" subtitle="Start the selected station at the scheduled time" value={settings.enabled} onChange={(value) => update("enabled", value)} />
    <Text style={[styles.subheading, { color: theme.onSurfaceVariant }]}>Alarm Time</Text>
    <View style={styles.inline}><TouchableOpacity style={styles.valueButton} onPress={() => update("hour", (Number(settings.hour) + 1) % 24)}><Text style={styles.valueText}>{String(settings.hour).padStart(2, "0")}</Text></TouchableOpacity><Text style={styles.colon}>:</Text><TouchableOpacity style={styles.valueButton} onPress={() => update("minute", (Number(settings.minute) + 5) % 60)}><Text style={styles.valueText}>{String(settings.minute).padStart(2, "0")}</Text></TouchableOpacity></View>
    <Text style={[styles.subheading, { color: theme.onSurfaceVariant }]}>Days of the Week</Text>
    <View style={styles.days}>{["S", "M", "T", "W", "T", "F", "S"].map((day, index) => { const active = String(settings.days).split(",").includes(String(index)); return <TouchableOpacity key={`${day}-${index}`} onPress={() => { const values = new Set(String(settings.days).split(",").filter(Boolean)); active ? values.delete(String(index)) : values.add(String(index)); update("days", Array.from(values).sort().join(",")); }} style={[styles.day, active && { backgroundColor: theme.primary }]}><Text style={{ color: active ? theme.onPrimary : theme.onSurface }}>{day}</Text></TouchableOpacity>; })}</View>
    <Text style={[styles.subheading, { color: theme.onSurfaceVariant }]}>Station</Text>
    <TouchableOpacity
      style={[styles.dropdown, { borderColor: theme.outline, backgroundColor: theme.surfaceContainer }]}
      onPress={chooseStation}
      activeOpacity={0.7}
    >
      <Text style={[styles.dropdownText, { color: selectedStation ? theme.onSurface : theme.onSurfaceVariant }]}>
        {selectedStation?.title || "Select a station"}
      </Text>
      <MaterialIcons name="arrow-drop-down" size={24} color={theme.onSurfaceVariant} />
    </TouchableOpacity>
    <Modal
      visible={stationPickerVisible}
      animationType="slide"
      onRequestClose={() => setStationPickerVisible(false)}
    >
      <View style={[styles.stationPicker, { backgroundColor: theme.surface, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={[styles.stationPickerHeader, { borderBottomColor: theme.outlineVariant }]}>
          <Text style={[styles.stationPickerTitle, { color: theme.onSurface }]}>Select a station</Text>
          <TouchableOpacity
            style={styles.stationPickerClose}
            onPress={() => setStationPickerVisible(false)}
            accessibilityLabel="Cancel station selection"
          >
            <MaterialIcons name="close" size={24} color={theme.onSurface} />
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.stationPickerContent}>
          <TouchableOpacity
            style={styles.stationOption}
            onPress={() => {
              update("station", "");
              setStationPickerVisible(false);
            }}
          >
            <View style={styles.stationOptionPlaceholder}>
              <MaterialIcons name="block" size={24} color={theme.onSurfaceVariant} />
            </View>
            <Text style={[styles.stationOptionText, { color: theme.onSurface }]}>No station selected</Text>
          </TouchableOpacity>
          {stations.map((station) => (
            <TouchableOpacity
              key={station.id}
              style={styles.stationOption}
              onPress={() => {
                update("station", station.id);
                setStationPickerVisible(false);
              }}
            >
              <StationLogo stationId={station.id} size={48} borderRadius={10} />
              <Text style={[styles.stationOptionText, { color: theme.onSurface }]} numberOfLines={1}>
                {station.title}
              </Text>
              {settings.station === station.id && (
                <MaterialIcons name="check" size={22} color={theme.primary} />
              )}
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    </Modal>
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
  </Card>;
}

function SubscriptionsPage() {
  const theme = useAppTheme();
  const [settings, setSettings] = useState({
    refresh: Preferences.getSetting("pref_subscription_refresh", 60),
    auto: Preferences.getSetting("pref_auto_download", false),
    limit: Preferences.getSetting("pref_auto_download_limit", 1),
    saved: Preferences.getSetting("pref_auto_download_saved", false),
    wifi: Preferences.getSetting("pref_download_wifi", true),
    deletePlayed: Preferences.getSetting("pref_delete_played", false)
  });
  const update = (key: keyof typeof settings, value: string | number | boolean) => { Preferences.setSetting(({ refresh: "pref_subscription_refresh", auto: "pref_auto_download", limit: "pref_auto_download_limit", saved: "pref_auto_download_saved", wifi: "pref_download_wifi", deletePlayed: "pref_delete_played" } as const)[key], value); setSettings((current) => ({ ...current, [key]: value })); };
  return <>
    <Card title="Subscription Notifications" subtitle="Check for new episodes every">
    {[0, 15, 30, 60, 120, 360, 720, 1440].map((value) => <Option key={value} label={value === 0 ? "Disabled" : value >= 60 ? `${value / 60} hours` : `${value} minutes`} selected={settings.refresh === value} onPress={() => update("refresh", value)} theme={theme} />)}
    </Card>
    <Card title="Podcast Downloads" subtitle="Manage automatic podcast downloads">
    <SwitchRow title="Auto-download subscribed podcasts" subtitle="" value={settings.auto} onChange={(value) => update("auto", value)} />
    {[1, 3, 5, 10].map((value) => <Option key={value} label={value === 1 ? "Latest episode" : `${value} episodes`} selected={settings.limit === value} onPress={() => update("limit", value)} theme={theme} />)}
    <SwitchRow title="Auto-download saved episodes" subtitle="" value={settings.saved} onChange={(value) => update("saved", value)} />
    <SwitchRow title="Download on WiFi only" subtitle="" value={settings.wifi} onChange={(value) => update("wifi", value)} />
    <SwitchRow title="Delete episode when played to completion" subtitle="" value={settings.deletePlayed} onChange={(value) => update("deletePlayed", value)} />
    <TouchableOpacity style={styles.secondaryButton} onPress={() => Alert.alert("Downloads", "Downloads are stored in the app library.")}><Text style={styles.secondaryButtonText}>Open Downloads Folder</Text></TouchableOpacity>
    <TouchableOpacity style={styles.secondaryButton} onPress={() => Alert.alert("Delete All Downloads", "Downloaded episodes can be removed from the Library.")}><Text style={styles.secondaryButtonText}>Delete All Downloads</Text></TouchableOpacity>
    </Card>
  </>;
}

function IndexingPage() {
  const [settings, setSettings] = useState<{ notifications: boolean; english: boolean }>({ notifications: Preferences.getSetting("pref_index_notifications", false), english: Preferences.getSetting("pref_exclude_non_english", false) });
  return <>
    <Card title="Indexing Options" subtitle="Configure podcast catalogue notifications and filtering">
    <SwitchRow title="Notify me when new podcasts are added" subtitle="" value={settings.notifications} onChange={(value) => { Preferences.setSetting("pref_index_notifications", value); setSettings((current) => ({ ...current, notifications: value })); }} />
    <SwitchRow title="Exclude non-English podcasts" subtitle="" value={settings.english} onChange={(value) => { Preferences.setSetting("pref_exclude_non_english", value); setSettings((current) => ({ ...current, english: value })); }} />
    </Card>
    <Card title="Index status" subtitle="Latest updates">
    <Text style={styles.body}>Last updated: —</Text>
    <Text style={styles.body}>Most popular updated: —</Text>
    <Text style={styles.body}>— podcasts indexed</Text>
    <Text style={styles.body}>— episodes indexed</Text>
    </Card>
  </>;
}

function InfoPage({ title, text }: { title: string; text: string }) {
  return <Card title={title} subtitle={text}><Text style={styles.body}>{text}</Text></Card>;
}

function Card({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  const theme = useAppTheme();
  return <View style={[styles.card, { backgroundColor: theme.surfaceContainer, borderColor: theme.outlineVariant }]}>
    <Text style={[styles.cardTitle, { color: theme.onSurface }]}>{title}</Text>
    <Text style={[styles.cardSubtitle, { color: theme.onSurfaceVariant }]}>{subtitle}</Text>
    {children}
  </View>;
}

function Option({ label, selected, onPress, theme }: { label: string; selected: boolean; onPress: () => void; theme: ReturnType<typeof useAppTheme> }) {
  return <TouchableOpacity style={styles.option} onPress={onPress}><Text style={[styles.optionText, { color: theme.onSurface }]}>{label}</Text>{selected && <MaterialIcons name="check" size={22} color={theme.primary} />}</TouchableOpacity>;
}

function SwitchRow({ title, subtitle, value, disabled, onChange }: { title: string; subtitle: string; value: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  const theme = useAppTheme();
  return <View style={styles.switchRow}><View style={styles.flex}><Text style={[styles.optionText, { color: disabled ? theme.onSurfaceVariant : theme.onSurface }]}>{title}</Text><Text style={[styles.cardSubtitle, { color: theme.onSurfaceVariant }]}>{subtitle}</Text></View><Switch value={value} disabled={disabled} onValueChange={onChange} /></View>;
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
  option: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#79747E", marginTop: 8 },
  optionText: { fontSize: 16 },
  switchRow: { minHeight: 72, flexDirection: "row", alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#79747E", marginTop: 8 },
  flex: { flex: 1, paddingRight: 12 },
  primaryButton: { minHeight: 44, borderRadius: 22, backgroundColor: "#6750A4", alignItems: "center", justifyContent: "center", marginVertical: 16 },
  primaryButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "600" },
  body: { fontSize: 15, lineHeight: 22, color: "#CAC4D0", marginTop: 16 }
  ,subheading: { fontSize: 14, fontWeight: "600", marginTop: 18, marginBottom: 4 }
  ,inline: { flexDirection: "row", alignItems: "center", marginVertical: 8 }
  ,valueButton: { minWidth: 64, minHeight: 44, borderWidth: 1, borderColor: "#79747E", borderRadius: 8, alignItems: "center", justifyContent: "center" }
  ,valueText: { fontSize: 18, color: "#CAC4D0" }
  ,colon: { fontSize: 20, marginHorizontal: 8, color: "#CAC4D0" }
  ,days: { flexDirection: "row", justifyContent: "space-between", marginVertical: 10 }
  ,day: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#79747E" }
  ,volumeButtons: { flexDirection: "row", justifyContent: "space-between", marginVertical: 12 }
  ,volumeButton: { fontSize: 16, padding: 10 }
  ,dropdown: { minHeight: 52, borderWidth: 1, borderRadius: 4, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginVertical: 8 }
  ,dropdownText: { fontSize: 16 }
  ,stationPicker: { flex: 1 }
  ,stationPickerHeader: { minHeight: 64, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth }
  ,stationPickerTitle: { flex: 1, fontSize: 22, fontWeight: "600" }
  ,stationPickerClose: { width: 48, height: 48, alignItems: "center", justifyContent: "center" }
  ,stationPickerContent: { padding: 16, paddingBottom: 32 }
  ,stationOption: { minHeight: 64, flexDirection: "row", alignItems: "center", paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#79747E" }
  ,stationOptionPlaceholder: { width: 48, height: 48, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "#49454E" }
  ,stationOptionText: { flex: 1, fontSize: 16, marginLeft: 16 }
  ,sliderLabels: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 }
  ,sliderLabel: { fontSize: 13 }
  ,volumeSlider: { height: 28, flexDirection: "row", alignItems: "center", gap: 4, marginVertical: 8 }
  ,volumeStep: { flex: 1, height: 6, borderRadius: 3 }
  ,secondaryButton: { minHeight: 44, borderRadius: 22, borderWidth: 1, borderColor: "#79747E", alignItems: "center", justifyContent: "center", marginVertical: 8 }
  ,secondaryButtonText: { color: "#D0BCFF", fontSize: 15, fontWeight: "600" }
});
