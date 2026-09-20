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
  Animated,
  Image,
  ScrollView,
  Alert
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { MaterialIcons } from "@expo/vector-icons";
import { Station, StationRepository } from "../../src/data/stations";
import { usePlayerStore } from "../../src/store/playerStore";
import { StationLogo } from "../../src/components/StationLogo";
import { useAppTheme } from "../../src/theme/colors";
import { fetchShowInfo } from "../../src/api/showInfo";
import { Podcast, PodcastApi, decodeXmlEntities } from "../../src/api/podcasts";
import { Preferences } from "../../src/storage/preferences";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type FavCategory = "Stations" | "Subscribed" | "Playlists" | "Searches" | "History";
type PodcastSort = "most_recently_updated" | "least_recently_updated" | "alphabetical" | "manual" | "tags";
type PlaylistSummary = { id: string; name: string; isDefault: boolean; itemCount: number };
type SavedPodcastSearch = { id: string; name: string; query: string; notificationsEnabled: boolean };

const ITEM_HEIGHT = 72;
const FAVOURITE_SECTION_TITLES: Record<FavCategory, string> = {
  Stations: "Favourite Stations",
  Subscribed: "Subscribed Podcasts",
  Playlists: "Playlists",
  Searches: "Saved Searches",
  History: "Listening History"
};

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
  showTitle?: string;
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
  showTitle,
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
          {showTitle ? (
            <Text
              style={[styles.stationSubtitle, { color: theme.onSurfaceVariant }]}
              numberOfLines={1}
            >
              {showTitle}
            </Text>
          ) : null}
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
  const [showTitles, setShowTitles] = useState<Record<string, string>>({});
  const [subscribedPodcasts, setSubscribedPodcasts] = useState<Podcast[]>([]);
  const [newEpisodeIds, setNewEpisodeIds] = useState<Set<string>>(new Set());
  const [podcastSort, setPodcastSort] = useState<PodcastSort>(
    () => Preferences.getSubscribedPodcastSort() as PodcastSort
  );
  const [latestEpisodeTimes, setLatestEpisodeTimes] = useState<Record<string, number>>({});
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>(
    () => Preferences.getPodcastPlaylists()
  );
  const [hidePlayedEpisodes, setHidePlayedEpisodes] = useState(
    () => Preferences.getHidePlayedEpisodesInPlaylists()
  );
  const [savedSearches, setSavedSearches] = useState<SavedPodcastSearch[]>(
    () => Preferences.getSavedPodcastSearches()
  );
  const [, forceTagUpdate] = useState(0);

  const {
    favorites,
    currentStation,
    currentShow,
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

  useEffect(() => {
    let isMounted = true;

    async function loadShowTitles() {
      const results = await Promise.all(
        favorites.map(async (stationId) => {
          try {
            const show = await fetchShowInfo(stationId);
            return [stationId, show.title !== "BBC Radio" ? show.title : ""] as const;
          } catch {
            return [stationId, ""] as const;
          }
        })
      );

      if (isMounted) {
        setShowTitles(Object.fromEntries(results));
      }
    }

    loadShowTitles();
    return () => {
      isMounted = false;
    };
  }, [favorites]);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;
      const subscribedIds = Preferences.getSubscribedPodcasts();

      setSubscribedPodcasts((current) =>
        current.filter((podcast) => subscribedIds.includes(podcast.id))
      );

      PodcastApi.fetchLiveCatalog().then((catalog) => {
        if (!isMounted) return;
        const subscribed = new Set(Preferences.getSubscribedPodcasts());
        const subscribedPodcasts = catalog.filter((podcast) => subscribed.has(podcast.id));
        setSubscribedPodcasts(subscribedPodcasts);

        Promise.all(
          subscribedPodcasts.map(async (podcast) => {
            const episodes = await PodcastApi.fetchEpisodes(podcast.rssUrl, podcast.id);
            const latestEpisode = episodes[0];
            if (latestEpisode) {
              setLatestEpisodeTimes((current) => ({
                ...current,
                [podcast.id]: new Date(latestEpisode.pubDate).getTime() || 0
              }));
            }
            return latestEpisode &&
              Preferences.getPodcastPosition(latestEpisode.id) <= 0
              ? podcast.id
              : null;
          })
        ).then((newIds) => {
          if (isMounted) {
            setNewEpisodeIds(new Set(newIds.filter((id): id is string => id !== null)));
          }
        });
      });

      return () => {
        isMounted = false;
      };
    }, [])
  );

  useFocusEffect(
    useCallback(() => {
      setSavedSearches(Preferences.getSavedPodcastSearches());
    }, [])
  );

  const sortedSubscribedPodcasts = useMemo(() => {
    const podcasts = [...subscribedPodcasts];
    const byLatest = (podcast: Podcast) => latestEpisodeTimes[podcast.id] || 0;

    if (podcastSort === "alphabetical") {
      return podcasts.sort((a, b) => a.title.localeCompare(b.title));
    }
    if (podcastSort === "least_recently_updated") {
      return podcasts.sort((a, b) => byLatest(a) - byLatest(b));
    }
    if (podcastSort === "manual") {
      const order = new Map(
        Preferences.getSubscribedPodcastManualOrder().map((id, index) => [id, index])
      );
      return podcasts.sort((a, b) =>
        (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(b.id) ?? Number.MAX_SAFE_INTEGER)
      );
    }
    if (podcastSort === "tags") {
      return podcasts.sort((a, b) =>
        Preferences.getPodcastTags(a.id, a.genres)[0]?.localeCompare(
          Preferences.getPodcastTags(b.id, b.genres)[0] || ""
        ) || 0
      );
    }
    return podcasts.sort((a, b) => byLatest(b) - byLatest(a));
  }, [latestEpisodeTimes, podcastSort, subscribedPodcasts]);

  const selectPodcastSort = useCallback(() => {
    const options: Array<[string, PodcastSort]> = [
      ["Most recently updated", "most_recently_updated"],
      ["Least recently updated", "least_recently_updated"],
      ["Alphabetical (A-Z)", "alphabetical"],
      ["Manual sort", "manual"],
      ["Sort by tags", "tags"]
    ];
    Alert.alert(
      "Sort subscribed podcasts",
      undefined,
      [
        ...options.map(([label, value]) => ({
          text: value === podcastSort ? `${label} ✓` : label,
          onPress: () => {
            if (value === "manual" && Preferences.getSubscribedPodcastManualOrder().length === 0) {
              Preferences.setSubscribedPodcastManualOrder(subscribedPodcasts.map((podcast) => podcast.id));
            }
            Preferences.setSubscribedPodcastSort(value);
            setPodcastSort(value);
          }
        })),
        { text: "Cancel", style: "cancel" as const }
      ]
    );
  }, [podcastSort, subscribedPodcasts]);

  const createPlaylist = useCallback(() => {
    Alert.prompt("Create playlist", "Enter a name", (value) => {
      const name = value.trim();
      if (!name) return;
      Preferences.createPodcastPlaylist(name);
      setPlaylists(Preferences.getPodcastPlaylists());
    }, "plain-text");
  }, []);

  const showPlaylistMenu = useCallback(() => {
    Alert.alert(
      "Playlist options",
      undefined,
      [
        {
          text: hidePlayedEpisodes ? "Hide played episodes ✓" : "Hide played episodes",
          onPress: () => {
            const next = !hidePlayedEpisodes;
            Preferences.setHidePlayedEpisodesInPlaylists(next);
            setHidePlayedEpisodes(next);
          }
        },
        { text: "Cancel", style: "cancel" as const }
      ]
    );
  }, [hidePlayedEpisodes]);

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
          showTitle={
            currentStation?.id === item.id && currentShow?.title !== "BBC Radio"
              ? currentShow?.title
              : showTitles[item.id]
          }
          theme={theme}
        />
      );
    },
    [draggingStationId, createPanResponder, panY, scaleAnim, getTranslation, handlePlayStation, handleOpenSchedule, toggleFavorite, currentStation?.id, currentShow, showTitles, theme]
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
          {FAVOURITE_SECTION_TITLES[activeCategory]}
        </Text>
        {activeCategory === "Subscribed" ? (
          <TouchableOpacity
            style={styles.overflowButton}
            onPress={selectPodcastSort}
            accessibilityLabel="Sort subscribed podcasts"
          >
            <MaterialIcons name="more-vert" size={24} color={theme.onSurface} />
          </TouchableOpacity>
        ) : activeCategory === "Playlists" ? (
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.overflowButton}
              onPress={createPlaylist}
              accessibilityLabel="Create playlist"
            >
              <MaterialIcons name="add" size={25} color={theme.onSurface} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.overflowButton}
              onPress={showPlaylistMenu}
              accessibilityLabel="Playlist options"
            >
              <MaterialIcons name="more-vert" size={24} color={theme.onSurface} />
            </TouchableOpacity>
          </View>
        ) : null}
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
      ) : activeCategory === "Subscribed" ? (
        <FlatList
          data={sortedSubscribedPodcasts}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.listContent, { paddingBottom: 170 + insets.bottom }]}
          style={{ backgroundColor: theme.surface }}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[
                styles.podcastRow,
                { backgroundColor: theme.surface, borderBottomColor: theme.outlineVariant }
              ]}
              activeOpacity={0.7}
              onPress={() => {
                router.push({
                  pathname: "/modal/podcast-detail",
                  params: {
                    podcastId: item.id,
                    podcastData: JSON.stringify(item)
                  }
                });
              }}
            >
              {item.imageUrl ? (
                <Image source={{ uri: item.imageUrl }} style={styles.podcastArtwork} />
              ) : (
                <View style={[styles.podcastArtworkFallback, { backgroundColor: theme.primaryContainer }]}>
                  <MaterialIcons name="podcasts" size={32} color={theme.primary} />
                </View>
              )}
              <View style={styles.podcastInfo}>
                <Text
                  style={[styles.podcastTitle, { color: theme.onSurface }]}
                  numberOfLines={2}
                >
                  {decodeXmlEntities(item.title)}
                </Text>
                <Text
                  style={[styles.podcastDescription, { color: theme.onSurfaceVariant }]}
                  numberOfLines={2}
                >
                  {decodeXmlEntities(item.description)}
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.categoryChipScroller}
                  contentContainerStyle={styles.categoryChipRow}
                >
                  {Preferences.getPodcastTags(item.id, item.genres).map((tag) => (
                    <TouchableOpacity
                      key={`${item.id}-${tag}`}
                      style={[styles.categoryChip, { backgroundColor: theme.surfaceVariant }]}
                      onPress={() => {
                        Preferences.removePodcastTag(item.id, item.genres, tag);
                        forceTagUpdate((value) => value + 1);
                      }}
                      accessibilityLabel={`Remove ${tag} category`}
                    >
                      <Text
                        style={[styles.categoryChipText, { color: theme.onSurfaceVariant }]}
                        numberOfLines={1}
                      >
                        {decodeXmlEntities(tag)}
                      </Text>
                      <MaterialIcons name="close" size={12} color={theme.onSurfaceVariant} />
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity
                    style={[styles.addCategoryChip, { borderColor: theme.outline }]}
                    onPress={() => {
                      Alert.prompt(
                        "Add category",
                        "Enter a category for this podcast",
                        (value) => {
                          const tag = value.trim();
                          if (tag) {
                            Preferences.addPodcastTag(item.id, item.genres, tag);
                            forceTagUpdate((current) => current + 1);
                          }
                        },
                        "plain-text"
                      );
                    }}
                    accessibilityLabel="Add category"
                  >
                    <MaterialIcons name="add" size={14} color={theme.primary} />
                  </TouchableOpacity>
                </ScrollView>
              </View>
              {newEpisodeIds.has(item.id) ? (
                <View style={styles.newEpisodeDot} accessibilityLabel="New episodes available" />
              ) : null}
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={[styles.emptyText, { color: theme.onSurfaceVariant }]}>
                No subscribed podcasts yet
              </Text>
            </View>
          }
        />
      ) : activeCategory === "Playlists" ? (
        <FlatList
          data={playlists}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.listContent, { paddingBottom: 170 + insets.bottom }]}
          style={{ backgroundColor: theme.surface }}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.playlistRow, { backgroundColor: theme.surface, borderBottomColor: theme.outlineVariant }]}
              activeOpacity={0.7}
              onPress={() => Alert.alert(item.name, item.isDefault ? "Built-in playlist" : "Custom playlist")}
            >
              <View style={[styles.playlistIcon, { backgroundColor: theme.primaryContainer }]}>
                <MaterialIcons
                  name={item.id === "downloaded" ? "file-download" : "bookmark"}
                  size={28}
                  color={theme.primary}
                />
              </View>
              <View style={styles.playlistInfo}>
                <Text style={[styles.playlistTitle, { color: theme.onSurface }]}>{item.name}</Text>
                <Text style={[styles.playlistSubtitle, { color: theme.onSurfaceVariant }]}>
                  {item.itemCount ?? 0} {item.itemCount === 1 ? "Episode" : "Episodes"}
                </Text>
              </View>
              <MaterialIcons name="chevron-right" size={24} color={theme.onSurfaceVariant} />
            </TouchableOpacity>
          )}
        />
      ) : activeCategory === "Searches" ? (
        <FlatList
          data={savedSearches}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.listContent, { paddingBottom: 170 + insets.bottom }]}
          style={{ backgroundColor: theme.surface }}
          renderItem={({ item }) => (
            <View style={[styles.savedSearchRow, { backgroundColor: theme.surface, borderBottomColor: theme.outlineVariant }]}>
              <TouchableOpacity style={styles.savedSearchMain} onPress={() => Alert.alert(item.name, item.query)}>
                <MaterialIcons name="search" size={26} color={theme.primary} />
                <View style={styles.savedSearchInfo}>
                  <Text style={[styles.savedSearchName, { color: theme.onSurface }]}>{item.name}</Text>
                  <Text style={[styles.savedSearchQuery, { color: theme.onSurfaceVariant }]}>{item.query}</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.savedSearchAction}
                onPress={() => {
                  Preferences.updatePodcastSearchNotifications(item.id, !item.notificationsEnabled);
                  setSavedSearches(Preferences.getSavedPodcastSearches());
                }}
                accessibilityLabel={item.notificationsEnabled ? "Disable search alerts" : "Enable search alerts"}
              >
                <MaterialIcons
                  name={item.notificationsEnabled ? "notifications-active" : "notifications-none"}
                  size={22}
                  color={item.notificationsEnabled ? theme.primary : theme.onSurfaceVariant}
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.savedSearchAction}
                onPress={() => {
                  Preferences.removePodcastSearch(item.id);
                  setSavedSearches(Preferences.getSavedPodcastSearches());
                }}
                accessibilityLabel="Remove saved search"
              >
                <MaterialIcons name="delete-outline" size={22} color={theme.onSurfaceVariant} />
              </TouchableOpacity>
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={[styles.emptyText, { color: theme.onSurfaceVariant }]}>No saved searches yet</Text>
            </View>
          }
        />
      ) : (
        <View style={[styles.emptyContainer, { backgroundColor: theme.surface, flex: 1 }]}>
          <Text style={[styles.emptyText, { color: theme.onSurfaceVariant }]}>
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
  overflowButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center"
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center"
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
  stationSubtitle: {
    fontSize: 13,
    marginTop: 2
  },
  podcastRow: {
    minHeight: 96,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  podcastArtwork: {
    width: 80,
    height: 80,
    borderRadius: 8
  },
  podcastArtworkFallback: {
    width: 80,
    height: 80,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center"
  },
  podcastInfo: {
    flex: 1,
    flexShrink: 1,
    marginHorizontal: 12
  },
  podcastTitle: {
    fontSize: 16,
    fontWeight: "700"
  },
  podcastDescription: {
    fontSize: 13,
    marginTop: 4
  },
  categoryChipRow: {
    flexDirection: "row",
    gap: 4,
    marginTop: 6
  },
  categoryChipScroller: {
    width: "100%",
    alignSelf: "stretch",
    marginTop: 2
  },
  categoryChip: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 3,
    gap: 3
  },
  categoryChipText: {
    fontSize: 10
  },
  addCategoryChip: {
    width: 24,
    height: 22,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center"
  },
  newEpisodeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#d32f2f",
    marginLeft: 6
  },
  playlistRow: {
    minHeight: 88,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  playlistIcon: {
    width: 56,
    height: 56,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center"
  },
  playlistInfo: {
    flex: 1,
    marginLeft: 16
  },
  playlistTitle: {
    fontSize: 16,
    fontWeight: "700"
  },
  playlistSubtitle: {
    fontSize: 13,
    marginTop: 4
  },
  savedSearchRow: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  savedSearchMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center"
  },
  savedSearchInfo: {
    flex: 1,
    marginLeft: 14
  },
  savedSearchName: {
    fontSize: 16,
    fontWeight: "700"
  },
  savedSearchQuery: {
    fontSize: 13,
    marginTop: 3
  },
  savedSearchAction: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center"
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
