import React, { useState } from "react";
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
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { Preferences } from "../../src/storage/preferences";
import { AUDIO_QUALITIES, AudioQuality } from "../../src/data/stations";
import { usePlayerStore } from "../../src/store/playerStore";
import { useAppTheme } from "../../src/theme/colors";

export default function SettingsScreen() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { audioQuality, setAudioQuality } = usePlayerStore();
  const [geoBlocked, setGeoBlocked] = useState(Preferences.getGeoBlocked());
  const [showQualityPicker, setShowQualityPicker] = useState(false);

  const handleGeoBlockedToggle = (val: boolean) => {
    setGeoBlocked(val);
    Preferences.setGeoBlocked(val);
  };

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

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.surface }]}
      edges={["top"]}
    >
      {/* 56dp Top App Bar */}
      <View style={[styles.topAppBar, { backgroundColor: theme.surface }]}>
        <Text style={[styles.appBarTitle, { color: theme.onSurface }]}>Settings</Text>
      </View>

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
          onPress={() => setShowQualityPicker(!showQualityPicker)}
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
              Audio quality ({AUDIO_QUALITIES[audioQuality]?.label || "High"}), controls and behaviour
            </Text>
          </View>
          <MaterialIcons
            name={showQualityPicker ? "expand-less" : "expand-more"}
            size={24}
            color={theme.onSurfaceVariant}
          />
        </TouchableOpacity>

        {/* Quality Options Submenu */}
        {showQualityPicker && (
          <View style={[styles.qualityPickerContainer, { backgroundColor: theme.surfaceContainer }]}>
            {(["HIGH", "MEDIUM", "LOW", "AUTO"] as AudioQuality[]).map((q) => {
              const config = AUDIO_QUALITIES[q];
              const isSelected = audioQuality === q;
              return (
                <TouchableOpacity
                  key={q}
                  style={styles.qualityOptionRow}
                  onPress={() => {
                    setAudioQuality(q);
                    setShowQualityPicker(false);
                  }}
                >
                  <Text
                    style={[
                      styles.qualityOptionText,
                      { color: isSelected ? theme.primary : theme.onSurface, fontWeight: isSelected ? "700" : "400" }
                    ]}
                  >
                    {config.label}
                  </Text>
                  {isSelected && (
                    <MaterialIcons name="check" size={20} color={theme.primary} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <View style={[styles.divider, { backgroundColor: theme.outlineVariant }]} />

        {/* Prioritize International Streams Item */}
        <View style={styles.settingItem}>
          <MaterialIcons
            name="public"
            size={24}
            color={theme.onSurface}
            style={styles.leadingIcon}
          />
          <View style={styles.textColumn}>
            <Text style={[styles.itemTitle, { color: theme.onSurface }]}>
              Prioritize International Streams
            </Text>
            <Text style={[styles.itemSubtitle, { color: theme.onSurfaceVariant }]}>
              Use when travelling outside the UK or on restricted networks
            </Text>
          </View>
          <Switch
            value={geoBlocked}
            onValueChange={handleGeoBlockedToggle}
            trackColor={{ false: theme.outlineVariant, true: theme.primary }}
            thumbColor={geoBlocked ? "#FFFFFF" : theme.onSurfaceVariant}
          />
        </View>

        {/* Personalisation Section */}
        <Text style={[styles.sectionTitle, { color: theme.onSurfaceVariant, marginTop: 24 }]}>
          Personalisation
        </Text>

        <TouchableOpacity
          style={styles.settingItem}
          activeOpacity={0.7}
          onPress={() => {
            Alert.alert("Theme", "Theme follows system light/dark mode automatically.");
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
            Alert.alert("Startup page", "Default landing screen is All Stations.");
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
        <Text style={[styles.sectionTitle, { color: theme.onSurfaceVariant, marginTop: 24 }]}>
          Data & privacy
        </Text>

        <TouchableOpacity
          style={styles.settingItem}
          activeOpacity={0.7}
          onPress={handleExportBackup}
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
              Export and import app settings & favorites
            </Text>
          </View>
        </TouchableOpacity>

        {/* About Section */}
        <Text style={[styles.sectionTitle, { color: theme.onSurfaceVariant, marginTop: 24 }]}>
          About
        </Text>

        <View style={styles.settingItem}>
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
        </View>

        <Text style={[styles.disclaimerText, { color: theme.onSurfaceVariant }]}>
          Unofficial third-party client. BBC and station trademarks are property of the British Broadcasting Corporation. Streams use public BBC APIs.
        </Text>
      </ScrollView>
    </SafeAreaView>
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
  }
});
