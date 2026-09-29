package com.hyliankid14.bbcradioplayer

import android.content.Context
import android.util.Log
import kotlinx.coroutines.*

/**
 * Central coordinator for track scrobbling to Last.fm and external scrobblers.
 * Enforces Last.fm scrobble criteria:
 * - Minimum listening time of 30 seconds.
 * - Scrobbled after 50% of track duration or 240 seconds (4 minutes), whichever is shorter.
 */
object ScrobbleManager {
    private const val TAG = "ScrobbleManager"
    private const val MIN_SCROBBLE_TIME_MS = 30_000L // 30 seconds minimum
    private const val MAX_SCROBBLE_THRESHOLD_MS = 240_000L // 4 minutes max
    private const val DEFAULT_RADIO_THRESHOLD_MS = 60_000L // 1 minute default if duration unknown

    data class ActiveTrack(
        val artist: String,
        val track: String,
        val album: String,
        val durationSec: Int,
        val startTimeMs: Long,
        var totalListenedMs: Long = 0L,
        var lastResumeTimeMs: Long = System.currentTimeMillis(),
        var isPlaying: Boolean = true,
        var alreadyScrobbled: Boolean = false
    )

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var activeTrack: ActiveTrack? = null
    private var scrobbleTimerJob: Job? = null

    @Synchronized
    fun onTrackStarted(
        context: Context,
        artist: String,
        track: String,
        album: String = "",
        durationSec: Int = 0,
        isPodcast: Boolean = false
    ) {
        val trimmedArtist = artist.trim()
        val trimmedTrack = track.trim()

        if (trimmedArtist.isEmpty() || trimmedTrack.isEmpty()) {
            return
        }

        // Check podcast filter
        if (isPodcast && !LastFmPreference.shouldScrobblePodcasts(context)) {
            Log.d(TAG, "Ignoring podcast track ($trimmedTrack) as podcast scrobbling is disabled")
            return
        }

        // If the same track is already active and playing, do not re-trigger
        val current = activeTrack
        if (current != null && current.artist.equals(trimmedArtist, ignoreCase = true) &&
            current.track.equals(trimmedTrack, ignoreCase = true)
        ) {
            return
        }

        // Before starting new track, check if previous track qualifies for scrobble
        checkAndScrobbleCurrent(context)

        val now = System.currentTimeMillis()
        val newTrack = ActiveTrack(
            artist = trimmedArtist,
            track = trimmedTrack,
            album = album.trim(),
            durationSec = durationSec,
            startTimeMs = now,
            lastResumeTimeMs = now,
            isPlaying = true,
            alreadyScrobbled = false
        )
        activeTrack = newTrack

        Log.d(TAG, "New track started: ${newTrack.artist} - ${newTrack.track} (duration: ${durationSec}s)")

        // 1. Broadcast standard scrobbler intent
        ScrobbleBroadcastManager.broadcastPlayState(
            context,
            ScrobbleBroadcastManager.SLS_STATE_START,
            newTrack.artist,
            newTrack.track,
            newTrack.album,
            durationSec
        )

        // 2. Direct Last.fm Now Playing & Schedule Scrobble
        scheduleDirectScrobble(context.applicationContext, newTrack)
    }

    @Synchronized
    fun onPlaybackPaused(context: Context) {
        val current = activeTrack ?: return
        if (current.isPlaying) {
            val now = System.currentTimeMillis()
            current.totalListenedMs += (now - current.lastResumeTimeMs)
            current.isPlaying = false

            ScrobbleBroadcastManager.broadcastPlayState(
                context,
                ScrobbleBroadcastManager.SLS_STATE_PAUSE,
                current.artist,
                current.track,
                current.album,
                current.durationSec
            )
        }
    }

    @Synchronized
    fun onPlaybackResumed(context: Context) {
        val current = activeTrack ?: return
        if (!current.isPlaying) {
            current.lastResumeTimeMs = System.currentTimeMillis()
            current.isPlaying = true

            ScrobbleBroadcastManager.broadcastPlayState(
                context,
                ScrobbleBroadcastManager.SLS_STATE_RESUME,
                current.artist,
                current.track,
                current.album,
                current.durationSec
            )

            // Re-check scrobble timer if not yet scrobbled
            if (!current.alreadyScrobbled) {
                scheduleDirectScrobble(context.applicationContext, current)
            }
        }
    }

    @Synchronized
    fun onPlaybackStopped(context: Context) {
        checkAndScrobbleCurrent(context)
        val current = activeTrack
        if (current != null) {
            ScrobbleBroadcastManager.broadcastPlayState(
                context,
                ScrobbleBroadcastManager.SLS_STATE_COMPLETE,
                current.artist,
                current.track,
                current.album,
                current.durationSec
            )
        }
        scrobbleTimerJob?.cancel()
        scrobbleTimerJob = null
        activeTrack = null
    }

    private fun checkAndScrobbleCurrent(context: Context) {
        val current = activeTrack ?: return
        if (current.alreadyScrobbled) return

        if (current.isPlaying) {
            val now = System.currentTimeMillis()
            current.totalListenedMs += (now - current.lastResumeTimeMs)
            current.lastResumeTimeMs = now
        }

        val thresholdMs = calculateScrobbleThresholdMs(current.durationSec)
        if (current.totalListenedMs >= thresholdMs) {
            triggerScrobble(context, current)
        }
    }

    private fun calculateScrobbleThresholdMs(durationSec: Int): Long {
        if (durationSec <= 0) {
            return DEFAULT_RADIO_THRESHOLD_MS
        }
        val durationMs = durationSec * 1000L
        val halfDuration = durationMs / 2
        // Scrobble at 50% or 4 minutes (240s), whichever is less, but at least 30s
        val threshold = minOf(halfDuration, MAX_SCROBBLE_THRESHOLD_MS)
        return maxOf(MIN_SCROBBLE_TIME_MS, threshold)
    }

    private fun scheduleDirectScrobble(context: Context, track: ActiveTrack) {
        scrobbleTimerJob?.cancel()

        scope.launch {
            // Send Now Playing update if logged in
            if (LastFmPreference.isDirectScrobbleEnabled(context)) {
                LastFmApiClient.updateNowPlaying(
                    context = context,
                    artist = track.artist,
                    track = track.track,
                    album = track.album,
                    durationSec = if (track.durationSec > 0) track.durationSec else null
                )
            }

            // Calculate remaining time until scrobble threshold
            val thresholdMs = calculateScrobbleThresholdMs(track.durationSec)
            val remainingMs = thresholdMs - track.totalListenedMs
            if (remainingMs > 0) {
                delay(remainingMs)
            }

            synchronized(this@ScrobbleManager) {
                if (activeTrack == track && !track.alreadyScrobbled && track.isPlaying) {
                    val now = System.currentTimeMillis()
                    track.totalListenedMs += (now - track.lastResumeTimeMs)
                    track.lastResumeTimeMs = now
                    if (track.totalListenedMs >= thresholdMs) {
                        triggerScrobble(context, track)
                    }
                }
            }
        }
    }

    private fun triggerScrobble(context: Context, track: ActiveTrack) {
        track.alreadyScrobbled = true
        Log.i(TAG, "Scrobbling track: ${track.artist} - ${track.track} (listened ${track.totalListenedMs}ms)")

        if (LastFmPreference.isDirectScrobbleEnabled(context)) {
            scope.launch {
                val timestampSec = track.startTimeMs / 1000L
                val success = LastFmApiClient.scrobble(
                    context = context,
                    artist = track.artist,
                    track = track.track,
                    timestampSec = timestampSec,
                    album = track.album,
                    durationSec = if (track.durationSec > 0) track.durationSec else null
                )
                if (success) {
                    LastFmPreference.setLastScrobbled(
                        context,
                        "${track.artist} - ${track.track}"
                    )
                }
            }
        }
    }
}
