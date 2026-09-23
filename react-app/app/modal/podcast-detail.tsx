import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  Image,
  StyleSheet,
  ActivityIndicator,
  Share,
  Modal,
  ScrollView,
  TextInput
} from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { useAppTheme } from "../../src/theme/colors";
import { Podcast, Episode, PodcastApi, decodeXmlEntities } from "../../src/api/podcasts";
import { usePlayerStore } from "../../src/store/playerStore";
import { Preferences } from "../../src/storage/preferences";
import { toSavedEpisodeEntry, useDownloadStore } from "../../src/downloads/downloadStore";
import { MiniPlayer } from "../../src/components/MiniPlayer";
import { AppNavigation } from "../../src/components/AppNavigation";
import { useNetworkStatus } from "../../src/store/networkStore";
import { NativeAndroid } from "../../src/native/nativeAndroid";

export default function PodcastDetailModal() {
  const router = useRouter();
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ podcastId: string; podcastData?: string }>();

  const [podcast, setPodcast] = useState<Podcast | null>(() => {
    if (params.podcastData) {
      try {
        return JSON.parse(params.podcastData);
      } catch {}
    }
    return null;
  });

  const [episodes, setEpisodes] = useState<Episode[]>(() => {
    if (params.podcastId) {
      return PodcastApi.getEpisodesFromCache(params.podcastId) || [];
    }
    return [];
  });
  const [isLoadingEpisodes, setIsLoadingEpisodes] = useState(() => {
    if (params.podcastId) {
      const cached = PodcastApi.getEpisodesFromCache(params.podcastId);
      return !cached || cached.length === 0;
    }
    return true;
  });
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [descriptionModalVisible, setDescriptionModalVisible] = useState(false);
  const [visibleEpisodeCount, setVisibleEpisodeCount] = useState(20);
  const [rating, setRating] = useState<{ average: number; count: number; mine: number }>(() => {
    const pid = podcast?.id || params.podcastId;
    if (pid) {
      const cached = Preferences.getCachedPodcastRatings()[pid];
      if (cached) {
        return {
          average: cached.average,
          count: cached.count,
          mine: cached.mine || 0
        };
      }
    }
    return { average: 0, count: 0, mine: 0 };
  });
  const [ratingModalVisible, setRatingModalVisible] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { playEpisode, pause, resume, currentEpisode, isPlaying } = usePlayerStore();
  const downloads = useDownloadStore((state) => state.downloads);
  const { isOnline } = useNetworkStatus();
  // Offline mode only exposes episodes that are already downloaded, matching the Kotlin feed.
  const displayEpisodes = React.useMemo(
    () =>
      isOnline
        ? episodes
        : episodes.filter((episode) => Preferences.isEpisodeDownloaded(episode.id)),
    [episodes, isOnline, downloads]
  );
  const [savedIds, setSavedIds] = useState<Set<string>>(
    () => new Set(Preferences.getPodcastPlaylistEntries("saved").map((entry) => entry.id))
  );
  const [playedIds, setPlayedIds] = useState<Set<string>>(
    () => new Set(Preferences.getPlayedEpisodeIds())
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [playlistModalVisible, setPlaylistModalVisible] = useState(false);
  const [newPlaylistDialogVisible, setNewPlaylistDialogVisible] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState("");

  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToastMessage(msg);
    toastTimer.current = setTimeout(() => setToastMessage(""), 2500);
  }, []);

  const toggleEpisodeSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const selectedEpisodes = useMemo(
    () => displayEpisodes.filter((ep) => selectedIds.has(ep.id)),
    [displayEpisodes, selectedIds]
  );

  const allSelectedPlayed = useMemo(
    () => selectedEpisodes.length > 0 && selectedEpisodes.every((ep) => playedIds.has(ep.id)),
    [selectedEpisodes, playedIds]
  );

  const allSelectedDownloaded = useMemo(
    () => selectedEpisodes.length > 0 && selectedEpisodes.every((ep) => downloads[ep.id]?.status === "downloaded"),
    [selectedEpisodes, downloads]
  );

  const handleTogglePlayedSelected = useCallback(() => {
    if (!podcast || selectedEpisodes.length === 0) return;
    if (allSelectedPlayed) {
      selectedEpisodes.forEach((ep) => {
        Preferences.markEpisodeUnplayed(ep.id);
      });
      setPlayedIds((prev) => {
        const next = new Set(prev);
        selectedEpisodes.forEach((ep) => next.delete(ep.id));
        return next;
      });
      showToast(`Marked ${selectedEpisodes.length} episode(s) as unplayed`);
    } else {
      selectedEpisodes.forEach((ep) => {
        const pubDateMs = ep.pubDate ? Date.parse(ep.pubDate) : undefined;
        Preferences.markEpisodePlayed(ep.id, podcast.id, isNaN(pubDateMs as number) ? undefined : pubDateMs);
      });
      setPlayedIds((prev) => {
        const next = new Set(prev);
        selectedEpisodes.forEach((ep) => next.add(ep.id));
        return next;
      });
      showToast(`Marked ${selectedEpisodes.length} episode(s) as played`);
    }
    setSelectedIds(new Set());
  }, [podcast, selectedEpisodes, allSelectedPlayed, showToast]);

  const handleToggleDownloadSelected = useCallback(() => {
    if (!podcast || selectedEpisodes.length === 0) return;
    const store = useDownloadStore.getState();
    if (allSelectedDownloaded) {
      selectedEpisodes.forEach((ep) => {
        store.remove(ep.id);
      });
      showToast(`Deleted ${selectedEpisodes.length} download(s)`);
    } else {
      const toDownload = selectedEpisodes.filter((ep) => downloads[ep.id]?.status !== "downloaded");
      toDownload.forEach((ep) => {
        void store.download(toSavedEpisodeEntry(podcast, ep));
      });
      showToast(`Downloading ${toDownload.length} episode(s)`);
    }
    setSelectedIds(new Set());
  }, [podcast, selectedEpisodes, allSelectedDownloaded, downloads, showToast]);

  const handleAddToPlaylist = useCallback((playlistId: string, playlistName: string) => {
    if (!podcast || selectedEpisodes.length === 0) return;
    selectedEpisodes.forEach((ep) => {
      Preferences.addPodcastPlaylistEntry(playlistId, toSavedEpisodeEntry(podcast, ep));
    });
    if (playlistId === "saved") {
      setSavedIds((prev) => {
        const next = new Set(prev);
        selectedEpisodes.forEach((ep) => next.add(ep.id));
        return next;
      });
    }
    showToast(`Added ${selectedEpisodes.length} episode(s) to ${playlistName}`);
    setPlaylistModalVisible(false);
    setSelectedIds(new Set());
  }, [podcast, selectedEpisodes, showToast]);

  const handleCreatePlaylistAndAdd = useCallback(() => {
    const trimmed = newPlaylistName.trim();
    if (!trimmed || !podcast || selectedEpisodes.length === 0) return;
    Preferences.createPodcastPlaylist(trimmed);
    const updatedPlaylists = Preferences.getPodcastPlaylists();
    const created = updatedPlaylists.find((p) => p.name === trimmed) || updatedPlaylists[updatedPlaylists.length - 1];
    if (created) {
      selectedEpisodes.forEach((ep) => {
        Preferences.addPodcastPlaylistEntry(created.id, toSavedEpisodeEntry(podcast, ep));
      });
    }
    showToast(`Added ${selectedEpisodes.length} episode(s) to ${trimmed}`);
    setNewPlaylistName("");
    setNewPlaylistDialogVisible(false);
    setPlaylistModalVisible(false);
    setSelectedIds(new Set());
  }, [newPlaylistName, podcast, selectedEpisodes, showToast]);

  // Saved state and played state can change while this screen is backgrounded (e.g. from the episode
  // detail modal), so refresh whenever the screen regains focus.
  useFocusEffect(
    useCallback(() => {
      setSavedIds(new Set(Preferences.getPodcastPlaylistEntries("saved").map((entry) => entry.id)));
      setPlayedIds(new Set(Preferences.getPlayedEpisodeIds()));
    }, [])
  );

  useEffect(() => {
    let mounted = true;
    async function loadData() {
      let currentPod = podcast;
      if (!currentPod && params.podcastId) {
        const catalog = await PodcastApi.fetchLiveCatalog();
        currentPod = catalog.find((p) => p.id === params.podcastId) || null;
        if (currentPod && mounted) setPodcast(currentPod);
      }

      if (currentPod) {
        const subscribed = Preferences.getSubscribedPodcasts();
        if (mounted) {
          setIsSubscribed(subscribed.includes(currentPod.id));
          setNotificationsEnabled(Preferences.isPodcastNotificationsEnabled(currentPod.id));
        }

        const cached = PodcastApi.getEpisodesFromCache(currentPod.id);
        if (cached && cached.length > 0) {
          if (mounted) {
            setEpisodes(cached);
            setIsLoadingEpisodes(false);
          }
        } else {
          if (mounted) setIsLoadingEpisodes(true);
        }

        const eps = await PodcastApi.fetchEpisodes(currentPod.rssUrl, currentPod.id);
        if (mounted) {
          setEpisodes(eps);
          setVisibleEpisodeCount(20);
          setIsLoadingEpisodes(false);
        }
      }
    }
    loadData();
    return () => {
      mounted = false;
    };
  }, [params.podcastId]);

  useEffect(() => {
    const pid = podcast?.id || params.podcastId;
    if (!pid) return;

    const cached = Preferences.getCachedPodcastRatings()[pid];
    if (cached) {
      setRating({
        average: cached.average,
        count: cached.count,
        mine: cached.mine || 0
      });
    }

    let active = true;
    PodcastApi.fetchRating(pid)
      .then((summary) => {
        if (!active || !summary) return;
        setRating({
          average: summary.average,
          count: summary.count,
          mine: summary.mine || 0
        });
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [podcast?.id, params.podcastId]);

  const submitRating = async (value: number) => {
    if (!podcast) return;
    if (!Preferences.getSetting("pref_analytics", true)) {
      showToast("Enable analytics in Settings to submit ratings");
      return;
    }
    setRatingModalVisible(false);
    setRating((current) => ({ ...current, mine: value }));
    await PodcastApi.submitRating(podcast.id, value, podcast.title);
  };

  const handleToggleSubscribe = () => {
    if (!podcast) return;
    const newState = Preferences.togglePodcastSubscription(podcast.id);
    setIsSubscribed(newState);
    if (!newState) setNotificationsEnabled(false);
  };

  const handleToggleNotifications = () => {
    if (!podcast) return;
    NativeAndroid.requestNotificationPermission();
    if (!isSubscribed) {
      Preferences.setPodcastSubscribed(podcast.id, true);
      setIsSubscribed(true);
    }
    const enabled = Preferences.togglePodcastNotifications(podcast.id);
    setNotificationsEnabled(enabled);
    showToast(enabled ? "Notifications enabled" : "Notifications disabled");
  };

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const handleShare = async () => {
    if (!podcast) return;
    try {
      await Share.share({
        title: podcast.title,
        message: `Listen to ${podcast.title} on BBC Radio Player: ${podcast.htmlUrl || podcast.rssUrl}`
      });
    } catch {}
  };

  const renderHeader = useCallback(() => {
    if (!podcast) return null;
    return (
      <View>
        {/* Podcast Header matching fragment_podcast_detail.xml */}
        <View style={[styles.headerCard, { backgroundColor: theme.surfaceContainer }]}>
          <View style={styles.headerTopRow}>
            {podcast.imageUrl ? (
              <Image source={{ uri: podcast.imageUrl }} style={styles.artwork} resizeMode="cover" />
            ) : (
              <View style={[styles.artworkFallback, { backgroundColor: theme.primaryContainer }]}>
                <MaterialIcons name="podcasts" size={48} color={theme.primary} />
              </View>
            )}
            <View style={styles.headerInfo}>
              <Text
                style={[styles.podcastDescription, { color: theme.onSurfaceVariant }]}
                numberOfLines={3}
              >
                {decodeXmlEntities(podcast.description)}
              </Text>
              {podcast.description.length > 100 && (
                <TouchableOpacity onPress={() => setDescriptionModalVisible(true)}>
                  <Text style={[styles.showMoreText, { color: theme.primary }]}>Show more</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Action Row: Subscribe, rating, share and notifications */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              onPress={handleToggleSubscribe}
              style={[
                styles.subscribeButton,
                isSubscribed
                  ? { backgroundColor: theme.secondaryContainer, borderColor: theme.primary }
                  : { backgroundColor: theme.primary }
              ]}
            >
              <MaterialIcons
                name={isSubscribed ? "check" : "add"}
                size={18}
                color={isSubscribed ? theme.primary : theme.onPrimary}
              />
              <Text
                style={[
                  styles.subscribeText,
                  { color: isSubscribed ? theme.primary : theme.onPrimary }
                ]}
              >
                {isSubscribed ? "Subscribed" : "Subscribe"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setRatingModalVisible(true)}
              style={styles.ratingGroup}
              accessibilityLabel="Rate podcast"
            >
              <View style={styles.inlineRating}>
                {[1, 2, 3, 4, 5].map((value) => (
                  <MaterialIcons
                    key={value}
                    name={value <= Math.round(rating.mine || rating.average) ? "star" : "star-border"}
                    size={20}
                    color={theme.primary}
                  />
                ))}
              </View>
              <Text style={[styles.ratingSummary, { color: theme.onSurfaceVariant }]}>
                {rating.average > 0 ? `${rating.average.toFixed(1)}/5 (${rating.count})` : "No ratings yet"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={handleShare} style={styles.iconButton}>
              <MaterialIcons name="share" size={22} color={theme.onSurface} />
            </TouchableOpacity>

            {isSubscribed && (
              <TouchableOpacity
                onPress={handleToggleNotifications}
                style={styles.iconButton}
                accessibilityLabel={notificationsEnabled ? "Disable podcast notifications" : "Enable podcast notifications"}
              >
                <MaterialIcons
                  name={notificationsEnabled ? "notifications" : "notifications-off"}
                  size={22}
                  color={notificationsEnabled ? theme.primary : theme.onSurfaceVariant}
                />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    );
  }, [podcast, theme, isSubscribed, notificationsEnabled, episodes.length]);

  const renderEpisodeItem = useCallback(
    ({ item: ep }: { item: Episode }) => {
      if (!podcast) return null;
      const isCurrentEpisode = currentEpisode?.id === ep.id;
      const isCurrentPlaying = isCurrentEpisode && isPlaying;
      const isSelected = selectedIds.has(ep.id);
      const isPlayed = playedIds.has(ep.id);
      const isDownloaded = downloads[ep.id]?.status === "downloaded";

      const openEpisode = () => {
        router.push({
          pathname: "/modal/now-playing",
          params: {
            podcastData: JSON.stringify(podcast),
            episodeData: JSON.stringify(ep)
          }
        });
      };

      const handlePress = () => {
        if (selectedIds.size > 0) {
          toggleEpisodeSelection(ep.id);
        } else {
          openEpisode();
        }
      };

      const handleLongPress = () => {
        toggleEpisodeSelection(ep.id);
      };

      const handlePlayPause = () => {
        if (isCurrentEpisode) {
          if (isPlaying) {
            pause();
          } else {
            resume();
          }
        } else {
          playEpisode(podcast, ep);
        }
      };

      return (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={handlePress}
          onLongPress={handleLongPress}
          delayLongPress={300}
          style={[
            styles.episodeItem,
            {
              borderBottomColor: theme.outlineVariant,
              backgroundColor: isSelected ? theme.surfaceVariant : theme.surface
            }
          ]}
        >
          {selectedIds.size > 0 ? (
            <TouchableOpacity
              onPress={() => toggleEpisodeSelection(ep.id)}
              style={styles.checkboxContainer}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <MaterialIcons
                name={isSelected ? "check-box" : "check-box-outline-blank"}
                size={24}
                color={isSelected ? theme.primary : theme.onSurfaceVariant}
              />
            </TouchableOpacity>
          ) : null}

          <View style={styles.episodeTextContainer}>
            <Text style={[styles.episodeTitle, { color: theme.onSurface }]} numberOfLines={2}>
              {decodeXmlEntities(ep.title)}
            </Text>
            {ep.description ? (
              <Text style={[styles.episodeDescription, { color: theme.onSurfaceVariant }]} numberOfLines={2}>
                {decodeXmlEntities(ep.description)}
              </Text>
            ) : null}
            <View style={styles.episodeMetaRow}>
              {ep.pubDate ? (
                <Text style={[styles.episodeMeta, { color: theme.onSurfaceVariant, flex: 1 }]}>
                  {ep.pubDate.split(" ").slice(0, 4).join(" ")}
                </Text>
              ) : null}
              {ep.durationMins > 0 ? (
                <Text style={[styles.episodeMeta, { color: theme.onSurfaceVariant }]}>
                  {ep.durationMins} min
                </Text>
              ) : null}
              {isPlayed ? (
                <MaterialIcons name="check" size={16} color="#4CAF50" style={styles.statusIcon} />
              ) : null}
              {isDownloaded ? (
                <MaterialIcons name="file-download" size={16} color={theme.primary} style={styles.statusIcon} />
              ) : null}
            </View>
          </View>

          {selectedIds.size === 0 ? (
            <View style={styles.episodeActions}>
              <TouchableOpacity
                style={[styles.playIconButton, { backgroundColor: theme.primary }]}
                onPress={handlePlayPause}
                accessibilityLabel={isCurrentPlaying ? "Pause episode" : "Play episode"}
              >
                <MaterialIcons
                  name={isCurrentPlaying ? "pause" : "play-arrow"}
                  size={24}
                  color={theme.onPrimary}
                />
              </TouchableOpacity>
            </View>
          ) : null}
        </TouchableOpacity>
      );
    },
    [
      podcast,
      currentEpisode?.id,
      isPlaying,
      playEpisode,
      pause,
      resume,
      router,
      theme,
      selectedIds,
      playedIds,
      downloads,
      toggleEpisodeSelection
    ]
  );

  const renderEmpty = useCallback(() => {
    if (isLoadingEpisodes) {
      return (
        <View style={[styles.loadingBox, { backgroundColor: theme.surface }]}>
          <ActivityIndicator size="small" color={theme.primary} />
          <Text style={[styles.loadingText, { color: theme.onSurfaceVariant }]}>
            Loading episodes from BBC RSS...
          </Text>
        </View>
      );
    }
    return (
      <View style={[styles.emptyBox, { backgroundColor: theme.surface }]}>
        <Text style={[styles.emptyText, { color: theme.onSurfaceVariant }]}>
          No episodes found for this podcast.
        </Text>
      </View>
    );
  }, [isLoadingEpisodes, theme]);

  if (!podcast) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.surfaceContainer }]}>
        <View style={styles.appBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <MaterialIcons name="arrow-back" size={24} color={theme.onSurface} />
          </TouchableOpacity>
        </View>
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.surfaceContainer }]} edges={["top"]}>
      {/* 56dp Top App Bar (title shown once, in the header card below) */}
      <View style={[styles.appBar, { borderBottomColor: theme.outlineVariant }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <MaterialIcons name="arrow-back" size={24} color={theme.onSurface} />
        </TouchableOpacity>
        <Text style={[styles.appBarTitle, { color: theme.onSurface }]} numberOfLines={1}>
          {decodeXmlEntities(podcast.title)}
        </Text>
      </View>

      <FlatList
        keyExtractor={(item) => item.id}
        renderItem={renderEpisodeItem}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={renderEmpty}
        data={displayEpisodes.slice(0, visibleEpisodeCount)}
        extraData={{ selectedIds, playedIds, downloads, isPlaying, currentEpisodeId: currentEpisode?.id }}
        initialNumToRender={10}
        maxToRenderPerBatch={20}
        windowSize={7}
        removeClippedSubviews={false}
        onEndReached={() => {
          if (visibleEpisodeCount < displayEpisodes.length) {
            setVisibleEpisodeCount((count) => Math.min(count + 20, displayEpisodes.length));
          }
        }}
        onEndReachedThreshold={0.6}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 200 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      />
      <Modal
        visible={ratingModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setRatingModalVisible(false)}
      >
        <View style={styles.ratingBackdrop}>
          <View style={[styles.ratingSheet, { backgroundColor: theme.surfaceContainer }]}>
            <Text style={[styles.ratingSheetTitle, { color: theme.onSurface }]}>Rate this podcast</Text>
            <View style={styles.ratingChoices}>
              {[1, 2, 3, 4, 5].map((value) => (
                <TouchableOpacity key={value} onPress={() => void submitRating(value)} style={styles.ratingChoice}>
                  <MaterialIcons name={value <= rating.mine ? "star" : "star-border"} size={34} color={theme.primary} />
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity onPress={() => setRatingModalVisible(false)} style={styles.closeRatingButton}>
              <Text style={[styles.rateAction, { color: theme.primary }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      <Modal
        visible={descriptionModalVisible}
        animationType="slide"
        onRequestClose={() => setDescriptionModalVisible(false)}
      >
        <View style={[styles.descriptionModal, { backgroundColor: theme.surfaceContainer, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <View style={[styles.descriptionModalHeader, { borderBottomColor: theme.outlineVariant }]}>
            <Text style={[styles.descriptionModalTitle, { color: theme.onSurface }]}>Podcast description</Text>
            <TouchableOpacity
              onPress={() => setDescriptionModalVisible(false)}
              style={styles.descriptionModalClose}
              accessibilityLabel="Close podcast description"
            >
              <MaterialIcons name="close" size={24} color={theme.onSurface} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.descriptionModalContent}>
            <Text style={[styles.descriptionModalText, { color: theme.onSurface }]}>
              {decodeXmlEntities(podcast?.description)}
            </Text>
          </ScrollView>
        </View>
      </Modal>

      {/* Add to playlist modal */}
      <Modal
        visible={playlistModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPlaylistModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.playlistModalBackdrop}
          activeOpacity={1}
          onPress={() => setPlaylistModalVisible(false)}
        >
          <View style={[styles.playlistModalSheet, { backgroundColor: theme.surfaceContainer }]}>
            <View style={styles.playlistModalHeader}>
              <Text style={[styles.playlistModalTitle, { color: theme.onSurface }]}>Add to playlist</Text>
              <TouchableOpacity onPress={() => setPlaylistModalVisible(false)}>
                <MaterialIcons name="close" size={24} color={theme.onSurface} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {Preferences.getPodcastPlaylists()
                .filter((p) => p.id !== "downloaded")
                .map((playlist) => (
                  <TouchableOpacity
                    key={playlist.id}
                    style={[styles.playlistItem, { borderBottomColor: theme.outlineVariant }]}
                    onPress={() => handleAddToPlaylist(playlist.id, playlist.name)}
                  >
                    <MaterialIcons
                      name={playlist.id === "saved" ? "bookmark" : "playlist-play"}
                      size={24}
                      color={theme.primary}
                    />
                    <Text style={[styles.playlistItemText, { color: theme.onSurface }]}>
                      {playlist.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              <TouchableOpacity
                style={[styles.playlistItem, { borderBottomColor: theme.outlineVariant }]}
                onPress={() => {
                  setNewPlaylistName("");
                  setNewPlaylistDialogVisible(true);
                }}
              >
                <MaterialIcons name="add" size={24} color={theme.primary} />
                <Text style={[styles.playlistItemText, { color: theme.primary, fontWeight: "600" }]}>
                  Create new playlist
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Create New Playlist Dialog */}
      <Modal
        visible={newPlaylistDialogVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setNewPlaylistDialogVisible(false)}
      >
        <View style={styles.newPlaylistDialogBackdrop}>
          <View style={[styles.newPlaylistDialog, { backgroundColor: theme.surfaceContainer }]}>
            <Text style={[styles.newPlaylistDialogTitle, { color: theme.onSurface }]}>New Playlist</Text>
            <TextInput
              style={[
                styles.newPlaylistInput,
                { color: theme.onSurface, borderColor: theme.outlineVariant }
              ]}
              placeholder="Playlist name"
              placeholderTextColor={theme.onSurfaceVariant}
              value={newPlaylistName}
              onChangeText={setNewPlaylistName}
              autoFocus
            />
            <View style={styles.newPlaylistActions}>
              <TouchableOpacity
                style={styles.dialogButton}
                onPress={() => setNewPlaylistDialogVisible(false)}
              >
                <Text style={[styles.dialogButtonText, { color: theme.onSurfaceVariant }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.dialogButton, { backgroundColor: theme.primary }]}
                onPress={handleCreatePlaylistAndAdd}
              >
                <Text style={[styles.dialogButtonText, { color: theme.onPrimary }]}>Create & Add</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {toastMessage ? (
        <View pointerEvents="none" style={[styles.toast, { backgroundColor: theme.primaryContainer, bottom: insets.bottom + 90 }]}>
          <MaterialIcons name="check-circle" size={18} color={theme.onPrimaryContainer} />
          <Text style={[styles.toastText, { color: theme.onPrimaryContainer }]}>{toastMessage}</Text>
        </View>
      ) : null}

      {selectedIds.size > 0 ? (
        <View
          style={[
            styles.selectionToolbar,
            {
              backgroundColor: theme.surfaceContainer,
              borderTopColor: theme.outlineVariant,
              bottom: insets.bottom + 80
            }
          ]}
        >
          <TouchableOpacity
            style={styles.selectionCloseButton}
            onPress={clearSelection}
            accessibilityLabel="Close selection mode"
          >
            <MaterialIcons name="close" size={24} color={theme.onSurface} />
          </TouchableOpacity>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.selectionChipsContainer}
          >
            <TouchableOpacity
              style={[styles.selectionChip, { borderColor: theme.outlineVariant }]}
              onPress={handleTogglePlayedSelected}
            >
              <Text style={[styles.selectionChipText, { color: theme.onSurface }]}>
                {allSelectedPlayed ? "Mark as unplayed" : "Mark as played"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.selectionChip, { borderColor: theme.outlineVariant }]}
              onPress={handleToggleDownloadSelected}
            >
              <Text style={[styles.selectionChipText, { color: theme.onSurface }]}>
                {allSelectedDownloaded ? "Delete downloads" : "Download"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.selectionChip, { borderColor: theme.outlineVariant }]}
              onPress={() => setPlaylistModalVisible(true)}
            >
              <Text style={[styles.selectionChipText, { color: theme.onSurface }]}>
                Add to playlist
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      ) : (
        <View style={[styles.miniPlayerWrapper, { bottom: insets.bottom + 80 }]}>
          <MiniPlayer />
        </View>
      )}
      <View style={[styles.navigationWrapper, { bottom: 0, backgroundColor: theme.surfaceContainer }]}>
        <AppNavigation />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  appBar: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  backButton: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center"
  },
  miniPlayerWrapper: {
    position: "absolute",
    left: 0,
    right: 0
  },
  appBarTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
    marginLeft: 8,
    marginRight: 16
  },
  navigationWrapper: {
    position: "absolute",
    left: 0,
    right: 0
  },
  scrollContent: {
    paddingBottom: 40
  },
  centerBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center"
  },
  headerCard: {
    padding: 16
  },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "flex-start"
  },
  artwork: {
    width: 100,
    height: 100,
    borderRadius: 12
  },
  artworkFallback: {
    width: 100,
    height: 100,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center"
  },
  headerInfo: {
    flex: 1,
    marginLeft: 14
  },
  podcastDescription: {
    fontSize: 13,
    lineHeight: 18
  },
  showMoreText: {
    fontSize: 12,
    fontWeight: "600",
    marginTop: 4
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 14
  },
  subscribeButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 12,
    borderWidth: 1,
    borderColor: "transparent"
  },
  subscribeText: {
    fontSize: 14,
    fontWeight: "600",
    marginLeft: 6
  },
  inlineRating: {
    flexDirection: "row",
    alignItems: "center"
  },
  ratingGroup: {
    alignItems: "center",
    marginRight: "auto",
    paddingVertical: 2
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center"
  },
  genresRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 12
  },
  genreChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1
  },
  genreChipText: {
    fontSize: 11,
    fontWeight: "500"
  },
  ratingSummary: {
    fontSize: 14,
    marginTop: 4
  },
  rateAction: {
    fontSize: 13,
    fontWeight: "600"
  },
  ratingBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.4)"
  },
  ratingSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    alignItems: "center"
  },
  ratingSheetTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 18
  },
  ratingChoices: {
    flexDirection: "row",
    alignItems: "center"
  },
  ratingChoice: {
    paddingHorizontal: 3
  },
  closeRatingButton: {
    marginTop: 16,
    padding: 8
  },
  toast: {
    position: "absolute",
    left: 20,
    right: 20,
    bottom: 24,
    minHeight: 48,
    borderRadius: 12,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 }
  },
  toastText: {
    fontSize: 14,
    fontWeight: "600"
  },
  descriptionModal: {
    flex: 1
  },
  descriptionModalHeader: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 20,
    borderBottomWidth: 1
  },
  descriptionModalTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700"
  },
  descriptionModalClose: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center"
  },
  descriptionModalContent: {
    padding: 20,
    paddingBottom: 40
  },
  descriptionModalText: {
    fontSize: 15,
    lineHeight: 23
  },
  episodesHeaderContainer: {
    marginTop: 8,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8
  },
  episodesTitle: {
    fontSize: 17,
    fontWeight: "700"
  },
  loadingBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 24,
    paddingHorizontal: 16,
    gap: 10
  },
  loadingText: {
    fontSize: 13
  },
  emptyBox: {
    paddingVertical: 32,
    paddingHorizontal: 16,
    alignItems: "center"
  },
  emptyText: {
    fontSize: 14
  },
  episodeItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  episodeTextContainer: {
    flex: 1,
    marginRight: 12
  },
  episodeTitle: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 4
  },
  episodeMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2
  },
  episodeMeta: {
    fontSize: 12
  },
  statusIcon: {
    marginLeft: 6
  },
  checkboxContainer: {
    marginRight: 12,
    justifyContent: "center",
    alignItems: "center"
  },
  episodeDescription: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2
  },
  episodeActions: {
    flexDirection: "row",
    alignItems: "center"
  },
  episodeActionButton: {
    width: 36,
    height: 40,
    alignItems: "center",
    justifyContent: "center"
  },
  playIconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    elevation: 2
  },
  selectionToolbar: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    borderTopWidth: 1,
    elevation: 8,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: -2 },
    zIndex: 10
  },
  selectionCloseButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 4
  },
  selectionChipsContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingRight: 16
  },
  selectionChip: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginRight: 8,
    backgroundColor: "transparent"
  },
  selectionChipText: {
    fontSize: 14,
    fontWeight: "600"
  },
  playlistModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end"
  },
  playlistModalSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 40,
    maxHeight: "70%"
  },
  playlistModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16
  },
  playlistModalTitle: {
    fontSize: 18,
    fontWeight: "700"
  },
  playlistItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  playlistItemText: {
    fontSize: 16,
    marginLeft: 14,
    fontWeight: "500",
    flex: 1
  },
  newPlaylistDialogBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24
  },
  newPlaylistDialog: {
    width: "100%",
    maxWidth: 340,
    borderRadius: 16,
    padding: 20
  },
  newPlaylistDialogTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 16
  },
  newPlaylistInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    marginBottom: 20
  },
  newPlaylistActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12
  },
  dialogButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8
  },
  dialogButtonText: {
    fontSize: 14,
    fontWeight: "600"
  }
});
