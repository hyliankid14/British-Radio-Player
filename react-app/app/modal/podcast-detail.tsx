import React, { useState, useEffect, useCallback, useRef } from "react";
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
  ScrollView
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
  const [rating, setRating] = useState<{ average: number; count: number; mine: number }>({ average: 0, count: 0, mine: 0 });
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

  const toggleSave = useCallback((ep: Episode) => {
    if (!podcast) return;
    const saved = Preferences.toggleSavedEpisode(toSavedEpisodeEntry(podcast, ep));
    setSavedIds((current) => {
      const next = new Set(current);
      if (saved) next.add(ep.id);
      else next.delete(ep.id);
      return next;
    });
  }, [podcast]);

  const toggleDownload = useCallback((ep: Episode) => {
    if (!podcast) return;
    const store = useDownloadStore.getState();
    const status = store.downloads[ep.id]?.status;
    if (status === "downloaded") {
      store.remove(ep.id);
    } else if (status !== "downloading") {
      void store.download(toSavedEpisodeEntry(podcast, ep));
    }
  }, [podcast]);

  // Saved state can change while this screen is backgrounded (e.g. from the episode
  // detail modal), so refresh it whenever the screen regains focus.
  useFocusEffect(
    useCallback(() => {
      setSavedIds(new Set(Preferences.getPodcastPlaylistEntries("saved").map((entry) => entry.id)));
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
    if (!podcast) return;
    fetch(`${PodcastApi.getRatingsBaseUrl()}/ratings?podcast_ids=${encodeURIComponent(podcast.id)}`)
      .then((response) => response.json())
      .then((payload) => {
        const summary = payload?.ratings?.[podcast.id];
        if (summary) {
          setRating({
            average: Number(summary.average_rating) || 0,
            count: Number(summary.rating_count) || 0,
            mine: Number(summary.my_rating) || 0
          });
        }
      })
      .catch(() => {});
  }, [podcast]);

  const submitRating = async (value: number) => {
    if (!podcast) return;
    if (!Preferences.getSetting("pref_analytics", true)) {
      setToastMessage("Enable analytics in Settings to submit ratings");
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToastMessage(""), 2500);
      return;
    }
    setRatingModalVisible(false);
    setRating((current) => ({ ...current, mine: value }));
    try {
      await fetch(`${PodcastApi.getRatingsBaseUrl()}/rating`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ podcast_id: podcast.id, rating: value, podcast_title: podcast.title, platform: "ios" })
      });
    } catch {}
  };

  const handleToggleSubscribe = () => {
    if (!podcast) return;
    const newState = Preferences.togglePodcastSubscription(podcast.id);
    setIsSubscribed(newState);
    if (!newState) setNotificationsEnabled(false);
  };

  const handleToggleNotifications = () => {
    if (!podcast || !isSubscribed) return;
    const enabled = Preferences.togglePodcastNotifications(podcast.id);
    setNotificationsEnabled(enabled);
    setToastMessage(enabled ? "Notifications enabled" : "Notifications disabled");
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMessage(""), 2500);
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
                    name={value <= (rating.mine || rating.average) ? "star" : "star-border"}
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

        {/* Episodes Header */}
        <View style={[styles.episodesHeaderContainer, { backgroundColor: theme.surface }]}>
          <Text style={[styles.episodesTitle, { color: theme.onSurface }]}>
            Episodes
          </Text>
        </View>
      </View>
    );
  }, [podcast, theme, isSubscribed, notificationsEnabled, episodes.length]);

  const renderEpisodeItem = useCallback(
    ({ item: ep }: { item: Episode }) => {
      if (!podcast) return null;
      const isCurrentEpisode = currentEpisode?.id === ep.id;
      const isCurrentPlaying = isCurrentEpisode && isPlaying;

      const openEpisode = () => {
        router.push({
          pathname: "/modal/episode-detail",
          params: {
            podcastData: JSON.stringify(podcast),
            episodeData: JSON.stringify(ep)
          }
        });
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
          onPress={openEpisode}
          style={[styles.episodeItem, { borderBottomColor: theme.outlineVariant, backgroundColor: theme.surface }]}
        >
          <View style={styles.episodeTextContainer}>
            <Text style={[styles.episodeTitle, { color: theme.onSurface }]} numberOfLines={2}>
              {decodeXmlEntities(ep.title)}
            </Text>
            <View style={styles.episodeMetaRow}>
              {ep.pubDate ? (
                <Text style={[styles.episodeMeta, { color: theme.onSurfaceVariant }]}>
                  {ep.pubDate.split(" ").slice(0, 4).join(" ")}
                </Text>
              ) : null}
              {ep.durationMins > 0 ? (
                <Text style={[styles.episodeMeta, { color: theme.onSurfaceVariant }]}>
                  {" • "}{ep.durationMins} mins
                </Text>
              ) : null}
            </View>
            {ep.description ? (
              <Text style={[styles.episodeDescription, { color: theme.onSurfaceVariant }]} numberOfLines={2}>
                {decodeXmlEntities(ep.description)}
              </Text>
            ) : null}
          </View>

          <View style={styles.episodeActions}>
            <TouchableOpacity
              style={styles.episodeActionButton}
              onPress={() => toggleSave(ep)}
              accessibilityLabel={savedIds.has(ep.id) ? "Remove saved episode" : "Save episode"}
            >
              <MaterialIcons
                name={savedIds.has(ep.id) ? "bookmark" : "bookmark-border"}
                size={22}
                color={savedIds.has(ep.id) ? theme.primary : theme.onSurfaceVariant}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.episodeActionButton}
              onPress={() => toggleDownload(ep)}
              accessibilityLabel={
                downloads[ep.id]?.status === "downloaded" ? "Remove download" : "Download episode"
              }
            >
              <MaterialIcons
                name={
                  downloads[ep.id]?.status === "downloaded"
                    ? "download-done"
                    : downloads[ep.id]?.status === "downloading"
                      ? "hourglass-empty"
                      : "file-download"
                }
                size={22}
                color={
                  downloads[ep.id]?.status === "downloaded"
                    ? theme.primary
                    : theme.onSurfaceVariant
                }
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.playIconButton, { backgroundColor: theme.primary }]}
              onPress={handlePlayPause}
            >
              <MaterialIcons
                name={isCurrentPlaying ? "pause" : "play-arrow"}
                size={24}
                color={theme.onPrimary}
              />
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      );
    },
    [podcast, currentEpisode?.id, isPlaying, playEpisode, pause, resume, router, theme, savedIds, downloads, toggleSave, toggleDownload]
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
        initialNumToRender={10}
        maxToRenderPerBatch={20}
        windowSize={7}
        removeClippedSubviews={true}
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
        <SafeAreaView style={[styles.descriptionModal, { backgroundColor: theme.surfaceContainer }]}>
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
        </SafeAreaView>
      </Modal>
      {toastMessage ? (
        <View pointerEvents="none" style={[styles.toast, { backgroundColor: theme.primaryContainer }]}>
          <MaterialIcons name="check-circle" size={18} color={theme.onPrimaryContainer} />
          <Text style={[styles.toastText, { color: theme.onPrimaryContainer }]}>{toastMessage}</Text>
        </View>
      ) : null}
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
    marginBottom: 4
  },
  episodeMeta: {
    fontSize: 12
  },
  episodeDescription: {
    fontSize: 12,
    lineHeight: 16
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
  }
});
