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
  Modal,
  Dimensions
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import TrackPlayer from "react-native-track-player";
import { MaterialIcons } from "@expo/vector-icons";
import { usePlayerStore } from "../../src/store/playerStore";
import { AUDIO_QUALITIES, AudioQuality } from "../../src/data/stations";
import { formatShowDisplayTitle } from "../../src/api/showInfo";
import { Podcast, PodcastApi, decodeXmlEntities } from "../../src/api/podcasts";
import { useAppTheme } from "../../src/theme/colors";
import { StationLogo, getStationTint } from "../../src/components/StationLogo";
import { SeekBar } from "../../src/components/SeekBar";
import { Preferences } from "../../src/storage/preferences";
import { toSavedEpisodeEntry, useDownloadStore } from "../../src/downloads/downloadStore";
import { NativeAndroid, ArtworkPalette } from "../../src/native/nativeAndroid";
import { OfflineBanner, VpnBanner } from "../../src/components/NetworkBanners";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const ARTWORK_SIZE = Math.min(SCREEN_WIDTH - 64, 300);

interface DerivedColours {
  subtle: string;
  buttonOutline: string;
  playPause: string;
  icon: string;
  isLight: boolean;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return { r: 0, g: 0, b: 0 };
  const value = parseInt(match[1], 16);
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
  return `#${clamp(r).toString(16).padStart(2, "0")}${clamp(g)
    .toString(16)
    .padStart(2, "0")}${clamp(b).toString(16).padStart(2, "0")}`.toUpperCase();
}

/** Mirrors the Kotlin `applyDominantColor` derivation used by `NowPlayingActivity`. */
function deriveColours(dominantHex: string, isDarkMode: boolean): DerivedColours {
  const { r, g, b } = hexToRgb(dominantHex);
  const subtle = isDarkMode
    ? rgbToHex(r * 0.4, g * 0.4, b * 0.4)
    : rgbToHex(255 - (255 - r) * 0.3, 255 - (255 - g) * 0.3, 255 - (255 - b) * 0.3);

  const sr = hexToRgb(subtle).r / 255;
  const sg = hexToRgb(subtle).g / 255;
  const sb = hexToRgb(subtle).b / 255;
  const luminance = 0.299 * sr + 0.587 * sg + 0.114 * sb;
  const isLight = luminance > 0.5;

  const buttonOutline = isLight
    ? rgbToHex(r * 0.7, g * 0.7, b * 0.7)
    : rgbToHex((r + 255) / 2, (g + 255) / 2, (b + 255) / 2);
  const playPause = isLight
    ? rgbToHex(r * 0.8, g * 0.8, b * 0.8)
    : rgbToHex(r * 0.5 + 127.5, g * 0.5 + 127.5, b * 0.5 + 127.5);
  const icon = isLight ? rgbToHex(r, g, b) : "#FFFFFF";

  return { subtle, buttonOutline, playPause, icon, isLight };
}

function formatClock(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

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

function parseEpoch(raw?: string): number {
  if (!raw) return 0;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export default function NowPlayingModal() {
  const router = useRouter();
  const params = useLocalSearchParams<{ autoplay?: string; action?: string }>();
  const theme = useAppTheme();
  const {
    currentStation,
    currentShow,
    currentPodcast,
    currentEpisode,
    isPlaying,
    isBuffering,
    togglePlayPause,
    stop,
    playNext,
    playPrevious,
    audioQuality,
    setAudioQuality,
    favorites,
    toggleFavorite,
    positionSeconds,
    durationSeconds,
    seekTo,
    seekBy,
    toggleEpisodePlayed,
    resume
  } = usePlayerStore();

  const downloads = useDownloadStore((state) => state.downloads);

  const [imageError, setImageError] = React.useState(false);
  const [palette, setPalette] = React.useState<DerivedColours | null>(null);
  const [menuVisible, setMenuVisible] = React.useState(false);
  const [descriptionVisible, setDescriptionVisible] = React.useState(false);
  const [playlistVisible, setPlaylistVisible] = React.useState(false);
  const [matchedPodcast, setMatchedPodcast] = React.useState<Podcast | null>(null);
  const [isPlayed, setIsPlayed] = React.useState(false);
  const [isSubscribed, setIsSubscribed] = React.useState(false);
  const [localPosition, setLocalPosition] = React.useState(positionSeconds);
  const [dragging, setDragging] = React.useState(false);

  const isPodcast = !currentStation && !!currentEpisode && !!currentPodcast;
  const artworkUrl = isPodcast
    ? currentEpisode?.imageUrl || currentPodcast?.imageUrl
    : currentShow?.imageUrl;
  const hasCustomArtwork = !!artworkUrl;
  const showTitle = currentShow ? formatShowDisplayTitle(currentShow) : "Radio";

  React.useEffect(() => {
    setImageError(false);
  }, [currentStation?.id, artworkUrl]);

  // Poll the player so the podcast scrubber advances smoothly between metadata events.
  React.useEffect(() => {
    if (!isPodcast) return;
    let mounted = true;
    const tick = async () => {
      try {
        const progress = await TrackPlayer.getProgress();
        if (!mounted || dragging) return;
        setLocalPosition(progress.position);
        const duration = progress.duration > 0 ? progress.duration : durationSeconds;
        if (duration > 0) usePlayerStore.setState({ durationSeconds: duration });
      } catch {
        // Player not ready yet.
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [isPodcast, dragging, durationSeconds]);

  React.useEffect(() => {
    if (!dragging) setLocalPosition(positionSeconds);
  }, [positionSeconds, dragging]);

  // Extract the adaptive palette from artwork, mirroring the Kotlin Now Playing theming.
  React.useEffect(() => {
    let cancelled = false;
    const isDark = theme.background === "#1C1B1F";
    async function resolvePalette() {
      if (hasCustomArtwork && artworkUrl) {
        const extracted = await NativeAndroid.extractPalette(artworkUrl, isDark);
        if (cancelled) return;
        if (extracted) {
          setPalette({
            subtle: extracted.subtle,
            buttonOutline: extracted.buttonOutline,
            playPause: extracted.playPause,
            icon: extracted.icon,
            isLight: extracted.isLight
          });
          return;
        }
      }
      const fallbackTint = isPodcast
        ? getStationTint(currentPodcast?.id || "podcast")
        : getStationTint(currentStation?.id || "radio");
      if (!cancelled) setPalette(deriveColours(fallbackTint, isDark));
    }
    resolvePalette();
    return () => {
      cancelled = true;
    };
  }, [artworkUrl, hasCustomArtwork, isPodcast, currentStation?.id, currentPodcast?.id, theme.background]);

  // Match the live radio show against the podcast catalogue for the "Open Podcast" action.
  React.useEffect(() => {
    if (!currentStation || !currentShow) {
      setMatchedPodcast(null);
      return;
    }
    let cancelled = false;
    const query = (currentShow.title || currentShow.episodeTitle || "").trim().toLowerCase();
    if (!query) return;
    PodcastApi.fetchLiveCatalog()
      .then((catalog) => {
        if (cancelled) return;
        const match = catalog.find(
          (podcast) => podcast.title.toLowerCase().trim() === query
        );
        setMatchedPodcast(match || null);
      })
      .catch(() => {
        if (!cancelled) setMatchedPodcast(null);
      });
    return () => {
      cancelled = true;
    };
  }, [currentStation?.id, currentShow?.title, currentShow?.episodeTitle]);

  React.useEffect(() => {
    if (currentEpisode) {
      setIsPlayed(Preferences.isEpisodePlayed(currentEpisode.id));
    }
  }, [currentEpisode?.id, positionSeconds]);

  React.useEffect(() => {
    if (currentPodcast) {
      setIsSubscribed(Preferences.getSubscribedPodcasts().includes(currentPodcast.id));
    }
  }, [currentPodcast?.id]);

  const handleStop = React.useCallback(async () => {
    await stop();
    router.back();
  }, [stop, router]);

  React.useEffect(() => {
    if (params.autoplay === "true") resume();
    if (params.action === "stop") handleStop();
  }, [params.autoplay, params.action, resume, handleStop]);

  if (!currentStation && !isPodcast) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.surfaceContainer }]}>
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyText, { color: theme.onSurface }]}>Nothing playing</Text>
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

  const isFav = currentStation ? favorites.includes(currentStation.id) : false;
  const headerTitle = currentStation ? currentStation.title : currentPodcast?.title || "Podcast";
  const background = palette?.subtle || theme.surfaceContainer;
  const outlineColour = palette?.buttonOutline || theme.surfaceVariant;
  const playPauseColour = palette?.playPause || theme.primary;
  const iconColour = palette?.icon || theme.onSurface;
  const controlIcon = palette?.isLight ? palette.icon : "#FFFFFF";
  const downloaded = currentEpisode ? downloads[currentEpisode.id]?.status === "downloaded" : false;

  const handleShare = async () => {
    try {
      if (isPodcast && currentEpisode) {
        await Share.share({
          message: `${currentEpisode.title} — ${currentPodcast?.title}\n${currentEpisode.audioUrl}`
        });
      } else {
        await Share.share({
          message: `Listening to ${currentStation?.title} - ${showTitle} on British Radio Player`,
          url: "https://github.com/hyliankid14/British-Radio-Player"
        });
      }
    } catch {
      // User cancelled.
    }
  };

  const cycleQuality = () => {
    const qualities: AudioQuality[] = ["HIGH", "MEDIUM", "LOW"];
    const currentIndex = qualities.indexOf(audioQuality);
    setAudioQuality(qualities[(currentIndex + 1) % qualities.length]);
  };

  const handleMarkPlayed = () => {
    if (!currentEpisode) return;
    const next = toggleEpisodePlayed(
      currentEpisode.id,
      currentEpisode.podcastId,
      parseEpoch(currentEpisode.pubDate)
    );
    setIsPlayed(next);
    setMenuVisible(false);
  };

  const handleSubscribe = () => {
    if (!currentPodcast) return;
    const subscribed = Preferences.togglePodcastSubscription(currentPodcast.id);
    setIsSubscribed(subscribed);
    setMenuVisible(false);
  };

  const handleDownloadToggle = () => {
    if (!currentEpisode || !currentPodcast) return;
    const store = useDownloadStore.getState();
    const status = store.downloads[currentEpisode.id]?.status;
    if (status === "downloaded") store.remove(currentEpisode.id);
    else if (status !== "downloading") void store.download(toSavedEpisodeEntry(currentPodcast, currentEpisode));
    setMenuVisible(false);
  };

  const handleAddToPlaylist = (playlistId: string) => {
    if (!currentEpisode || !currentPodcast) return;
    Preferences.addPodcastPlaylistEntry(playlistId, toSavedEpisodeEntry(currentPodcast, currentEpisode));
    setPlaylistVisible(false);
  };

  const handlePrevious = () => {
    if (isPodcast) void seekBy(-10);
    else void playPrevious();
  };

  const handleNext = () => {
    if (isPodcast) void seekBy(30);
    else void playNext();
  };

  const playlists = Preferences.getPodcastPlaylists().filter(
    (playlist) => playlist.id !== "downloaded"
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: background }]}>
      <View style={[styles.topAppBar, { backgroundColor: background }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.navButton}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <MaterialIcons name="arrow-back" size={24} color={iconColour} />
        </TouchableOpacity>

        <Text style={[styles.appBarTitle, { color: iconColour }]} numberOfLines={1}>
          {headerTitle}
        </Text>

        <View style={styles.appBarActions}>
          {isPodcast ? (
            <TouchableOpacity
              onPress={handleMarkPlayed}
              style={styles.navButton}
              accessibilityLabel={isPlayed ? "Mark episode as unplayed" : "Mark episode as played"}
            >
              <MaterialIcons
                name={isPlayed ? "check-circle" : "check-circle-outline"}
                size={24}
                color={iconColour}
              />
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity onPress={handleShare} style={styles.navButton}>
            <MaterialIcons name="share" size={24} color={iconColour} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setMenuVisible(true)} style={styles.navButton}>
            <MaterialIcons name="more-vert" size={24} color={iconColour} />
          </TouchableOpacity>
        </View>
      </View>

      <OfflineBanner />
      <VpnBanner />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.artworkContainer}>
          {hasCustomArtwork && !imageError ? (
            <Image
              source={{ uri: artworkUrl }}
              style={[styles.artworkImage, { width: ARTWORK_SIZE, height: ARTWORK_SIZE }]}
              onError={() => setImageError(true)}
            />
          ) : currentStation ? (
            <StationLogo stationId={currentStation.id} size={ARTWORK_SIZE} borderRadius={16} />
          ) : (
            <View
              style={[
                styles.artworkFallback,
                { width: ARTWORK_SIZE, height: ARTWORK_SIZE, backgroundColor: theme.primaryContainer }
              ]}
            >
              <MaterialIcons name="podcasts" size={96} color={theme.primary} />
            </View>
          )}
        </View>

        <Text style={[styles.showName, { color: iconColour }]} numberOfLines={2}>
          {isPodcast ? decodeXmlEntities(currentEpisode?.title || "") : showTitle}
        </Text>

        {isPodcast ? (
          <>
            <Text style={[styles.stationSubtitle, { color: iconColour, opacity: 0.8 }]} numberOfLines={1}>
              {decodeXmlEntities(currentPodcast?.title || "")}
            </Text>
            {currentEpisode?.pubDate ? (
              <Text style={[styles.releaseDate, { color: iconColour, opacity: 0.7 }]}>
                {formatEpisodeDate(currentEpisode.pubDate)}
              </Text>
            ) : null}
          </>
        ) : (
          <>
            {currentShow?.nextShowTitle ? (
              <Text style={[styles.nextShow, { color: iconColour, opacity: 0.8 }]} numberOfLines={2}>
                Up next: {currentShow.nextShowTitle}
              </Text>
            ) : null}

            {currentShow?.episodeTitle && currentShow.episodeTitle !== showTitle ? (
              <Text style={[styles.episodeTitle, { color: iconColour }]} numberOfLines={2}>
                {currentShow.episodeTitle}
              </Text>
            ) : null}

            <Text style={[styles.stationSubtitle, { color: iconColour, opacity: 0.8 }]}>
              {currentStation?.title} • {currentStation?.category.toUpperCase()}
            </Text>
          </>
        )}

        {isPodcast && currentEpisode?.description ? (
          <View style={styles.descriptionContainer}>
            <Text
              style={[styles.description, { color: iconColour, opacity: 0.85 }]}
              numberOfLines={4}
            >
              {decodeXmlEntities(currentEpisode.description)}
            </Text>
            <TouchableOpacity onPress={() => setDescriptionVisible(true)}>
              <Text style={[styles.showMore, { color: iconColour }]}>Show more</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {!isPodcast && matchedPodcast ? (
          <TouchableOpacity
            style={[
              styles.openPodcastButton,
              { backgroundColor: palette?.isLight ? palette.buttonOutline : outlineColour }
            ]}
            onPress={() =>
              router.push({
                pathname: "/modal/podcast-detail",
                params: {
                  podcastId: matchedPodcast.id,
                  podcastData: JSON.stringify(matchedPodcast)
                }
              })
            }
          >
            <Text style={[styles.openPodcastText, { color: controlIcon }]}>Open Podcast</Text>
          </TouchableOpacity>
        ) : null}

        {!isPodcast ? (
          <TouchableOpacity
            style={[styles.qualityChip, { backgroundColor: outlineColour, borderColor: outlineColour }]}
            onPress={cycleQuality}
            activeOpacity={0.7}
          >
            <MaterialIcons name="high-quality" size={16} color={controlIcon} />
            <Text style={[styles.qualityText, { color: controlIcon }]}>
              {AUDIO_QUALITIES[audioQuality]?.label || "High"}
            </Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>

      {isPodcast ? (
        <View style={styles.progressSection}>
          <SeekBar
            value={dragging ? localPosition : localPosition}
            max={durationSeconds || currentEpisode?.durationMins * 60 || 0}
            activeColor={palette?.isLight ? palette.playPause : "#FFFFFF"}
            trackColor={palette?.isLight ? "rgba(0,0,0,0.2)" : "rgba(255,255,255,0.3)"}
            labelColor={controlIcon}
            labelBackground={outlineColour}
            onSeekStart={() => setDragging(true)}
            onSeek={(seconds) => {
              setLocalPosition(seconds);
              void seekTo(seconds);
            }}
            onSeekEnd={() => setDragging(false)}
          />
          <View style={styles.progressLabels}>
            <Text style={[styles.progressLabel, { color: controlIcon }]}>
              {formatClock(localPosition)}
            </Text>
            <Text style={[styles.progressLabel, { color: controlIcon }]}>
              -{formatClock(Math.max(0, (durationSeconds || currentEpisode?.durationMins * 60 || 0) - localPosition))}
            </Text>
          </View>
        </View>
      ) : null}

      <View style={styles.playbackControls}>
        <TouchableOpacity
          style={[styles.controlIconButton, { backgroundColor: outlineColour }]}
          onPress={handleStop}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialIcons name="stop" size={26} color={controlIcon} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.controlIconButton, { backgroundColor: outlineColour }]}
          onPress={handlePrevious}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialIcons name="skip-previous" size={26} color={controlIcon} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.playPauseButton, { backgroundColor: playPauseColour }]}
          onPress={togglePlayPause}
          activeOpacity={0.85}
        >
          {isBuffering ? (
            <ActivityIndicator size="small" color={controlIcon} />
          ) : (
            <MaterialIcons
              name={isPlaying ? "pause" : "play-arrow"}
              size={34}
              color={palette?.isLight ? palette.icon : "#FFFFFF"}
            />
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.controlIconButton, { backgroundColor: outlineColour }]}
          onPress={handleNext}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialIcons name="skip-next" size={26} color={controlIcon} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.controlIconButton,
            {
              backgroundColor:
                isPodcast && isSubscribed
                  ? playPauseColour
                  : isFav
                  ? playPauseColour
                  : "transparent"
            }
          ]}
          onPress={() => {
            if (isPodcast && currentPodcast) {
              setIsSubscribed(Preferences.togglePodcastSubscription(currentPodcast.id));
            } else if (currentStation) {
              toggleFavorite(currentStation.id);
            }
          }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialIcons
            name={isPodcast ? (isSubscribed ? "star" : "star-border") : isFav ? "star" : "star-border"}
            size={26}
            color={
              isPodcast && isSubscribed
                ? controlIcon
                : isFav
                ? controlIcon
                : iconColour
            }
          />
        </TouchableOpacity>
      </View>

      {/* Overflow menu */}
      <Modal visible={menuVisible} transparent animationType="fade" onRequestClose={() => setMenuVisible(false)}>
        <TouchableOpacity style={styles.menuBackdrop} activeOpacity={1} onPress={() => setMenuVisible(false)}>
          <View style={[styles.menuSheet, { backgroundColor: theme.surfaceContainer }]}>
            {isPodcast && currentPodcast ? (
              <TouchableOpacity
                style={styles.menuRow}
                onPress={() => {
                  setMenuVisible(false);
                  router.push({
                    pathname: "/modal/podcast-detail",
                    params: {
                      podcastId: currentPodcast.id,
                      podcastData: JSON.stringify(currentPodcast)
                    }
                  });
                }}
              >
                <MaterialIcons name="list" size={22} color={theme.onSurface} />
                <Text style={[styles.menuText, { color: theme.onSurface }]}>View all episodes</Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity
              style={styles.menuRow}
              onPress={() => {
                setMenuVisible(false);
                void handleShare();
              }}
            >
              <MaterialIcons name="share" size={22} color={theme.onSurface} />
              <Text style={[styles.menuText, { color: theme.onSurface }]}>Share</Text>
            </TouchableOpacity>

            {isPodcast && currentPodcast ? (
              <>
                <TouchableOpacity
                  style={styles.menuRow}
                  onPress={() => {
                    setMenuVisible(false);
                    setPlaylistVisible(true);
                  }}
                >
                  <MaterialIcons name="playlist-add" size={22} color={theme.onSurface} />
                  <Text style={[styles.menuText, { color: theme.onSurface }]}>Add to playlist</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.menuRow} onPress={handleSubscribe}>
                  <MaterialIcons name={isSubscribed ? "notifications-off" : "notifications"} size={22} color={theme.onSurface} />
                  <Text style={[styles.menuText, { color: theme.onSurface }]}>
                    {isSubscribed ? "Unsubscribe" : "Subscribe"}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.menuRow} onPress={handleMarkPlayed}>
                  <MaterialIcons name="check-circle" size={22} color={theme.onSurface} />
                  <Text style={[styles.menuText, { color: theme.onSurface }]}>
                    {isPlayed ? "Mark as unplayed" : "Mark as played"}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.menuRow} onPress={handleDownloadToggle}>
                  <MaterialIcons name={downloaded ? "delete" : "download"} size={22} color={theme.onSurface} />
                  <Text style={[styles.menuText, { color: theme.onSurface }]}>
                    {downloaded ? "Delete download" : "Download episode"}
                  </Text>
                </TouchableOpacity>
              </>
            ) : null}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Full description dialog */}
      <Modal
        visible={descriptionVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setDescriptionVisible(false)}
      >
        <View style={styles.menuBackdrop}>
          <View style={[styles.descriptionSheet, { backgroundColor: theme.surfaceContainer }]}>
            <View style={styles.descriptionHeader}>
              <Text style={[styles.descriptionTitle, { color: theme.onSurface }]}>
                {decodeXmlEntities(currentEpisode?.title || "")}
              </Text>
              <TouchableOpacity onPress={() => setDescriptionVisible(false)} style={styles.navButton}>
                <MaterialIcons name="close" size={24} color={theme.onSurface} />
              </TouchableOpacity>
            </View>
            <ScrollView>
              <Text style={[styles.descriptionFull, { color: theme.onSurfaceVariant }]}>
                {decodeXmlEntities(currentEpisode?.description || "")}
              </Text>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Add to playlist dialog */}
      <Modal
        visible={playlistVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPlaylistVisible(false)}
      >
        <TouchableOpacity
          style={styles.menuBackdrop}
          activeOpacity={1}
          onPress={() => setPlaylistVisible(false)}
        >
          <View style={[styles.menuSheet, { backgroundColor: theme.surfaceContainer }]}>
            <Text style={[styles.menuTitle, { color: theme.onSurface }]}>Add to playlist</Text>
            {playlists.map((playlist) => (
              <TouchableOpacity
                key={playlist.id}
                style={styles.menuRow}
                onPress={() => handleAddToPlaylist(playlist.id)}
              >
                <MaterialIcons name="playlist-play" size={22} color={theme.onSurface} />
                <Text style={[styles.menuText, { color: theme.onSurface }]}>{playlist.name}</Text>
              </TouchableOpacity>
            ))}
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
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 4,
    elevation: 4
  },
  appBarActions: {
    flexDirection: "row",
    alignItems: "center"
  },
  navButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center"
  },
  appBarTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: "600",
    marginHorizontal: 4
  },
  scrollContent: {
    alignItems: "center",
    paddingTop: 16,
    paddingBottom: 16,
    paddingHorizontal: 24
  },
  artworkContainer: {
    marginVertical: 12,
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
  artworkFallback: {
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center"
  },
  showName: {
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 8,
    paddingHorizontal: 16
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
  releaseDate: {
    fontSize: 12,
    textAlign: "center",
    marginTop: 4
  },
  stationSubtitle: {
    fontSize: 13,
    marginTop: 6,
    textAlign: "center"
  },
  descriptionContainer: {
    marginTop: 8,
    paddingHorizontal: 8,
    alignItems: "center"
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center"
  },
  showMore: {
    fontSize: 13,
    fontWeight: "600",
    marginTop: 6,
    padding: 6
  },
  openPodcastButton: {
    marginTop: 14,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20
  },
  openPodcastText: {
    fontSize: 14,
    fontWeight: "600"
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
  progressSection: {
    paddingHorizontal: 16,
    paddingBottom: 4
  },
  progressLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 4,
    marginTop: -6
  },
  progressLabel: {
    fontSize: 11
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
  },
  menuBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.45)"
  },
  menuSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingVertical: 12,
    paddingHorizontal: 8
  },
  menuTitle: {
    fontSize: 16,
    fontWeight: "700",
    paddingHorizontal: 16,
    paddingVertical: 8
  },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 14
  },
  menuText: {
    fontSize: 16
  },
  descriptionSheet: {
    maxHeight: "70%",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16
  },
  descriptionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8
  },
  descriptionTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700"
  },
  descriptionFull: {
    fontSize: 15,
    lineHeight: 22,
    paddingBottom: 24
  }
});
