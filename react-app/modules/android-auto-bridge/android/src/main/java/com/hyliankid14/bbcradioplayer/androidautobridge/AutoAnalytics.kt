package com.hyliankid14.bbcradioplayer.androidautobridge

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Anonymous analytics tracker for Android Auto, mirroring the main app's PrivacyAnalytics.
 */
object AutoAnalytics {

  private const val TAG = "AutoAnalytics"
  private const val ANALYTICS_EVENT_URL = "https://bbc-radio.shai.website/event"

  private fun utcTimestamp(): String {
    val fmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply {
      timeZone = TimeZone.getTimeZone("UTC")
    }
    return fmt.format(Date())
  }

  fun trackStationPlay(context: Context, stationId: String, stationName: String?) {
    val cleanId = stationId.trim()
    if (!AutoState.isAnalyticsEnabled(context) || cleanId.isBlank()) return
    val payload = JSONObject().apply {
      put("event", "station_play")
      put("station_id", cleanId)
      if (!stationName.isNullOrBlank()) {
        put("station_name", stationName.trim())
      }
      put("date", utcTimestamp())
      put("app_version", "2.0.0")
      put("platform", "android")
    }
    sendEvent(payload)
  }

  fun trackEpisodePlay(
    context: Context,
    podcastId: String,
    episodeId: String,
    episodeTitle: String?,
    podcastTitle: String?
  ) {
    val cleanPodId = podcastId.trim()
    val cleanEpId = episodeId.trim()
    if (!AutoState.isAnalyticsEnabled(context) || cleanPodId.isBlank() || cleanEpId.isBlank()) return
    val payload = JSONObject().apply {
      put("event", "episode_play")
      put("podcast_id", cleanPodId)
      put("episode_id", cleanEpId)
      if (!podcastTitle.isNullOrBlank()) {
        put("podcast_title", podcastTitle.trim())
      }
      if (!episodeTitle.isNullOrBlank()) {
        put("episode_title", episodeTitle.trim())
      }
      put("date", utcTimestamp())
      put("app_version", "2.0.0")
      put("platform", "android")
    }
    sendEvent(payload)
  }

  private fun sendEvent(payload: JSONObject) {
    try {
      val conn = (URL(ANALYTICS_EVENT_URL).openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"
        doOutput = true
        connectTimeout = 5000
        readTimeout = 5000
        setRequestProperty("Content-Type", "application/json")
        setRequestProperty("User-Agent", "British-Radio-Player/2.0.0")
      }
      conn.outputStream.use { os ->
        os.write(payload.toString().toByteArray(Charsets.UTF_8))
      }
      val code = conn.responseCode
      if (code == HttpURLConnection.HTTP_OK || code == HttpURLConnection.HTTP_CREATED) {
        Log.d(TAG, "Analytics event sent successfully: ${payload.optString("event")}")
      } else {
        Log.w(TAG, "Analytics server responded with code $code")
      }
      conn.disconnect()
    } catch (e: Exception) {
      Log.w(TAG, "Failed to send analytics event: ${e.message}")
    }
  }
}
