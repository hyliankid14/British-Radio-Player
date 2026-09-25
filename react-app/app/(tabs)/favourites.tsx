import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TouchableWithoutFeedback,
  StyleSheet,
  LayoutAnimation,
  Platform,
  UIManager,
  PanResponder,
  Animated,
  Image,
  ScrollView,
  Modal,
  TextInput,
  Switch
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { MaterialIcons } from "@expo/vector-icons";
import { Station, StationRepository } from "../../src/data/stations";
import { usePlayerStore } from "../../src/store/playerStore";
import { StationLogo } from "../../src/components/StationLogo";
import { useAppTheme } from "../../src/theme/colors";
import { useStationShowStore } from "../../src/store/stationShowStore";
import { Podcast, PodcastApi, decodeXmlEntities, Episode, matchesBooleanSearch } from "../../src/api/podcasts";
import { Preferences, PodcastHistoryEntry } from "../../src/storage/preferences";
import { OfflineBanner, VpnBanner } from "../../src/components/NetworkBanners";
import { NativeAndroid } from "../../src/native/nativeAndroid";
import { useResponsiveLayout } from "../../src/theme/responsive";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type FavCategory = "Stations" | "Subscribed" | "Playlists" | "Searches" | "History";
type PodcastSort = "most_recently_updated" | "least_recently_updated" | "alphabetical" | "manual" | "tags";
type PlaylistSummary = { id: string; name: string; isDefault: boolean; itemCount: number };
type SavedPodcastSearch = { id: string; name: string; query: string; notificationsEnabled: boolean; latestResultDate?: string };

const CATEGORY_ITEMS: { id: FavCategory; label: string; icon: string }[] = [
  { id: "Stations", label: "Stations", icon: "star" },
  { id: "Subscribed", label: "Subscribed", icon: "headphones" },
  { id: "Playlists", label: "Playlists", icon: "bookmark" },
  { id: "Searches", label: "Searches", icon: "search" },
  { id: "History", label: "History", icon: "history" }
];

const ITEM_HEIGHT = 72;
const PODCAST_ITEM_HEIGHT = 104;
const FAVOURITE_SECTION_TITLES: Record<FavCategory, string> = {
  Stations: "Favourite Stations",
  Subscribed: "Subscribed Podcasts",
  Playlists: "Playlists",
  Searches: "Saved Searches",
  History: "Listening History"
};

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

function formatRelativeTime(epochMs: number): string {
  if (!epochMs || epochMs <= 0) return "";
  const now = Date.now();
  const diffSec = Math.floor((now - epochMs) / 1000);
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(epochMs).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

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

function checkPodcastHasNewEpisodes(
  podcastId: string,
  episodes: Episode[],
  playedEpisodeIds: Set<string>
): boolean {
  if (!episodes || episodes.length === 0) return false;

  // 1. If every single episode has been played, there are definitely no new episodes.
  const hasUnplayed = episodes.some((ep) => !playedEpisodeIds.has(ep.id));
  if (!hasUnplayed) {
    const latestEpoch = episodes.reduce((max, ep) => {
      const t = ep.pubDate ? Date.parse(ep.pubDate) : 0;
      return isNaN(t) ? max : Math.max(max, t);
    }, 0);
    if (latestEpoch > 0) {
      Preferences.setLastPlayedEpoch(podcastId, latestEpoch);
    }
    return false;
  }

  // 2. If the newest episode has already been played, do not show the new episode dot.
  //    (Older unplayed episodes do not make a podcast "new")
  const latestEpisode = episodes[0];
  if (!latestEpisode || playedEpisodeIds.has(latestEpisode.id)) {
    return false;
  }

  // 3. If there is a lastPlayedEpoch recorded, only mark new if the latest episode was published after it.
  const latestEpoch = latestEpisode.pubDate ? Date.parse(latestEpisode.pubDate) || 0 : 0;
  const lastPlayedEpoch = Preferences.getLastPlayedEpoch(podcastId);
  return lastPlayedEpoch <= 0 || latestEpoch > lastPlayedEpoch;
}

export default function FavouritesScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ category?: string }>();
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const responsive = useResponsiveLayout();
  const isTablet = responsive.isTablet;
  const [activeCategory, setActiveCategory] = useState<FavCategory>(() => {
    const requested = params.category as FavCategory | undefined;
    return requested && ["Stations", "Subscribed", "Playlists", "Searches", "History"].includes(requested)
      ? requested
      : "Stations";
  });
  const [draggingStationId, setDraggingStationId] = useState<string | null>(null);
  const { shows, fetchShowsForStations, checkAndAdvanceShows } = useStationShowStore();
  const [subscribedPodcasts, setSubscribedPodcasts] = useState<Podcast[]>([]);
  const [newEpisodeIds, setNewEpisodeIds] = useState<Set<string>>(new Set());
  const [podcastSort, setPodcastSort] = useState<PodcastSort>(
    () => Preferences.getSubscribedPodcastSort() as PodcastSort
  );
  const [latestEpisodeTimes, setLatestEpisodeTimes] = useState<Record<string, number>>({});
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>(
    () => Preferences.getPodcastPlaylists()
  );
  const [savedSearches, setSavedSearches] = useState<SavedPodcastSearch[]>(
    () => Preferences.getSavedPodcastSearches()
  );
  const [podcastHistory, setPodcastHistory] = useState<PodcastHistoryEntry[]>(
    () => Preferences.getPodcastHistory()
  );
  const [tagVersion, forceTagUpdate] = useState(0);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [, refreshFromStore] = useState(0);

  // Drag and drop state for subscribed podcasts in manual sort mode
  const [draggingPodcastId, setDraggingPodcastId] = useState<string | null>(null);

  // Modern Material 3 dialog modal states
  const [sortMenuVisible, setSortMenuVisible] = useState(false);
  const [createPlaylistVisible, setCreatePlaylistVisible] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState("");

  const [renamePlaylistTarget, setRenamePlaylistTarget] = useState<{ id: string; name: string } | null>(null);
  const [renamePlaylistName, setRenamePlaylistName] = useState("");
  const [deletePlaylistTarget, setDeletePlaylistTarget] = useState<PlaylistSummary | null>(null);

  const [taggingPodcast, setTaggingPodcast] = useState<Podcast | null>(null);
  const [newTagInput, setNewTagInput] = useState("");
  const [subOptionsTarget, setSubOptionsTarget] = useState<Podcast | null>(null);

  const [editSearchTarget, setEditSearchTarget] = useState<SavedPodcastSearch | null>(null);
  const [editSearchName, setEditSearchName] = useState("");
  const [editSearchQuery, setEditSearchQuery] = useState("");
  const [editSearchNotify, setEditSearchNotify] = useState(false);
  const [deleteSearchTarget, setDeleteSearchTarget] = useState<SavedPodcastSearch | null>(null);

  const [clearHistoryModalVisible, setClearHistoryModalVisible] = useState(false);
  const [historyOptionsTarget, setHistoryOptionsTarget] = useState<PodcastHistoryEntry | null>(null);

  const {
    currentStation,
    currentShow,
    playStation,
    togglePlayPause,
    toggleFavorite,
    setFavoritesOrder,
    playEpisode,
    currentEpisode,
    isPlaying
  } = usePlayerStore();
  const favorites = usePlayerStore((state) => state.favorites);

  const allStations = useMemo(() => StationRepository.getAll(), []);

  const buildOrderedList = useCallback(
    (ids: string[]) => {
      const map = new Map(allStations.map((s) => [s.id, s]));
      return ids
        .map((id) => map.get(id))
        .filter((s): s is Station => s !== undefined);
    },
    [allStations]
  );

  // Derive the list directly from the store rather than mirroring it in local state. A
  // mirror could end up empty (showing "No favourite stations yet") while the stations
  // were still starred elsewhere in the app.
  const orderedList = useMemo(
    () => buildOrderedList(favorites),
    [buildOrderedList, favorites]
  );

  useEffect(() => {
    if (favorites.length > 0) {
      void fetchShowsForStations(favorites);
    }
  }, [favorites, fetchShowsForStations]);

  useFocusEffect(
    useCallback(() => {
      checkAndAdvanceShows();
      if (favorites.length > 0) {
        void fetchShowsForStations(favorites);
      }
    }, [favorites, checkAndAdvanceShows, fetchShowsForStations])
  );

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;
      const subscribedIds = Preferences.getSubscribedPodcasts();
      const livePlayed = new Set(Preferences.getPlayedEpisodeIds());

      setSubscribedPodcasts((current) =>
        current.filter((podcast) => subscribedIds.includes(podcast.id))
      );

      // Phase 1: Immediately evaluate cached episodes to eliminate flicker
      const initialNewIds = new Set<string>();
      for (const podcastId of subscribedIds) {
        const cached = PodcastApi.getEpisodesFromCache(podcastId);
        if (cached && cached.length > 0) {
          if (checkPodcastHasNewEpisodes(podcastId, cached, livePlayed)) {
            initialNewIds.add(podcastId);
          }
        }
      }
      setNewEpisodeIds(initialNewIds);

      // Phase 2: Fetch live catalog and check fresh episodes
      PodcastApi.fetchLiveCatalog().then((catalog) => {
        if (!isMounted) return;
        const subscribed = new Set(Preferences.getSubscribedPodcasts());
        const subscribedPodcastsList = catalog.filter((podcast) => subscribed.has(podcast.id));
        setSubscribedPodcasts(subscribedPodcastsList);

        const currentPlayed = new Set(Preferences.getPlayedEpisodeIds());
        Promise.all(
          subscribedPodcastsList.map(async (podcast) => {
            const episodes = await PodcastApi.fetchEpisodes(podcast.rssUrl, podcast.id);
            const latestEpisode = episodes[0];
            if (latestEpisode) {
              setLatestEpisodeTimes((current) => ({
                ...current,
                [podcast.id]: new Date(latestEpisode.pubDate).getTime() || 0
              }));
            }
            return checkPodcastHasNewEpisodes(podcast.id, episodes, currentPlayed)
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
      let active = true;
      const searches = Preferences.getSavedPodcastSearches();
      setSavedSearches(searches);
      setPodcastHistory(Preferences.getPodcastHistory());
      setPlaylists(Preferences.getPodcastPlaylists());
      void Promise.all(
        searches.map(async (search) => {
          const results = await PodcastApi.searchEpisodesOnPi(search.query, 100);
          const matchingEpisodes = results.filter((episode) =>
            matchesBooleanSearch(search.query, `${episode.title} ${episode.description}`)
          );
          const latestResultDate = matchingEpisodes
            .map((episode) => episode.pubDate)
            .filter((date) => typeof date === "string" && Number.isFinite(Date.parse(date)))
            .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
          if (latestResultDate !== search.latestResultDate) {
            if (latestResultDate || results.length > 0) {
              Preferences.updatePodcastSearchLatestResult(search.id, latestResultDate);
            }
          }
        })
      ).then(() => {
        if (active) setSavedSearches(Preferences.getSavedPodcastSearches());
      });
      return () => {
        active = false;
      };
    }, [])
  );

  useEffect(() => {
    const sub = Preferences.onChanged((key) => {
      if (
        key.includes("history") ||
        key.includes("progress") ||
        key.includes("played")
      ) {
        setPodcastHistory(Preferences.getPodcastHistory());
      }
      if (key.includes("saved_podcast_searches")) {
        setSavedSearches(Preferences.getSavedPodcastSearches());
      }
    });
    return () => sub.remove();
  }, []);

  const handleOpenHistoryEntry = useCallback(
    (item: PodcastHistoryEntry) => {
      const isCurrent = currentEpisode?.id === item.id;
      if (isCurrent) {
        router.push("/modal/now-playing");
        return;
      }
      const podcast: Podcast = {
        id: item.podcastId,
        title: item.podcastTitle,
        description: "",
        rssUrl: "",
        htmlUrl: "",
        imageUrl: item.imageUrl,
        genres: [],
        typicalDurationMins: item.durationMins
      };
      const episode: Episode = {
        id: item.id,
        title: item.title,
        description: item.description,
        audioUrl: item.audioUrl,
        imageUrl: item.imageUrl,
        pubDate: item.pubDate,
        durationMins: item.durationMins,
        podcastId: item.podcastId
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

  const handlePlayHistoryEntry = useCallback(
    (item: PodcastHistoryEntry) => {
      const isCurrent = currentEpisode?.id === item.id;
      if (isCurrent) {
        void togglePlayPause();
      } else {
        const podcast: Podcast = {
          id: item.podcastId,
          title: item.podcastTitle,
          description: "",
          rssUrl: "",
          htmlUrl: "",
          imageUrl: item.imageUrl,
          genres: [],
          typicalDurationMins: item.durationMins
        };
        const episode: Episode = {
          id: item.id,
          title: item.title,
          description: item.description,
          audioUrl: item.audioUrl,
          imageUrl: item.imageUrl,
          pubDate: item.pubDate,
          durationMins: item.durationMins,
          podcastId: item.podcastId
        };
        void playEpisode(podcast, episode);
      }
      router.push("/modal/now-playing");
    },
    [currentEpisode?.id, playEpisode, togglePlayPause, router]
  );

  const promptClearHistory = useCallback(() => {
    setClearHistoryModalVisible(true);
  }, []);

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
      const manualIds = Preferences.getSubscribedPodcastManualOrder();
      if (manualIds.length === 0) {
        return podcasts;
      }
      const order = new Map(manualIds.map((id, index) => [id, index]));
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
  }, [latestEpisodeTimes, podcastSort, subscribedPodcasts, tagVersion]);

  // Unique tags across subscribed podcasts, mirroring the Kotlin "Group by tags" list.
  const allSubscribedTags = useMemo(() => {
    const tags = new Set<string>();
    subscribedPodcasts.forEach((podcast) => {
      Preferences.getPodcastTags(podcast.id, podcast.genres).forEach((tag) => {
        if (tag.trim()) tags.add(tag);
      });
    });
    return Array.from(tags).sort((a, b) => a.localeCompare(b));
  }, [subscribedPodcasts, tagVersion]);

  const countPodcastsForTag = useCallback(
    (tag: string) =>
      subscribedPodcasts.filter((podcast) =>
        Preferences.getPodcastTags(podcast.id, podcast.genres).includes(tag)
      ).length,
    [subscribedPodcasts, tagVersion]
  );

  const taggedSubscribedPodcasts = useMemo(
    () =>
      selectedTag
        ? sortedSubscribedPodcasts.filter((podcast) =>
            Preferences.getPodcastTags(podcast.id, podcast.genres).includes(selectedTag)
          )
        : sortedSubscribedPodcasts,
    [sortedSubscribedPodcasts, selectedTag, tagVersion]
  );

  // Leave the nested tag view when the sort mode or category changes.
  useEffect(() => {
    if (podcastSort !== "tags" || activeCategory !== "Subscribed") setSelectedTag(null);
  }, [podcastSort, activeCategory]);

  const PODCAST_SORT_OPTIONS: Array<[string, PodcastSort]> = [
    ["Most recently updated", "most_recently_updated"],
    ["Least recently updated", "least_recently_updated"],
    ["Alphabetical (A-Z)", "alphabetical"],
    ["Manual sort", "manual"],
    ["Sort by tags", "tags"]
  ];

  const selectPodcastSort = useCallback(() => {
    setSortMenuVisible(true);
  }, []);

  const handleCreatePlaylist = useCallback(() => {
    const name = newPlaylistName.trim();
    if (!name) return;
    Preferences.createPodcastPlaylist(name);
    setPlaylists(Preferences.getPodcastPlaylists());
    setCreatePlaylistVisible(false);
    setNewPlaylistName("");
  }, [newPlaylistName]);

  const handleRenamePlaylist = useCallback(() => {
    if (!renamePlaylistTarget) return;
    const name = renamePlaylistName.trim();
    if (!name) return;
    Preferences.renamePodcastPlaylist(renamePlaylistTarget.id, name);
    setPlaylists(Preferences.getPodcastPlaylists());
    setRenamePlaylistTarget(null);
    setRenamePlaylistName("");
  }, [renamePlaylistTarget, renamePlaylistName]);

  const confirmDeletePlaylist = useCallback((playlist: { id: string; name: string }) => {
    setDeletePlaylistTarget(playlist as PlaylistSummary);
  }, []);

  const handleAddTag = useCallback(() => {
    if (!taggingPodcast) return;
    const tag = newTagInput.trim();
    if (tag) {
      Preferences.addPodcastTag(taggingPodcast.id, taggingPodcast.genres, tag);
      forceTagUpdate((c) => c + 1);
    }
    setTaggingPodcast(null);
    setNewTagInput("");
  }, [taggingPodcast, newTagInput]);

  const handleSaveSearchEdit = useCallback(async () => {
    if (!editSearchTarget) return;
    const name = editSearchName.trim() || editSearchTarget.query;
    const query = editSearchQuery.trim() || editSearchTarget.query;
    const queryChanged = query.toLowerCase() !== editSearchTarget.query.toLowerCase();
    let latestResultDate = editSearchTarget.latestResultDate;
    if (queryChanged) {
      const results = await PodcastApi.searchEpisodesOnPi(query, 100);
      const matching = results.filter((ep) =>
        matchesBooleanSearch(query, `${ep.title} ${ep.description}`)
      );
      latestResultDate = matching
        .map((ep) => ep.pubDate)
        .filter((d) => typeof d === "string" && Number.isFinite(Date.parse(d)))
        .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
    }
    Preferences.updatePodcastSearch(editSearchTarget.id, {
      name,
      query,
      notificationsEnabled: editSearchNotify,
      latestResultDate
    });
    setSavedSearches(Preferences.getSavedPodcastSearches());
    setEditSearchTarget(null);
  }, [editSearchTarget, editSearchName, editSearchQuery, editSearchNotify]);

  const confirmDeleteSearch = useCallback((search: SavedPodcastSearch) => {
    setDeleteSearchTarget(search);
  }, []);

  const moveSubscribedPodcast = useCallback(
    (fromIndex: number, toIndex: number) => {
      const list = [...sortedSubscribedPodcasts];
      if (toIndex < 0 || toIndex >= list.length) return;
      const [item] = list.splice(fromIndex, 1);
      list.splice(toIndex, 0, item);
      const newOrder = list.map((p) => p.id);
      Preferences.setSubscribedPodcastManualOrder(newOrder);
      forceTagUpdate((v) => v + 1);
    },
    [sortedSubscribedPodcasts]
  );

  // Subscribed podcasts drag-and-drop state & callbacks for manual sort mode
  const podcastPanY = useRef(new Animated.Value(0)).current;
  const podcastScaleAnim = useRef(new Animated.Value(1.0)).current;
  const podcastDragStartIndexRef = useRef<number>(0);
  const podcastCurrentTargetIndexRef = useRef<number>(0);
  const podcastIsDraggingRef = useRef<boolean>(false);
  const podcastOrderedListRef = useRef<Podcast[]>([]);
  podcastOrderedListRef.current = sortedSubscribedPodcasts;

  const podcastNeighborTranslations = useRef<Record<string, Animated.Value>>({});
  const getPodcastTranslation = useCallback((id: string) => {
    if (!podcastNeighborTranslations.current[id]) {
      podcastNeighborTranslations.current[id] = new Animated.Value(0);
    }
    return podcastNeighborTranslations.current[id];
  }, []);

  const createPodcastPanResponder = useCallback(
    (index: number, podcast: Podcast) =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dy) > 4,
        onPanResponderGrant: () => {
          podcastIsDraggingRef.current = true;
          setDraggingPodcastId(podcast.id);
          podcastDragStartIndexRef.current = index;
          podcastCurrentTargetIndexRef.current = index;
          podcastPanY.setValue(0);

          Animated.spring(podcastScaleAnim, {
            toValue: 1.03,
            friction: 8,
            tension: 110,
            useNativeDriver: true
          }).start();
        },
        onPanResponderMove: (_, gestureState) => {
          podcastPanY.setValue(gestureState.dy);

          const fromIdx = podcastDragStartIndexRef.current;
          const currentList = podcastOrderedListRef.current;
          const target = Math.max(
            0,
            Math.min(
              currentList.length - 1,
              fromIdx + Math.round(gestureState.dy / PODCAST_ITEM_HEIGHT)
            )
          );

          if (target !== podcastCurrentTargetIndexRef.current) {
            podcastCurrentTargetIndexRef.current = target;

            currentList.forEach((item, j) => {
              if (item.id === podcast.id) return;
              let shift = 0;
              if (target > fromIdx) {
                if (j > fromIdx && j <= target) {
                  shift = -PODCAST_ITEM_HEIGHT;
                }
              } else if (target < fromIdx) {
                if (j >= target && j < fromIdx) {
                  shift = PODCAST_ITEM_HEIGHT;
                }
              }
              Animated.spring(getPodcastTranslation(item.id), {
                toValue: shift,
                friction: 9,
                tension: 140,
                useNativeDriver: true
              }).start();
            });
          }
        },
        onPanResponderRelease: () => {
          const fromIdx = podcastDragStartIndexRef.current;
          const finalTarget = podcastCurrentTargetIndexRef.current;
          const landingY = (finalTarget - fromIdx) * PODCAST_ITEM_HEIGHT;
          const currentList = podcastOrderedListRef.current;

          Animated.parallel([
            Animated.spring(podcastPanY, {
              toValue: landingY,
              friction: 8,
              tension: 110,
              useNativeDriver: true
            }),
            Animated.spring(podcastScaleAnim, {
              toValue: 1.0,
              friction: 8,
              tension: 110,
              useNativeDriver: true
            })
          ]).start(() => {
            currentList.forEach((p) => {
              getPodcastTranslation(p.id).setValue(0);
            });
            podcastPanY.setValue(0);
            podcastIsDraggingRef.current = false;
            setDraggingPodcastId(null);

            if (finalTarget !== fromIdx) {
              const updated = [...currentList];
              const [moved] = updated.splice(fromIdx, 1);
              if (moved) {
                updated.splice(finalTarget, 0, moved);
                const newIds = updated.map((p) => p.id);
                Preferences.setSubscribedPodcastManualOrder(newIds);
                forceTagUpdate((v) => v + 1);
              }
            }
          });
        },
        onPanResponderTerminate: () => {
          Animated.parallel([
            Animated.spring(podcastPanY, {
              toValue: 0,
              useNativeDriver: true
            }),
            Animated.spring(podcastScaleAnim, {
              toValue: 1.0,
              useNativeDriver: true
            })
          ]).start(() => {
            podcastOrderedListRef.current.forEach((p) => {
              getPodcastTranslation(p.id).setValue(0);
            });
            podcastPanY.setValue(0);
            podcastIsDraggingRef.current = false;
            setDraggingPodcastId(null);
          });
        }
      }),
    [getPodcastTranslation, podcastPanY, podcastScaleAnim]
  );

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

  const resetDragState = useCallback(() => {
    panY.setValue(0);
    scaleAnim.setValue(1);
    Object.values(neighborTranslations.current).forEach((value) => value.setValue(0));
    isDraggingRef.current = false;
    dragStartIndexRef.current = 0;
    currentTargetIndexRef.current = 0;
    setDraggingStationId(null);
  }, [panY, scaleAnim]);

  // Re-read the store and clear any interrupted drag animation when the tab regains
  // focus or the user switches between the favourites sections (Stations, Playlists...).
  // Without this the rows could stay hidden behind leaked drag offsets until a restart.
  useFocusEffect(
    useCallback(() => {
      resetDragState();
      refreshFromStore((value) => value + 1);
    }, [resetDragState])
  );

  useEffect(() => {
    resetDragState();
  }, [activeCategory, resetDragState]);

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
              if (moved) {
                updated.splice(finalTarget, 0, moved);

                const newIds = updated.map((s) => s.id);
                // Read the live ids from the store: a favourite toggled elsewhere must
                // not be dropped by a stale closure captured when the drag started.
                const latestFavorites = usePlayerStore.getState().favorites;
                const otherFavorites = latestFavorites.filter((id) => !newIds.includes(id));
                setFavoritesOrder([...newIds, ...otherFavorites]);
              }
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
    [getTranslation, panY, scaleAnim, setFavoritesOrder]
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
            currentStation?.id === item.id && currentShow?.title && currentShow.title !== "BBC Radio"
              ? currentShow.title
              : (shows[item.id]?.title || "")
          }
          theme={theme}
        />
      );
    },
    [draggingStationId, createPanResponder, panY, scaleAnim, getTranslation, handlePlayStation, handleOpenSchedule, toggleFavorite, currentStation?.id, currentShow, shows, theme]
  );

  const renderHistoryItem = useCallback(
    ({ item }: { item: PodcastHistoryEntry }) => {
      const isCurrent = currentEpisode?.id === item.id;
      const progressSeconds = Preferences.getEpisodeProgress(item.id);
      const totalSeconds = (item.durationMins > 0 ? item.durationMins : 0) * 60;
      const isPlayed = Preferences.isEpisodePlayed(item.id);
      const progressPercent =
        !isPlayed && totalSeconds > 0 && progressSeconds > 0
          ? Math.min(100, Math.max(0, Math.round((progressSeconds / totalSeconds) * 100)))
          : 0;

      return (
        <TouchableOpacity
          style={[
            styles.historyRow,
            { backgroundColor: theme.surface, borderBottomColor: theme.outlineVariant }
          ]}
          activeOpacity={0.7}
          onPress={() => handleOpenHistoryEntry(item)}
          onLongPress={() => {
            setHistoryOptionsTarget(item);
          }}
        >
          {item.imageUrl ? (
            <Image source={{ uri: item.imageUrl }} style={styles.historyArtwork} />
          ) : (
            <View
              style={[
                styles.historyArtworkFallback,
                { backgroundColor: theme.primaryContainer }
              ]}
            >
              <MaterialIcons name="podcasts" size={28} color={theme.primary} />
            </View>
          )}

          <View style={styles.historyInfo}>
            <Text style={[styles.historyTitle, { color: theme.onSurface }]} numberOfLines={2}>
              {decodeXmlEntities(item.title)}
            </Text>

            {item.podcastTitle ? (
              <Text
                style={[styles.historyPodcastTitle, { color: theme.onSurfaceVariant }]}
                numberOfLines={1}
              >
                {decodeXmlEntities(item.podcastTitle)}
              </Text>
            ) : null}

            {progressPercent > 0 ? (
              <View
                style={[
                  styles.historyProgressBarTrack,
                  { backgroundColor: theme.surfaceVariant }
                ]}
              >
                <View
                  style={[
                    styles.historyProgressBarFill,
                    { width: `${progressPercent}%`, backgroundColor: theme.primary }
                  ]}
                />
              </View>
            ) : null}

            <View style={styles.historyMetaRow}>
              <Text style={[styles.historyMetaText, { color: theme.onSurfaceVariant }]}>
                {item.pubDate ? formatEpisodeDate(item.pubDate) : formatRelativeTime(item.playedAtMs)}
              </Text>
              {item.durationMins > 0 ? (
                <Text style={[styles.historyMetaText, { color: theme.onSurfaceVariant }]}>
                  {item.durationMins} min
                </Text>
              ) : null}
              {isPlayed ? (
                <View style={styles.playedBadge}>
                  <MaterialIcons name="check-circle" size={14} color="#4CAF50" />
                  <Text style={styles.playedBadgeText}>Played</Text>
                </View>
              ) : null}
            </View>
          </View>

          <TouchableOpacity
            style={[
              styles.historyPlayButton,
              { backgroundColor: isCurrent && isPlaying ? theme.primary : theme.primaryContainer }
            ]}
            onPress={() => handlePlayHistoryEntry(item)}
            accessibilityLabel={isCurrent && isPlaying ? "Pause episode" : "Play episode"}
          >
            <MaterialIcons
              name={isCurrent && isPlaying ? "pause" : "play-arrow"}
              size={24}
              color={isCurrent && isPlaying ? "#FFFFFF" : theme.primary}
            />
          </TouchableOpacity>
        </TouchableOpacity>
      );
    },
    [currentEpisode?.id, isPlaying, theme, handlePlayHistoryEntry]
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
        {activeCategory === "Subscribed" && selectedTag !== null ? (
          <TouchableOpacity
            style={styles.navBackButton}
            onPress={() => setSelectedTag(null)}
            accessibilityLabel="Back to categories"
          >
            <MaterialIcons name="arrow-back" size={24} color={theme.onSurface} />
          </TouchableOpacity>
        ) : null}
        <Text style={[styles.topAppBarTitle, { color: theme.onSurface }]} numberOfLines={1}>
          {activeCategory === "Subscribed" && selectedTag !== null
            ? decodeXmlEntities(selectedTag)
            : FAVOURITE_SECTION_TITLES[activeCategory]}
        </Text>
        {activeCategory === "Subscribed" ? (
          <TouchableOpacity
            style={styles.overflowButton}
            onPress={selectPodcastSort}
            accessibilityLabel="Sort subscribed podcasts"
          >
            <MaterialIcons name="sort" size={24} color={theme.onSurface} />
          </TouchableOpacity>
        ) : activeCategory === "Playlists" ? (
          <TouchableOpacity
            style={styles.overflowButton}
            onPress={() => {
              setNewPlaylistName("");
              setCreatePlaylistVisible(true);
            }}
            accessibilityLabel="Create playlist"
          >
            <MaterialIcons name="add" size={25} color={theme.onSurface} />
          </TouchableOpacity>
        ) : activeCategory === "History" && podcastHistory.length > 0 ? (
          <TouchableOpacity
            style={styles.overflowButton}
            onPress={promptClearHistory}
            accessibilityLabel="Clear listening history"
          >
            <MaterialIcons name="delete-sweep" size={24} color={theme.onSurface} />
          </TouchableOpacity>
        ) : null}
      </View>

      <OfflineBanner />
      <VpnBanner />

      {/* Pill group under Top App Bar matching favorites_toggle_group */}
      <View style={[styles.pillGroupContainer, isTablet && styles.pillGroupContainerTablet]}>
        {CATEGORY_ITEMS.map((item) => {
          const isSelected = activeCategory === item.id;
          return (
            <TouchableOpacity
              key={item.id}
              style={[
                styles.categoryPill,
                isTablet && styles.categoryPillTablet,
                {
                  // M3 Expressive connected button group: a small gap separates the segments
                  // and the selected segment is a full pill, rounder than the rest.
                  borderRadius: isSelected ? 24 : 12,
                  height: isSelected ? 44 : 40,
                  marginVertical: isSelected ? -2 : 0,
                  backgroundColor: isSelected
                    ? theme.navIndicator
                    : theme.surfaceVariant
                }
              ]}
              onPress={() => setActiveCategory(item.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={item.label}
            >
              <View style={styles.pillContent}>
                <MaterialIcons
                  name={item.icon as any}
                  size={18}
                  color={isSelected ? (theme.navIndicatorIcon || theme.primary) : theme.onSurfaceVariant}
                />
                {isTablet ? (
                  <Text
                    style={[
                      styles.categoryPillText,
                      {
                        color: isSelected
                          ? (theme.navIndicatorIcon || theme.primary)
                          : theme.onSurfaceVariant,
                        fontWeight: isSelected ? "700" : "500"
                      }
                    ]}
                    numberOfLines={1}
                  >
                    {item.label}
                  </Text>
                ) : null}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Content */}
      {activeCategory === "Stations" ? (
        <FlatList
          key="stations"
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
        podcastSort === "tags" && selectedTag === null ? (
          <FlatList
            key="subscribed-tags"
            data={allSubscribedTags}
            keyExtractor={(tag) => tag}
            contentContainerStyle={[styles.listContent, { paddingBottom: 170 + insets.bottom }]}
            style={{ backgroundColor: theme.surface }}
            renderItem={({ item: tag }) => (
              <TouchableOpacity
                style={[
                  styles.podcastRow,
                  { backgroundColor: theme.surface, borderBottomColor: theme.outlineVariant }
                ]}
                activeOpacity={0.7}
                onPress={() => setSelectedTag(tag)}
              >
                <View
                  style={[styles.podcastArtworkFallback, { backgroundColor: theme.primaryContainer }]}
                >
                  <MaterialIcons name="label-outline" size={26} color={theme.primary} />
                </View>
                <View style={styles.podcastInfo}>
                  <Text
                    style={[styles.podcastTitle, { color: theme.onSurface }]}
                    numberOfLines={1}
                  >
                    {decodeXmlEntities(tag)}
                  </Text>
                  <Text style={[styles.podcastDescription, { color: theme.onSurfaceVariant }]}>
                    {countPodcastsForTag(tag)} podcast{countPodcastsForTag(tag) === 1 ? "" : "s"}
                  </Text>
                </View>
                <MaterialIcons name="chevron-right" size={24} color={theme.onSurfaceVariant} />
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={[styles.emptyText, { color: theme.onSurfaceVariant }]}>
                  No categories yet
                </Text>
              </View>
            }
          />
        ) : (
        <FlatList
          key="subscribed"
          data={taggedSubscribedPodcasts}
          keyExtractor={(item) => item.id}
          scrollEnabled={!draggingPodcastId}
          removeClippedSubviews={false}
          contentContainerStyle={[styles.listContent, { paddingBottom: 170 + insets.bottom }]}
          style={{ backgroundColor: theme.surface, overflow: "visible" }}
          ListHeaderComponent={
            selectedTag ? (
              <TouchableOpacity
                style={[
                  styles.podcastRow,
                  { backgroundColor: theme.surface, borderBottomColor: theme.outlineVariant }
                ]}
                onPress={() => setSelectedTag(null)}
              >
                <MaterialIcons
                  name="arrow-back"
                  size={24}
                  color={theme.onSurface}
                  style={{ marginRight: 12 }}
                />
                <Text style={[styles.podcastTitle, { color: theme.onSurface }]}>
                  {decodeXmlEntities(selectedTag)}
                </Text>
              </TouchableOpacity>
            ) : null
          }
          renderItem={({ item, index }: { item: Podcast; index: number }) => {
            const isDraggingThis = draggingPodcastId === item.id;
            const podcastPanResponder = createPodcastPanResponder(index, item);
            const transform = isDraggingThis
              ? [{ translateY: podcastPanY }, { scale: podcastScaleAnim }]
              : [{ translateY: getPodcastTranslation(item.id) }];

            return (
              <Animated.View
                style={[
                  styles.podcastRow,
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
                  style={{ flex: 1, flexDirection: "row", alignItems: "center" }}
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
                  onLongPress={() => {
                    setSubOptionsTarget(item);
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
                          setTaggingPodcast(item);
                          setNewTagInput("");
                        }}
                        accessibilityLabel="Add category"
                      >
                        <MaterialIcons name="add" size={14} color={theme.primary} />
                      </TouchableOpacity>
                    </ScrollView>
                  </View>
                </TouchableOpacity>

              {podcastSort === "manual" ? (
                <View
                  {...podcastPanResponder.panHandlers}
                  style={styles.dragHandleContainer}
                  hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
                >
                  <MaterialIcons
                    name="drag-indicator"
                    size={24}
                    color={isDraggingThis ? theme.primary : theme.onSurfaceVariant}
                  />
                </View>
              ) : null}

              {newEpisodeIds.has(item.id) ? (
                <View style={styles.newEpisodeDot} accessibilityLabel="New episodes available" />
              ) : null}
            </Animated.View>
          );
        }}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={[styles.emptyText, { color: theme.onSurfaceVariant }]}>
                No subscribed podcasts yet
              </Text>
            </View>
          }
        />
        )
      ) : activeCategory === "Playlists" ? (
        <FlatList
          key="playlists"
          data={playlists}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.listContent, { paddingBottom: 170 + insets.bottom }]}
          style={{ backgroundColor: theme.surface }}
          renderItem={({ item }) => {
            const isCustom = !item.isDefault && item.id !== "saved" && item.id !== "downloaded";
            return (
              <TouchableOpacity
                style={[
                  styles.playlistRow,
                  { backgroundColor: theme.surface, borderBottomColor: theme.outlineVariant }
                ]}
                activeOpacity={0.7}
                onPress={() =>
                  router.push({
                    pathname: "/modal/playlist-detail",
                    params: { playlistId: item.id, playlistName: item.name }
                  })
                }
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
                {isCustom ? (
                  <View style={styles.playlistActions}>
                    <TouchableOpacity
                      style={styles.actionButton}
                      onPress={() => {
                        setRenamePlaylistTarget(item);
                        setRenamePlaylistName(item.name);
                      }}
                      accessibilityLabel="Rename playlist"
                    >
                      <MaterialIcons name="edit" size={20} color={theme.onSurfaceVariant} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.actionButton}
                      onPress={() => confirmDeletePlaylist(item)}
                      accessibilityLabel="Delete playlist"
                    >
                      <MaterialIcons name="delete-outline" size={22} color={theme.onSurfaceVariant} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <MaterialIcons name="chevron-right" size={24} color={theme.onSurfaceVariant} />
                )}
              </TouchableOpacity>
            );
          }}
        />
      ) : activeCategory === "Searches" ? (
        <FlatList
          key="searches"
          data={savedSearches}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.listContent, { paddingBottom: 170 + insets.bottom }]}
          style={{ backgroundColor: theme.surface }}
          renderItem={({ item }) => (
            <View style={[styles.savedSearchRow, { backgroundColor: theme.surface, borderBottomColor: theme.outlineVariant }]}>
              <TouchableOpacity
                style={styles.savedSearchMain}
                onPress={() =>
                  router.push({
                    pathname: "/modal/podcast-search",
                    params: { search: item.query, savedSearchId: item.id }
                  })
                }
              >
                <MaterialIcons name="search" size={26} color={theme.primary} />
                <View style={styles.savedSearchInfo}>
                  <Text style={[styles.savedSearchName, { color: theme.onSurface }]}>{item.name}</Text>
                  {item.latestResultDate ? (
                    <Text style={[styles.savedSearchQuery, { color: theme.onSurfaceVariant }]}>
                      Latest: {new Date(item.latestResultDate).toLocaleDateString()}
                    </Text>
                  ) : null}
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
                  setEditSearchTarget(item);
                  setEditSearchName(item.name);
                  setEditSearchQuery(item.query);
                  setEditSearchNotify(item.notificationsEnabled);
                }}
                accessibilityLabel="Edit saved search"
              >
                <MaterialIcons name="edit" size={20} color={theme.onSurfaceVariant} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.savedSearchAction}
                onPress={() => confirmDeleteSearch(item)}
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
        <FlatList
          key="history"
          data={podcastHistory}
          keyExtractor={(item) => item.id}
          renderItem={renderHistoryItem}
          contentContainerStyle={[styles.listContent, { paddingBottom: 170 + insets.bottom }]}
          style={{ backgroundColor: theme.surface }}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <MaterialIcons
                name="history"
                size={48}
                color={theme.onSurfaceVariant}
                style={{ marginBottom: 12, opacity: 0.6 }}
              />
              <Text
                style={[
                  styles.emptyText,
                  { color: theme.onSurface, fontWeight: "700", fontSize: 16 }
                ]}
              >
                No listening history yet
              </Text>
              <Text style={[styles.emptyText, { color: theme.onSurfaceVariant, marginTop: 4 }]}>
                Podcast episodes you play will appear here.
              </Text>
            </View>
          }
        />
      )}

      {/* Subscribed Podcast Sort Modal */}
      <Modal
        visible={sortMenuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSortMenuVisible(false)}
      >
        <TouchableOpacity
          style={styles.dialogBackdrop}
          activeOpacity={1}
          onPress={() => setSortMenuVisible(false)}
        >
          <View
            style={[styles.dialogCard, { backgroundColor: theme.surfaceContainer }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[styles.dialogTitle, { color: theme.onSurface }]}>
              Sort subscribed podcasts
            </Text>
            {PODCAST_SORT_OPTIONS.map(([label, value]) => {
              const isSelected = podcastSort === value;
              return (
                <TouchableOpacity
                  key={value}
                  style={styles.sortOptionRow}
                  activeOpacity={0.7}
                  onPress={() => {
                    if (
                      value === "manual" &&
                      Preferences.getSubscribedPodcastManualOrder().length === 0
                    ) {
                      Preferences.setSubscribedPodcastManualOrder(
                        subscribedPodcasts.map((podcast) => podcast.id)
                      );
                    }
                    Preferences.setSubscribedPodcastSort(value);
                    setPodcastSort(value);
                    setSortMenuVisible(false);
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
                onPress={() => setSortMenuVisible(false)}
                style={styles.dialogButton}
              >
                <Text style={{ color: theme.primary, fontWeight: "600" }}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Create Playlist Modal */}
      <Modal
        visible={createPlaylistVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCreatePlaylistVisible(false)}
      >
        <TouchableOpacity
          style={styles.dialogBackdrop}
          activeOpacity={1}
          onPress={() => setCreatePlaylistVisible(false)}
        >
          <View
            style={[styles.dialogCard, { backgroundColor: theme.surfaceContainer }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[styles.dialogTitle, { color: theme.onSurface }]}>Create playlist</Text>
            <TextInput
              style={[
                styles.dialogInput,
                { color: theme.onSurface, borderColor: theme.outline, backgroundColor: theme.surface }
              ]}
              placeholder="Playlist name"
              placeholderTextColor={theme.onSurfaceVariant}
              value={newPlaylistName}
              onChangeText={setNewPlaylistName}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleCreatePlaylist}
            />
            <View style={styles.dialogActions}>
              <TouchableOpacity
                onPress={() => setCreatePlaylistVisible(false)}
                style={styles.dialogButton}
              >
                <Text style={{ color: theme.primary, fontWeight: "600" }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleCreatePlaylist}
                style={[styles.dialogButton, { backgroundColor: theme.primary }]}
              >
                <Text style={{ color: "#FFFFFF", fontWeight: "700" }}>Create</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Rename Playlist Modal */}
      <Modal
        visible={renamePlaylistTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setRenamePlaylistTarget(null)}
      >
        <TouchableOpacity
          style={styles.dialogBackdrop}
          activeOpacity={1}
          onPress={() => setRenamePlaylistTarget(null)}
        >
          <View
            style={[styles.dialogCard, { backgroundColor: theme.surfaceContainer }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[styles.dialogTitle, { color: theme.onSurface }]}>Rename playlist</Text>
            <TextInput
              style={[
                styles.dialogInput,
                { color: theme.onSurface, borderColor: theme.outline, backgroundColor: theme.surface }
              ]}
              placeholder="Playlist name"
              placeholderTextColor={theme.onSurfaceVariant}
              value={renamePlaylistName}
              onChangeText={setRenamePlaylistName}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleRenamePlaylist}
            />
            <View style={styles.dialogActions}>
              <TouchableOpacity
                onPress={() => setRenamePlaylistTarget(null)}
                style={styles.dialogButton}
              >
                <Text style={{ color: theme.primary, fontWeight: "600" }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleRenamePlaylist}
                style={[styles.dialogButton, { backgroundColor: theme.primary }]}
              >
                <Text style={{ color: "#FFFFFF", fontWeight: "700" }}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Add Tag Modal */}
      <Modal
        visible={taggingPodcast !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setTaggingPodcast(null)}
      >
        <TouchableOpacity
          style={styles.dialogBackdrop}
          activeOpacity={1}
          onPress={() => setTaggingPodcast(null)}
        >
          <View
            style={[styles.dialogCard, { backgroundColor: theme.surfaceContainer }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[styles.dialogTitle, { color: theme.onSurface }]}>Add category</Text>
            <Text style={[styles.dialogSubtitle, { color: theme.onSurfaceVariant }]} numberOfLines={1}>
              {taggingPodcast ? decodeXmlEntities(taggingPodcast.title) : ""}
            </Text>
            <TextInput
              style={[
                styles.dialogInput,
                { color: theme.onSurface, borderColor: theme.outline, backgroundColor: theme.surface }
              ]}
              placeholder="Category name"
              placeholderTextColor={theme.onSurfaceVariant}
              value={newTagInput}
              onChangeText={setNewTagInput}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleAddTag}
            />
            <View style={styles.dialogActions}>
              <TouchableOpacity
                onPress={() => setTaggingPodcast(null)}
                style={styles.dialogButton}
              >
                <Text style={{ color: theme.primary, fontWeight: "600" }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleAddTag}
                style={[styles.dialogButton, { backgroundColor: theme.primary }]}
              >
                <Text style={{ color: "#FFFFFF", fontWeight: "700" }}>Add</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Edit Saved Search Modal */}
      <Modal
        visible={editSearchTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setEditSearchTarget(null)}
      >
        <TouchableOpacity
          style={styles.dialogBackdrop}
          activeOpacity={1}
          onPress={() => setEditSearchTarget(null)}
        >
          <View
            style={[styles.dialogCard, { backgroundColor: theme.surfaceContainer }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[styles.dialogTitle, { color: theme.onSurface }]}>Edit Saved Search</Text>
            <Text style={[styles.dialogLabel, { color: theme.onSurfaceVariant }]}>Name</Text>
            <TextInput
              style={[
                styles.dialogInput,
                { color: theme.onSurface, borderColor: theme.outline, backgroundColor: theme.surface }
              ]}
              placeholder="Search name"
              placeholderTextColor={theme.onSurfaceVariant}
              value={editSearchName}
              onChangeText={setEditSearchName}
            />
            <Text style={[styles.dialogLabel, { color: theme.onSurfaceVariant, marginTop: 8 }]}>Query</Text>
            <TextInput
              style={[
                styles.dialogInput,
                { color: theme.onSurface, borderColor: theme.outline, backgroundColor: theme.surface }
              ]}
              placeholder="Search query"
              placeholderTextColor={theme.onSurfaceVariant}
              value={editSearchQuery}
              onChangeText={setEditSearchQuery}
            />
            <View style={styles.dialogSwitchRow}>
              <Text style={[styles.dialogSwitchLabel, { color: theme.onSurface }]}>New episode alerts</Text>
              <Switch
                value={editSearchNotify}
                onValueChange={setEditSearchNotify}
                trackColor={{ true: theme.primary, false: theme.outlineVariant }}
                thumbColor="#FFFFFF"
              />
            </View>
            <View style={styles.dialogActions}>
              <TouchableOpacity
                onPress={() => setEditSearchTarget(null)}
                style={styles.dialogButton}
              >
                <Text style={{ color: theme.primary, fontWeight: "600" }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSaveSearchEdit}
                style={[styles.dialogButton, { backgroundColor: theme.primary }]}
              >
                <Text style={{ color: "#FFFFFF", fontWeight: "700" }}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Clear History Confirmation Modal */}
      <Modal
        visible={clearHistoryModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setClearHistoryModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.dialogBackdrop}
          activeOpacity={1}
          onPress={() => setClearHistoryModalVisible(false)}
        >
          <View
            style={[styles.dialogCard, { backgroundColor: theme.surfaceContainer }]}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.dialogHeaderRow}>
              <MaterialIcons name="delete-sweep" size={26} color="#BA1A1A" />
              <Text style={[styles.dialogTitle, { color: theme.onSurface, marginBottom: 0, marginLeft: 12 }]}>
                Clear History
              </Text>
            </View>
            <Text style={[styles.dialogBodyText, { color: theme.onSurfaceVariant, marginVertical: 16 }]}>
              Are you sure you want to clear your listening history? This will remove all recently played episodes.
            </Text>
            <View style={styles.dialogActions}>
              <TouchableOpacity
                onPress={() => setClearHistoryModalVisible(false)}
                style={styles.dialogButton}
              >
                <Text style={{ color: theme.primary, fontWeight: "600" }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  Preferences.clearPodcastHistory();
                  setPodcastHistory([]);
                  setClearHistoryModalVisible(false);
                }}
                style={[styles.dialogButton, { backgroundColor: "#BA1A1A" }]}
              >
                <Text style={{ color: "#FFFFFF", fontWeight: "700" }}>Clear</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Delete Playlist Confirmation Modal */}
      <Modal
        visible={deletePlaylistTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setDeletePlaylistTarget(null)}
      >
        <TouchableOpacity
          style={styles.dialogBackdrop}
          activeOpacity={1}
          onPress={() => setDeletePlaylistTarget(null)}
        >
          <View
            style={[styles.dialogCard, { backgroundColor: theme.surfaceContainer }]}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.dialogHeaderRow}>
              <MaterialIcons name="delete-outline" size={26} color="#BA1A1A" />
              <Text style={[styles.dialogTitle, { color: theme.onSurface, marginBottom: 0, marginLeft: 12 }]}>
                Delete Playlist
              </Text>
            </View>
            <Text style={[styles.dialogBodyText, { color: theme.onSurfaceVariant, marginVertical: 16 }]}>
              Delete "{deletePlaylistTarget?.name}"? Saved episodes in this playlist will be removed.
            </Text>
            <View style={styles.dialogActions}>
              <TouchableOpacity
                onPress={() => setDeletePlaylistTarget(null)}
                style={styles.dialogButton}
              >
                <Text style={{ color: theme.primary, fontWeight: "600" }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  if (deletePlaylistTarget) {
                    Preferences.deletePodcastPlaylist(deletePlaylistTarget.id);
                    setPlaylists(Preferences.getPodcastPlaylists());
                    setDeletePlaylistTarget(null);
                  }
                }}
                style={[styles.dialogButton, { backgroundColor: "#BA1A1A" }]}
              >
                <Text style={{ color: "#FFFFFF", fontWeight: "700" }}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Delete Saved Search Confirmation Modal */}
      <Modal
        visible={deleteSearchTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteSearchTarget(null)}
      >
        <TouchableOpacity
          style={styles.dialogBackdrop}
          activeOpacity={1}
          onPress={() => setDeleteSearchTarget(null)}
        >
          <View
            style={[styles.dialogCard, { backgroundColor: theme.surfaceContainer }]}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.dialogHeaderRow}>
              <MaterialIcons name="delete-outline" size={26} color="#BA1A1A" />
              <Text style={[styles.dialogTitle, { color: theme.onSurface, marginBottom: 0, marginLeft: 12 }]}>
                Delete Saved Search
              </Text>
            </View>
            <Text style={[styles.dialogBodyText, { color: theme.onSurfaceVariant, marginVertical: 16 }]}>
              Delete "{deleteSearchTarget?.name}"?
            </Text>
            <View style={styles.dialogActions}>
              <TouchableOpacity
                onPress={() => setDeleteSearchTarget(null)}
                style={styles.dialogButton}
              >
                <Text style={{ color: theme.primary, fontWeight: "600" }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  if (deleteSearchTarget) {
                    Preferences.removePodcastSearch(deleteSearchTarget.id);
                    setSavedSearches(Preferences.getSavedPodcastSearches());
                    setDeleteSearchTarget(null);
                  }
                }}
                style={[styles.dialogButton, { backgroundColor: "#BA1A1A" }]}
              >
                <Text style={{ color: "#FFFFFF", fontWeight: "700" }}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Subscription Options Modal */}
      <Modal
        visible={subOptionsTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSubOptionsTarget(null)}
      >
        <TouchableOpacity
          style={styles.dialogBackdrop}
          activeOpacity={1}
          onPress={() => setSubOptionsTarget(null)}
        >
          <View
            style={[styles.dialogCard, { backgroundColor: theme.surfaceContainer }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[styles.dialogTitle, { color: theme.onSurface }]} numberOfLines={2}>
              {subOptionsTarget ? decodeXmlEntities(subOptionsTarget.title) : ""}
            </Text>
            <Text style={[styles.dialogSubtitle, { color: theme.onSurfaceVariant, marginBottom: 16 }]}>
              Subscription options
            </Text>

            <TouchableOpacity
              style={styles.optionRowButton}
              onPress={() => {
                if (subOptionsTarget) {
                  const target = subOptionsTarget;
                  setSubOptionsTarget(null);
                  setTaggingPodcast(target);
                  setNewTagInput("");
                }
              }}
            >
              <MaterialIcons name="label-outline" size={22} color={theme.primary} />
              <Text style={[styles.optionRowText, { color: theme.onSurface }]}>Add category</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.optionRowButton}
              onPress={async () => {
                if (subOptionsTarget) {
                  const target = subOptionsTarget;
                  setSubOptionsTarget(null);
                  try {
                    const eps = await PodcastApi.fetchEpisodes(target.rssUrl, target.id);
                    const toMark = eps.map((ep) => ({
                      id: ep.id,
                      podcastId: target.id,
                      pubDateEpochMs: ep.pubDate ? Date.parse(ep.pubDate) || 0 : 0
                    }));
                    Preferences.markEpisodesPlayed(toMark);
                    setNewEpisodeIds((prev) => {
                      const next = new Set(prev);
                      next.delete(target.id);
                      return next;
                    });
                  } catch (e) {
                    console.warn("Failed to mark all played", e);
                  }
                }
              }}
            >
              <MaterialIcons name="done-all" size={22} color={theme.primary} />
              <Text style={[styles.optionRowText, { color: theme.onSurface }]}>Mark all as played</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.optionRowButton}
              onPress={() => {
                if (subOptionsTarget) {
                  Preferences.togglePodcastSubscription(subOptionsTarget.id);
                  refreshFromStore((v) => v + 1);
                  setSubOptionsTarget(null);
                }
              }}
            >
              <MaterialIcons name="remove-circle-outline" size={22} color="#BA1A1A" />
              <Text style={[styles.optionRowText, { color: "#BA1A1A" }]}>Unsubscribe</Text>
            </TouchableOpacity>

            <View style={styles.dialogActions}>
              <TouchableOpacity
                onPress={() => setSubOptionsTarget(null)}
                style={styles.dialogButton}
              >
                <Text style={{ color: theme.primary, fontWeight: "600" }}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* History Episode Options Modal */}
      <Modal
        visible={historyOptionsTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setHistoryOptionsTarget(null)}
      >
        <TouchableOpacity
          style={styles.dialogBackdrop}
          activeOpacity={1}
          onPress={() => setHistoryOptionsTarget(null)}
        >
          <View
            style={[styles.dialogCard, { backgroundColor: theme.surfaceContainer }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[styles.dialogTitle, { color: theme.onSurface }]} numberOfLines={2}>
              {historyOptionsTarget ? decodeXmlEntities(historyOptionsTarget.title) : ""}
            </Text>
            <Text style={[styles.dialogSubtitle, { color: theme.onSurfaceVariant, marginBottom: 16 }]} numberOfLines={1}>
              {historyOptionsTarget ? decodeXmlEntities(historyOptionsTarget.podcastTitle) : ""}
            </Text>

            <TouchableOpacity
              style={styles.optionRowButton}
              onPress={() => {
                if (historyOptionsTarget) {
                  const target = historyOptionsTarget;
                  setHistoryOptionsTarget(null);
                  handlePlayHistoryEntry(target);
                }
              }}
            >
              <MaterialIcons name="play-arrow" size={22} color={theme.primary} />
              <Text style={[styles.optionRowText, { color: theme.onSurface }]}>Play episode</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.optionRowButton}
              onPress={() => {
                if (historyOptionsTarget) {
                  const isPlayedNow = Preferences.isEpisodePlayed(historyOptionsTarget.id);
                  if (isPlayedNow) {
                    Preferences.markEpisodeUnplayed(historyOptionsTarget.id);
                  } else {
                    Preferences.markEpisodePlayed(historyOptionsTarget.id, historyOptionsTarget.podcastId);
                  }
                  setPodcastHistory(Preferences.getPodcastHistory());
                  setHistoryOptionsTarget(null);
                }
              }}
            >
              <MaterialIcons
                name={
                  historyOptionsTarget && Preferences.isEpisodePlayed(historyOptionsTarget.id)
                    ? "check-circle"
                    : "check-circle-outline"
                }
                size={22}
                color={theme.primary}
              />
              <Text style={[styles.optionRowText, { color: theme.onSurface }]}>
                {historyOptionsTarget && Preferences.isEpisodePlayed(historyOptionsTarget.id)
                  ? "Mark as unplayed"
                  : "Mark as played"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.optionRowButton}
              onPress={() => {
                if (historyOptionsTarget) {
                  Preferences.removePodcastHistoryEntry(historyOptionsTarget.id);
                  setPodcastHistory(Preferences.getPodcastHistory());
                  setHistoryOptionsTarget(null);
                }
              }}
            >
              <MaterialIcons name="delete-outline" size={22} color="#BA1A1A" />
              <Text style={[styles.optionRowText, { color: "#BA1A1A" }]}>
                Remove from history
              </Text>
            </TouchableOpacity>

            <View style={styles.dialogActions}>
              <TouchableOpacity
                onPress={() => setHistoryOptionsTarget(null)}
                style={styles.dialogButton}
              >
                <Text style={{ color: theme.primary, fontWeight: "600" }}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
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
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 4
  },
  pillGroupContainerTablet: {
    maxWidth: 720,
    alignSelf: "center",
    width: "100%",
    paddingHorizontal: 16
  },
  categoryPill: {
    flex: 1,
    height: 40,
    alignItems: "center",
    justifyContent: "center"
  },
  categoryPillTablet: {
    flex: 1,
    paddingHorizontal: 8
  },
  pillContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6
  },
  categoryPillText: {
    fontSize: 13,
    fontWeight: "600"
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
  historyRow: {
    minHeight: 88,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  historyArtwork: {
    width: 60,
    height: 60,
    borderRadius: 8
  },
  historyArtworkFallback: {
    width: 60,
    height: 60,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center"
  },
  historyInfo: {
    flex: 1,
    marginHorizontal: 12,
    justifyContent: "center"
  },
  historyTitle: {
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 20
  },
  historyPodcastTitle: {
    fontSize: 13,
    fontStyle: "italic",
    marginTop: 2
  },
  historyProgressBarTrack: {
    height: 4,
    borderRadius: 2,
    width: "100%",
    marginTop: 6,
    overflow: "hidden"
  },
  historyProgressBarFill: {
    height: "100%",
    borderRadius: 2
  },
  historyMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
    gap: 8
  },
  historyMetaText: {
    fontSize: 12
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
  historyPlayButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center"
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
  },
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
    marginBottom: 8
  },
  dialogSubtitle: {
    fontSize: 13,
    marginBottom: 16
  },
  dialogLabel: {
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 4
  },
  dialogInput: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    fontSize: 15,
    marginBottom: 16
  },
  dialogSwitchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
    paddingVertical: 4
  },
  dialogSwitchLabel: {
    fontSize: 14,
    fontWeight: "500"
  },
  dialogActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 8,
    marginTop: 8
  },
  dialogButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10
  },
  navBackButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 4
  },
  playlistActions: {
    flexDirection: "row",
    alignItems: "center"
  },
  podcastNotificationButton: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center"
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
  dialogHeaderRow: {
    flexDirection: "row",
    alignItems: "center"
  },
  dialogBodyText: {
    fontSize: 14,
    lineHeight: 20
  },
  optionRowButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    gap: 14
  },
  optionRowText: {
    fontSize: 16,
    fontWeight: "500"
  }
});
