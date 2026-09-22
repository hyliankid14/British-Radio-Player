import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Switch,
  Alert,
  Share,
  StyleSheet
} from "react-native";
import * as Linking from "expo-linking";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { Preferences } from "../../src/storage/preferences";
import { AUDIO_QUALITIES, AudioQuality } from "../../src/data/stations";
import { usePlayerStore } from "../../src/store/playerStore";
import { useAppTheme } from "../../src/theme/colors";
import { LastFmApi } from "../../src/api/lastfm";
import { useRouter } from "expo-router";
import { OfflineBanner, VpnBanner } from "../../src/components/NetworkBanners";

export default function SettingsScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { audioQuality, setAudioQuality } = usePlayerStore();
  const [lastFm, setLastFm] = useState(Preferences.getLastFm());

  const handleExportBackup = async () => {
    try {
      const jsonBackup = Preferences.exportBackup();
      await Share.share({
        title: "British Radio Player Backup",
        message: jsonBackup
      });
    } catch (e) {
      Alert.alert("Export Error", "Failed to export settings backup.");
    }
  };

  useEffect(() => {
    const handleUrl = async ({ url }: { url: string }) => {
      const parsed = Linking.parse(url);
      const token = typeof parsed.queryParams?.token === "string" ? parsed.queryParams.token : null;
      if (!token) return;
      try {
        const session = await LastFmApi.exchangeToken(token);
        Preferences.setLastFmSession(session.username, session.sessionKey);
        setLastFm(Preferences.getLastFm());
        Alert.alert("Last.fm connected", `Connected as ${session.username}.`);
      } catch (error) {
        Alert.alert("Last.fm connection failed", error instanceof Error ? error.message : "Could not connect to Last.fm.");
      }
    };
    const subscription = Linking.addEventListener("url", handleUrl);
    Linking.getInitialURL().then((url) => {
      if (url) void handleUrl({ url });
    });
    return () => subscription.remove();
  }, []);

  const connectLastFm = async () => {
    if (!LastFmApi.isConfigured()) {
      Alert.alert("Last.fm setup required", "Add EXPO_PUBLIC_LASTFM_API_KEY and EXPO_PUBLIC_LASTFM_API_SECRET to the React app environment.");
      return;
    }
    await Linking.openURL(LastFmApi.authUrl());
  };

  const disconnectLastFm = () => {
    Alert.alert("Disconnect Last.fm?", "Songs will no longer be scrobbled directly.", [
      { text: "Cancel", style: "cancel" },
      { text: "Disconnect", style: "destructive", onPress: () => {
        Preferences.clearLastFmSession();
        setLastFm(Preferences.getLastFm());
      } }
    ]);
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.surface }]}
      edges={["top"]}
    >
      {/* 56dp Top App Bar */}
      <View style={[styles.topAppBar, { backgroundColor: theme.surface }]}>
        <Text style={[styles.appBarTitle, { color: theme.onSurface }]}>Settings</Text>
      </View>

      <OfflineBanner />
      <VpnBanner />

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 170 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Playback Section */}
        <Text style={[styles.sectionTitle, { color: theme.onSurfaceVariant }]}>
          Playback
        </Text>

        {/* Playback & Audio Quality Item */}
        <TouchableOpacity
          style={styles.settingItem}
          activeOpacity={0.7}
          onPress={() => router.push({ pathname: "/modal/settings-detail", params: { section: "playback" } })}
        >
          <MaterialIcons
            name="play-arrow"
            size={24}
            color={theme.onSurface}
            style={styles.leadingIcon}
          />
          <View style={styles.textColumn}>
            <Text style={[styles.itemTitle, { color: theme.onSurface }]}>
              Playback
            </Text>
            <Text style={[styles.itemSubtitle, { color: theme.onSurfaceVariant }]}>
              Audio quality, controls and behaviour
            </Text>
          </View>
        </TouchableOpacity>

        <View style={[styles.divider, { backgroundColor: theme.outlineVariant }]} />

        <SettingsRow
          theme={theme}
          icon="music-note"
          title="Last.fm Scrobbler"
          subtitle="Connect account and scrobble played songs"
          onPress={() => router.push({ pathname: "/modal/settings-detail", params: { section: "lastfm" } })}
        />

        <View style={[styles.divider, { backgroundColor: theme.outlineVariant }]} />

        <SettingsRow
          theme={theme}
          icon="notifications"
          title="Alarm"
          subtitle="Wake-up alarms and station start options"
          onPress={() => router.push({ pathname: "/modal/settings-detail", params: { section: "alarm" } })}
        />

        {/* Personalisation Section */}
        <Text style={[styles.sectionTitle, { color: theme.onSurfaceVariant, marginTop: 24 }]}>
          Personalisation
        </Text>

        <TouchableOpacity
          style={styles.settingItem}
          activeOpacity={0.7}
          onPress={() => {
            router.push({ pathname: "/modal/settings-detail", params: { section: "theme" } });
          }}
        >
          <MaterialIcons
            name="palette"
            size={24}
            color={theme.onSurface}
            style={styles.leadingIcon}
          />
          <View style={styles.textColumn}>
            <Text style={[styles.itemTitle, { color: theme.onSurface }]}>
              Theme
            </Text>
            <Text style={[styles.itemSubtitle, { color: theme.onSurfaceVariant }]}>
              Light, dark or match system
            </Text>
          </View>
        </TouchableOpacity>

        <View style={[styles.divider, { backgroundColor: theme.outlineVariant }]} />

        <TouchableOpacity
          style={styles.settingItem}
          activeOpacity={0.7}
          onPress={() => {
            router.push({ pathname: "/modal/settings-detail", params: { section: "startup_page" } });
          }}
        >
          <MaterialIcons
            name="star-border"
            size={24}
            color={theme.onSurface}
            style={styles.leadingIcon}
          />
          <View style={styles.textColumn}>
            <Text style={[styles.itemTitle, { color: theme.onSurface }]}>
              Startup page
            </Text>
            <Text style={[styles.itemSubtitle, { color: theme.onSurfaceVariant }]}>
              Choose default screen when launching app
            </Text>
          </View>
        </TouchableOpacity>

        {/* Data & Privacy Section */}
        <View style={[styles.divider, { backgroundColor: theme.outlineVariant }]} />

        <SettingsRow
          theme={theme}
          icon="directions-car"
          title="Android Auto"
          subtitle="In-car playback preferences"
          onPress={() => router.push({ pathname: "/modal/settings-detail", params: { section: "android_auto" } })}
        />

        {/* Podcasts Section */}
        <Text style={[styles.sectionTitle, { color: theme.onSurfaceVariant, marginTop: 24 }]}>
          Podcasts
        </Text>

        <SettingsRow
          theme={theme}
          icon="podcasts"
          title="Subscriptions"
          subtitle="Auto refresh and download controls"
          onPress={() => router.push({ pathname: "/modal/settings-detail", params: { section: "subscriptions" } })}
        />

        <View style={[styles.divider, { backgroundColor: theme.outlineVariant }]} />

        <SettingsRow
          theme={theme}
          icon="search"
          title="Indexing"
          subtitle="Search index status"
          onPress={() => router.push({ pathname: "/modal/settings-detail", params: { section: "indexing" } })}
        />

        {/* Data & Privacy Section */}
        <Text style={[styles.sectionTitle, { color: theme.onSurfaceVariant, marginTop: 24 }]}>
          Data & privacy
        </Text>

        <TouchableOpacity
          style={styles.settingItem}
          activeOpacity={0.7}
          onPress={() => router.push({ pathname: "/modal/settings-detail", params: { section: "backup" } })}
        >
          <MaterialIcons
            name="cloud-sync"
            size={24}
            color={theme.onSurface}
            style={styles.leadingIcon}
          />
          <View style={styles.textColumn}>
            <Text style={[styles.itemTitle, { color: theme.onSurface }]}>
              Backup & restore
            </Text>
            <Text style={[styles.itemSubtitle, { color: theme.onSurfaceVariant }]}>
              Export and import app settings
            </Text>
          </View>
        </TouchableOpacity>

        <View style={[styles.divider, { backgroundColor: theme.outlineVariant }]} />

        <SettingsRow
          theme={theme}
          icon="settings"
          title="Privacy"
          subtitle="Permissions and data collection"
          onPress={() => router.push({ pathname: "/modal/settings-detail", params: { section: "privacy" } })}
        />

        {/* About Section */}
        <Text style={[styles.sectionTitle, { color: theme.onSurfaceVariant, marginTop: 24 }]}>
          About
        </Text>

        <TouchableOpacity
          style={styles.settingItem}
          activeOpacity={0.7}
          onPress={() => router.push({ pathname: "/modal/settings-detail", params: { section: "about" } })}
        >
          <MaterialIcons
            name="info"
            size={24}
            color={theme.onSurface}
            style={styles.leadingIcon}
          />
          <View style={styles.textColumn}>
            <Text style={[styles.itemTitle, { color: theme.onSurface }]}>
              About
            </Text>
            <Text style={[styles.itemSubtitle, { color: theme.onSurfaceVariant }]}>
              Version 2.0.0 (React Cross-Platform Native)
            </Text>
          </View>
        </TouchableOpacity>

        <Text style={[styles.disclaimerText, { color: theme.onSurfaceVariant }]}>
          Unofficial third-party client. BBC and station trademarks are property of the British Broadcasting Corporation. Streams use public BBC APIs.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function SettingsRow({
  theme,
  icon,
  title,
  subtitle,
  onPress
}: {
  theme: ReturnType<typeof useAppTheme>;
  icon: React.ComponentProps<typeof MaterialIcons>["name"];
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.settingItem} activeOpacity={0.7} onPress={onPress}>
      <MaterialIcons name={icon} size={24} color={theme.onSurface} style={styles.leadingIcon} />
      <View style={styles.textColumn}>
        <Text style={[styles.itemTitle, { color: theme.onSurface }]}>{title}</Text>
        <Text style={[styles.itemSubtitle, { color: theme.onSurfaceVariant }]}>{subtitle}</Text>
      </View>
    </TouchableOpacity>
  );
}

function SettingsSwitch({
  theme,
  title,
  subtitle,
  value,
  disabled,
  onValueChange
}: {
  theme: ReturnType<typeof useAppTheme>;
  title: string;
  subtitle: string;
  value: boolean;
  disabled?: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.optionRow}>
      <View style={styles.textColumn}>
        <Text style={[styles.itemTitle, { color: disabled ? theme.onSurfaceVariant : theme.onSurface }]}>{title}</Text>
        <Text style={[styles.itemSubtitle, { color: theme.onSurfaceVariant }]}>{subtitle}</Text>
      </View>
      <Switch value={value} disabled={disabled} onValueChange={onValueChange} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  topAppBar: {
    height: 56,
    justifyContent: "center",
    paddingHorizontal: 20,
    elevation: 2
  },
  appBarTitle: {
    fontSize: 22,
    fontWeight: "600",
    letterSpacing: -0.2
  },
  scrollContent: {
    paddingBottom: 120
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: 0.1,
    marginTop: 16,
    marginBottom: 8,
    marginHorizontal: 20
  },
  settingItem: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14
  },
  leadingIcon: {
    marginRight: 16
  },
  textColumn: {
    flex: 1
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: "500"
  },
  itemSubtitle: {
    fontSize: 14,
    marginTop: 2
  },
  divider: {
    height: 1,
    marginHorizontal: 20,
    opacity: 0.2
  },
  qualityPickerContainer: {
    marginHorizontal: 20,
    marginBottom: 12,
    borderRadius: 12,
    paddingVertical: 4
  },
  qualityOptionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12
  },
  qualityOptionText: {
    fontSize: 15
  },
  disclaimerText: {
    fontSize: 12,
    textAlign: "center",
    lineHeight: 18,
    marginTop: 24,
    paddingHorizontal: 24
  },
  lastFmOptions: {
    paddingHorizontal: 20,
    paddingBottom: 8
  },
  optionHeading: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 4
  },
  optionRow: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center"
  },
  disconnect: {
    fontSize: 15,
    fontWeight: "600",
    paddingVertical: 12
  }
});
