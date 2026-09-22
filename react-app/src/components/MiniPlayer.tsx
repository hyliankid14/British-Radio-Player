import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Image } from "react-native";
import { useRouter } from "expo-router";
import { MaterialIcons } from "@expo/vector-icons";
import { usePlayerStore } from "../store/playerStore";
import { formatShowDisplayTitle } from "../api/showInfo";
import { StationLogo } from "./StationLogo";
import { useAppTheme } from "../theme/colors";
import { Preferences } from "../storage/preferences";

export function MiniPlayer() {
  const router = useRouter();
  const theme = useAppTheme();
  const [, forceRefresh] = React.useState(0);
  const {
    currentStation,
    currentShow,
    currentPodcast,
    currentEpisode,
    isPlaying,
    isBuffering,
    togglePlayPause,
    pause,
    stop,
    playNext,
    playPrevious,
    seekBy,
    favorites,
    toggleFavorite
  } = usePlayerStore();

  const isPodcast = !currentStation && !!currentEpisode && !!currentPodcast;
  if (!currentStation && !isPodcast) return null;

  const isFav = currentStation ? favorites.includes(currentStation.id) : false;
  const isSubscribed = currentPodcast ? Preferences.getSubscribedPodcasts().includes(currentPodcast.id) : false;
  const title = currentStation ? currentStation.title : (currentEpisode?.title || "Podcast Episode");
  const subtitle = currentStation
    ? (currentShow ? formatShowDisplayTitle(currentShow) : "Radio")
    : (currentPodcast?.title || "BBC Podcast");
  const artworkUrl = currentStation
    ? currentShow?.imageUrl || currentStation.logoUrl
    : currentEpisode?.imageUrl || currentPodcast?.imageUrl;
  // Tapping the mini player always opens the unified Now Playing screen, matching the
  // legacy Kotlin behaviour for both live radio and podcast playback.
  const openNowPlaying = () => {
    router.push("/modal/now-playing");
  };

  const handlePrevious = () => {
    if (isPodcast) void seekBy(-10);
    else void playPrevious();
  };

  const handleNext = () => {
    if (isPodcast) void seekBy(30);
    else void playNext();
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.miniPlayerBg }]}>
      {/* Station / Podcast Artwork */}
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={openNowPlaying}
        style={styles.artworkContainer}
      >
        {artworkUrl ? (
          <Image
            source={{ uri: artworkUrl }}
            style={{ width: 72, height: 72, borderRadius: 10 }}
            resizeMode="cover"
          />
        ) : currentStation ? (
          <StationLogo stationId={currentStation.id} size={72} borderRadius={10} />
        ) : (
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 10,
              backgroundColor: theme.primaryContainer,
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            <MaterialIcons name="podcasts" size={36} color={theme.primary} />
          </View>
        )}
      </TouchableOpacity>

      {/* Info & Controls */}
      <View style={styles.contentColumn}>
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={openNowPlaying}
          style={styles.textContainer}
        >
          <Text
            style={[styles.stationTitle, { color: theme.onSurface }]}
            numberOfLines={1}
          >
            {title}
          </Text>
          <Text
            style={[styles.showSubtitle, { color: theme.onSurfaceVariant }]}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        </TouchableOpacity>

        {/* 5-button control row matching mini_player.xml */}
        <View style={styles.controlsRow}>
          {/* Stop Button */}
          <TouchableOpacity
            style={styles.controlButton}
            onPress={stop}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialIcons name="stop" size={26} color={theme.miniPlayerIconTint} />
          </TouchableOpacity>

          {/* Previous Button */}
          <TouchableOpacity
            style={styles.controlButton}
            onPress={handlePrevious}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialIcons name="skip-previous" size={26} color={theme.miniPlayerIconTint} />
          </TouchableOpacity>

          {/* Play/Pause Button */}
          <TouchableOpacity
            style={styles.controlButton}
            onPress={togglePlayPause}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {isBuffering ? (
              <ActivityIndicator size="small" color={theme.primary} />
            ) : (
              <MaterialIcons
                name={isPlaying ? "pause" : "play-arrow"}
                size={30}
                color={theme.miniPlayerIconTint}
              />
            )}
          </TouchableOpacity>

          {/* Next Button */}
          <TouchableOpacity
            style={styles.controlButton}
            onPress={handleNext}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialIcons name="skip-next" size={26} color={theme.miniPlayerIconTint} />
          </TouchableOpacity>

          {/* Favorite / Subscribed Star Button */}
          <TouchableOpacity
            style={styles.controlButton}
            onPress={() => {
              if (currentStation) {
                toggleFavorite(currentStation.id);
              } else if (currentPodcast) {
                Preferences.togglePodcastSubscription(currentPodcast.id);
                forceRefresh((value) => value + 1);
              }
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialIcons
              name={isPodcast ? (isSubscribed ? "star" : "star-border") : isFav ? "star" : "star-border"}
              size={26}
              color={isPodcast ? (isSubscribed ? theme.star : theme.miniPlayerIconTint) : isFav ? theme.star : theme.miniPlayerIconTint}
            />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(0,0,0,0.08)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4
  },
  artworkContainer: {
    marginRight: 16
  },
  contentColumn: {
    flex: 1,
    justifyContent: "center"
  },
  textContainer: {
    marginBottom: 4
  },
  stationTitle: {
    fontSize: 16,
    fontWeight: "bold",
    letterSpacing: 0.15
  },
  showSubtitle: {
    fontSize: 13,
    marginTop: 1
  },
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingRight: 4
  },
  controlButton: {
    padding: 6,
    alignItems: "center",
    justifyContent: "center"
  }
});
