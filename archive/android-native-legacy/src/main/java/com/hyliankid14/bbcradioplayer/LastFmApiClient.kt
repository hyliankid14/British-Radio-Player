package com.hyliankid14.bbcradioplayer

import android.content.Context
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.security.MessageDigest

object LastFmApiClient {
    private const val TAG = "LastFmApiClient"
    private const val BASE_URL = "https://ws.audioscrobbler.com/2.0/"
    const val CALLBACK_SCHEME = "bbcradioplayer"
    const val CALLBACK_HOST = "lastfm-auth"
    const val CALLBACK_URL = "$CALLBACK_SCHEME://$CALLBACK_HOST"

    data class SessionResult(
        val success: Boolean,
        val username: String? = null,
        val sessionKey: String? = null,
        val errorMessage: String? = null
    )

    fun getAuthUrl(context: Context): String {
        val apiKey = LastFmPreference.getEffectiveApiKey(context)
        val encodedCb = URLEncoder.encode(CALLBACK_URL, "UTF-8")
        return "https://www.last.fm/api/auth/?api_key=$apiKey&cb=$encodedCb"
    }

    /**
     * Compute Last.fm API signature:
     * 1. Sort all parameters alphabetically by parameter name (excluding 'format' and 'callback').
     * 2. Concatenate name + value (no delimiters).
     * 3. Append secret.
     * 4. Compute MD5 in lowercase 32-character hexadecimal.
     */
    fun createApiSignature(params: Map<String, String>, secret: String): String {
        val filtered = params.filterKeys { it != "format" && it != "callback" }
        val sortedKeys = filtered.keys.sorted()
        val sb = StringBuilder()
        for (k in sortedKeys) {
            sb.append(k).append(filtered[k])
        }
        sb.append(secret)
        return md5(sb.toString())
    }

    private fun md5(input: String): String {
        val md = MessageDigest.getInstance("MD5")
        val digest = md.digest(input.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }

    /**
     * Exchange the unauthorized web request token for a permanent session key via auth.getSession.
     */
    suspend fun fetchSession(context: Context, token: String): SessionResult = withContext(Dispatchers.IO) {
        val apiKey = LastFmPreference.getEffectiveApiKey(context)
        val secret = LastFmPreference.getEffectiveApiSecret(context)

        val params = mutableMapOf(
            "method" to "auth.getSession",
            "api_key" to apiKey,
            "token" to token
        )
        val sig = createApiSignature(params, secret)
        params["api_sig"] = sig
        params["format"] = "json"

        try {
            val response = executeGet(params)
            val json = JSONObject(response)
            if (json.has("session")) {
                val sessionObj = json.getJSONObject("session")
                val username = sessionObj.getString("name")
                val key = sessionObj.getString("key")
                SessionResult(success = true, username = username, sessionKey = key)
            } else {
                val errorMsg = json.optString("message", "Unknown error fetching session")
                Log.w(TAG, "auth.getSession failed: $errorMsg")
                SessionResult(success = false, errorMessage = errorMsg)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Exception during auth.getSession: ${e.message}", e)
            SessionResult(success = false, errorMessage = e.message)
        }
    }

    /**
     * Notify Last.fm that a track has started playing via track.updateNowPlaying.
     */
    suspend fun updateNowPlaying(
        context: Context,
        artist: String,
        track: String,
        album: String? = null,
        durationSec: Int? = null
    ): Boolean = withContext(Dispatchers.IO) {
        val sessionKey = LastFmPreference.getSessionKey(context) ?: return@withContext false
        val apiKey = LastFmPreference.getEffectiveApiKey(context)
        val secret = LastFmPreference.getEffectiveApiSecret(context)

        val params = mutableMapOf(
            "method" to "track.updateNowPlaying",
            "artist" to artist,
            "track" to track,
            "api_key" to apiKey,
            "sk" to sessionKey
        )
        if (!album.isNullOrBlank()) {
            params["album"] = album
        }
        if (durationSec != null && durationSec > 0) {
            params["duration"] = durationSec.toString()
        }

        val sig = createApiSignature(params, secret)
        params["api_sig"] = sig
        params["format"] = "json"

        try {
            val response = executePost(params)
            val json = JSONObject(response)
            val success = json.has("nowplaying")
            if (!success) {
                Log.w(TAG, "track.updateNowPlaying error: $response")
            } else {
                Log.d(TAG, "Now playing updated on Last.fm: $artist - $track")
            }
            success
        } catch (e: Exception) {
            Log.e(TAG, "Failed to update now playing: ${e.message}", e)
            false
        }
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
    ): Boolean = withContext(Dispatchers.IO) {
        val sessionKey = LastFmPreference.getSessionKey(context) ?: return@withContext false
        val apiKey = LastFmPreference.getEffectiveApiKey(context)
        val secret = LastFmPreference.getEffectiveApiSecret(context)

        val params = mutableMapOf(
            "method" to "track.scrobble",
            "artist" to artist,
            "track" to track,
            "timestamp" to timestampSec.toString(),
            "api_key" to apiKey,
            "sk" to sessionKey
        )
        if (!album.isNullOrBlank()) {
            params["album"] = album
        }
        if (durationSec != null && durationSec > 0) {
            params["duration"] = durationSec.toString()
        }

        val sig = createApiSignature(params, secret)
        params["api_sig"] = sig
        params["format"] = "json"

        try {
            val response = executePost(params)
            val json = JSONObject(response)
            val success = json.has("scrobbles")
            if (success) {
                Log.d(TAG, "Successfully scrobbled to Last.fm: $artist - $track")
            } else {
                Log.w(TAG, "track.scrobble error: $response")
            }
            success
        } catch (e: Exception) {
            Log.e(TAG, "Failed to scrobble: ${e.message}", e)
            false
        }
    }

    private fun executeGet(params: Map<String, String>): String {
        val query = encodeParams(params)
        val url = URL("$BASE_URL?$query")
        val conn = url.openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "GET"
            conn.connectTimeout = 8000
            conn.readTimeout = 8000
            conn.setRequestProperty("User-Agent", "BritishRadioPlayer/1.0")

            val stream = if (conn.responseCode in 200..299) conn.inputStream else conn.errorStream
            return stream?.bufferedReader()?.use { it.readText() } ?: ""
        } finally {
            conn.disconnect()
        }
    }

    private fun executePost(params: Map<String, String>): String {
        val body = encodeParams(params)
        val url = URL(BASE_URL)
        val conn = url.openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 8000
            conn.readTimeout = 8000
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
            conn.setRequestProperty("User-Agent", "BritishRadioPlayer/1.0")

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
