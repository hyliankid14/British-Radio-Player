import React from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Share,
  ScrollView,
  Dimensions
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { usePlayerStore } from "../../src/store/playerStore";
import { AUDIO_QUALITIES, AudioQuality } from "../../src/data/stations";
import { formatShowDisplayTitle } from "../../src/api/showInfo";
import { useAppTheme } from "../../src/theme/colors";
import { StationLogo } from "../../src/components/StationLogo";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const ARTWORK_SIZE = Math.min(SCREEN_WIDTH - 64, 300);

export default function NowPlayingModal() {
  const router = useRouter();
  const params = useLocalSearchParams<{ autoplay?: string; action?: string }>();
  const theme = useAppTheme();
  const {
    currentStation,
    currentShow,
    isPlaying,
    isBuffering,
    togglePlayPause,
    pause,
    stop,
    playNext,
    playPrevious,
    audioQuality,
    setAudioQuality,
    favorites,
    toggleFavorite
  } = usePlayerStore();

  const [imageError, setImageError] = React.useState(false);
  const resume = usePlayerStore((s) => s.resume);

  const handleStop = React.useCallback(async () => {
    await stop();
    router.back();
  }, [stop, router]);

  React.useEffect(() => {
    setImageError(false);
  }, [currentStation?.id, currentShow?.imageUrl]);

  React.useEffect(() => {
    if (params.autoplay === "true") {
      resume();
    }
    if (params.action === "stop") {
      handleStop();
    }
  }, [params.autoplay, params.action, resume, handleStop]);

  if (!currentStation) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.surfaceContainer }]}>
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyText, { color: theme.onSurface }]}>No station playing</Text>
          <TouchableOpacity
            style={[styles.closeButton, { backgroundColor: theme.primary }]}
            onPress={() => router.back()}
          >
            <Text style={styles.closeButtonText}>Close</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const isFav = favorites.includes(currentStation.id);
  const showTitle = currentShow ? formatShowDisplayTitle(currentShow) : "Radio";
  const hasCustomArtwork = !!currentShow?.imageUrl;

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Listening to ${currentStation.title} - ${showTitle} on British Radio Player`,
        url: "https://github.com/hyliankid14/British-Radio-Player"
      });
    } catch (e) {
      // User cancelled
    }
  };

  const cycleQuality = () => {
    const qualities: AudioQuality[] = ["HIGH", "MEDIUM", "LOW"];
    const currentIndex = qualities.indexOf(audioQuality);
    const nextQuality = qualities[(currentIndex + 1) % qualities.length];
    setAudioQuality(nextQuality);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.surfaceContainer }]}>
      {/* Material 3 Top App Bar (56dp) matching native toolbar */}
      <View style={[styles.topAppBar, { backgroundColor: theme.surfaceContainer }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.navButton}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <MaterialIcons name="arrow-back" size={24} color={theme.onSurface} />
        </TouchableOpacity>

        <Text
          style={[styles.appBarTitle, { color: theme.onSurface }]}
          numberOfLines={1}
        >
          {currentStation.title}
        </Text>

        <TouchableOpacity
          onPress={handleShare}
          style={styles.navButton}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <MaterialIcons name="share" size={24} color={theme.onSurface} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Station Artwork (Square 1:1 up to 300dp) */}
        <View style={styles.artworkContainer}>
          {hasCustomArtwork && !imageError ? (
            <Image
              source={{ uri: currentShow!.imageUrl }}
              style={[styles.artworkImage, { width: ARTWORK_SIZE, height: ARTWORK_SIZE }]}
              onError={() => setImageError(true)}
            />
          ) : (
            <StationLogo
              stationId={currentStation.id}
              size={ARTWORK_SIZE}
              borderRadius={16}
            />
          )}
        </View>

        {/* Show Name (Material3 HeadlineSmall) */}
        <Text
          style={[styles.showName, { color: theme.onSurface }]}
          numberOfLines={2}
        >
          {showTitle}
        </Text>

        {/* Next Show Info (Material3 BodySmall) */}
        {currentShow?.nextShowTitle ? (
          <Text
            style={[styles.nextShow, { color: theme.onSurfaceVariant }]}
            numberOfLines={2}
          >
            Up next: {currentShow.nextShowTitle}
          </Text>
        ) : null}

        {/* Episode Title (Material3 TitleMedium) */}
        {currentShow?.episodeTitle && currentShow.episodeTitle !== showTitle ? (
          <Text
            style={[styles.episodeTitle, { color: theme.onSurface }]}
            numberOfLines={2}
          >
            {currentShow.episodeTitle}
          </Text>
        ) : null}

        {/* Artist / Track or Secondary Info */}
        <Text style={[styles.stationSubtitle, { color: theme.onSurfaceVariant }]}>
          {currentStation.title} • {currentStation.category.toUpperCase()}
        </Text>

        {/* Audio Quality Chip */}
        <TouchableOpacity
          style={[
            styles.qualityChip,
            {
              backgroundColor: theme.pillActiveBg,
              borderColor: theme.outlineVariant
            }
          ]}
          onPress={cycleQuality}
          activeOpacity={0.7}
        >
          <MaterialIcons name="high-quality" size={16} color={theme.onSurface} />
          <Text style={[styles.qualityText, { color: theme.onSurface }]}>
            {AUDIO_QUALITIES[audioQuality]?.label || "High"}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Playback Controls matching activity_now_playing.xml */}
      <View style={styles.playbackControls}>
        {/* Stop Button */}
        <TouchableOpacity
          style={styles.controlIconButton}
          onPress={handleStop}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialIcons name="stop" size={26} color={theme.onSurface} />
        </TouchableOpacity>

        {/* Previous Button */}
        <TouchableOpacity
          style={styles.controlIconButton}
          onPress={playPrevious}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialIcons name="skip-previous" size={26} color={theme.onSurface} />
        </TouchableOpacity>

        {/* Play / Pause Filled Button (64x64dp, primary background, white icon) */}
        <TouchableOpacity
          style={[styles.playPauseButton, { backgroundColor: theme.primary }]}
          onPress={togglePlayPause}
          activeOpacity={0.85}
        >
          {isBuffering ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <MaterialIcons
              name={isPlaying ? "pause" : "play-arrow"}
              size={34}
              color="#FFFFFF"
            />
          )}
        </TouchableOpacity>

        {/* Next Button */}
        <TouchableOpacity
          style={styles.controlIconButton}
          onPress={playNext}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialIcons name="skip-next" size={26} color={theme.onSurface} />
        </TouchableOpacity>

        {/* Favorite Button */}
        <TouchableOpacity
          style={styles.controlIconButton}
          onPress={() => toggleFavorite(currentStation.id)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialIcons
            name={isFav ? "star" : "star-border"}
            size={26}
            color={isFav ? theme.star : theme.onSurface}
          />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  topAppBar: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    elevation: 4
  },
  navButton: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center"
  },
  appBarTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: "600",
    textAlign: "center"
  },
  scrollContent: {
    alignItems: "center",
    paddingTop: 16,
    paddingBottom: 24,
    paddingHorizontal: 24
  },
  artworkContainer: {
    marginVertical: 16,
    borderRadius: 16,
    overflow: "hidden",
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8
  },
  artworkImage: {
    borderRadius: 16
  },
  showName: {
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 8,
    paddingHorizontal: 16,
    letterSpacing: -0.2
  },
  nextShow: {
    fontSize: 12,
    textAlign: "center",
    marginTop: 4,
    paddingHorizontal: 16
  },
  episodeTitle: {
    fontSize: 16,
    lineHeight: 22,
    textAlign: "center",
    marginTop: 6,
    paddingHorizontal: 16
  },
  stationSubtitle: {
    fontSize: 13,
    marginTop: 8,
    textAlign: "center"
  },
  qualityChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 16,
    gap: 6
  },
  qualityText: {
    fontSize: 12,
    fontWeight: "600"
  },
  playbackControls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-evenly",
    paddingHorizontal: 12,
    paddingVertical: 16,
    marginBottom: 12
  },
  controlIconButton: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 24
  },
  playPauseButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center"
  },
  emptyText: {
    fontSize: 18,
    marginBottom: 16
  },
  closeButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8
  },
  closeButtonText: {
    color: "#FFFFFF",
    fontWeight: "bold"
  }
});
