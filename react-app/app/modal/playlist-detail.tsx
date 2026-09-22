import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  FlatList,
  Image,
  Modal,
  PanResponder,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View
} from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { Episode, Podcast, decodeXmlEntities } from "../../src/api/podcasts";
import { Preferences, SavedEpisodeEntry } from "../../src/storage/preferences";
import { useDownloadStore, toSavedEpisodeEntry } from "../../src/downloads/downloadStore";
import { usePlayerStore } from "../../src/store/playerStore";
import { useAppTheme } from "../../src/theme/colors";
import { MiniPlayer } from "../../src/components/MiniPlayer";
import { AppNavigation } from "../../src/components/AppNavigation";
import { useNetworkStatus } from "../../src/store/networkStore";

type PlaylistSort = "newest_first" | "oldest_first" | "title" | "manual";

const EPISODE_ITEM_HEIGHT = 88;

const PLAYLIST_SORT_OPTIONS: Array<[string, PlaylistSort]> = [
  ["Sort: Newest first", "newest_first"],
  ["Sort: Oldest first", "oldest_first"],
  ["Sort: Title", "title"],
  ["Sort: Manual", "manual"]
];

function formatEpisodeDate(raw?: string): string {
  if (!raw) return "";
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric"
    }).format(parsed);
  }
  return raw.includes(":") ? raw.split(":")[0].trim() : raw.trim();
}

export default function PlaylistDetailModal() {
  const router = useRouter();
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ playlistId?: string; playlistName?: string }>();
  const playlistId = params.playlistId || "saved";
  const playlistName = params.playlistName || "Playlist";

  const downloads = useDownloadStore((state) => state.downloads);
  const { playEpisode, currentEpisode, isPlaying, togglePlayPause } = usePlayerStore();
  const { isOnline } = useNetworkStatus();

  const [rawEntries, setRawEntries] = useState<SavedEpisodeEntry[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [playlistSort, setPlaylistSort] = useState<PlaylistSort>(() => {
    return (Preferences.getSetting(`pref_playlist_sort_${playlistId}`, "newest_first") as PlaylistSort) || "newest_first";
  });
  const [hidePlayed, setHidePlayed] = useState(() => Preferences.getHidePlayedEpisodesInPlaylists());
  const [manualOrder, setManualOrder] = useState<string[]>(() => {
    const raw = Preferences.getSetting(`pref_playlist_manual_${playlistId}`, "[]");
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  });

  const [sortModalVisible, setSortModalVisible] = useState(false);
  const [optionsModalVisible, setOptionsModalVisible] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<SavedEpisodeEntry | null>(null);

  const loadEntries = useCallback(() => {
    if (playlistId === "downloaded") {
      setRawEntries(
        Object.values(Preferences.getDownloadedEntries())
          .sort((a, b) => b.downloadedAtMs - a.downloadedAtMs)
          .map((record) => record.entry)
      );
      return;
    }
    const all = Preferences.getPodcastPlaylistEntries(playlistId);
    setRawEntries(isOnline ? all : all.filter((entry) => Preferences.isEpisodeDownloaded(entry.id)));
  }, [playlistId, isOnline]);

  useFocusEffect(
    useCallback(() => {
      loadEntries();
    }, [loadEntries])
  );

  useEffect(() => {
    loadEntries();
  }, [downloads, loadEntries]);

  // Sort and filter entries
  const displayEntries = useMemo(() => {
    let list = [...rawEntries];
    if (hidePlayed) {
      list = list.filter((e) => !Preferences.isEpisodePlayed(e.id));
    }

    if (playlistSort === "newest_first") {
      return list.sort((a, b) => {
        const timeA = a.pubDate ? Date.parse(a.pubDate) || 0 : 0;
        const timeB = b.pubDate ? Date.parse(b.pubDate) || 0 : 0;
        return timeB - timeA;
      });
    }

    if (playlistSort === "oldest_first") {
      return list.sort((a, b) => {
        const timeA = a.pubDate ? Date.parse(a.pubDate) || 0 : 0;
        const timeB = b.pubDate ? Date.parse(b.pubDate) || 0 : 0;
        return timeA - timeB;
      });
    }

    if (playlistSort === "title") {
      return list.sort((a, b) => a.title.localeCompare(b.title));
    }

    if (playlistSort === "manual") {
      if (manualOrder.length === 0) return list;
      const orderMap = new Map(manualOrder.map((id, index) => [id, index]));
      return list.sort((a, b) => {
        const idxA = orderMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
        const idxB = orderMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;
        return idxA - idxB;
      });
    }

    return list;
  }, [rawEntries, hidePlayed, playlistSort, manualOrder]);

  const [draggingEpisodeId, setDraggingEpisodeId] = useState<string | null>(null);
  const episodePanY = useRef(new Animated.Value(0)).current;
  const episodeScaleAnim = useRef(new Animated.Value(1.0)).current;
  const episodeDragStartIndexRef = useRef<number>(0);
  const episodeCurrentTargetIndexRef = useRef<number>(0);
  const episodeIsDraggingRef = useRef<boolean>(false);
  const episodeOrderedListRef = useRef<SavedEpisodeEntry[]>([]);
  episodeOrderedListRef.current = displayEntries;

  const episodeNeighborTranslations = useRef<Record<string, Animated.Value>>({});
  const getEpisodeTranslation = useCallback((id: string) => {
    if (!episodeNeighborTranslations.current[id]) {
      episodeNeighborTranslations.current[id] = new Animated.Value(0);
    }
    return episodeNeighborTranslations.current[id];
  }, []);

  const createEpisodePanResponder = useCallback(
    (index: number, episode: SavedEpisodeEntry) =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dy) > 4,
        onPanResponderGrant: () => {
          episodeIsDraggingRef.current = true;
          setDraggingEpisodeId(episode.id);
          episodeDragStartIndexRef.current = index;
          episodeCurrentTargetIndexRef.current = index;
          episodePanY.setValue(0);

          Animated.spring(episodeScaleAnim, {
            toValue: 1.03,
            friction: 8,
            tension: 110,
            useNativeDriver: true
          }).start();
        },
        onPanResponderMove: (_, gestureState) => {
          episodePanY.setValue(gestureState.dy);

          const fromIdx = episodeDragStartIndexRef.current;
          const currentList = episodeOrderedListRef.current;
          const target = Math.max(
            0,
            Math.min(
              currentList.length - 1,
              fromIdx + Math.round(gestureState.dy / EPISODE_ITEM_HEIGHT)
            )
          );

          if (target !== episodeCurrentTargetIndexRef.current) {
            episodeCurrentTargetIndexRef.current = target;

            currentList.forEach((item, j) => {
              if (item.id === episode.id) return;
              let shift = 0;
              if (target > fromIdx) {
                if (j > fromIdx && j <= target) {
                  shift = -EPISODE_ITEM_HEIGHT;
                }
              } else if (target < fromIdx) {
                if (j >= target && j < fromIdx) {
                  shift = EPISODE_ITEM_HEIGHT;
                }
              }
              Animated.spring(getEpisodeTranslation(item.id), {
                toValue: shift,
                friction: 9,
                tension: 140,
                useNativeDriver: true
              }).start();
            });
          }
        },
        onPanResponderRelease: () => {
          const fromIdx = episodeDragStartIndexRef.current;
          const finalTarget = episodeCurrentTargetIndexRef.current;
          const landingY = (finalTarget - fromIdx) * EPISODE_ITEM_HEIGHT;
          const currentList = episodeOrderedListRef.current;

          Animated.parallel([
            Animated.spring(episodePanY, {
              toValue: landingY,
              friction: 8,
              tension: 110,
              useNativeDriver: true
            }),
            Animated.spring(episodeScaleAnim, {
              toValue: 1.0,
              friction: 8,
              tension: 110,
              useNativeDriver: true
            })
          ]).start(() => {
            currentList.forEach((e) => {
              getEpisodeTranslation(e.id).setValue(0);
            });
            episodePanY.setValue(0);
            episodeIsDraggingRef.current = false;
            setDraggingEpisodeId(null);

            if (finalTarget !== fromIdx) {
              const updated = [...currentList];
              const [moved] = updated.splice(fromIdx, 1);
              if (moved) {
                updated.splice(finalTarget, 0, moved);
                const newIds = updated.map((e) => e.id);
                setManualOrder(newIds);
                Preferences.setSetting(
                  `pref_playlist_manual_${playlistId}`,
                  JSON.stringify(newIds)
                );
              }
            }
          });
        },
        onPanResponderTerminate: () => {
          Animated.parallel([
            Animated.spring(episodePanY, {
              toValue: 0,
              useNativeDriver: true
            }),
            Animated.spring(episodeScaleAnim, {
              toValue: 1.0,
              useNativeDriver: true
            })
          ]).start(() => {
            episodeOrderedListRef.current.forEach((e) => {
              getEpisodeTranslation(e.id).setValue(0);
            });
            episodePanY.setValue(0);
            episodeIsDraggingRef.current = false;
            setDraggingEpisodeId(null);
          });
        }
      }),
    [getEpisodeTranslation, episodePanY, episodeScaleAnim, playlistId]
  );

  const toggleSelection = useCallback((episodeId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(episodeId)) next.delete(episodeId);
      else next.add(episodeId);
      return next;
    });
  }, []);

  const exitSelection = useCallback(() => {
    setSelectionMode(false);
    setSelected(new Set());
  }, []);

  const removeSelected = useCallback(() => {
    selected.forEach((episodeId) => {
      if (playlistId === "downloaded") useDownloadStore.getState().remove(episodeId);
      else Preferences.removePodcastPlaylistEntry(playlistId, episodeId);
    });
    exitSelection();
    loadEntries();
  }, [selected, playlistId, exitSelection, loadEntries]);

  const downloadSelected = useCallback(() => {
    const store = useDownloadStore.getState();
    rawEntries
      .filter((entry) => selected.has(entry.id) && !store.downloads[entry.id])
      .forEach((entry) => {
        const podcast: Podcast = {
          id: entry.podcastId,
          title: entry.podcastTitle,
          description: "",
          rssUrl: "",
          htmlUrl: "",
          imageUrl: entry.imageUrl,
          genres: [],
          typicalDurationMins: entry.durationMins
        };
        const episode: Episode = {
          id: entry.id,
          title: entry.title,
          description: entry.description,
          audioUrl: entry.audioUrl,
          imageUrl: entry.imageUrl,
          pubDate: entry.pubDate,
          durationMins: entry.durationMins,
          podcastId: entry.podcastId
        };
        void store.download(toSavedEpisodeEntry(podcast, episode));
      });
    exitSelection();
  }, [rawEntries, selected, exitSelection]);

  // Opens Now Playing without autoplaying
  const openEntryInNowPlaying = useCallback(
    (entry: SavedEpisodeEntry) => {
      const isCurrent = currentEpisode?.id === entry.id;
      if (isCurrent) {
        router.push("/modal/now-playing");
        return;
      }
      const podcast: Podcast = {
        id: entry.podcastId,
        title: entry.podcastTitle,
        description: "",
        rssUrl: "",
        htmlUrl: "",
        imageUrl: entry.imageUrl,
        genres: [],
        typicalDurationMins: entry.durationMins
      };
      const episode: Episode = {
        id: entry.id,
        title: entry.title,
        description: entry.description,
        audioUrl: entry.audioUrl,
        imageUrl: entry.imageUrl,
        pubDate: entry.pubDate,
        durationMins: entry.durationMins,
        podcastId: entry.podcastId
      };
      router.push({
        pathname: "/modal/now-playing",
        params: {
          podcastData: JSON.stringify(podcast),
          episodeData: JSON.stringify(episode)
        }
      });
    },
    [currentEpisode?.id, router]
  );

  // Directly starts playback
  const playEntry = useCallback(
    (entry: SavedEpisodeEntry) => {
      const isCurrent = currentEpisode?.id === entry.id;
      if (isCurrent) {
        void togglePlayPause();
      } else {
        const podcast: Podcast = {
          id: entry.podcastId,
          title: entry.podcastTitle,
          description: "",
          rssUrl: "",
          htmlUrl: "",
          imageUrl: entry.imageUrl,
          genres: [],
          typicalDurationMins: entry.durationMins
        };
        const episode: Episode = {
          id: entry.id,
          title: entry.title,
          description: entry.description,
          audioUrl: entry.audioUrl,
          imageUrl: entry.imageUrl,
          pubDate: entry.pubDate,
          durationMins: entry.durationMins,
          podcastId: entry.podcastId
        };
        void playEpisode(podcast, episode);
      }
      router.push("/modal/now-playing");
    },
    [currentEpisode?.id, playEpisode, togglePlayPause, router]
  );

  const removeEntry = useCallback(
    (entry: SavedEpisodeEntry) => {
      if (playlistId === "downloaded") {
        useDownloadStore.getState().remove(entry.id);
      } else {
        Preferences.removePodcastPlaylistEntry(playlistId, entry.id);
      }
      setRemoveTarget(null);
      loadEntries();
    },
    [playlistId, loadEntries]
  );

  const areAllDownloaded =
    rawEntries.length > 0 &&
    rawEntries.every((e) => downloads[e.id]?.status === "downloaded");

  const handleBulkDownload = () => {
    setOptionsModalVisible(false);
    if (areAllDownloaded) {
      rawEntries.forEach((e) => useDownloadStore.getState().remove(e.id));
    } else {
      const store = useDownloadStore.getState();
      rawEntries
        .filter((e) => downloads[e.id]?.status !== "downloaded")
        .forEach((entry) => {
          const podcast: Podcast = {
            id: entry.podcastId,
            title: entry.podcastTitle,
            description: "",
            rssUrl: "",
            htmlUrl: "",
            imageUrl: entry.imageUrl,
            genres: [],
            typicalDurationMins: entry.durationMins
          };
          const episode: Episode = {
            id: entry.id,
            title: entry.title,
            description: entry.description,
            audioUrl: entry.audioUrl,
            imageUrl: entry.imageUrl,
            pubDate: entry.pubDate,
            durationMins: entry.durationMins,
            podcastId: entry.podcastId
          };
          void store.download(toSavedEpisodeEntry(podcast, episode));
        });
    }
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.surfaceContainer }]}
      edges={["top"]}
    >
      <View
        style={[
          styles.appBar,
          { borderBottomColor: theme.outlineVariant, backgroundColor: theme.surfaceContainer }
        ]}
      >
        <TouchableOpacity
          onPress={() => (selectionMode ? exitSelection() : router.back())}
          style={styles.backButton}
          accessibilityLabel={selectionMode ? "Clear selection" : "Back"}
        >
          <MaterialIcons
            name={selectionMode ? "close" : "arrow-back"}
            size={24}
            color={theme.onSurface}
          />
        </TouchableOpacity>
        <Text style={[styles.appBarTitle, { color: theme.onSurface }]} numberOfLines={1}>
          {selectionMode ? `${selected.size} selected` : playlistName}
        </Text>

        {selectionMode ? (
          <View style={styles.selectionActions}>
            <TouchableOpacity
              onPress={downloadSelected}
              style={styles.headerIconButton}
              accessibilityLabel="Download selected"
            >
              <MaterialIcons name="download" size={22} color={theme.onSurface} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={removeSelected}
              style={styles.headerIconButton}
              accessibilityLabel={
                playlistId === "downloaded" ? "Delete downloads" : "Remove from playlist"
              }
            >
              <MaterialIcons
                name={playlistId === "downloaded" ? "delete-outline" : "remove-circle-outline"}
                size={22}
                color={theme.onSurface}
              />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.headerIconButton}
              onPress={() => setSortModalVisible(true)}
              accessibilityLabel="Sort playlist"
            >
              <MaterialIcons name="sort" size={24} color={theme.onSurface} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.headerIconButton}
              onPress={() => setOptionsModalVisible(true)}
              accessibilityLabel="Playlist options"
            >
              <MaterialIcons name="more-vert" size={24} color={theme.onSurface} />
            </TouchableOpacity>
          </View>
        )}
      </View>

      <FlatList
        data={displayEntries}
        keyExtractor={(item) => item.id}
        scrollEnabled={!draggingEpisodeId}
        removeClippedSubviews={false}
        contentContainerStyle={[styles.listContent, { paddingBottom: 170 + insets.bottom }]}
        style={{ backgroundColor: theme.surface, overflow: "visible" }}
        renderItem={({ item, index }) => {
          const isCurrent = currentEpisode?.id === item.id;
          const isDraggingThis = draggingEpisodeId === item.id;
          const episodePanResponder = createEpisodePanResponder(index, item);
          const transform = isDraggingThis
            ? [{ translateY: episodePanY }, { scale: episodeScaleAnim }]
            : [{ translateY: getEpisodeTranslation(item.id) }];

          const progressSeconds = Preferences.getEpisodeProgress(item.id);
          const durationSeconds = (item.durationMins || 0) * 60;
          const isPlayed = Preferences.isEpisodePlayed(item.id);
          const progressPercent =
            !isPlayed && durationSeconds > 0 && progressSeconds > 0
              ? Math.min(100, Math.round((progressSeconds / durationSeconds) * 100))
              : 0;

          return (
            <Animated.View
              style={[
                styles.row,
                {
                  backgroundColor: isDraggingThis ? theme.surfaceContainer : theme.surface,
                  borderBottomColor: theme.outlineVariant,
                  transform,
                  zIndex: isDraggingThis ? 999 : 1,
                  elevation: isDraggingThis ? 8 : 0,
                  shadowColor: "#000",
                  shadowOffset: { width: 0, height: isDraggingThis ? 6 : 0 },
                  shadowOpacity: isDraggingThis ? 0.25 : 0,
                  shadowRadius: isDraggingThis ? 8 : 0
                }
              ]}
            >
              <TouchableOpacity
                style={styles.rowMain}
                activeOpacity={0.7}
                onPress={() => {
                  if (selectionMode) toggleSelection(item.id);
                  else openEntryInNowPlaying(item);
                }}
                onLongPress={() => {
                  if (!selectionMode) {
                    setSelectionMode(true);
                    setSelected(new Set([item.id]));
                  }
                }}
              >
                {selectionMode ? (
                  <MaterialIcons
                    name={selected.has(item.id) ? "check-circle" : "radio-button-unchecked"}
                    size={24}
                    color={selected.has(item.id) ? theme.primary : theme.onSurfaceVariant}
                    style={{ marginRight: 12 }}
                  />
                ) : null}

                {item.imageUrl ? (
                  <Image source={{ uri: item.imageUrl }} style={styles.artwork} />
                ) : (
                  <View
                    style={[
                      styles.artworkFallback,
                      { backgroundColor: theme.primaryContainer }
                    ]}
                  >
                    <MaterialIcons name="podcasts" size={26} color={theme.primary} />
                  </View>
                )}

                <View style={styles.info}>
                  <Text style={[styles.title, { color: theme.onSurface }]} numberOfLines={2}>
                    {decodeXmlEntities(item.title)}
                  </Text>
                  {item.podcastTitle ? (
                    <Text
                      style={[styles.podcastTitle, { color: theme.onSurfaceVariant }]}
                      numberOfLines={1}
                    >
                      {decodeXmlEntities(item.podcastTitle)}
                    </Text>
                  ) : null}

                  {progressPercent > 0 ? (
                    <View
                      style={[
                        styles.progressBarTrack,
                        { backgroundColor: theme.surfaceVariant }
                      ]}
                    >
                      <View
                        style={[
                          styles.progressBarFill,
                          { width: `${progressPercent}%`, backgroundColor: theme.primary }
                        ]}
                      />
                    </View>
                  ) : null}

                  <View style={styles.metaRow}>
                    <Text style={[styles.metaText, { color: theme.onSurfaceVariant }]}>
                      {formatEpisodeDate(item.pubDate)}
                    </Text>
                    {item.durationMins > 0 ? (
                      <Text style={[styles.metaText, { color: theme.onSurfaceVariant }]}>
                        {item.durationMins} min
                      </Text>
                    ) : null}
                    {isPlayed ? (
                      <View style={styles.playedBadge}>
                        <MaterialIcons name="check-circle" size={13} color="#4CAF50" />
                        <Text style={styles.playedBadgeText}>Played</Text>
                      </View>
                    ) : progressSeconds > 0 ? (
                      <Text style={styles.inProgressBadgeText}>~ In progress</Text>
                    ) : null}
                  </View>
                </View>
              </TouchableOpacity>

              {!selectionMode ? (
                <View style={styles.rowTrailingActions}>
                  <TouchableOpacity
                    style={[
                      styles.playButton,
                      {
                        backgroundColor:
                          isCurrent && isPlaying ? theme.primary : theme.primaryContainer
                      }
                    ]}
                    onPress={() => playEntry(item)}
                    accessibilityLabel={isCurrent && isPlaying ? "Pause episode" : "Play episode"}
                  >
                    <MaterialIcons
                      name={isCurrent && isPlaying ? "pause" : "play-arrow"}
                      size={20}
                      color={isCurrent && isPlaying ? "#FFFFFF" : theme.primary}
                    />
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.removeButton}
                    onPress={() => setRemoveTarget(item)}
                    accessibilityLabel={
                      playlistId === "downloaded" ? "Delete download" : "Remove from playlist"
                    }
                  >
                    <MaterialIcons
                      name={
                        playlistId === "downloaded"
                          ? "delete-outline"
                          : "remove-circle-outline"
                      }
                      size={22}
                      color={theme.onSurfaceVariant}
                    />
                  </TouchableOpacity>

                  {playlistSort === "manual" ? (
                    <View
                      {...episodePanResponder.panHandlers}
                      style={styles.dragHandleContainer}
                      hitSlop={{ top: 16, bottom: 16, left: 12, right: 12 }}
                    >
                      <MaterialIcons
                        name="drag-indicator"
                        size={24}
                        color={isDraggingThis ? theme.primary : theme.onSurfaceVariant}
                      />
                    </View>
                  ) : null}
                </View>
              ) : null}
            </Animated.View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <MaterialIcons name="bookmark-border" size={48} color={theme.onSurfaceVariant} />
            <Text style={[styles.emptyText, { color: theme.onSurface }]}>
              {playlistId === "downloaded"
                ? "No downloaded episodes yet"
                : "Nothing saved to this playlist yet"}
            </Text>
          </View>
        }
      />

      {/* Sort Modal */}
      <Modal
        visible={sortModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSortModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.dialogBackdrop}
          activeOpacity={1}
          onPress={() => setSortModalVisible(false)}
        >
          <View
            style={[styles.dialogCard, { backgroundColor: theme.surfaceContainer }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[styles.dialogTitle, { color: theme.onSurface }]}>
              Sort playlist
            </Text>
            {PLAYLIST_SORT_OPTIONS.map(([label, value]) => {
              const isSelected = playlistSort === value;
              return (
                <TouchableOpacity
                  key={value}
                  style={styles.sortOptionRow}
                  activeOpacity={0.7}
                  onPress={() => {
                    Preferences.setSetting(`pref_playlist_sort_${playlistId}`, value);
                    setPlaylistSort(value);
                    if (value === "manual" && manualOrder.length === 0) {
                      const ids = rawEntries.map((e) => e.id);
                      setManualOrder(ids);
                      Preferences.setSetting(
                        `pref_playlist_manual_${playlistId}`,
                        JSON.stringify(ids)
                      );
                    }
                    setSortModalVisible(false);
                  }}
                >
                  <MaterialIcons
                    name={isSelected ? "radio-button-checked" : "radio-button-unchecked"}
                    size={22}
                    color={isSelected ? theme.primary : theme.onSurfaceVariant}
                  />
                  <Text
                    style={[
                      styles.sortOptionLabel,
                      {
                        color: isSelected ? theme.primary : theme.onSurface,
                        fontWeight: isSelected ? "700" : "400"
                      }
                    ]}
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
            <View style={styles.dialogActions}>
              <TouchableOpacity
                onPress={() => setSortModalVisible(false)}
                style={styles.dialogButton}
              >
                <Text style={{ color: theme.primary, fontWeight: "600" }}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Options Modal */}
      <Modal
        visible={optionsModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setOptionsModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.dialogBackdrop}
          activeOpacity={1}
          onPress={() => setOptionsModalVisible(false)}
        >
          <View
            style={[styles.dialogCard, { backgroundColor: theme.surfaceContainer }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[styles.dialogTitle, { color: theme.onSurface }]}>
              Playlist options
            </Text>

            <View style={styles.dialogSwitchRow}>
              <Text style={[styles.dialogSwitchLabel, { color: theme.onSurface }]}>
                Hide played episodes
              </Text>
              <Switch
                value={hidePlayed}
                onValueChange={(val) => {
                  setHidePlayed(val);
                  Preferences.setHidePlayedEpisodesInPlaylists(val);
                }}
                trackColor={{ true: theme.primary, false: theme.outlineVariant }}
                thumbColor="#FFFFFF"
              />
            </View>

            {rawEntries.length > 0 ? (
              <TouchableOpacity
                style={styles.optionRowButton}
                onPress={handleBulkDownload}
              >
                <MaterialIcons
                  name={areAllDownloaded ? "delete-outline" : "download"}
                  size={22}
                  color={theme.primary}
                />
                <Text style={[styles.optionRowText, { color: theme.onSurface }]}>
                  {areAllDownloaded
                    ? "Delete all episode downloads"
                    : "Download all episodes"}
                </Text>
              </TouchableOpacity>
            ) : null}

            <View style={styles.dialogActions}>
              <TouchableOpacity
                onPress={() => setOptionsModalVisible(false)}
                style={styles.dialogButton}
              >
                <Text style={{ color: theme.primary, fontWeight: "600" }}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Remove Episode Confirmation Modal */}
      <Modal
        visible={removeTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setRemoveTarget(null)}
      >
        <TouchableOpacity
          style={styles.dialogBackdrop}
          activeOpacity={1}
          onPress={() => setRemoveTarget(null)}
        >
          <View
            style={[styles.dialogCard, { backgroundColor: theme.surfaceContainer }]}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.dialogHeaderRow}>
              <MaterialIcons name="delete-outline" size={26} color="#BA1A1A" />
              <Text
                style={[
                  styles.dialogTitle,
                  { color: theme.onSurface, marginBottom: 0, marginLeft: 12 }
                ]}
              >
                {playlistId === "downloaded" ? "Delete Download" : "Remove Episode"}
              </Text>
            </View>
            <Text
              style={[
                styles.dialogBodyText,
                { color: theme.onSurfaceVariant, marginVertical: 16 }
              ]}
              numberOfLines={2}
            >
              {playlistId === "downloaded"
                ? `Delete "${removeTarget?.title}" from downloaded files?`
                : `Remove "${removeTarget?.title}" from ${playlistName}?`}
            </Text>
            <View style={styles.dialogActions}>
              <TouchableOpacity
                onPress={() => setRemoveTarget(null)}
                style={styles.dialogButton}
              >
                <Text style={{ color: theme.primary, fontWeight: "600" }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  if (removeTarget) removeEntry(removeTarget);
                }}
                style={[styles.dialogButton, { backgroundColor: "#BA1A1A" }]}
              >
                <Text style={{ color: "#FFFFFF", fontWeight: "700" }}>Remove</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      <View style={[styles.miniPlayerWrapper, { bottom: insets.bottom + 80 }]}>
        <MiniPlayer />
      </View>
      <View style={[styles.navigationWrapper, { bottom: insets.bottom }]}>
        <AppNavigation />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  appBar: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  backButton: { width: 56, height: 56, alignItems: "center", justifyContent: "center" },
  appBarTitle: { flex: 1, fontSize: 18, fontWeight: "700", marginRight: 8 },
  headerActions: { flexDirection: "row", alignItems: "center", paddingRight: 4 },
  headerIconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  selectionActions: { flexDirection: "row", alignItems: "center", paddingRight: 4 },
  listContent: { flexGrow: 1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 16,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  rowMain: { flex: 1, flexDirection: "row", alignItems: "center", paddingVertical: 10 },
  artwork: { width: 56, height: 56, borderRadius: 8 },
  artworkFallback: {
    width: 56,
    height: 56,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center"
  },
  info: { flex: 1, marginLeft: 12, marginRight: 8 },
  title: { fontSize: 15, fontWeight: "600", lineHeight: 20 },
  podcastTitle: { fontSize: 13, fontStyle: "italic", marginTop: 2 },
  metaRow: { flexDirection: "row", alignItems: "center", marginTop: 4, gap: 8 },
  metaText: { fontSize: 12 },
  progressBarTrack: {
    height: 4,
    borderRadius: 2,
    width: "100%",
    marginTop: 6,
    overflow: "hidden"
  },
  progressBarFill: {
    height: "100%",
    borderRadius: 2
  },
  playedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2
  },
  playedBadgeText: {
    fontSize: 11,
    color: "#4CAF50",
    fontWeight: "600"
  },
  inProgressBadgeText: {
    fontSize: 11,
    color: "#FFA000",
    fontWeight: "600"
  },
  rowTrailingActions: {
    flexDirection: "row",
    alignItems: "center",
    paddingRight: 8
  },
  playButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 4
  },
  removeButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  dragHandleContainer: {
    width: 36,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 2
  },
  emptyContainer: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 80 },
  emptyText: { fontSize: 15, marginTop: 12 },
  miniPlayerWrapper: { position: "absolute", left: 0, right: 0 },
  navigationWrapper: { position: "absolute", left: 0, right: 0 },
  dialogBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24
  },
  dialogCard: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 24,
    padding: 24,
    elevation: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.3,
    shadowRadius: 16
  },
  dialogTitle: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 12
  },
  dialogHeaderRow: {
    flexDirection: "row",
    alignItems: "center"
  },
  dialogBodyText: {
    fontSize: 14,
    lineHeight: 20
  },
  dialogSwitchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
    paddingVertical: 4
  },
  dialogSwitchLabel: {
    fontSize: 15,
    fontWeight: "500"
  },
  optionRowButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    gap: 12
  },
  optionRowText: {
    fontSize: 15,
    fontWeight: "500"
  },
  sortOptionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    gap: 12
  },
  sortOptionLabel: {
    fontSize: 16
  },
  dialogActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 8,
    marginTop: 12
  },
  dialogButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10
  }
});
