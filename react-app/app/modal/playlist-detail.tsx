import React, { useCallback, useEffect, useState } from "react";
import { FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { Episode, Podcast, decodeXmlEntities } from "../../src/api/podcasts";
import { Preferences, SavedEpisodeEntry } from "../../src/storage/preferences";
import { useDownloadStore } from "../../src/downloads/downloadStore";
import { usePlayerStore } from "../../src/store/playerStore";
import { useAppTheme } from "../../src/theme/colors";
import { MiniPlayer } from "../../src/components/MiniPlayer";
import { AppNavigation } from "../../src/components/AppNavigation";

export default function PlaylistDetailModal() {
  const router = useRouter();
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ playlistId?: string; playlistName?: string }>();
  const playlistId = params.playlistId || "saved";
  const playlistName = params.playlistName || "Playlist";

  const downloads = useDownloadStore((state) => state.downloads);
  const playEpisode = usePlayerStore((state) => state.playEpisode);
  const [entries, setEntries] = useState<SavedEpisodeEntry[]>([]);

  const loadEntries = useCallback(() => {
    if (playlistId === "downloaded") {
      setEntries(
        Object.values(Preferences.getDownloadedEntries())
          .sort((a, b) => b.downloadedAtMs - a.downloadedAtMs)
          .map((record) => record.entry)
      );
      return;
    }
    setEntries(Preferences.getPodcastPlaylistEntries(playlistId));
  }, [playlistId]);

  useFocusEffect(
    useCallback(() => {
      loadEntries();
    }, [loadEntries])
  );

  useEffect(() => {
    loadEntries();
  }, [downloads, loadEntries]);

  const playEntry = useCallback(
    (entry: SavedEpisodeEntry) => {
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
      playEpisode(podcast, episode);
    },
    [playEpisode]
  );

  const removeEntry = useCallback(
    (entry: SavedEpisodeEntry) => {
      if (playlistId === "downloaded") {
        useDownloadStore.getState().remove(entry.id);
      } else {
        Preferences.removePodcastPlaylistEntry(playlistId, entry.id);
      }
      loadEntries();
    },
    [playlistId, loadEntries]
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.surfaceContainer }]} edges={["top"]}>
      <View
        style={[
          styles.appBar,
          { borderBottomColor: theme.outlineVariant, backgroundColor: theme.surfaceContainer }
        ]}
      >
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityLabel="Back">
          <MaterialIcons name="arrow-back" size={24} color={theme.onSurface} />
        </TouchableOpacity>
        <Text style={[styles.appBarTitle, { color: theme.onSurface }]} numberOfLines={1}>
          {playlistName}
        </Text>
      </View>

      <FlatList
        data={entries}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.listContent, { paddingBottom: 170 + insets.bottom }]}
        style={{ backgroundColor: theme.surface }}
        renderItem={({ item }) => (
          <View
            style={[
              styles.row,
              { backgroundColor: theme.surface, borderBottomColor: theme.outlineVariant }
            ]}
          >
            <TouchableOpacity style={styles.rowMain} activeOpacity={0.7} onPress={() => playEntry(item)}>
              {item.imageUrl ? (
                <Image source={{ uri: item.imageUrl }} style={styles.artwork} />
              ) : (
                <View style={[styles.artworkFallback, { backgroundColor: theme.primaryContainer }]}>
                  <MaterialIcons name="podcasts" size={26} color={theme.primary} />
                </View>
              )}
              <View style={styles.info}>
                <Text style={[styles.title, { color: theme.onSurface }]} numberOfLines={2}>
                  {decodeXmlEntities(item.title)}
                </Text>
                <Text style={[styles.meta, { color: theme.onSurfaceVariant }]} numberOfLines={1}>
                  {decodeXmlEntities(item.podcastTitle)}
                  {item.pubDate ? ` • ${item.pubDate.split(" ").slice(0, 4).join(" ")}` : ""}
                </Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.removeButton}
              onPress={() => removeEntry(item)}
              accessibilityLabel={
                playlistId === "downloaded" ? "Delete download" : "Remove from playlist"
              }
            >
              <MaterialIcons
                name={playlistId === "downloaded" ? "delete-outline" : "remove-circle-outline"}
                size={24}
                color={theme.onSurfaceVariant}
              />
            </TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <MaterialIcons name="bookmark-border" size={40} color={theme.onSurfaceVariant} />
            <Text style={[styles.emptyText, { color: theme.onSurfaceVariant }]}>
              {playlistId === "downloaded"
                ? "No downloaded episodes yet"
                : "Nothing saved to this playlist yet"}
            </Text>
          </View>
        }
      />

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
  appBarTitle: { flex: 1, fontSize: 18, fontWeight: "700", marginRight: 16 },
  listContent: { flexGrow: 1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 16,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  rowMain: { flex: 1, flexDirection: "row", alignItems: "center", paddingVertical: 12 },
  artwork: { width: 48, height: 48, borderRadius: 6 },
  artworkFallback: {
    width: 48,
    height: 48,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center"
  },
  info: { flex: 1, marginLeft: 12, marginRight: 8 },
  title: { fontSize: 15, fontWeight: "600" },
  meta: { fontSize: 12, marginTop: 3 },
  removeButton: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  emptyContainer: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 80 },
  emptyText: { fontSize: 15, marginTop: 12 },
  miniPlayerWrapper: { position: "absolute", left: 0, right: 0 },
  navigationWrapper: { position: "absolute", left: 0, right: 0 }
});
