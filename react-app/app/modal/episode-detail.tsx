import React, { useState } from "react";
import { Image, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { Podcast, Episode, decodeXmlEntities } from "../../src/api/podcasts";
import { useAppTheme } from "../../src/theme/colors";
import { usePlayerStore } from "../../src/store/playerStore";
import { Preferences } from "../../src/storage/preferences";
import { toSavedEpisodeEntry, useDownloadStore } from "../../src/downloads/downloadStore";
import { MiniPlayer } from "../../src/components/MiniPlayer";
import { AppNavigation } from "../../src/components/AppNavigation";

function formatEpisodeDate(raw: string): string {
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

export default function EpisodeDetailModal() {
  const router = useRouter();
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ podcastData?: string; episodeData?: string }>();
  const [descriptionModalVisible, setDescriptionModalVisible] = useState(false);
  const { playEpisode, pause, resume, stop, isPlaying, currentEpisode } = usePlayerStore();

  let podcast: Podcast | null = null;
  let episode: Episode | null = null;
  try {
    podcast = params.podcastData ? JSON.parse(params.podcastData) : null;
    episode = params.episodeData ? JSON.parse(params.episodeData) : null;
  } catch {
    podcast = null;
    episode = null;
  }

  if (!podcast || !episode) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.surfaceContainer }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <MaterialIcons name="arrow-back" size={24} color={theme.onSurface} />
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const isCurrentEpisode = currentEpisode?.id === episode.id;
  const [isSaved, setIsSaved] = useState(() => Preferences.isEpisodeSaved(episode.id));
  const downloads = useDownloadStore((state) => state.downloads);
  const downloadState = downloads[episode.id];
  const toggleSaved = () => {
    const saved = Preferences.toggleSavedEpisode(toSavedEpisodeEntry(podcast, episode));
    setIsSaved(saved);
  };
  const toggleDownload = () => {
    const store = useDownloadStore.getState();
    const status = store.downloads[episode.id]?.status;
    if (status === "downloaded") {
      store.remove(episode.id);
    } else if (status !== "downloading") {
      void store.download(toSavedEpisodeEntry(podcast, episode));
    }
  };
  const handlePlayPause = async () => {
    if (isCurrentEpisode) {
      if (isPlaying) await pause();
      else await resume();
    } else {
      await playEpisode(podcast, episode);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.surfaceContainer }]} edges={["top"]}>
      <View style={[styles.appBar, { borderBottomColor: theme.outlineVariant }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityLabel="Back">
          <MaterialIcons name="arrow-back" size={24} color={theme.onSurface} />
        </TouchableOpacity>
        <Text style={[styles.appBarTitle, { color: theme.onSurface }]} numberOfLines={1}>
          {decodeXmlEntities(podcast.title)}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 192 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        {episode.imageUrl || podcast.imageUrl ? (
          <Image source={{ uri: episode.imageUrl || podcast.imageUrl }} style={styles.artwork} />
        ) : (
          <View style={[styles.artworkFallback, { backgroundColor: theme.primaryContainer }]}>
            <MaterialIcons name="podcasts" size={72} color={theme.primary} />
          </View>
        )}

        <Text style={[styles.episodeTitle, { color: theme.onSurface }]} numberOfLines={2}>
          {decodeXmlEntities(episode.title)}
        </Text>
        {episode.pubDate ? (
          <Text style={[styles.releaseDate, { color: theme.onSurfaceVariant }]}>
            {formatEpisodeDate(episode.pubDate)}
          </Text>
        ) : null}

        <View style={styles.descriptionContainer}>
          <Text
            style={[styles.description, { color: theme.onSurfaceVariant }]}
            numberOfLines={4}
          >
            {decodeXmlEntities(episode.description || "No description available.")}
          </Text>
          {episode.description.length > 240 ? (
            <TouchableOpacity onPress={() => setDescriptionModalVisible(true)}>
              <Text style={[styles.showMore, { color: theme.primary }]}>Show more</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <TouchableOpacity
          style={[styles.openPodcastButton, { borderColor: theme.outline, backgroundColor: theme.surface }]}
          onPress={() =>
            router.push({
              pathname: "/modal/podcast-detail",
              params: { podcastId: podcast.id, podcastData: JSON.stringify(podcast) }
            })
          }
        >
          <Text style={[styles.openPodcastText, { color: theme.onSurface }]}>Open Podcast</Text>
        </TouchableOpacity>

        <View style={styles.playbackControls}>
          <TouchableOpacity onPress={stop} style={styles.controlButton} accessibilityLabel="Stop">
            <MaterialIcons name="stop" size={25} color={theme.onSurface} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.controlButton} accessibilityLabel="Previous">
            <MaterialIcons name="skip-previous" size={25} color={theme.onSurface} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handlePlayPause}
            style={[styles.playPauseButton, { backgroundColor: theme.primary }]}
            accessibilityLabel={isPlaying && isCurrentEpisode ? "Pause" : "Play"}
          >
            <MaterialIcons
              name={isPlaying && isCurrentEpisode ? "pause" : "play-arrow"}
              size={34}
              color={theme.onPrimary}
            />
          </TouchableOpacity>
          <TouchableOpacity style={styles.controlButton} accessibilityLabel="Next">
            <MaterialIcons name="skip-next" size={25} color={theme.onSurface} />
          </TouchableOpacity>
        </View>

        <View style={styles.secondaryActions}>
          <TouchableOpacity
            style={[styles.secondaryActionButton, { borderColor: theme.outline, backgroundColor: theme.surface }]}
            onPress={toggleSaved}
            accessibilityLabel={isSaved ? "Remove saved episode" : "Save episode"}
          >
            <MaterialIcons
              name={isSaved ? "bookmark" : "bookmark-border"}
              size={20}
              color={isSaved ? theme.primary : theme.onSurface}
            />
            <Text style={[styles.secondaryActionText, { color: theme.onSurface }]}>
              {isSaved ? "Saved" : "Save"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.secondaryActionButton, { borderColor: theme.outline, backgroundColor: theme.surface }]}
            onPress={toggleDownload}
            accessibilityLabel={downloadState?.status === "downloaded" ? "Remove download" : "Download episode"}
          >
            <MaterialIcons
              name={
                downloadState?.status === "downloaded"
                  ? "download-done"
                  : downloadState?.status === "downloading"
                    ? "hourglass-empty"
                    : "file-download"
              }
              size={20}
              color={downloadState?.status === "downloaded" ? theme.primary : theme.onSurface}
            />
            <Text style={[styles.secondaryActionText, { color: theme.onSurface }]}>
              {downloadState?.status === "downloaded"
                ? "Downloaded"
                : downloadState?.status === "downloading"
                  ? "Downloading..."
                  : downloadState?.status === "error"
                    ? "Retry download"
                    : "Download"}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <View style={[styles.miniPlayerWrapper, { bottom: insets.bottom + 80 }]}>
        <MiniPlayer />
      </View>
      <View style={[styles.navigationWrapper, { bottom: insets.bottom }]}>
        <AppNavigation />
      </View>

      <Modal
        visible={descriptionModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setDescriptionModalVisible(false)}
      >
        <SafeAreaView style={[styles.descriptionModal, { backgroundColor: theme.surfaceContainer }]}>
          <View style={[styles.descriptionModalHeader, { borderBottomColor: theme.outlineVariant }]}>
            <Text style={[styles.descriptionModalTitle, { color: theme.onSurface }]}>Episode description</Text>
            <TouchableOpacity
              onPress={() => setDescriptionModalVisible(false)}
              style={styles.descriptionModalClose}
              accessibilityLabel="Close description"
            >
              <MaterialIcons name="close" size={24} color={theme.onSurface} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.descriptionModalContent}>
            <Text style={[styles.fullDescription, { color: theme.onSurfaceVariant }]}>
              {decodeXmlEntities(episode.description || "No description available.")}
            </Text>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  appBar: { height: 56, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth },
  backButton: { width: 56, height: 56, alignItems: "center", justifyContent: "center" },
  appBarTitle: { flex: 1, fontSize: 18, fontWeight: "700", marginRight: 16 },
  scrollContent: { alignItems: "center", paddingTop: 16 },
  artwork: { width: "62%", aspectRatio: 1, maxWidth: 280, borderRadius: 2 },
  artworkFallback: { width: "62%", aspectRatio: 1, maxWidth: 280, alignItems: "center", justifyContent: "center" },
  episodeTitle: { fontSize: 16, lineHeight: 22, textAlign: "center", marginTop: 5, paddingHorizontal: 24 },
  releaseDate: { fontSize: 12, textAlign: "center", marginTop: 6 },
  descriptionContainer: { width: "100%", paddingHorizontal: 24, marginTop: 10 },
  description: { fontSize: 15, lineHeight: 21, textAlign: "center" },
  showMore: { textAlign: "center", fontSize: 13, padding: 8 },
  descriptionModal: { flex: 1 },
  descriptionModalHeader: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 20,
    paddingRight: 8,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  descriptionModalTitle: { flex: 1, fontSize: 18, fontWeight: "700" },
  descriptionModalClose: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  descriptionModalContent: { padding: 20 },
  fullDescription: { fontSize: 16, lineHeight: 24 },
  openPodcastButton: { borderWidth: 1, borderRadius: 22, paddingHorizontal: 18, paddingVertical: 11, marginTop: 8 },
  openPodcastText: { fontSize: 14, fontWeight: "600" },
  playbackControls: { flexDirection: "row", alignItems: "center", justifyContent: "center", width: "100%", marginTop: 24, marginBottom: 12 },
  miniPlayerWrapper: { position: "absolute", left: 0, right: 0 },
  navigationWrapper: { position: "absolute", left: 0, right: 0 },
  controlButton: { width: 48, height: 48, alignItems: "center", justifyContent: "center", marginHorizontal: 2 },
  playPauseButton: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", marginHorizontal: 4 },
  secondaryActions: { flexDirection: "row", justifyContent: "center", width: "100%", marginTop: 4, marginBottom: 12 },
  secondaryActionButton: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginHorizontal: 6
  },
  secondaryActionText: { fontSize: 14, fontWeight: "600", marginLeft: 8 }
});
