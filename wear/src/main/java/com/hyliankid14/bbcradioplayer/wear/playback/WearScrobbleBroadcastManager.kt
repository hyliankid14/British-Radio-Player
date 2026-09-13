package com.hyliankid14.bbcradioplayer.wear.playback

import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Dispatches standard Android Scrobbler broadcast intents on Wear OS.
 * These intents are intercepted by scrobblers sideloaded on Wear OS (e.g. Pano Scrobbler, SLS).
 */
object WearScrobbleBroadcastManager {
    private const val TAG = "WearScrobbleBroadcast"

    // Simple Last.fm Scrobbler (SLS) API
    private const val ACTION_SLS_PLAY_STATE_CHANGED = "com.adam.asmp.playstatechanged"
    const val SLS_STATE_START = 0
    const val SLS_STATE_RESUME = 1
    const val SLS_STATE_PAUSE = 2
    const val SLS_STATE_COMPLETE = 3

    // Scrobble Droid API
    private const val ACTION_SCROBBLE_DROID_MUSIC_STATUS = "net.jjc1138.android.scrobbler.action.MUSIC_STATUS"

    // Official Last.fm Android App Broadcasts
    private const val ACTION_LASTFM_METACHANGED = "fm.last.android.metachanged"
    private const val ACTION_LASTFM_PLAYBACK_PAUSED = "fm.last.android.playbackpaused"
    private const val ACTION_LASTFM_PLAYBACK_COMPLETE = "fm.last.android.playbackcomplete"

    fun broadcastPlayState(
        context: Context,
        state: Int,
        artist: String,
        track: String,
        album: String = "",
        durationSec: Int = 0
    ) {
        if (!WearLastFmPreference.isBroadcastScrobbleEnabled(context)) {
            return
        }

        try {
            // 1. Simple Last.fm Scrobbler (SLS)
            val slsIntent = Intent(ACTION_SLS_PLAY_STATE_CHANGED).apply {
                putExtra("state", state)
                putExtra("app-name", "British Radio Player")
                putExtra("app-package", context.packageName)
                putExtra("artist", artist)
                putExtra("track", track)
                putExtra("album", album)
                putExtra("duration", durationSec)
            }
            context.sendBroadcast(slsIntent)

            // 2. Scrobble Droid / Pano Scrobbler music status
            val isPlaying = (state == SLS_STATE_START || state == SLS_STATE_RESUME)
            val sdIntent = Intent(ACTION_SCROBBLE_DROID_MUSIC_STATUS).apply {
                putExtra("playing", isPlaying)
                putExtra("artist", artist)
                putExtra("track", track)
                putExtra("album", album)
                putExtra("secs", durationSec)
                putExtra("source", "P")
            }
            context.sendBroadcast(sdIntent)

            // 3. Official Last.fm intents
            val lastFmAction = when (state) {
                SLS_STATE_START, SLS_STATE_RESUME -> ACTION_LASTFM_METACHANGED
                SLS_STATE_PAUSE -> ACTION_LASTFM_PLAYBACK_PAUSED
                SLS_STATE_COMPLETE -> ACTION_LASTFM_PLAYBACK_COMPLETE
                else -> ACTION_LASTFM_METACHANGED
            }
            val lastFmIntent = Intent(lastFmAction).apply {
                putExtra("artist", artist)
                putExtra("track", track)
                putExtra("album", album)
                putExtra("duration", (durationSec * 1000).toLong())
                putExtra("position", 0L)
            }
            context.sendBroadcast(lastFmIntent)

            Log.d(TAG, "Sent wear scrobbler broadcasts for: $artist - $track (state: $state)")
        } catch (e: Exception) {
            Log.w(TAG, "Failed to send wear scrobbler broadcasts: ${e.message}")
        }
    }
}
