import React from "react";
import { StyleSheet, Text, View, StyleProp, ViewStyle, TextStyle } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import {
  computeEpisodePlaybackStatus,
  EPISODE_CHECK_GREEN,
  EPISODE_TILDE_AMBER
} from "../podcasts/episodePlaybackStatus";

export { EPISODE_CHECK_GREEN, EPISODE_TILDE_AMBER };

export interface EpisodePlaybackIndicatorProps {
  isPlayed: boolean;
  durationMins: number;
  progressSeconds: number;
  style?: StyleProp<ViewStyle | TextStyle>;
  testID?: string;
}

/**
 * Replicates the played / in-progress indicator from the archived Kotlin app.
 *
 * - Marked played: green checkmark (\u2713 / check icon, #4CAF50)
 * - In progress (progress > 0 and < 95%): amber/coral tilde (~, #FF5252)
 * - Otherwise: hidden
 */
export const EpisodePlaybackIndicator = React.memo(function EpisodePlaybackIndicator({
  isPlayed,
  durationMins,
  progressSeconds,
  style,
  testID
}: EpisodePlaybackIndicatorProps) {
  const status = computeEpisodePlaybackStatus(isPlayed, durationMins, progressSeconds);

  if (status.isPlayed) {
    return (
      <MaterialIcons
        name="check"
        size={16}
        color={EPISODE_CHECK_GREEN}
        style={[styles.statusIcon, style as StyleProp<TextStyle>]}
        accessibilityLabel="Played status: played"
        testID={testID ? `${testID}-played` : "episode-played-indicator"}
      />
    );
  }

  if (status.isInProgress) {
    return (
      <Text
        style={[styles.statusTilde, style as StyleProp<TextStyle>]}
        accessibilityLabel="Played status: in progress"
        testID={testID ? `${testID}-in-progress` : "episode-in-progress-indicator"}
      >
        ~
      </Text>
    );
  }

  return null;
});

export interface EpisodeProgressBarProps {
  progressPercent: number;
  trackColor: string;
  fillColor: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Horizontal progress indicator bar for podcast episode list items,
 * matching LinearProgressIndicator in item_episode.xml.
 */
export const EpisodeProgressBar = React.memo(function EpisodeProgressBar({
  progressPercent,
  trackColor,
  fillColor,
  style,
  testID
}: EpisodeProgressBarProps) {
  if (progressPercent <= 0) return null;

  return (
    <View
      style={[styles.progressBarTrack, { backgroundColor: trackColor }, style]}
      testID={testID || "episode-progress-bar"}
      accessibilityLabel={`Playback progress: ${progressPercent}%`}
    >
      <View
        style={[
          styles.progressBarFill,
          { width: `${progressPercent}%`, backgroundColor: fillColor }
        ]}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  statusIcon: {
    marginLeft: 6
  },
  statusTilde: {
    marginLeft: 6,
    color: EPISODE_TILDE_AMBER,
    fontSize: 16,
    fontWeight: "bold",
    lineHeight: 16,
    includeFontPadding: false
  },
  progressBarTrack: {
    height: 4,
    borderRadius: 2,
    width: "100%",
    marginTop: 6,
    overflow: "hidden"
  },
  progressBarFill: {
    height: "100%",
    borderRadius: 2
  }
});
