package com.hyliankid14.bbcradioplayer.nativeandroid

import android.content.Context
import android.content.Intent
import com.hyliankid14.bbcradioplayer.nativeandroid.widget.WidgetStore
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Native Android helpers for the React application.
 *
 * Currently exposes the one-time migration of preferences from the legacy Kotlin build so
 * that existing users keep their favourites, subscriptions, playlists, history and settings
 * after an in-place update.
 */
class NativeAndroidModule : Module() {

  private val context: Context?
    get() = appContext.reactContext?.applicationContext

  private var shakeDetector: ShakeDetector? = null

  override fun definition() = ModuleDefinition {
    Name("NativeAndroid")

    Events("onShake", "onWearState", "onNotificationOpen", "onAlarmLaunch", "onWidgetAction")

    OnCreate {
      instance = this@NativeAndroidModule
    }

    OnNewIntent { intent ->
      onNewIntent(intent)
    }

    OnDestroy {
      if (instance === this@NativeAndroidModule) instance = null
    }

    /** True when the legacy Kotlin app left preference data behind on this device. */
    Function("hasLegacyData") { ->
      val ctx = context ?: return@Function false
      LegacyMigration.hasLegacyData(ctx)
    }

    /**
     * Returns the legacy preferences converted into the React MMKV key/value shape, as a
     * JSON object string. Returns "{}" when nothing is available.
     */
    Function("readLegacyPreferences") { ->
      val ctx = context ?: return@Function "{}"
      LegacyMigration.readLegacyPreferences(ctx).toString()
    }

    /** The MMKV key that marks the migration as complete. */
    Function("migrationFlagKey") { ->
      LegacyMigration.MIGRATION_FLAG_KEY
    }

    /** Returns whether analytics was enabled in the legacy Kotlin app's SharedPreferences. */
    Function("getLegacyAnalyticsEnabled") { ->
      val ctx = context ?: return@Function false
      ctx.getSharedPreferences("privacy_analytics", Context.MODE_PRIVATE)
        .getBoolean("analytics_enabled", false)
    }

    /** Syncs the analytics enabled state into native SharedPreferences so native services can read it. */
    Function("setNativeAnalyticsEnabled") { enabled: Boolean ->
      val ctx = context ?: return@Function null
      ctx.getSharedPreferences("privacy_analytics", Context.MODE_PRIVATE)
        .edit()
        .putBoolean("analytics_enabled", enabled)
        .apply()
      null
    }

    /** Saves the last 5 scrobbled tracks to persistent storage (survives reinstalls). */
    Function("savePersistentScrobbles") { json: String ->
      val ctx = context ?: return@Function null
      PersistentScrobbleStore.save(ctx, json)
      null
    }

    /** Reads persistent scrobbled tracks from persistent storage (survives reinstalls). */
    Function("readPersistentScrobbles") { ->
      val ctx = context ?: return@Function null
      PersistentScrobbleStore.read(ctx)
    }

    /**
     * Extracts the adaptive Now Playing palette from artwork, mirroring the Kotlin
     * `Palette.from(bitmap)` behaviour. Returns "{}" when the image cannot be loaded.
     */
    AsyncFunction("extractPalette") { imageUrl: String, isDarkMode: Boolean ->
      PaletteExtractor.extract(imageUrl, isDarkMode).toString()
    }

    /** True when any active network uses the VPN transport, mirroring the Kotlin VPN check. */
    Function("isVpnActive") { ->
      val ctx = context ?: return@Function false
      try {
        val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as? android.net.ConnectivityManager
          ?: return@Function false
        cm.allNetworks.any { network ->
          val capabilities = cm.getNetworkCapabilities(network) ?: return@any false
          capabilities.hasTransport(android.net.NetworkCapabilities.TRANSPORT_VPN)
        }
      } catch (_: Exception) {
        false
      }
    }

    /** Begins accelerometer shake detection, emitting `onShake` events. */
    Function("startShakeDetection") { ->
      val ctx = context ?: return@Function null
      if (shakeDetector == null) {
        shakeDetector = ShakeDetector(ctx) {
          try {
            sendEvent("onShake")
          } catch (_: Exception) {
          }
        }
      }
      shakeDetector?.start()
    }

    /** Stops accelerometer shake detection. */
    Function("stopShakeDetection") { ->
      shakeDetector?.stop()
    }

    OnDestroy {
      shakeDetector?.stop()
      shakeDetector = null
    }

    // ── Radio alarm ─────────────────────────────────────────────────────────

    /** Schedules (or reschedules) the exact radio alarm. */
    Function("scheduleAlarm") { hour: Int, minute: Int, daysMask: Int, stationId: String?, stationName: String?, streamUrl: String?, ramp: Boolean, volume: Int ->
      val ctx = context ?: return@Function null
      AlarmScheduler.schedule(ctx, hour, minute, daysMask, stationId, stationName, streamUrl, ramp, volume)
      null
    }

    /** Stops any in-progress native alarm playback (e.g. when the app takes over). */
    Function("stopAlarmPlayback") { ->
      context?.let { AlarmPlaybackService.stop(it) }
      null
    }

    /** Cancels any pending radio alarm. */
    Function("cancelAlarm") { ->
      context?.let { AlarmScheduler.cancel(it) }
      null
    }

    /** True when the OS permits exact alarms (Android 12+). */
    Function("canScheduleExactAlarms") { ->
      val ctx = context ?: return@Function true
      if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.S) true
      else {
        val manager = ctx.getSystemService(Context.ALARM_SERVICE) as? android.app.AlarmManager
        manager?.canScheduleExactAlarms() ?: false
      }
    }

    /** Requests the runtime POST_NOTIFICATIONS permission. */
    Function("requestNotificationPermission") { ->
      val activity = appContext.currentActivity ?: return@Function false
      if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.TIRAMISU) return@Function true
      if (activity.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) ==
        android.content.pm.PackageManager.PERMISSION_GRANTED
      ) {
        return@Function true
      }
      activity.runOnUiThread {
        androidx.core.app.ActivityCompat.requestPermissions(
          activity,
          arrayOf(android.Manifest.permission.POST_NOTIFICATIONS),
          9201
        )
      }
      false
    }

    /** Cancels any active alarm notification and ringtone. */
    Function("cancelAlarmNotification") { ->
      val ctx = context ?: return@Function null
      AlarmNotifier.cancel(ctx)
      null
    }

    /**
     * When the app was launched by the alarm notification, returns the requested station id;
     * otherwise null. Consumed once so playback only starts on the alarm launch.
     */
    Function("consumeAlarmLaunch") { ->
      val pending = pendingAlarmLaunch
      if (pending != null) {
        pendingAlarmLaunch = null
        context?.let { AlarmNotifier.cancel(it) }
        return@Function pending
      }
      val activity = appContext.currentActivity ?: return@Function null
      val intent = activity.intent ?: return@Function null
      val stationId = intent.getStringExtra(AlarmScheduler.EXTRA_STATION_ID)
      if (stationId == null && !intent.hasExtra(AlarmScheduler.EXTRA_RAMP)) return@Function null
      val ramp = intent.getBooleanExtra(AlarmScheduler.EXTRA_RAMP, true)
      val volume = intent.getIntExtra(AlarmScheduler.EXTRA_VOLUME, 5)
      intent.removeExtra(AlarmScheduler.EXTRA_STATION_ID)
      intent.removeExtra(AlarmScheduler.EXTRA_RAMP)
      intent.removeExtra(AlarmScheduler.EXTRA_VOLUME)
      context?.let { AlarmNotifier.cancel(it) }
      val result = org.json.JSONObject().apply {
        put("stationId", stationId ?: org.json.JSONObject.NULL)
        put("ramp", ramp)
        put("volume", volume)
      }
      result.toString()
    }

    // ── In-app updater ──────────────────────────────────────────────────────

    /** Checks GitHub releases for a newer APK, returning a JSON string (or "{}"). */
    AsyncFunction("checkForUpdate") { currentVersion: String ->
      AppUpdater.checkForUpdate(currentVersion).toString()
    }

    /** Downloads the update APK and opens the system installer when complete. */
    Function("downloadAndInstallUpdate") { apkUrl: String, apkName: String ->
      val ctx = context ?: return@Function null
      AppUpdater.downloadAndInstall(ctx, apkUrl, apkName)
      null
    }

    // ── Home screen widget ──────────────────────────────────────────────────

    /**
     * Stores the station catalogue the widget's station picker offers, as
     * `{"stations":[{"id","title","category"}]}`. The React layer owns the list so the
     * picker cannot drift from the stations the app actually plays.
     */
    Function("setWidgetCatalogue") { stationsJson: String ->
      val ctx = context ?: return@Function null
      WidgetStore.saveCatalogue(ctx, stationsJson)
      null
    }

    /**
     * Renders and caches the custom station ident as a PNG file in internal storage,
     * returning the content:// URI for use in media notifications and SystemUI.
     */
    Function("getStationIdentUri") { stationId: String ->
      val ctx = context ?: return@Function null
      try {
        val sanitizedId = stationId.replace(Regex("[^a-zA-Z0-9_-]"), "")
        if (sanitizedId.isEmpty()) return@Function null
        val dir = java.io.File(ctx.filesDir, "idents")
        if (!dir.exists()) dir.mkdirs()
        val file = java.io.File(dir, "$sanitizedId.png")
        if (!file.exists()) {
          val bitmap = com.hyliankid14.bbcradioplayer.nativeandroid.widget.StationArtwork.createBitmap(sanitizedId, 512)
          val tempFile = java.io.File(dir, "$sanitizedId.tmp")
          java.io.FileOutputStream(tempFile).use { out ->
            bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, out)
          }
          if (!tempFile.renameTo(file)) {
            tempFile.copyTo(file, overwrite = true)
            tempFile.delete()
          }
        }
        "content://${ctx.packageName}.stationident/$sanitizedId.png"
      } catch (_: Exception) {
        null
      }
    }

    /** Pushes what the player is doing, so the widget for that station can show it. */
    Function("updateWidgetState") {
        stationId: String, stationTitle: String, showLine: String, isPlaying: Boolean, artworkUrl: String ->
      val ctx = context ?: return@Function null
      StationWidgetProvider.updateState(ctx, stationId, stationTitle, showLine, isPlaying, artworkUrl)
      null
    }

    /**
     * Returns the tap the user made on a widget as `{"action","stationId"}` and clears it,
     * or an empty string when the app was not opened by a widget.
     */
    Function("consumeWidgetAction") { ->
      val ctx = context ?: return@Function ""
      WidgetStore.consumeAction(ctx) ?: ""
    }

    /** Returns the deep link or target URL when launched from a notification intent, else null. */
    Function("consumeNotificationLaunch") { ->
      val pending = pendingNotificationUrl
      if (pending != null) {
        pendingNotificationUrl = null
        return@Function pending
      }
      val activity = appContext.currentActivity ?: return@Function null
      val intent = activity.intent ?: return@Function null
      extractUrlFromIntent(intent)
    }

    // ── Wear OS sync ────────────────────────────────────────────────────────

    /** Pushes phone state to the Wear OS companion. */
    Function("pushWearState") { payloadJson: String ->
      val ctx = context ?: return@Function null
      WearSync.pushState(ctx, payloadJson)
      null
    }

    OnStartObserving {
      WearSyncRelay.onStateReceived = { json ->
        try {
          sendEvent("onWearState", mapOf("payload" to json))
        } catch (_: Exception) {
        }
      }
    }

    OnStopObserving {
      WearSyncRelay.onStateReceived = null
    }

    // ── Background sync ─────────────────────────────────────────────────────

    /** Stores the subscription snapshot used by the background worker. */
    Function("syncBackgroundSubscriptions") { subscriptionsJson: String ->
      val ctx = context ?: return@Function null
      BackgroundSync.syncSubscriptions(ctx, subscriptionsJson)
      null
    }

    /** Schedules (or cancels, when intervalMinutes is 0) the periodic new-episode check. */
    Function("scheduleBackgroundSync") { intervalMinutes: Int, wifiOnly: Boolean ->
      val ctx = context ?: return@Function null
      BackgroundSync.schedule(ctx, intervalMinutes, wifiOnly)
      null
    }

    /** Returns episode IDs already notified by the native background worker. */
    Function("getBackgroundNotifiedEpisodeIds") { ->
      val ctx = context ?: return@Function emptyList<String>()
      BackgroundSync.getNotifiedEpisodeIds(ctx)
    }

    /** Marks an episode as notified so the background worker will not duplicate it. */
    Function("markBackgroundEpisodeNotified") { episodeId: String ->
      val ctx = context ?: return@Function null
      BackgroundSync.markNotified(ctx, episodeId)
      null
    }

    // ── Podcast downloads ───────────────────────────────────────────────────

    /** Absolute path of the public Podcasts folder used for downloads. */
    Function("getDownloadsFolderPath") { ->
      PodcastDownloads.folderPath()
    }

    /** Copies a downloaded temp file into the public Podcasts folder; returns its URI. */
    AsyncFunction("publishDownload") { sourceUri: String, fileName: String, title: String ->
      val ctx = context ?: return@AsyncFunction null
      PodcastDownloads.publish(ctx, sourceUri, fileName, title)
    }

    /** Deletes a published episode by URI. */
    Function("deleteDownload") { uri: String ->
      val ctx = context ?: return@Function false
      PodcastDownloads.delete(ctx, uri)
    }

    /** Deletes every episode in the app's public Podcasts folder; returns the count. */
    Function("clearDownloads") { ->
      val ctx = context ?: return@Function 0
      PodcastDownloads.clearAll(ctx)
    }

    /** Opens the public Podcasts downloads folder in the system file manager. */
    Function("openDownloadsFolder") { ->
      val ctx = context ?: return@Function false
      PodcastDownloads.openFolder(ctx)
    }

    /** Broadcasts track playback state to third-party Android scrobbler apps (SLS, Scrobble Droid, Last.fm). */
    Function("broadcastScrobble") { state: Int, artist: String, track: String, album: String, durationSec: Int ->
      val ctx = context ?: return@Function null
      ScrobbleBroadcast.broadcast(ctx, state, artist, track, album, durationSec)
      null
    }
  }

  companion object {
    @Volatile
    private var instance: NativeAndroidModule? = null
    @Volatile
    private var pendingNotificationUrl: String? = null
    @Volatile
    private var pendingAlarmLaunch: String? = null

    fun dispatchWidgetAction(action: String, stationId: String?) {
      val mod = instance ?: return
      val actionJson = org.json.JSONObject().apply {
        put("action", action)
        put("stationId", stationId ?: org.json.JSONObject.NULL)
      }.toString()
      try {
        mod.sendEvent("onWidgetAction", mapOf("action" to actionJson))
      } catch (_: Exception) {
      }
    }

    fun onNewIntent(intent: Intent) {
      val url = extractUrlFromIntent(intent)
      if (url != null) {
        pendingNotificationUrl = url
        val mod = instance
        if (mod != null) {
          try {
            mod.sendEvent("onNotificationOpen", mapOf("url" to url))
          } catch (_: Exception) {
          }
        }
      }

      val stationId = intent.getStringExtra(AlarmScheduler.EXTRA_STATION_ID)
      if (stationId != null || intent.hasExtra(AlarmScheduler.EXTRA_RAMP)) {
        val ramp = intent.getBooleanExtra(AlarmScheduler.EXTRA_RAMP, true)
        val volume = intent.getIntExtra(AlarmScheduler.EXTRA_VOLUME, 5)
        intent.removeExtra(AlarmScheduler.EXTRA_STATION_ID)
        intent.removeExtra(AlarmScheduler.EXTRA_RAMP)
        intent.removeExtra(AlarmScheduler.EXTRA_VOLUME)
        val alarmJson = org.json.JSONObject().apply {
          put("stationId", stationId ?: org.json.JSONObject.NULL)
          put("ramp", ramp)
          put("volume", volume)
        }.toString()
        pendingAlarmLaunch = alarmJson
        val mod = instance
        val ctx = mod?.context
        if (ctx != null) {
          AlarmNotifier.cancel(ctx)
        }
        if (mod != null) {
          try {
            mod.sendEvent("onAlarmLaunch", mapOf("alarm" to alarmJson))
          } catch (_: Exception) {
          }
        }
      }
    }

    fun extractUrlFromIntent(intent: Intent): String? {
      val url = intent.getStringExtra("url")
      if (url != null) {
        intent.removeExtra("url")
        return url
      }
      // Checked before podcastId because a saved-search payload carries the matched
      // episode's podcastId alongside its query; the search screen is the real target.
      val search = intent.getStringExtra("search")
      if (search != null) {
        intent.removeExtra("search")
        val savedSearchId = intent.getStringExtra("savedSearchId")
        if (savedSearchId != null) intent.removeExtra("savedSearchId")
        val param =
          if (savedSearchId.isNullOrEmpty()) ""
          else "&savedSearchId=" + java.net.URLEncoder.encode(savedSearchId, "UTF-8")
        return "/modal/podcast-search?search=${java.net.URLEncoder.encode(search, "UTF-8")}$param"
      }
      val podcastId = intent.getStringExtra("podcastId")
      if (podcastId != null) {
        intent.removeExtra("podcastId")
        val episodeId = intent.getStringExtra("episodeId")
        if (episodeId != null) intent.removeExtra("episodeId")
        val episodeParam =
          if (episodeId.isNullOrEmpty()) ""
          else "&episodeId=" + java.net.URLEncoder.encode(episodeId, "UTF-8")
        return "/modal/podcast-detail?podcastId=" +
          java.net.URLEncoder.encode(podcastId, "UTF-8") + episodeParam
      }
      val dataUri = intent.dataString
      if (dataUri != null && (dataUri.startsWith("bbcradioplayer://") || dataUri.startsWith("trackplayer://"))) {
        intent.data = null
        return dataUri
      }
      return null
    }
  }
}
