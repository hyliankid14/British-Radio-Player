import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  Image,
  StyleSheet,
  ActivityIndicator,
  Share
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { useAppTheme } from "../../src/theme/colors";
import { Podcast, Episode, PodcastApi, decodeXmlEntities } from "../../src/api/podcasts";
import { usePlayerStore } from "../../src/store/playerStore";
import { Preferences } from "../../src/storage/preferences";

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
  const [showFullDescription, setShowFullDescription] = useState(false);

  const { playEpisode, currentEpisode, isPlaying } = usePlayerStore();

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
        if (mounted) setIsSubscribed(subscribed.includes(currentPod.id));

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
          setIsLoadingEpisodes(false);
        }
      }
    }
    loadData();
    return () => {
      mounted = false;
    };
  }, [params.podcastId]);

  const handleToggleSubscribe = () => {
    if (!podcast) return;
    const newState = Preferences.togglePodcastSubscription(podcast.id);
    setIsSubscribed(newState);
  };

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
              <Text style={[styles.podcastTitle, { color: theme.onSurface }]} numberOfLines={2}>
                {decodeXmlEntities(podcast.title)}
              </Text>
              <Text
                style={[styles.podcastDescription, { color: theme.onSurfaceVariant }]}
                numberOfLines={showFullDescription ? undefined : 3}
              >
                {decodeXmlEntities(podcast.description)}
              </Text>
              {podcast.description.length > 100 && (
                <TouchableOpacity onPress={() => setShowFullDescription(!showFullDescription)}>
                  <Text style={[styles.showMoreText, { color: theme.primary }]}>
                    {showFullDescription ? "Show less" : "Show more"}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Action Row: Subscribe & Share */}
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

            <TouchableOpacity onPress={handleShare} style={styles.iconButton}>
              <MaterialIcons name="share" size={22} color={theme.onSurface} />
            </TouchableOpacity>
          </View>

          {/* Genres Chips */}
          {podcast.genres.length > 0 && (
            <View style={styles.genresRow}>
              {podcast.genres.map((g, idx) => (
                <View key={idx} style={[styles.genreChip, { backgroundColor: theme.surface, borderColor: theme.outlineVariant }]}>
                  <Text style={[styles.genreChipText, { color: theme.onSurfaceVariant }]}>{decodeXmlEntities(g)}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Episodes Header */}
        <View style={[styles.episodesHeaderContainer, { backgroundColor: theme.surface }]}>
          <Text style={[styles.episodesTitle, { color: theme.onSurface }]}>
            Episodes {episodes.length > 0 ? `(${episodes.length})` : ""}
          </Text>
        </View>
      </View>
    );
  }, [podcast, theme, isSubscribed, showFullDescription, episodes.length]);

  const renderEpisodeItem = useCallback(
    ({ item: ep }: { item: Episode }) => {
      if (!podcast) return null;
      const isCurrentPlaying = currentEpisode?.id === ep.id && isPlaying;
      return (
        <View
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

          <TouchableOpacity
            style={[styles.playIconButton, { backgroundColor: theme.primary }]}
            onPress={() => playEpisode(podcast, ep)}
          >
            <MaterialIcons
              name={isCurrentPlaying ? "pause" : "play-arrow"}
              size={24}
              color={theme.onPrimary}
            />
          </TouchableOpacity>
        </View>
      );
    },
    [podcast, currentEpisode?.id, isPlaying, playEpisode, theme]
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
      {/* 56dp Top App Bar */}
      <View style={[styles.appBar, { borderBottomColor: theme.outlineVariant }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <MaterialIcons name="arrow-back" size={24} color={theme.onSurface} />
        </TouchableOpacity>
        <Text style={[styles.appBarTitle, { color: theme.onSurface }]} numberOfLines={1}>
          {decodeXmlEntities(podcast.title)}
        </Text>
      </View>

      <FlatList
        data={episodes}
        keyExtractor={(item) => item.id}
        renderItem={renderEpisodeItem}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={renderEmpty}
        initialNumToRender={20}
        maxToRenderPerBatch={20}
        windowSize={7}
        removeClippedSubviews={true}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 120 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      />
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
  appBarTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
    marginLeft: 8,
    marginRight: 16
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
  podcastTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 6
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
  playIconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    elevation: 2
  }
});
