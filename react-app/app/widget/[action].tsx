import React, { useEffect } from "react";
import { Redirect, useLocalSearchParams } from "expo-router";
import { StationRepository } from "../../src/data/stations";
import { usePlayerStore } from "../../src/store/playerStore";

/**
 * Handles widget deep links (e.g. bbcradioplayer://widget/play?station=radio1).
 *
 * Tapping a widget opens the app with a widget URL. Expo Router routes the deep link
 * here, preventing the "Unmatched Route" error and immediately redirecting to the
 * main player screen while ensuring the requested station action is fulfilled.
 */
export default function WidgetActionRoute() {
  const { action, station } = useLocalSearchParams<{ action?: string; station?: string }>();

  useEffect(() => {
    if (action === "stop") {
      void usePlayerStore.getState().stop();
      return;
    }
    if (action === "play") {
      const stationId = station ? String(station) : undefined;
      const targetStation = stationId
        ? StationRepository.getById(stationId)
        : (usePlayerStore.getState().currentStation ?? StationRepository.getAll()[0]);
      if (targetStation) {
        const state = usePlayerStore.getState();
        if (!state.isPlaying || state.currentStation?.id !== targetStation.id) {
          void state.playStation(targetStation);
        }
      }
    }
  }, [action, station]);

  return <Redirect href="/(tabs)" />;
}
