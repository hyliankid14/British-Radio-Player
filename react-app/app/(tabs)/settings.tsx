import React from "react";
import {
  Platform,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAppTheme } from "../../src/theme/colors";
import { OfflineBanner, VpnBanner } from "../../src/components/NetworkBanners";

export default function SettingsScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const open = (section: string) =>
    router.push({ pathname: "/modal/settings-detail", params: { section } });

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
        <SectionTitle label="Playback" theme={theme} />

        <SettingsRow
          theme={theme}
          icon="play-arrow"
          title="Playback"
          subtitle="Audio quality, controls and behaviour"
          onPress={() => open("playback")}
        />
        <Divider theme={theme} />

        <SettingsRow
          theme={theme}
          icon="music-note"
          title="Last.fm Scrobbler"
          subtitle="Connect account and scrobble played songs"
          onPress={() => open("lastfm")}
        />
        <Divider theme={theme} />

        <SettingsRow
          theme={theme}
          icon="notifications"
          title="Alarm"
          subtitle="Wake-up alarms and station start options"
          onPress={() => open("alarm")}
        />

        <SectionTitle label="Personalisation" theme={theme} />

        <SettingsRow
          theme={theme}
          icon="palette"
          title="Theme"
          subtitle="Light, dark or match system"
          onPress={() => open("theme")}
        />
        <Divider theme={theme} />

        <SettingsRow
          theme={theme}
          icon="star-border"
          title="Startup page"
          subtitle="Choose default screen when launching app"
          onPress={() => open("startup_page")}
        />
        <Divider theme={theme} />

        <SettingsRow
          theme={theme}
          icon="directions-car"
          title={Platform.OS === "ios" ? "CarPlay" : "Android Auto"}
          subtitle="In-car playback preferences"
          onPress={() => open("android_auto")}
        />

        <SectionTitle label="Podcasts" theme={theme} />

        <SettingsRow
          theme={theme}
          icon="podcasts"
          title="Subscriptions"
          subtitle="Auto refresh and download controls"
          onPress={() => open("subscriptions")}
        />
        <Divider theme={theme} />

        <SettingsRow
          theme={theme}
          icon="search"
          title="Indexing"
          subtitle="Search index status"
          onPress={() => open("indexing")}
        />

        <SectionTitle label="Data & privacy" theme={theme} />

        <SettingsRow
          theme={theme}
          icon="cloud-sync"
          title="Backup & restore"
          subtitle="Export and import app settings"
          onPress={() => open("backup")}
        />
        <Divider theme={theme} />

        <SettingsRow
          theme={theme}
          icon="settings"
          title="Privacy"
          subtitle="Permissions and data collection"
          onPress={() => open("privacy")}
        />

        <SectionTitle label="About" theme={theme} />

        <SettingsRow
          theme={theme}
          icon="info"
          title="About"
          subtitle="Version 2.0.0"
          onPress={() => open("about")}
        />
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
      <MaterialIcons name="chevron-right" size={24} color={theme.onSurfaceVariant} />
    </TouchableOpacity>
  );
}

function SectionTitle({ label, theme }: { label: string; theme: ReturnType<typeof useAppTheme> }) {
  return (
    <Text style={[styles.sectionTitle, { color: theme.primary }]}>
      {label}
    </Text>
  );
}

function Divider({ theme }: { theme: ReturnType<typeof useAppTheme> }) {
  return <View style={[styles.divider, { backgroundColor: theme.outlineVariant }]} />;
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
  }
});
