import React, { useState, useMemo, useEffect } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Station, StationCategory, StationRepository } from "../../src/data/stations";
import { usePlayerStore } from "../../src/store/playerStore";
import { StationLogo } from "../../src/components/StationLogo";
import { useAppTheme } from "../../src/theme/colors";
import { fetchShowInfo } from "../../src/api/showInfo";

type SubCategoryTab = "National" | "Regions" | "Local" | "Songs";

export default function AllStationsScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const [activeSubTab, setActiveSubTab] = useState<SubCategoryTab>("National");
  const [showTitles, setShowTitles] = useState<Record<string, string>>({});

  const {
    currentStation,
    isPlaying,
    playStation,
    togglePlayPause,
    favorites,
    toggleFavorite
  } = usePlayerStore();

  const allStations = useMemo(() => StationRepository.getAll(), []);

  // Fetch show info for visible stations
  useEffect(() => {
    let isMounted = true;
    async function loadShows() {
      const nationalStations = allStations.filter(
        (s) => s.category === StationCategory.NATIONAL
      );
      for (const s of nationalStations.slice(0, 10)) {
        try {
          const info = await fetchShowInfo(s.id);
          if (isMounted && info?.title) {
            setShowTitles((prev) => ({ ...prev, [s.id]: info.title }));
          }
        } catch {
          // ignore background errors
        }
      }
    }
    loadShows();
    return () => {
      isMounted = false;
    };
  }, [allStations]);

  const filteredStations = useMemo(() => {
    if (activeSubTab === "National") {
      return allStations.filter((s) => s.category === StationCategory.NATIONAL);
    } else if (activeSubTab === "Regions") {
      return allStations.filter((s) => s.category === StationCategory.REGIONS);
    } else if (activeSubTab === "Local") {
      return allStations.filter((s) => s.category === StationCategory.LOCAL);
    }
    return [];
  }, [allStations, activeSubTab]);

  const renderStationItem = ({ item }: { item: Station }) => {
    const isCurrent = currentStation?.id === item.id;
    const isFav = favorites.includes(item.id);
    const subtitle = showTitles[item.id] || "";

    return (
      <TouchableOpacity
        style={[
          styles.stationRow,
          { backgroundColor: theme.surface }
        ]}
        activeOpacity={0.7}
        onPress={() => {
          if (isCurrent) {
            togglePlayPause();
          } else {
            playStation(item);
          }
        }}
      >
        {/* 56dp Station Logo with rounded corners matching station_list_item.xml */}
        <StationLogo stationId={item.id} size={56} borderRadius={12} />

        {/* Station Title & Subtitle */}
        <View style={styles.stationInfo}>
          <Text
            style={[
              styles.stationTitle,
              { color: theme.onSurface }
            ]}
            numberOfLines={1}
          >
            {item.title}
          </Text>
          {subtitle ? (
            <Text
              style={[
                styles.stationSubtitle,
                { color: theme.onSurfaceVariant }
              ]}
              numberOfLines={1}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>

        {/* Schedule Button */}
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => {
            router.push({
              pathname: "/modal/schedule",
              params: {
                stationId: item.id,
                stationTitle: item.title
              }
            });
          }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialIcons
            name="calendar-today"
            size={22}
            color={theme.onSurfaceVariant}
          />
        </TouchableOpacity>

        {/* Favorite Star Button */}
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => toggleFavorite(item.id)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialIcons
            name={isFav ? "star" : "star-border"}
            size={24}
            color={isFav ? theme.star : theme.starInactive}
          />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.surfaceContainer }]}
      edges={["top"]}
    >
      {/* Top App Bar (Material 3: 56dp) */}
      <View
        style={[
          styles.topAppBar,
          {
            backgroundColor: theme.surfaceContainer
          }
        ]}
      >
        <Text style={[styles.topAppBarTitle, { color: theme.onSurface }]}>
          All Stations
        </Text>
      </View>

      {/* Underline Tabs: National, Regions, Local, Songs */}
      <View
        style={[
          styles.tabBarStrip,
          {
            backgroundColor: theme.surfaceContainer,
            borderBottomColor: theme.divider
          }
        ]}
      >
        {(["National", "Regions", "Local", "Songs"] as SubCategoryTab[]).map(
          (tab) => {
            const isSelected = activeSubTab === tab;
            return (
              <TouchableOpacity
                key={tab}
                style={[
                  styles.tabItem,
                  isSelected && [
                    styles.tabItemActive,
                    { borderBottomColor: theme.primary }
                  ]
                ]}
                onPress={() => setActiveSubTab(tab)}
              >
                <Text
                  style={[
                    styles.tabItemText,
                    {
                      color: isSelected ? theme.primary : theme.onSurfaceVariant,
                      fontWeight: isSelected ? "bold" : "normal"
                    }
                  ]}
                >
                  {tab}
                </Text>
              </TouchableOpacity>
            );
          }
        )}
      </View>

      {/* Station List */}
      <FlatList
        data={filteredStations}
        keyExtractor={(item) => item.id}
        renderItem={renderStationItem}
        style={{ backgroundColor: theme.surface }}
        contentContainerStyle={[styles.listContent, { paddingBottom: 170 + insets.bottom }]}
        ListEmptyComponent={
          activeSubTab === "Songs" ? (
            <View style={styles.emptyContainer}>
              <Text
                style={[styles.emptyText, { color: theme.onSurfaceVariant }]}
              >
                {"No recently played songs yet.\nSongs detected while a station is playing will appear here."}
              </Text>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  topAppBar: {
    height: 56,
    paddingHorizontal: 16,
    justifyContent: "center",
    elevation: 4
  },
  topAppBarTitle: {
    fontSize: 22,
    fontWeight: "600",
    letterSpacing: 0
  },
  tabBarStrip: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  tabItem: {
    flex: 1,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 3,
    borderBottomColor: "transparent"
  },
  tabItemActive: {
    borderBottomWidth: 3
  },
  tabItemText: {
    fontSize: 14
  },
  listContent: {
    paddingBottom: 170 // Space for MiniPlayer + Bottom Navigation
  },
  stationRow: {
    height: 72,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16
  },
  stationInfo: {
    flex: 1,
    marginLeft: 16,
    justifyContent: "center"
  },
  stationTitle: {
    fontSize: 16,
    fontWeight: "bold",
    letterSpacing: 0.15
  },
  stationSubtitle: {
    fontSize: 13,
    marginTop: 2
  },
  actionButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 4
  },
  emptyContainer: {
    padding: 32,
    alignItems: "center",
    justifyContent: "center"
  },
  emptyText: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20
  }
});
