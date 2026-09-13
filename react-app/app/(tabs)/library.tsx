import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

type LibrarySection = "DOWNLOADS" | "SAVED" | "PLAYLISTS" | "HISTORY";

export default function LibraryScreen() {
  const [activeSection, setActiveSection] = useState<LibrarySection>("DOWNLOADS");

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Library</Text>
      </View>

      {/* Section Filter Pills */}
      <View style={styles.tabsContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsScroll}>
          {[
            { id: "DOWNLOADS", label: "Downloads", icon: "cloud-download-outline" },
            { id: "SAVED", label: "Saved", icon: "bookmark-outline" },
            { id: "PLAYLISTS", label: "Playlists", icon: "list-outline" },
            { id: "HISTORY", label: "History", icon: "time-outline" }
          ].map((tab) => {
            const isActive = activeSection === tab.id;
            return (
              <TouchableOpacity
                key={tab.id}
                style={[styles.tabPill, isActive && styles.tabPillActive]}
                onPress={() => setActiveSection(tab.id as LibrarySection)}
              >
                <Ionicons
                  name={tab.icon as any}
                  size={16}
                  color={isActive ? "#FFFFFF" : "#CAC4D0"}
                  style={{ marginRight: 6 }}
                />
                <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Content Area */}
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {activeSection === "DOWNLOADS" && (
          <View style={styles.emptyState}>
            <View style={styles.iconCircle}>
              <Ionicons name="cloud-download-outline" size={38} color="#D0BCFF" />
            </View>
            <Text style={styles.emptyTitle}>No downloaded episodes</Text>
            <Text style={styles.emptySubtitle}>
              Download podcast episodes to listen when you're offline or on the move without using cellular data.
            </Text>
          </View>
        )}

        {activeSection === "SAVED" && (
          <View style={styles.emptyState}>
            <View style={styles.iconCircle}>
              <Ionicons name="bookmark-outline" size={38} color="#D0BCFF" />
            </View>
            <Text style={styles.emptyTitle}>No saved episodes</Text>
            <Text style={styles.emptySubtitle}>
              Tap the bookmark icon on any podcast episode to save it here for later listening.
            </Text>
          </View>
        )}

        {activeSection === "PLAYLISTS" && (
          <View style={styles.emptyState}>
            <View style={styles.iconCircle}>
              <Ionicons name="list-outline" size={38} color="#D0BCFF" />
            </View>
            <Text style={styles.emptyTitle}>No playlists created</Text>
            <Text style={styles.emptySubtitle}>
              Create custom playlists to group your favorite episodes and radio shows.
            </Text>
          </View>
        )}

        {activeSection === "HISTORY" && (
          <View style={styles.emptyState}>
            <View style={styles.iconCircle}>
              <Ionicons name="time-outline" size={38} color="#D0BCFF" />
            </View>
            <Text style={styles.emptyTitle}>No listening history</Text>
            <Text style={styles.emptySubtitle}>
              Radio stations and podcast episodes you stream will appear here so you can easily jump back in.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#161324"
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 14
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: "#FFFFFF"
  },
  tabsContainer: {
    marginBottom: 10
  },
  tabsScroll: {
    paddingHorizontal: 16,
    gap: 8
  },
  tabPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#221F38",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#322E54"
  },
  tabPillActive: {
    backgroundColor: "#6750A4",
    borderColor: "#D0BCFF"
  },
  tabText: {
    color: "#CAC4D0",
    fontSize: 13,
    fontWeight: "600"
  },
  tabTextActive: {
    color: "#FFFFFF"
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingBottom: 120,
    justifyContent: "center"
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#221F38",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#322E54"
  },
  emptyTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 8
  },
  emptySubtitle: {
    color: "#A5A0C8",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20
  }
});
