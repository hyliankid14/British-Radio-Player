import TrackPlayer, { Event, State, Capability } from "react-native-track-player";
import { usePlayerStore } from "../store/playerStore";

export async function playbackService(): Promise<void> {
  TrackPlayer.addEventListener(Event.RemotePlay, () => {
    TrackPlayer.play();
  });

  TrackPlayer.addEventListener(Event.RemotePause, () => {
    TrackPlayer.pause();
  });

  TrackPlayer.addEventListener(Event.RemoteStop, () => {
    usePlayerStore.getState().stop();
  });

  TrackPlayer.addEventListener(Event.RemoteSeek, (event) => {
    TrackPlayer.seekTo(event.position);
  });

  TrackPlayer.addEventListener(Event.RemoteDuck, async (event) => {
    if (event.paused || event.permanent) {
      await TrackPlayer.pause();
    } else {
      await TrackPlayer.play();
    }
  });

  // Persist resume positions and drive "played" / autoplay-next behaviour. These run in
  // the headless playback service so they keep working with the app backgrounded.
  TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, (event) => {
    usePlayerStore.getState().handleEpisodeProgress(event.position, event.duration);
  });

  TrackPlayer.addEventListener(Event.PlaybackQueueEnded, () => {
    void usePlayerStore.getState().handleEpisodeEnded();
  });
}

let isSetup = false;

export async function setupPlayer(): Promise<boolean> {
  if (isSetup) return true;

  try {
    await TrackPlayer.setupPlayer({
      autoHandleInterruptions: true,
      iosCategory: "playback" as any,
      iosCategoryMode: "default" as any,
      iosCategoryOptions: [
        "allowBluetooth",
        "allowBluetoothA2DP",
        "allowAirPlay",
        "defaultToSpeaker"
      ] as any
    });

    await TrackPlayer.updateOptions({
      capabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.Stop,
        Capability.SeekTo
      ],
      compactCapabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.Stop
      ],
      notificationCapabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.Stop
      ],
      progressUpdateEventInterval: 5
    });

    isSetup = true;
    return true;
  } catch (error) {
    // If player is already setup, error message indicates it
    if ((error as Error)?.message?.includes("already initialized")) {
      isSetup = true;
      return true;
    }
    console.warn("TrackPlayer setup error:", error);
    return false;
  }
}
