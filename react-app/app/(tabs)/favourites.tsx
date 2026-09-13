import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  LayoutAnimation,
  Platform,
  UIManager,
  PanResponder,
  Animated
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

interface StationRowProps {
  station: Station;
  isDragging: boolean;
  panY: Animated.Value;
  scaleAnim: Animated.Value;
  translationY: Animated.Value;
  panHandlers: any;
  onPlay: (station: Station) => void;
  onSchedule: (station: Station) => void;
  onToggleFavorite: (stationId: string) => void;
  theme: any;
}

function StationRow({
  station,
  isDragging,
  panY,
  scaleAnim,
  translationY,
  panHandlers,
  onPlay,
  onSchedule,
  onToggleFavorite,
  theme
}: StationRowProps) {
  const transform = isDragging
    ? [{ translateY: panY }, { scale: scaleAnim }]
    : [{ translateY: translationY }];

  return (
    <Animated.View
      style={[
        styles.stationRow,
        {
          backgroundColor: isDragging
            ? (theme.surfaceVariant || "#2b2930")
            : theme.surface,
          zIndex: isDragging ? 9999 : 1,
          elevation: isDragging ? 24 : 0,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 10 },
          shadowOpacity: isDragging ? 0.5 : 0,
          shadowRadius: isDragging ? 14 : 0,
          borderRadius: isDragging ? 12 : 0,
          borderColor: isDragging ? theme.primary : "transparent",
          borderWidth: isDragging ? 1.5 : 0,
          transform
        }
      ]}
    >
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

      {/* Drag handle to the left of the schedule icon matching Kotlin station_list_item.xml */}
      <View
        {...panHandlers}
        style={styles.dragHandleContainer}
        hitSlop={{ top: 14, bottom: 14, left: 10, right: 10 }}
      >
        <MaterialIcons
          name="drag-handle"
          size={24}
          color={isDragging ? theme.primary : theme.outline}
        />
      </View>

      {/* Schedule Button */}
      <TouchableOpacity
        style={styles.actionButton}
        onPress={() => onSchedule(station)}
        hitSlop={{ top: 12, bottom: 12, left: 4, right: 4 }}
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
        hitSlop={{ top: 12, bottom: 12, left: 4, right: 8 }}
      >
        <MaterialIcons
          name="star"
          size={24}
          color={theme.star}
        />
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function FavouritesScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const [activeCategory, setActiveCategory] = useState<FavCategory>("Stations");
  const [draggingStationId, setDraggingStationId] = useState<string | null>(null);

  const {
    favorites,
    currentStation,
    playStation,
    togglePlayPause,
    toggleFavorite,
    setFavoritesOrder
  } = usePlayerStore();

  const allStations = useMemo(() => StationRepository.getAll(), []);
  const [orderedList, setOrderedList] = useState<Station[]>([]);

  // Sync orderedList whenever favorites change externally or on load
  useEffect(() => {
    const map = new Map(allStations.map((s) => [s.id, s]));
    const list = favorites
      .map((id) => map.get(id))
      .filter((s): s is Station => s !== undefined);
    setOrderedList(list);
  }, [allStations, favorites]);

  // Keep a ref to the latest orderedList for panResponder callbacks
  const orderedListRef = useRef<Station[]>([]);
  orderedListRef.current = orderedList;

  // Native-driven animation values for 60/120 FPS buttery smooth drag & hover
  const panY = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1.0)).current;
  const dragStartIndexRef = useRef<number>(0);
  const currentTargetIndexRef = useRef<number>(0);
  const isDraggingRef = useRef<boolean>(false);

  const neighborTranslations = useRef<Record<string, Animated.Value>>({});
  const getTranslation = useCallback((id: string) => {
    if (!neighborTranslations.current[id]) {
      neighborTranslations.current[id] = new Animated.Value(0);
    }
    return neighborTranslations.current[id];
  }, []);

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

  const createPanResponder = useCallback(
    (startIndex: number, station: Station) =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          isDraggingRef.current = true;
          dragStartIndexRef.current = startIndex;
          currentTargetIndexRef.current = startIndex;
          panY.setValue(0);
          setDraggingStationId(station.id);
          Animated.spring(scaleAnim, {
            toValue: 1.04,
            friction: 6,
            tension: 120,
            useNativeDriver: true
          }).start();
        },
        onPanResponderMove: (_, gestureState) => {
          panY.setValue(gestureState.dy);

          const fromIdx = dragStartIndexRef.current;
          const currentList = orderedListRef.current;
          const target = Math.max(
            0,
            Math.min(
              currentList.length - 1,
              fromIdx + Math.round(gestureState.dy / ITEM_HEIGHT)
            )
          );

          if (target !== currentTargetIndexRef.current) {
            currentTargetIndexRef.current = target;

            currentList.forEach((item, j) => {
              if (item.id === station.id) return;
              let shift = 0;
              if (target > fromIdx) {
                if (j > fromIdx && j <= target) {
                  shift = -ITEM_HEIGHT;
                }
              } else if (target < fromIdx) {
                if (j >= target && j < fromIdx) {
                  shift = ITEM_HEIGHT;
                }
              }
              Animated.spring(getTranslation(item.id), {
                toValue: shift,
                friction: 9,
                tension: 140,
                useNativeDriver: true
              }).start();
            });
          }
        },
        onPanResponderRelease: () => {
          const fromIdx = dragStartIndexRef.current;
          const finalTarget = currentTargetIndexRef.current;
          const landingY = (finalTarget - fromIdx) * ITEM_HEIGHT;
          const currentList = orderedListRef.current;

          Animated.parallel([
            Animated.spring(panY, {
              toValue: landingY,
              friction: 8,
              tension: 110,
              useNativeDriver: true
            }),
            Animated.spring(scaleAnim, {
              toValue: 1.0,
              friction: 8,
              tension: 110,
              useNativeDriver: true
            })
          ]).start(() => {
            // First reset animated values and dragging state so no translation offsets linger
            currentList.forEach((s) => {
              getTranslation(s.id).setValue(0);
            });
            panY.setValue(0);
            isDraggingRef.current = false;
            setDraggingStationId(null);

            if (finalTarget !== fromIdx) {
              const updated = [...currentList];
              const [moved] = updated.splice(fromIdx, 1);
              updated.splice(finalTarget, 0, moved);
              setOrderedList(updated);

              const newIds = updated.map((s) => s.id);
              const otherFavorites = favorites.filter((id) => !newIds.includes(id));
              setFavoritesOrder([...newIds, ...otherFavorites]);
            }
          });
        },
        onPanResponderTerminate: () => {
          Animated.parallel([
            Animated.spring(panY, {
              toValue: 0,
              useNativeDriver: true
            }),
            Animated.spring(scaleAnim, {
              toValue: 1.0,
              useNativeDriver: true
            })
          ]).start(() => {
            orderedListRef.current.forEach((s) => {
              getTranslation(s.id).setValue(0);
            });
            panY.setValue(0);
            isDraggingRef.current = false;
            setDraggingStationId(null);
          });
        }
      }),
    [favorites, getTranslation, panY, scaleAnim, setFavoritesOrder]
  );

  const renderStationItem = useCallback(
    ({ item, index }: { item: Station; index: number }) => {
      const isDragging = item.id === draggingStationId;
      const panResponder = createPanResponder(index, item);

      return (
        <StationRow
          station={item}
          isDragging={isDragging}
          panY={panY}
          scaleAnim={scaleAnim}
          translationY={getTranslation(item.id)}
          panHandlers={panResponder.panHandlers}
          onPlay={handlePlayStation}
          onSchedule={handleOpenSchedule}
          onToggleFavorite={toggleFavorite}
          theme={theme}
        />
      );
    },
    [draggingStationId, createPanResponder, panY, scaleAnim, getTranslation, handlePlayStation, handleOpenSchedule, toggleFavorite, theme]
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
          data={orderedList}
          keyExtractor={(item) => item.id}
          renderItem={renderStationItem}
          scrollEnabled={!draggingStationId}
          removeClippedSubviews={false}
          style={{ backgroundColor: theme.surface, overflow: "visible" }}
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
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0,0,0,0.06)"
  },
  dragHandleContainer: {
    width: 40,
    height: 40,
    marginLeft: 8,
    alignItems: "center",
    justifyContent: "center"
  },
  stationMainTouchable: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center"
  },
  stationInfo: {
    flex: 1,
    marginLeft: 16,
    justifyContent: "center"
  },
  stationTitle: {
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0.15
  },
  actionButton: {
    width: 40,
    height: 40,
    marginLeft: 4,
    alignItems: "center",
    justifyContent: "center"
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
