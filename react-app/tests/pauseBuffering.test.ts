import test from "node:test";
import assert from "node:assert/strict";

test("Pause buffering preference semantics", () => {
  const PREF_KEY = "pref_pause_buffering";
  const storage = new Map<string, boolean>();

  const getSetting = (key: string, fallback: boolean) => {
    return storage.has(key) ? storage.get(key)! : fallback;
  };

  const setSetting = (key: string, value: boolean) => {
    storage.set(key, value);
  };

  // Default is true (buffering enabled)
  assert.equal(getSetting(PREF_KEY, true), true);

  // Turned off
  setSetting(PREF_KEY, false);
  assert.equal(getSetting(PREF_KEY, true), false);

  // Turned on
  setSetting(PREF_KEY, true);
  assert.equal(getSetting(PREF_KEY, true), true);
});

test("Playback resume semantics with pause buffering toggled", () => {
  interface ResumeDecision {
    action: "restart_live_edge" | "play_buffer" | "resume_episode";
  }

  function resolveResumeAction(
    kind: "station" | "episode",
    pauseBufferingEnabled: boolean,
    isPlayerIdle: boolean
  ): ResumeDecision {
    if (kind === "station") {
      // If pause buffering is disabled or player was stopped (STATE_IDLE), resume at live edge
      if (!pauseBufferingEnabled || isPlayerIdle) {
        return { action: "restart_live_edge" };
      }
      return { action: "play_buffer" };
    }
    // Episodes always resume saved position
    return { action: "resume_episode" };
  }

  // 1. Live radio, pause buffering OFF -> restarts at live position
  assert.deepEqual(
    resolveResumeAction("station", false, false),
    { action: "restart_live_edge" }
  );

  // 2. Live radio, pause buffering OFF, player was stopped -> restarts at live position
  assert.deepEqual(
    resolveResumeAction("station", false, true),
    { action: "restart_live_edge" }
  );

  // 3. Live radio, pause buffering ON, player paused -> plays buffer
  assert.deepEqual(
    resolveResumeAction("station", true, false),
    { action: "play_buffer" }
  );

  // 4. Live radio, pause buffering ON, but player was idle/stopped -> recovers via live candidate
  assert.deepEqual(
    resolveResumeAction("station", true, true),
    { action: "restart_live_edge" }
  );

  // 5. Podcast episode, pause buffering OFF -> resumes episode progress
  assert.deepEqual(
    resolveResumeAction("episode", false, false),
    { action: "resume_episode" }
  );

  // 6. Podcast episode, pause buffering ON -> resumes episode progress
  assert.deepEqual(
    resolveResumeAction("episode", true, false),
    { action: "resume_episode" }
  );
});

test("Audio focus interruption semantics for Android Auto", () => {
  type FocusLossAction = "stop_prevent_buffering" | "pause_buffer";

  function resolveTransientFocusLossAction(
    kind: "station" | "episode",
    pauseBufferingEnabled: boolean
  ): FocusLossAction {
    if (kind === "station" && !pauseBufferingEnabled) {
      return "stop_prevent_buffering";
    }
    return "pause_buffer";
  }

  // Phone call / transient loss while listening to station with pause buffering OFF:
  // Must stop player immediately to prevent background buffering
  assert.equal(resolveTransientFocusLossAction("station", false), "stop_prevent_buffering");

  // Phone call / transient loss with pause buffering ON:
  // Pauses and allows buffer
  assert.equal(resolveTransientFocusLossAction("station", true), "pause_buffer");

  // Podcast episode:
  // Always pauses and saves progress
  assert.equal(resolveTransientFocusLossAction("episode", false), "pause_buffer");
});
