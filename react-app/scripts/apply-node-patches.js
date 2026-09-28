#!/usr/bin/env node
/**
 * Applies local fixes to third-party packages that have not shipped a release
 * compatible with the pinned React Native version yet.
 *
 * Each patch is idempotent: applying it twice is a no-op, and an upstream source
 * that no longer matches throws rather than being silently skipped, so a
 * dependency bump cannot quietly drop a required fix. Run automatically via the
 * "postinstall" script in package.json.
 */
const fs = require("node:fs");
const path = require("node:path");

const PATCHES = [
  {
    package: "react-native-track-player",
    file: "android/src/main/java/com/doublesymmetry/trackplayer/module/MusicModule.kt",
    reason:
      "React Native 0.86 requires a non-null Bundle in Arguments.fromBundle(), but Track.originalItem is Bundle?",
    replacements: [
      {
        from: "Arguments.fromBundle(musicService.tracks[index].originalItem)",
        to: "Arguments.fromBundle(musicService.tracks[index].originalItem ?: Bundle())"
      },
      {
        from:
          "musicService.tracks[musicService.getCurrentTrackIndex()].originalItem\n            )",
        to:
          "musicService.tracks[musicService.getCurrentTrackIndex()].originalItem ?: Bundle()\n            )"
      }
    ]
  },
  {
    package: "react-native-track-player",
    file: "android/src/main/java/com/doublesymmetry/trackplayer/module/MusicModule.kt",
    reason:
      "React Native 0.86's TurboModule interop throws 'returnType == void iff the method is " +
      "synchronous' on any @ReactMethod whose JVM signature is not void; Kotlin infers Job " +
      "from the `= scope.launch { }` body, so 37 methods crash the app at launch",
    replacements: [
      {
        from: "import kotlinx.coroutines.MainScope",
        to: "import kotlinx.coroutines.CoroutineScope\nimport kotlinx.coroutines.MainScope"
      },
      {
        from: "    private val scope = MainScope()",
        to:
          "    private val scope = MainScope()\n" +
          "    /**\n" +
          "     * React Native's TurboModule interop requires a void JVM signature on every\n" +
          "     * @ReactMethod, but Kotlin infers Job from an `= scope.launch { }` body. This\n" +
          "     * wrapper keeps the fire-and-forget coroutine -- and the `return@launch` labels\n" +
          "     * used inside it -- while giving the enclosing function a Unit return type.\n" +
          "     */\n" +
          "    private fun launch(block: suspend CoroutineScope.() -> Unit) {\n" +
          "        scope.launch(block = block)\n" +
          "    }"
      },
      {
        from: "callback: Promise) = scope.launch {",
        to: "callback: Promise) = launch {"
      },
      {
        from: "callback: Promise) =\n        scope.launch {",
        to: "callback: Promise) =\n        launch {"
      }
    ]
  },
  {
    package: "react-native-track-player",
    file: "android/src/main/java/com/doublesymmetry/trackplayer/service/MusicService.kt",
    reason:
      "MusicService extends HeadlessJsTaskService and emits events through reactNativeHost, " +
      "which React Native 0.86 forbids in the New Architecture ('You should not use " +
      "ReactNativeHost directly in the New Architecture') -- this killed the app on the first " +
      "playback-state event",
    replacements: [
      {
        from:
          "import com.facebook.react.HeadlessJsTaskService\n" +
          "import com.facebook.react.bridge.Arguments\n",
        to:
          "import com.facebook.react.HeadlessJsTaskService\n" +
          "import com.facebook.react.ReactApplication\n" +
          "import com.facebook.react.bridge.Arguments\n" +
          "import com.facebook.react.bridge.ReactContext\n"
      },
      {
        from:
          "    @MainThread\n" +
          "    private fun emit(event: String, data: Bundle? = null) {\n" +
          "        reactNativeHost.reactInstanceManager.currentReactContext\n" +
          "            ?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)\n" +
          "            ?.emit(event, data?.let { Arguments.fromBundle(it) })\n" +
          "    }",
        to:
          "    /**\n" +
          "     * The New Architecture throws from HeadlessJsTaskService.getReactNativeHost(), so\n" +
          "     * the ReactContext is reached through the application's ReactHost instead.\n" +
          "     */\n" +
          "    private fun currentReactContext(): ReactContext? =\n" +
          "        (application as? ReactApplication)?.reactHost?.currentReactContext\n" +
          "\n" +
          "    @MainThread\n" +
          "    private fun emit(event: String, data: Bundle? = null) {\n" +
          "        currentReactContext()?.emitDeviceEvent(event, data?.let { Arguments.fromBundle(it) })\n" +
          "    }"
      },
      {
        from:
          "    @MainThread\n" +
          "    private fun emitList(event: String, data: List<Bundle> = emptyList()) {\n" +
          "        val payload = Arguments.createArray()\n" +
          "        data.forEach { payload.pushMap(Arguments.fromBundle(it)) }\n" +
          "\n" +
          "        reactNativeHost.reactInstanceManager.currentReactContext\n" +
          "            ?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)\n" +
          "            ?.emit(event, payload)\n" +
          "    }",
        to:
          "    @MainThread\n" +
          "    private fun emitList(event: String, data: List<Bundle> = emptyList()) {\n" +
          "        val payload = Arguments.createArray()\n" +
          "        data.forEach { payload.pushMap(Arguments.fromBundle(it)) }\n" +
          "\n" +
          "        currentReactContext()?.emitDeviceEvent(event, payload)\n" +
          "    }"
      },
      {
        from:
          "        val notification = notificationBuilder.build()\n" +
          "        startForeground(EMPTY_NOTIFICATION_ID, notification)\n" +
          "        @Suppress(\"DEPRECATION\")\n" +
          "        stopForeground(true)",
        to:
          "        val notification = notificationBuilder.build()\n" +
          "        try {\n" +
          "            startForeground(EMPTY_NOTIFICATION_ID, notification)\n" +
          "            @Suppress(\"DEPRECATION\")\n" +
          "            stopForeground(true)\n" +
          "        } catch (exception: Exception) {\n" +
          "            // This is only an ANR workaround. Android 12+ throws\n" +
          "            // ForegroundServiceStartNotAllowedException when the service was started from\n" +
          "            // the background, and that must never take the app down.\n" +
          "            Timber.w(exception, \"Could not show the temporary foreground notification\")\n" +
          "        }"
      }
    ]
  }
];

for (const patch of PATCHES) {
  const target = path.join(__dirname, "..", "node_modules", patch.package, patch.file);
  if (!fs.existsSync(target)) {
    console.warn(`[patch] skipped ${patch.package}: ${patch.file} not found`);
    continue;
  }

  let source = fs.readFileSync(target, "utf8");
  let dirty = false;

  for (const { from, to } of patch.replacements) {
    if (source.includes(to)) continue;
    if (!source.includes(from)) {
      throw new Error(
        `[patch] ${patch.package}: expected source not found, upstream has changed:\n${from}`
      );
    }
    source = source.split(from).join(to);
    dirty = true;
  }

  if (dirty) {
    fs.writeFileSync(target, source);
    console.log(`[patch] applied ${patch.package} — ${patch.reason}`);
  }
}
