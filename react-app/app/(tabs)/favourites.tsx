import React, { useState, useMemo, useCallback, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  LayoutAnimation,
  Platform,
  UIManager,
  PanResponder
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { MaterialIcons } from "@expo/vector-icons";
import { Station, StationRepository } from "../../src/data/stations";
import { usePlayerStore } from "../../src/store/playerStore";
import { StationLogo } from "../../src/components/StationLogo";
import { useAppTheme } from "../../src/theme/colors";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type FavCategory = "Stations" | "Subscribed" | "Playlists" | "Searches" | "History";

const ITEM_HEIGHT = 72;

interface ReorderableRowProps {
  station: Station;
  index: number;
  total: number;
  isReordering: boolean;
  onMove: (fromIndex: number, toIndex: number) => void;
  onPlay: (station: Station) => void;
  onSchedule: (station: Station) => void;
  onToggleFavorite: (stationId: string) => void;
  theme: any;
}

function ReorderableStationRow({
  station,
  index,
  total,
  isReordering,
  onMove,
  onPlay,
  onSchedule,
  onToggleFavorite,
  theme
}: ReorderableRowProps) {
  const currentIndexRef = useRef(index);
  currentIndexRef.current = index;

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 4,
        onPanResponderMove: (_, gesture) => {
          const dy = gesture.dy;
          const currIdx = currentIndexRef.current;
          if (dy < -ITEM_HEIGHT * 0.6 && currIdx > 0) {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            onMove(currIdx, currIdx - 1);
            gesture.dy = 0;
          } else if (dy > ITEM_HEIGHT * 0.6 && currIdx < total - 1) {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            onMove(currIdx, currIdx + 1);
            gesture.dy = 0;
          }
        },
        onPanResponderRelease: () => {},
        onPanResponderTerminate: () => {}
      }),
    [onMove, total]
  );

  return (
    <View style={[styles.stationRow, { backgroundColor: theme.surface }]}>
      {/* Drag handle matching item_station.xml / station_list_item.xml */}
      <View
        {...panResponder.panHandlers}
        style={styles.dragHandleContainer}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <MaterialIcons
          name="drag-handle"
          size={24}
          color={isReordering ? theme.primary : theme.outline}
        />
      </View>

      <TouchableOpacity
        style={styles.stationMainTouchable}
        activeOpacity={0.7}
        onPress={() => onPlay(station)}
      >
        <StationLogo stationId={station.id} size={48} borderRadius={10} />

        <View style={styles.stationInfo}>
          <Text
            style={[styles.stationTitle, { color: theme.onSurface }]}
            numberOfLines={1}
          >
            {station.title}
          </Text>
        </View>
      </TouchableOpacity>

      {/* When Reordering is toggled on, show Up/Down buttons for accessible one-tap movement */}
      {isReordering && (
        <View style={styles.reorderButtonsRow}>
          <TouchableOpacity
            style={[styles.actionButton, index === 0 && styles.disabledButton]}
            disabled={index === 0}
            onPress={() => {
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              onMove(index, index - 1);
            }}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          >
            <MaterialIcons
              name="arrow-upward"
              size={20}
              color={index === 0 ? theme.outlineVariant : theme.primary}
            />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, index === total - 1 && styles.disabledButton]}
            disabled={index === total - 1}
            onPress={() => {
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              onMove(index, index + 1);
            }}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          >
            <MaterialIcons
              name="arrow-downward"
              size={20}
              color={index === total - 1 ? theme.outlineVariant : theme.primary}
            />
          </TouchableOpacity>
        </View>
      )}

      {/* Schedule Button */}
      <TouchableOpacity
        style={styles.actionButton}
        onPress={() => onSchedule(station)}
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
        onPress={() => onToggleFavorite(station.id)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <MaterialIcons
          name="star"
          size={24}
          color={theme.star}
        />
      </TouchableOpacity>
    </View>
  );
}

export default function FavouritesScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const [activeCategory, setActiveCategory] = useState<FavCategory>("Stations");
  const [isReordering, setIsReordering] = useState(false);

  const {
    currentStation,
    isPlaying,
    playStation,
    togglePlayPause,
    favorites,
    toggleFavorite,
    setFavoritesOrder
  } = usePlayerStore();

  const allStations = useMemo(() => StationRepository.getAll(), []);

  // Guarantee stations are ordered strictly by the user's favorites array order
  const favoriteStations = useMemo(() => {
    const map = new Map(allStations.map((s) => [s.id, s]));
    return favorites
      .map((id) => map.get(id))
      .filter((s): s is Station => s !== undefined);
  }, [allStations, favorites]);

  const handleMove = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (fromIndex < 0 || toIndex < 0 || fromIndex >= favorites.length || toIndex >= favorites.length) return;
      const updated = [...favorites];
      const [moved] = updated.splice(fromIndex, 1);
      updated.splice(toIndex, 0, moved);
      setFavoritesOrder(updated);
    },
    [favorites, setFavoritesOrder]
  );

  const handlePlayStation = useCallback(
    (station: Station) => {
      if (currentStation?.id === station.id) {
        togglePlayPause();
      } else {
        playStation(station);
      }
    },
    [currentStation?.id, playStation, togglePlayPause]
  );

  const handleOpenSchedule = useCallback(
    (station: Station) => {
      router.push({
        pathname: "/modal/schedule",
        params: {
          stationId: station.id,
          stationTitle: station.title
        }
      });
    },
    [router]
  );

  const renderStationItem = useCallback(
    ({ item, index }: { item: Station; index: number }) => {
      return (
        <ReorderableStationRow
          station={item}
          index={index}
          total={favoriteStations.length}
          isReordering={isReordering}
          onMove={handleMove}
          onPlay={handlePlayStation}
          onSchedule={handleOpenSchedule}
          onToggleFavorite={toggleFavorite}
          theme={theme}
        />
      );
    },
    [favoriteStations.length, isReordering, handleMove, handlePlayStation, handleOpenSchedule, toggleFavorite, theme]
  );

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
            backgroundColor: theme.surfaceContainer,
            borderBottomColor: theme.outlineVariant
          }
        ]}
      >
        <Text style={[styles.topAppBarTitle, { color: theme.onSurface }]}>
          Favourite Stations
        </Text>

        {activeCategory === "Stations" && favoriteStations.length > 1 && (
          <TouchableOpacity
            style={[
              styles.reorderToggleButton,
              isReordering && { backgroundColor: theme.primaryContainer }
            ]}
            onPress={() => {
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              setIsReordering(!isReordering);
            }}
          >
            <MaterialIcons
              name={isReordering ? "check" : "sort"}
              size={22}
              color={isReordering ? theme.primary : theme.onSurfaceVariant}
            />
            <Text
              style={[
                styles.reorderToggleText,
                { color: isReordering ? theme.primary : theme.onSurfaceVariant }
              ]}
            >
              {isReordering ? "Done" : "Reorder"}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Pill group under Top App Bar matching favorites_toggle_group */}
      <View style={styles.pillGroupContainer}>
        {[
          { id: "Stations", icon: "star" },
          { id: "Subscribed", icon: "headphones" },
          { id: "Playlists", icon: "bookmark" },
          { id: "Searches", icon: "search" },
          { id: "History", icon: "history" }
        ].map((item) => {
          const isSelected = activeCategory === item.id;
          return (
            <TouchableOpacity
              key={item.id}
              style={[
                styles.categoryPill,
                {
                  backgroundColor: isSelected
                    ? theme.navIndicator
                    : theme.surfaceVariant
                }
              ]}
              onPress={() => setActiveCategory(item.id as FavCategory)}
            >
              <MaterialIcons
                name={item.icon as any}
                size={18}
                color={isSelected ? theme.primary : theme.onSurfaceVariant}
              />
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Content */}
      {activeCategory === "Stations" ? (
        <FlatList
          data={favoriteStations}
          keyExtractor={(item) => item.id}
          renderItem={renderStationItem}
          style={{ backgroundColor: theme.surface }}
          contentContainerStyle={[styles.listContent, { paddingBottom: 170 + insets.bottom }]}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={[styles.emptyText, { color: theme.onSurfaceVariant }]}>
                No favourite stations yet
              </Text>
            </View>
          }
        />
      ) : (
        <View style={[styles.emptyContainer, { backgroundColor: theme.surface, flex: 1 }]}>
          <Text style={[styles.emptyText, { color: theme.onSurfaceVariant }]}>
            {activeCategory === "Subscribed" && "No subscribed podcasts yet"}
            {activeCategory === "Playlists" && "No playlists yet"}
            {activeCategory === "Searches" && "No saved searches yet"}
            {activeCategory === "History" && "No history yet"}
          </Text>
        </View>
      )}
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  topAppBarTitle: {
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: 0
  },
  reorderToggleButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 4
  },
  reorderToggleText: {
    fontSize: 13,
    fontWeight: "600"
  },
  pillGroupContainer: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6
  },
  categoryPill: {
    flex: 1,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center"
  },
  listContent: {
    paddingBottom: 170
  },
  stationRow: {
    height: ITEM_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0,0,0,0.06)"
  },
  dragHandleContainer: {
    width: 36,
    height: 48,
    alignItems: "center",
    justifyContent: "center"
  },
  stationMainTouchable: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    marginLeft: 4
  },
  stationInfo: {
    flex: 1,
    marginLeft: 12,
    justifyContent: "center"
  },
  stationTitle: {
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0.15
  },
  reorderButtonsRow: {
    flexDirection: "row",
    alignItems: "center"
  },
  actionButton: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 1
  },
  disabledButton: {
    opacity: 0.3
  },
  emptyContainer: {
    padding: 32,
    alignItems: "center",
    justifyContent: "center"
  },
  emptyText: {
    fontSize: 14,
    textAlign: "center"
  }
});
