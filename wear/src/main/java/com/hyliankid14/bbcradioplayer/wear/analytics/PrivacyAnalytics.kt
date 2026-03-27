package com.hyliankid14.bbcradioplayer.wear.analytics

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import com.hyliankid14.bbcradioplayer.wear.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.TimeZone

class PrivacyAnalytics(private val context: Context) {
    companion object {
        private const val PREFS_NAME = "privacy_analytics"
        private const val KEY_ENABLED = "analytics_enabled"
        private const val TAG = "WearPrivacyAnalytics"
        private const val ANALYTICS_ENDPOINT = "https://raspberrypi.tailc23afa.ts.net:8443/event"
        private const val PLATFORM = "wear"
    }

    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun isEnabled(): Boolean = prefs.getBoolean(KEY_ENABLED, true)

    suspend fun trackStationPlay(stationId: String, stationName: String?) {
        if (!isEnabled()) return
        withContext(Dispatchers.IO) {
            runCatching {
                sendEvent(JSONObject().apply {
                    put("event", "station_play")
                    put("station_id", stationId)
                    if (!stationName.isNullOrBlank()) put("station_name", stationName)
                    put("date", getCurrentDate())
                    put("app_version", getAppVersion())
                    put("platform", PLATFORM)
                })
                Log.d(TAG, "Tracked station play: $stationId")
            }.onFailure { e ->
                Log.w(TAG, "Failed to send station_play event", e)
            }
        }
    }

    suspend fun trackEpisodePlay(
        podcastId: String,
        episodeId: String,
        episodeTitle: String?,
        podcastTitle: String?
    ) {
        if (!isEnabled()) return
        withContext(Dispatchers.IO) {
            runCatching {
                sendEvent(JSONObject().apply {
                    put("event", "episode_play")
                    put("podcast_id", podcastId)
                    put("episode_id", episodeId)
                    if (!podcastTitle.isNullOrBlank()) put("podcast_title", podcastTitle)
                    if (!episodeTitle.isNullOrBlank()) put("episode_title", episodeTitle)
                    put("date", getCurrentDate())
                    put("app_version", getAppVersion())
                    put("platform", PLATFORM)
                })
                Log.d(TAG, "Tracked episode play: $episodeId from podcast $podcastId")
            }.onFailure { e ->
                Log.w(TAG, "Failed to send episode_play event", e)
            }
        }
    }

    private fun sendEvent(eventData: JSONObject) {
        val connection = URL(ANALYTICS_ENDPOINT).openConnection() as HttpURLConnection
        connection.apply {
            requestMethod = "POST"
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("User-Agent", "British-Radio-Player-Wear/${getAppVersion()}")
            connectTimeout = 5000
            readTimeout = 5000
        }

        connection.outputStream.use { os ->
            os.write(eventData.toString().toByteArray())
        }

        val responseCode = connection.responseCode
        if (responseCode != HttpURLConnection.HTTP_OK && responseCode != HttpURLConnection.HTTP_CREATED) {
            Log.w(TAG, "Analytics server returned $responseCode")
        }
        connection.disconnect()
    }

    private fun getCurrentDate(): String {
        return runCatching {
            val fmt = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", java.util.Locale.US)
            fmt.timeZone = TimeZone.getTimeZone("UTC")
            fmt.format(java.util.Date())
        }.getOrDefault("unknown")
    }

    private fun getAppVersion(): String {
        return runCatching {
            val versionName = context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "unknown"
            if (BuildConfig.DEBUG && !versionName.endsWith("-debug")) "$versionName-debug" else versionName
        }.getOrDefault("unknown")
    }
}