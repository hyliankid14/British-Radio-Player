import React, { useCallback, useMemo, useRef, useState } from "react";
import { PanResponder, StyleSheet, Text, View } from "react-native";

export interface SeekBarProps {
  value: number;
  max: number;
  onSeek: (seconds: number) => void;
  onSeekStart?: () => void;
  onSeekEnd?: () => void;
  onScrubbing?: (seconds: number) => void;
  activeColor?: string;
  trackColor?: string;
  labelColor?: string;
  labelBackground?: string;
}

function formatClock(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Material 3 style scrubber with a draggable thumb and floating time label.
 * Used by the unified Now Playing screen for podcast playback.
 */
export function SeekBar({
  value,
  max,
  onSeek,
  onSeekStart,
  onSeekEnd,
  onScrubbing,
  activeColor = "#6200EE",
  trackColor = "#CAC4D0",
  labelColor = "#FFFFFF",
  labelBackground = "#49454F"
}: SeekBarProps) {
  const widthRef = useRef(0);
  const startXRef = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [dragValue, setDragValue] = useState(0);

  const safeMax = max > 0 ? max : 0;
  const ratio = safeMax > 0 ? Math.min(1, Math.max(0, (dragging ? dragValue : value) / safeMax)) : 0;

  const valueFromX = useCallback(
    (x: number) => {
      const width = widthRef.current;
      if (width <= 0 || safeMax <= 0) return 0;
      const clamped = Math.min(Math.max(x, 0), width);
      return (clamped / width) * safeMax;
    },
    [safeMax]
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => safeMax > 0,
        onMoveShouldSetPanResponder: () => safeMax > 0,
        onPanResponderGrant: (event) => {
          const width = widthRef.current;
          const locX = event.nativeEvent.locationX;
          const clampedX = width > 0 ? Math.min(Math.max(locX, 0), width) : locX;
          startXRef.current = clampedX;
          const next = valueFromX(clampedX);
          setDragging(true);
          setDragValue(next);
          onSeekStart?.();
          onScrubbing?.(next);
        },
        onPanResponderMove: (_event, gestureState) => {
          const width = widthRef.current;
          const currentX =
            width > 0
              ? Math.min(Math.max(startXRef.current + gestureState.dx, 0), width)
              : startXRef.current + gestureState.dx;
          const next = valueFromX(currentX);
          setDragValue(next);
          onScrubbing?.(next);
        },
        onPanResponderRelease: (_event, gestureState) => {
          const width = widthRef.current;
          const currentX =
            width > 0
              ? Math.min(Math.max(startXRef.current + gestureState.dx, 0), width)
              : startXRef.current + gestureState.dx;
          const next = valueFromX(currentX);
          setDragging(false);
          onSeek(next);
          onSeekEnd?.();
        },
        onPanResponderTerminate: () => {
          setDragging(false);
          onSeekEnd?.();
        }
      }),
    [onSeek, onSeekEnd, onSeekStart, onScrubbing, safeMax, valueFromX]
  );

  return (
    <View style={styles.container}>
      {dragging ? (
        <View
          style={[
            styles.label,
            { backgroundColor: labelBackground, left: `${ratio * 100}%` }
          ]}
          pointerEvents="none"
        >
          <Text style={[styles.labelText, { color: labelColor }]}>
            {formatClock(dragValue)}
          </Text>
        </View>
      ) : null}
      <View
        style={styles.touchArea}
        onLayout={(event) => {
          widthRef.current = event.nativeEvent.layout.width;
        }}
        {...panResponder.panHandlers}
      >
        <View pointerEvents="none" style={[styles.track, { backgroundColor: trackColor }]} />
        <View
          pointerEvents="none"
          style={[
            styles.activeTrack,
            { backgroundColor: activeColor, width: `${ratio * 100}%` }
          ]}
        />
        <View
          pointerEvents="none"
          style={[
            styles.thumb,
            { backgroundColor: activeColor, left: `${ratio * 100}%` }
          ]}
        />
      </View>
    </View>
  );
}

const THUMB_SIZE = 14;

const styles = StyleSheet.create({
  container: {
    width: "100%",
    height: 44,
    justifyContent: "center"
  },
  touchArea: {
    height: 44,
    justifyContent: "center"
  },
  track: {
    height: 4,
    borderRadius: 2,
    width: "100%"
  },
  activeTrack: {
    position: "absolute",
    height: 4,
    borderRadius: 2,
    left: 0
  },
  thumb: {
    position: "absolute",
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    marginLeft: -THUMB_SIZE / 2
  },
  label: {
    position: "absolute",
    top: -18,
    marginLeft: -24,
    width: 48,
    paddingVertical: 4,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10
  },
  labelText: {
    fontSize: 12,
    fontWeight: "600"
  }
});
