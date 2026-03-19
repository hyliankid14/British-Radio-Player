package com.hyliankid14.bbcradioplayer

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
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
        private const val KEY_FIRST_RUN = "analytics_first_run"
        private const val TAG = "PrivacyAnalytics"

        // Self-hosted analytics endpoint on your Raspberry Pi.
        // Replace with your own Pi hostname/IP and HTTPS reverse-proxy URL.
        private const val ANALYTICS_ENDPOINT = "https://raspberrypi.tailc23afa.ts.net:8443/event"
    }
    
    private val prefs: SharedPreferences = 
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    
    // Check if analytics are enabled
    fun isEnabled(): Boolean = prefs.getBoolean(KEY_ENABLED, false)
    
    // Enable/disable analytics
    fun setEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_ENABLED, enabled).apply()
        Log.d(TAG, "Analytics ${if (enabled) "enabled" else "disabled"}")
    }
    
    // Check if we should show the opt-in dialog
    fun shouldShowOptInDialog(): Boolean = 
        !prefs.contains(KEY_FIRST_RUN)
    
    // Mark that we've shown the dialog
    fun markOptInDialogShown() {
        prefs.edit().putBoolean(KEY_FIRST_RUN, true).apply()
    }
    
    // Track station play (anonymous)
    suspend fun trackStationPlay(stationId: String, stationName: String? = null) {
        if (!isEnabled()) return
        
        withContext(Dispatchers.IO) {
            try {
                sendEvent(JSONObject().apply {
                    put("event", "station_play")
                    put("station_id", stationId)
                    if (!stationName.isNullOrBlank()) {
                        put("station_name", stationName)
                    }
                    put("date", getCurrentDate())
                    put("app_version", getAppVersion())
                })
                Log.d(TAG, "Tracked station play: $stationId")
            } catch (e: Exception) {
                Log.w(TAG, "Failed to send station_play event", e)
            }
        }
    }
    
    // Track episode play (anonymous)
    suspend fun trackEpisodePlay(
        podcastId: String,
        episodeId: String,
        episodeTitle: String? = null,
        podcastTitle: String? = null
    ) {
        if (!isEnabled()) return
        
        withContext(Dispatchers.IO) {
            try {
                sendEvent(JSONObject().apply {
                    put("event", "episode_play")
                    put("podcast_id", podcastId)
                    put("episode_id", episodeId)
                    if (!podcastTitle.isNullOrBlank()) {
                        put("podcast_title", podcastTitle)
                    }
                    if (!episodeTitle.isNullOrBlank()) {
                        put("episode_title", episodeTitle)
                    }
                    put("date", getCurrentDate())
                    put("app_version", getAppVersion())
                })
                Log.d(TAG, "Tracked episode play: $episodeId from podcast $podcastId")
            } catch (e: Exception) {
                Log.w(TAG, "Failed to send episode_play event", e)
            }
        }
    }
    
    private fun sendEvent(eventData: JSONObject) {
        try {
            val connection = URL(ANALYTICS_ENDPOINT).openConnection() as HttpURLConnection
            connection.apply {
                requestMethod = "POST"
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("User-Agent", "British-Radio-Player/${getAppVersion()}")
                connectTimeout = 5000
                readTimeout = 5000
            }
            
            connection.outputStream.use { os ->
                os.write(eventData.toString().toByteArray())
            }
            
            val responseCode = connection.responseCode
            if (responseCode != HttpURLConnection.HTTP_OK && 
                responseCode != HttpURLConnection.HTTP_CREATED) {
                Log.w(TAG, "Analytics server returned $responseCode")
            } else {
                Log.d(TAG, "Event sent successfully")
            }
            
            connection.disconnect()
        } catch (e: Exception) {
            Log.w(TAG, "Exception while sending event", e)
        }
    }
    
    private fun getCurrentDate(): String {
        // Return UTC date+time (ISO 8601) so server can use precise timestamps
        return try {
            val fmt = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", java.util.Locale.US)
            fmt.timeZone = TimeZone.getTimeZone("UTC")
            fmt.format(java.util.Date())
        } catch (e: Exception) {
            "unknown"
        }
    }
    
    private fun getAppVersion(): String {
        return try {
            // The versionName already encodes the build type:
            //   GitHub release:  "1.5.0-github"
            //   Play release:    "1.5.0-play"
            //   Any debug build: "1.5.0-debug"
            val versionName = context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "unknown"
            if (BuildConfig.DEBUG && !versionName.endsWith("-debug")) "$versionName-debug" else versionName
        } catch (e: Exception) {
            "unknown"
        }
    }
}
