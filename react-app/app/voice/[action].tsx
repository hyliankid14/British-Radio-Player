import React, { useEffect } from "react";
import { Redirect, useLocalSearchParams } from "expo-router";
import { executeVoiceAction, VoiceActionType } from "../../src/voice/voiceControl.ts";

/**
 * Handles voice control deep links (e.g. bbcradioplayer://voice/play?station=radio1,
 * bbcradioplayer://voice/play?podcast=p086w16s, bbcradioplayer://voice/play?query=radio%204).
 *
 * Siri or Shortcuts launch the app with a voice URL. Expo Router routes the deep link
 * here, preventing the "Unmatched Route" error and immediately redirecting to the
 * main screen while fulfilling the requested voice action.
 */
export default function VoiceActionRoute() {
  const { action, station, podcast, episode, query, random, resume } = useLocalSearchParams<{
    action?: string;
    station?: string;
    podcast?: string;
    episode?: string;
    query?: string;
    random?: string;
    resume?: string;
  }>();

  useEffect(() => {
    const act = (action || "play").toLowerCase();
    const actionType: VoiceActionType = act === "stop" ? "stop" : act === "resume" ? "resume" : "play";

    void executeVoiceAction({
      action: actionType,
      stationId: station ? String(station) : null,
      podcastId: podcast ? String(podcast) : null,
      episodeId: episode ? String(episode) : null,
      query: query ? String(query) : null,
      random: random === "true" || random === "1",
      resume: resume === "true" || resume === "1"
    });
  }, [action, station, podcast, episode, query, random, resume]);

  return <Redirect href="/(tabs)" />;
}
