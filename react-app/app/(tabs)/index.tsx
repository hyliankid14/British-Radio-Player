import React, { useState, useMemo, useEffect, useCallback } from "react";
import {
  View,
  Text,
  Image,
  FlatList,
  TouchableOpacity,
  Modal,
  Alert,
  Linking,
  StyleSheet,
  ActivityIndicator
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { FontAwesome5, MaterialIcons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { Station, StationCategory, StationRepository } from "../../src/data/stations";
import { usePlayerStore } from "../../src/store/playerStore";
import { useStationShowStore } from "../../src/store/stationShowStore";
import { StationLogo } from "../../src/components/StationLogo";
import { useAppTheme } from "../../src/theme/colors";
import { Preferences } from "../../src/storage/preferences";
import { OfflineBanner, VpnBanner } from "../../src/components/NetworkBanners";

type SubCategoryTab = "National" | "Regions" | "Local" | "Songs";

export default function AllStationsScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const [activeSubTab, setActiveSubTab] = useState<SubCategoryTab>("National");
  const { shows, fetchShowsForStations, checkAndAdvanceShows } = useStationShowStore();
  const [recentSongs, setRecentSongs] = useState(Preferences.getRecentSongs());
  const [selectedSong, setSelectedSong] = useState<(typeof recentSongs)[number] | null>(null);

  const {
    currentStation,
    currentShow,
    isPlaying,
    playStation,
    togglePlayPause,
    favorites,
    toggleFavorite
  } = usePlayerStore();

  const allStations = useMemo(() => StationRepository.getAll(), []);

  useEffect(() => {
    const sub = Preferences.onChanged((key) => {
      if (key.includes("recent_songs")) {
        setRecentSongs(Preferences.getRecentSongs());
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (activeSubTab === "Songs") setRecentSongs(Preferences.getRecentSongs());
  }, [activeSubTab, currentShow]);

  const openSongInMusicApp = (song: (typeof recentSongs)[number]) => {
    if (!`${song.artist} ${song.track}`.trim()) return;
    setSelectedSong(song);
  };

  const musicServices = selectedSong
    ? (() => {
        const encodedQuery = encodeURIComponent(
          `${selectedSong.artist} ${selectedSong.track}`.trim()
        );
        return [
          { name: "Spotify", icon: "spotify" as const, colour: "#1DB954", url: `https://open.spotify.com/search/${encodedQuery}` },
          { name: "YouTube Music", icon: "youtube" as const, colour: "#FF0000", url: `https://music.youtube.com/search?q=${encodedQuery}` },
          { name: "Amazon Music", icon: "amazon" as const, colour: "#00A8E1", url: `https://music.amazon.co.uk/search/${encodedQuery}` },
          { name: "Apple Music", icon: "apple" as const, colour: theme.onSurface, url: `https://music.apple.com/gb/search?term=${encodedQuery}` },
          { name: "Deezer", icon: "deezer" as const, colour: "#A238FF", url: `https://www.deezer.com/search/${encodedQuery}` }
        ];
      })()
    : [];

  const openMusicService = (service: (typeof musicServices)[number]) => {
    setSelectedSong(null);
    Linking.openURL(service.url).catch(() => {
      Alert.alert("Unable to open link", `Could not open ${service.name}.`);
    });
  };

  useEffect(() => {
    if (!currentStation || !currentShow) return;
    const songArtist = (currentShow as any).rawArtist || currentShow.artist || "";
    const songTrack = (currentShow as any).rawTrack || currentShow.track || "";
    if (!songArtist && !songTrack) return;
    Preferences.addRecentSong({
      artist: songArtist,
      track: songTrack,
      imageUrl: (currentShow as any).rawImageUrl || currentShow.imageUrl || currentStation.logoUrl,
      stationId: currentStation.id,
      stationName: currentStation.title
    });
    setRecentSongs(Preferences.getRecentSongs());
  }, [currentShow, currentStation]);

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

  useEffect(() => {
    if (filteredStations.length > 0) {
      void fetchShowsForStations(filteredStations.map((s) => s.id));
    }
  }, [filteredStations, fetchShowsForStations]);

  useFocusEffect(
    useCallback(() => {
      setRecentSongs(Preferences.getRecentSongs());
      checkAndAdvanceShows();
      if (filteredStations.length > 0) {
        void fetchShowsForStations(filteredStations.map((s) => s.id));
      }
    }, [filteredStations, checkAndAdvanceShows, fetchShowsForStations])
  );

  const renderStationItem = ({ item }: { item: Station }) => {
    const isCurrent = currentStation?.id === item.id;
    const isFav = favorites.includes(item.id);
    const livePlayingTitle =
      isCurrent && currentShow?.title && currentShow.title !== "BBC Radio"
        ? currentShow.title
        : undefined;
    const subtitle = livePlayingTitle || shows[item.id]?.title || "";

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

      <OfflineBanner />
      <VpnBanner />

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
                onPress={() => {
                  setActiveSubTab(tab);
                  if (tab === "Songs") {
                    setRecentSongs(Preferences.getRecentSongs());
                  }
                }}
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

      {activeSubTab === "Songs" ? (
        <FlatList
          data={recentSongs}
          keyExtractor={(item, index) => `${item.playedAtMs}_${index}`}
          style={{ backgroundColor: theme.surface }}
          contentContainerStyle={[styles.listContent, { paddingBottom: 170 + insets.bottom }]}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.stationRow, { backgroundColor: theme.surface }]}
              onPress={() => openSongInMusicApp(item)}
              activeOpacity={0.7}
            >
              {item.imageUrl ? (
                <Image
                  source={{ uri: item.imageUrl }}
                  style={styles.songArtwork}
                  resizeMode="cover"
                />
              ) : (
                <StationLogo stationId={item.stationId} size={56} borderRadius={12} />
              )}
              <View style={styles.stationInfo}>
                <Text style={[styles.stationTitle, { color: theme.onSurface }]} numberOfLines={1}>
                  {item.track || "Unknown track"}
                </Text>
                <Text style={[styles.stationSubtitle, { color: theme.onSurfaceVariant }]} numberOfLines={1}>
                  {item.artist} • {item.stationName}
                </Text>
              </View>
              <MaterialIcons
                name="open-in-new"
                size={22}
                color={theme.onSurfaceVariant}
                accessibilityLabel="Listen in an external music application"
              />
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={[styles.emptyText, { color: theme.onSurfaceVariant }]}>
                {"No recently played songs yet.\nSongs detected while a station is playing will appear here."}
              </Text>
            </View>
          }
        />
      ) : (
        <FlatList
          data={filteredStations}
          keyExtractor={(item) => item.id}
          renderItem={renderStationItem}
          style={{ backgroundColor: theme.surface }}
          contentContainerStyle={[styles.listContent, { paddingBottom: 170 + insets.bottom }]}
        />
      )}
      <Modal
        visible={selectedSong !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedSong(null)}
      >
        <View style={styles.musicSheetBackdrop}>
          <View style={[styles.musicSheet, { backgroundColor: theme.surfaceContainer }]}>
            <View style={styles.musicSheetHeader}>
              <Text style={[styles.musicSheetTitle, { color: theme.onSurface }]}>
                Listen to: {selectedSong?.track || selectedSong?.artist}
              </Text>
              <TouchableOpacity
                onPress={() => setSelectedSong(null)}
                style={styles.musicSheetClose}
                accessibilityLabel="Close music applications"
              >
                <MaterialIcons name="close" size={24} color={theme.onSurfaceVariant} />
              </TouchableOpacity>
            </View>
            {musicServices.map((service) => (
              <TouchableOpacity
                key={service.name}
                style={styles.musicServiceRow}
                onPress={() => openMusicService(service)}
                activeOpacity={0.7}
              >
                <View style={styles.musicServiceIcon}>
                  <FontAwesome5 name={service.icon} size={20} color={service.colour} />
                </View>
                <Text style={[styles.musicServiceName, { color: theme.onSurface }]}>
                  {service.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>
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
  songArtwork: {
    width: 56,
    height: 56,
    borderRadius: 12
  },
  actionButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 4
  },
  musicSheetBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0, 0, 0, 0.45)"
  },
  musicSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 28
  },
  musicSheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
    marginBottom: 8
  },
  musicSheetTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700"
  },
  musicSheetClose: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center"
  },
  musicServiceRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center"
  },
  musicServiceIcon: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center"
  },
  musicServiceName: {
    marginLeft: 12,
    fontSize: 16
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
