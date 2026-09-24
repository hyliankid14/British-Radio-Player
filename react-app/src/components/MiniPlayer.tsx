import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Image } from "react-native";
import { useRouter } from "expo-router";
import { MaterialIcons } from "@expo/vector-icons";
import { usePlayerStore } from "../store/playerStore";
import { formatShowDisplayTitle } from "../api/showInfo";
import { StationLogo } from "./StationLogo";
import { useAppTheme } from "../theme/colors";
import { Preferences } from "../storage/preferences";
import { useResponsiveLayout } from "../theme/responsive";

export function MiniPlayer() {
  const router = useRouter();
  const theme = useAppTheme();
  const responsive = useResponsiveLayout();
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
    toggleFavorite,
    positionSeconds,
    durationSeconds
  } = usePlayerStore();

  const isPodcast = !currentStation && !!currentEpisode && !!currentPodcast;
  if (!currentStation && !isPodcast) return null;

  const isFav = currentStation ? favorites.includes(currentStation.id) : false;
  const isSubscribed = currentPodcast ? Preferences.getSubscribedPodcasts().includes(currentPodcast.id) : false;
  const title = currentStation ? currentStation.title : (currentEpisode?.title || "Podcast Episode");
  const subtitle = currentStation
    ? (currentShow ? formatShowDisplayTitle(currentShow) : "Radio")
    : (currentPodcast?.title || "BBC Podcast");
  const isSongPlaying = !isPodcast && !!(currentShow?.artist || currentShow?.track);
  const isOfficialLogo =
    !!currentStation &&
    (currentShow?.imageUrl === currentStation.logoUrl ||
      currentShow?.imageUrl?.includes("/services/") ||
      currentShow?.imageUrl?.includes("blocks-colour-black"));

  const artworkUrl = currentStation
    ? isSongPlaying && currentShow?.imageUrl && !isOfficialLogo
      ? currentShow.imageUrl
      : undefined
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

  const artworkSize = responsive.miniPlayerArtworkSize;
  const isTablet = responsive.isTablet;
  const iconSize = isTablet ? 28 : 26;
  const playIconSize = isTablet ? 32 : 30;

  const renderTextContent = () => (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={openNowPlaying}
      style={isTablet ? styles.textContainerTablet : styles.textContainerPhone}
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
      {isPodcast && durationSeconds > 0 ? (
        <View style={[styles.progressTrack, { backgroundColor: theme.surfaceVariant }]}>
          <View
            style={[
              styles.progressIndicator,
              {
                backgroundColor: theme.primary,
                width: `${Math.min(100, Math.max(0, (positionSeconds / durationSeconds) * 100))}%`
              }
            ]}
          />
        </View>
      ) : null}
    </TouchableOpacity>
  );

  const renderControls = () => (
    <View style={isTablet ? styles.controlsRowTablet : styles.controlsRowPhone}>
      {/* Stop Button */}
      <TouchableOpacity
        style={isTablet ? [styles.controlButtonTablet, { width: responsive.miniPlayerButtonSize, height: responsive.miniPlayerButtonSize, padding: responsive.miniPlayerButtonPadding }] : styles.controlButtonPhone}
        onPress={stop}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <MaterialIcons name="stop" size={iconSize} color={theme.miniPlayerIconTint} />
      </TouchableOpacity>

      {/* Previous Button */}
      <TouchableOpacity
        style={isTablet ? [styles.controlButtonTablet, { width: responsive.miniPlayerButtonSize, height: responsive.miniPlayerButtonSize, padding: responsive.miniPlayerButtonPadding }] : styles.controlButtonPhone}
        onPress={handlePrevious}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <MaterialIcons name="skip-previous" size={iconSize} color={theme.miniPlayerIconTint} />
      </TouchableOpacity>

      {/* Play/Pause Button */}
      <TouchableOpacity
        style={isTablet ? [styles.controlButtonTablet, { width: responsive.miniPlayerButtonSize, height: responsive.miniPlayerButtonSize, padding: responsive.miniPlayerButtonPadding }] : styles.controlButtonPhone}
        onPress={togglePlayPause}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        {isBuffering ? (
          <ActivityIndicator size="small" color={theme.primary} />
        ) : (
          <MaterialIcons
            name={isPlaying ? "pause" : "play-arrow"}
            size={playIconSize}
            color={theme.miniPlayerIconTint}
          />
        )}
      </TouchableOpacity>

      {/* Next Button */}
      <TouchableOpacity
        style={isTablet ? [styles.controlButtonTablet, { width: responsive.miniPlayerButtonSize, height: responsive.miniPlayerButtonSize, padding: responsive.miniPlayerButtonPadding }] : styles.controlButtonPhone}
        onPress={handleNext}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <MaterialIcons name="skip-next" size={iconSize} color={theme.miniPlayerIconTint} />
      </TouchableOpacity>

      {/* Favorite / Subscribed Star Button */}
      <TouchableOpacity
        style={isTablet ? [styles.controlButtonTablet, { width: responsive.miniPlayerButtonSize, height: responsive.miniPlayerButtonSize, padding: responsive.miniPlayerButtonPadding }] : styles.controlButtonPhone}
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
          size={iconSize}
          color={isPodcast ? (isSubscribed ? theme.star : theme.miniPlayerIconTint) : isFav ? theme.star : theme.miniPlayerIconTint}
        />
      </TouchableOpacity>
    </View>
  );

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: theme.miniPlayerBg,
          paddingVertical: isTablet ? 12 : 8
        }
      ]}
    >
      {/* Station / Podcast Artwork */}
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={openNowPlaying}
        style={[styles.artworkContainer, { marginRight: isTablet ? 20 : 16 }]}
      >
        {artworkUrl ? (
          <Image
            source={{ uri: artworkUrl }}
            style={{ width: artworkSize, height: artworkSize, borderRadius: 10 }}
            resizeMode="cover"
          />
        ) : currentStation ? (
          <StationLogo stationId={currentStation.id} size={artworkSize} borderRadius={10} />
        ) : (
          <View
            style={{
              width: artworkSize,
              height: artworkSize,
              borderRadius: 10,
              backgroundColor: theme.primaryContainer,
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            <MaterialIcons name="podcasts" size={isTablet ? 40 : 36} color={theme.primary} />
          </View>
        )}
      </TouchableOpacity>

      {/* Info & Controls */}
      {isTablet ? (
        <View style={styles.contentRowTablet}>
          {renderTextContent()}
          {renderControls()}
        </View>
      ) : (
        <View style={styles.contentColumnPhone}>
          {renderTextContent()}
          {renderControls()}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(0,0,0,0.08)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4
  },
  artworkContainer: {
    alignItems: "center",
    justifyContent: "center"
  },
  contentColumnPhone: {
    flex: 1,
    justifyContent: "center"
  },
  contentRowTablet: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  textContainerPhone: {
    marginBottom: 4
  },
  textContainerTablet: {
    flex: 1,
    marginRight: 16,
    justifyContent: "center"
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
  progressTrack: {
    height: 4,
    borderRadius: 2,
    marginTop: 4,
    overflow: "hidden"
  },
  progressIndicator: {
    height: "100%",
    borderRadius: 2
  },
  controlsRowPhone: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingRight: 4
  },
  controlsRowTablet: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end"
  },
  controlButtonPhone: {
    padding: 6,
    alignItems: "center",
    justifyContent: "center"
  },
  controlButtonTablet: {
    alignItems: "center",
    justifyContent: "center"
  }
});
