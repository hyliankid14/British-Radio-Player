package com.hyliankid14.bbcradioplayer.wear.playback

import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import com.hyliankid14.bbcradioplayer.wear.data.EpisodeSummary
import com.hyliankid14.bbcradioplayer.wear.data.Station
import kotlinx.coroutines.flow.StateFlow

class WearPlaybackController(private val context: Context) {
    val nowPlaying: StateFlow<NowPlaying?> = WearPlaybackStateStore.nowPlaying()

    val currentState: NowPlaying?
        get() = WearPlaybackStateStore.currentState()

    fun playStation(station: Station) {
        val intent = baseIntent(WearPlaybackService.ACTION_PLAY_STATION).apply {
            putStringArrayListExtra(
                WearPlaybackService.EXTRA_STREAM_CANDIDATES,
                ArrayList(station.streamCandidates().mapNotNull(::normaliseUrl))
            )
            putExtra(WearPlaybackService.EXTRA_STATION_ID, station.id)
            putExtra(WearPlaybackService.EXTRA_SERVICE_ID, station.serviceId)
            putExtra(WearPlaybackService.EXTRA_TITLE, station.title)
            putExtra(WearPlaybackService.EXTRA_SUBTITLE, "Live radio")
            putExtra(WearPlaybackService.EXTRA_ARTWORK_URL, null as String?)
            putExtra(WearPlaybackService.EXTRA_IS_LIVE, true)
        }
        ContextCompat.startForegroundService(context, intent)
    }

    fun playEpisode(
        episode: EpisodeSummary,
        startPositionMs: Long = 0L,
        artworkUrl: String? = null
    ) {
        val urlCandidates = buildUrlCandidates(episode.audioUrl)
        val primaryUrl = urlCandidates.firstOrNull()
        val intent = baseIntent(WearPlaybackService.ACTION_PLAY_EPISODE).apply {
            putExtra(WearPlaybackService.EXTRA_EPISODE_URL, primaryUrl)
            putStringArrayListExtra(
                WearPlaybackService.EXTRA_STREAM_CANDIDATES,
                ArrayList(urlCandidates)
            )
            putExtra(WearPlaybackService.EXTRA_EPISODE_ID, episode.id)
            putExtra(WearPlaybackService.EXTRA_PODCAST_ID, episode.podcastId)
            putExtra(WearPlaybackService.EXTRA_TITLE, episode.title)
            putExtra(WearPlaybackService.EXTRA_SUBTITLE, episode.podcastTitle)
            putExtra(WearPlaybackService.EXTRA_ARTWORK_URL, normaliseUrl(artworkUrl))
            putExtra(WearPlaybackService.EXTRA_IS_LIVE, false)
            putExtra(WearPlaybackService.EXTRA_START_POSITION_MS, startPositionMs)
        }
        ContextCompat.startForegroundService(context, intent)
    }

    fun togglePlayPause() {
        context.startService(baseIntent(WearPlaybackService.ACTION_TOGGLE_PLAY_PAUSE))
    }

    fun seekBy(deltaMs: Long) {
        context.startService(
            baseIntent(WearPlaybackService.ACTION_SEEK_BY)
                .putExtra(WearPlaybackService.EXTRA_SEEK_DELTA_MS, deltaMs)
        )
    }

    fun stop() {
        context.startService(baseIntent(WearPlaybackService.ACTION_STOP))
    }

    fun adjustVolume(direction: Int) {
        context.startService(
            baseIntent(WearPlaybackService.ACTION_ADJUST_VOLUME)
                .putExtra(WearPlaybackService.EXTRA_VOLUME_DIRECTION, direction)
        )
    }

    private fun baseIntent(action: String): Intent {
        return Intent(context, WearPlaybackService::class.java).setAction(action)
    }

    private fun normaliseUrl(url: String?): String? {
        if (url.isNullOrBlank()) return null
        return url.trim().replace("http://", "https://")
    }

    private fun buildUrlCandidates(url: String?): List<String> {
        if (url.isNullOrBlank()) return emptyList()
        val trimmed = url.trim()
        val https = trimmed.replace("http://", "https://")
        return listOf(https, trimmed).distinct().filter { it.isNotBlank() }
    }
}