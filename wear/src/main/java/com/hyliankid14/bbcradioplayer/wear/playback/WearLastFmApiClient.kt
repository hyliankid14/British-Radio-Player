package com.hyliankid14.bbcradioplayer.wear.playback

import android.content.Context
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * Calls the first-party Last.fm signing proxy.
 *
 * Last.fm requires api_sig on every authenticated call, computed with a shared
 * secret. That secret used to be baked into this APK via BuildConfig, which means
 * anyone who pulls the APK apart can extract it and forge scrobbles. Signing now
 * happens in the proxy, so the watch only needs the proxy URL — which the phone
 * pushes alongside the session key.
 */
object WearLastFmApiClient {
    private const val TAG = "WearLastFmApiClient"

    private const val CONNECT_TIMEOUT_MS = 8000
    private const val READ_TIMEOUT_MS = 8000

    /**
     * Notify Last.fm that a track has started playing via track.updateNowPlaying.
     */
    suspend fun updateNowPlaying(
        context: Context,
        artist: String,
        track: String,
        album: String? = null,
        durationSec: Int? = null
    ): Boolean = post(context, "track.updateNowPlaying", buildMap {
        put("artist", artist)
        put("track", track)
        album?.takeIf { it.isNotBlank() }?.let { put("album", it) }
        durationSec?.takeIf { it > 0 }?.let { put("duration", it.toString()) }
    }, expectedKey = "nowplaying") {
        Log.d(TAG, "Now playing updated on Last.fm: $artist - $track")
    }

    /**
     * Submit a scrobble via track.scrobble.
     */
    suspend fun scrobble(
        context: Context,
        artist: String,
        track: String,
        timestampSec: Long,
        album: String? = null,
        durationSec: Int? = null
    ): Boolean = post(context, "track.scrobble", buildMap {
        put("artist", artist)
        put("track", track)
        put("timestamp", timestampSec.toString())
        album?.takeIf { it.isNotBlank() }?.let { put("album", it) }
        durationSec?.takeIf { it > 0 }?.let { put("duration", it.toString()) }
    }, expectedKey = "scrobbles") {
        Log.d(TAG, "Successfully scrobbled to Last.fm from Wear: $artist - $track")
    }

    /**
     * Posts to the proxy and reports whether the response carried [expectedKey].
     * Form encoding is used because the proxy accepts both JSON and form bodies,
     * which keeps this caller free of a JSON serialiser.
     */
    private suspend fun post(
        context: Context,
        method: String,
        fields: Map<String, String>,
        expectedKey: String,
        onSuccess: () -> Unit
    ): Boolean = withContext(Dispatchers.IO) {
        val sessionKey = WearLastFmPreference.getSessionKey(context)
        if (sessionKey == null) return@withContext false

        val proxyUrl = WearLastFmPreference.getProxyUrl(context)
        if (proxyUrl.isNullOrBlank()) {
            Log.w(TAG, "No Last.fm proxy URL configured; skipping $method")
            return@withContext false
        }

        val params = LinkedHashMap(fields)
        params["sk"] = sessionKey

        try {
            val response = executePost(proxyUrl, method, params)
            val json = JSONObject(response)
            if (json.has("error")) {
                Log.w(TAG, "$method error ${json.optInt("error")}: ${json.optString("message")}")
                return@withContext false
            }
            if (json.has(expectedKey)) {
                onSuccess()
                true
            } else {
                Log.w(TAG, "$method unexpected response: $response")
                false
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to POST $method: ${e.message}", e)
            false
        }
    }

    private fun executePost(proxyUrl: String, method: String, params: Map<String, String>): String {
        val body = encodeParams(params)
        val url = URL("${proxyUrl.trimEnd('/')}/lastfm/$method")
        val conn = url.openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = CONNECT_TIMEOUT_MS
            conn.readTimeout = READ_TIMEOUT_MS
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
            conn.setRequestProperty("Accept", "application/json")
            conn.setRequestProperty("User-Agent", "BritishRadioPlayerWear/1.0")

            OutputStreamWriter(conn.outputStream, "UTF-8").use { writer ->
                writer.write(body)
                writer.flush()
            }

            val stream = if (conn.responseCode in 200..299) conn.inputStream else conn.errorStream
            return stream?.bufferedReader()?.use { it.readText() } ?: ""
        } finally {
            conn.disconnect()
        }
    }

    private fun encodeParams(params: Map<String, String>): String {
        return params.entries.joinToString("&") { (key, value) ->
            "${URLEncoder.encode(key, "UTF-8")}=${URLEncoder.encode(value, "UTF-8")}"
        }
    }
}
