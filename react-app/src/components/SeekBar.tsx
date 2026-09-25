import React, { useEffect, useRef, useState } from "react";
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

function valueFromX(x: number, width: number, maxSeconds: number): number {
  if (width <= 0 || maxSeconds <= 0) return 0;
  return (Math.min(Math.max(x, 0), width) / width) * maxSeconds;
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
  const [dragging, setDragging] = useState(false);
  const [dragValue, setDragValue] = useState(0);

  // All gesture inputs are read from refs so the PanResponder below can be created once.
  // Re-creating panHandlers while a view holds the responder detaches the active gesture,
  // which is what stops the thumb from following the finger mid-scrub.
  const widthRef = useRef(0);
  const originXRef = useRef(0);
  const maxRef = useRef(0);
  const enabledRef = useRef(false);
  const callbacksRef = useRef({ onSeek, onSeekStart, onSeekEnd, onScrubbing });

  useEffect(() => {
    callbacksRef.current = { onSeek, onSeekStart, onSeekEnd, onScrubbing };
  }, [onSeek, onSeekStart, onSeekEnd, onScrubbing]);

  const safeMax = max > 0 ? max : 0;
  maxRef.current = safeMax;
  enabledRef.current = safeMax > 0;

  const ratio = safeMax > 0 ? Math.min(1, Math.max(0, (dragging ? dragValue : value) / safeMax)) : 0;
  // Keeps the 48pt bubble inside the track instead of clipping it off at either end.
  const labelPercent = Math.min(88, Math.max(12, ratio * 100));

  const panResponderRef = useRef<ReturnType<typeof PanResponder.create> | null>(null);
  if (panResponderRef.current === null) {
    panResponderRef.current = PanResponder.create({
      onStartShouldSetPanResponder: () => enabledRef.current,
      // Claim the gesture only once the drag is clearly horizontal, so an ancestor
      // ScrollView can still take over a vertical swipe.
      onMoveShouldSetPanResponder: (_event, gestureState) =>
        enabledRef.current && Math.abs(gestureState.dx) > Math.abs(gestureState.dy),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => {
        if (!enabledRef.current) return;
        // Derived from this event's own pageX/locationX pair, so it shares a coordinate
        // space with gestureState.moveX on both platforms.
        originXRef.current = event.nativeEvent.pageX - event.nativeEvent.locationX;
        const next = valueFromX(event.nativeEvent.locationX, widthRef.current, maxRef.current);
        setDragging(true);
        setDragValue(next);
        callbacksRef.current.onSeekStart?.();
        callbacksRef.current.onScrubbing?.(next);
      },
      onPanResponderMove: (_event, gestureState) => {
        if (!enabledRef.current) return;
        const next = valueFromX(
          gestureState.moveX - originXRef.current,
          widthRef.current,
          maxRef.current
        );
        setDragValue(next);
        callbacksRef.current.onScrubbing?.(next);
      },
      onPanResponderRelease: (_event, gestureState) => {
        if (!enabledRef.current) return;
        const next = valueFromX(
          gestureState.moveX - originXRef.current,
          widthRef.current,
          maxRef.current
        );
        setDragging(false);
        callbacksRef.current.onSeek(next);
        callbacksRef.current.onSeekEnd?.();
      },
      onPanResponderTerminate: (_event, gestureState) => {
        if (!enabledRef.current) return;
        const next = valueFromX(
          gestureState.moveX - originXRef.current,
          widthRef.current,
          maxRef.current
        );
        setDragging(false);
        callbacksRef.current.onSeek(next);
        callbacksRef.current.onSeekEnd?.();
      }
    });
  }

  return (
    <View style={styles.container}>
      {dragging ? (
        <View
          style={[
            styles.label,
            { backgroundColor: labelBackground, left: `${labelPercent}%` }
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
        {...panResponderRef.current.panHandlers}
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
