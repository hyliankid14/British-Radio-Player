import { useCallback, useRef, useState } from "react";
import { Animated, PanResponder, ViewStyle } from "react-native";

import { moveItemToIndex } from "../utils/reorder.ts";

export interface DragRowProps {
  isDragging: boolean;
  panHandlers: ReturnType<typeof PanResponder.create>["panHandlers"] | undefined;
  transform: ViewStyle["transform"];
}

export interface DragReorder {
  /** Id of the row being dragged, or null. Use it to disable list scrolling. */
  draggingId: string | null;
  getRowDrag: (index: number, id: string) => DragRowProps;
}

/**
 * Drag-to-reorder for a fixed-height list, used by the manually sorted lists in
 * favourites. The dragged row follows the finger while the rows it displaces
 * spring aside, and the new order is committed once on release.
 */
export function useDragReorder(params: {
  ids: string[];
  itemHeight: number;
  enabled: boolean;
  onCommit: (orderedIds: string[]) => void;
}): DragReorder {
  const { itemHeight, enabled, onCommit } = params;
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // The pan responders are created once per row per render but fire long after it,
  // so they read the live list and commit callback through refs.
  const idsRef = useRef<string[]>(params.ids);
  idsRef.current = params.ids;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  const panY = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1.0)).current;
  const startIndexRef = useRef(0);
  const targetIndexRef = useRef(0);

  const translations = useRef<Record<string, Animated.Value>>({});
  const getTranslation = useCallback((id: string) => {
    if (!translations.current[id]) {
      translations.current[id] = new Animated.Value(0);
    }
    return translations.current[id];
  }, []);

  const endDrag = useCallback(
    (animateTo: number, animateScale: number, commitTarget: number | null) => {
      const fromIdx = startIndexRef.current;
      const currentIds = idsRef.current;
      Animated.parallel([
        Animated.spring(panY, {
          toValue: animateTo,
          friction: 8,
          tension: 110,
          useNativeDriver: true
        }),
        Animated.spring(scaleAnim, {
          toValue: animateScale,
          friction: 8,
          tension: 110,
          useNativeDriver: true
        })
      ]).start(() => {
        currentIds.forEach((id) => getTranslation(id).setValue(0));
        panY.setValue(0);
        setDraggingId(null);
        if (commitTarget !== null && commitTarget !== fromIdx) {
          onCommitRef.current(moveItemToIndex(currentIds, fromIdx, commitTarget));
        }
      });
    },
    [getTranslation, panY, scaleAnim]
  );

  const getRowDrag = useCallback(
    (index: number, id: string): DragRowProps => {
      const isDragging = draggingId === id;
      if (!enabled) {
        return { isDragging: false, panHandlers: undefined, transform: [{ translateY: getTranslation(id) }] };
      }

      const panHandlers = PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dy) > 4,
        onPanResponderGrant: () => {
          setDraggingId(id);
          startIndexRef.current = index;
          targetIndexRef.current = index;
          panY.setValue(0);
          Animated.spring(scaleAnim, {
            toValue: 1.03,
            friction: 8,
            tension: 110,
            useNativeDriver: true
          }).start();
        },
        onPanResponderMove: (_, gestureState) => {
          panY.setValue(gestureState.dy);

          const fromIdx = startIndexRef.current;
          const currentIds = idsRef.current;
          const target = Math.max(
            0,
            Math.min(currentIds.length - 1, fromIdx + Math.round(gestureState.dy / itemHeight))
          );

          if (target !== targetIndexRef.current) {
            targetIndexRef.current = target;

            currentIds.forEach((otherId, j) => {
              if (otherId === id) return;
              let shift = 0;
              if (target > fromIdx) {
                if (j > fromIdx && j <= target) {
                  shift = -itemHeight;
                }
              } else if (target < fromIdx) {
                if (j >= target && j < fromIdx) {
                  shift = itemHeight;
                }
              }
              Animated.spring(getTranslation(otherId), {
                toValue: shift,
                friction: 9,
                tension: 140,
                useNativeDriver: true
              }).start();
            });
          }
        },
        onPanResponderRelease: () => {
          const fromIdx = startIndexRef.current;
          const finalTarget = targetIndexRef.current;
          endDrag((finalTarget - fromIdx) * itemHeight, 1.0, finalTarget);
        },
        onPanResponderTerminate: () => {
          targetIndexRef.current = startIndexRef.current;
          endDrag(0, 1.0, null);
        }
      }).panHandlers;

      return {
        isDragging,
        panHandlers,
        transform: isDragging
          ? [{ translateY: panY }, { scale: scaleAnim }]
          : [{ translateY: getTranslation(id) }]
      };
    },
    [draggingId, enabled, endDrag, getTranslation, itemHeight, panY, scaleAnim]
  );

  return { draggingId, getRowDrag };
}
