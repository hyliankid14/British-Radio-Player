package com.hyliankid14.bbcradioplayer.wear.playback

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class NowPlaying(
    val title: String,
    val subtitle: String,
    val isLive: Boolean,
    val isPlaying: Boolean,
    val positionMs: Long,
    val durationMs: Long,
    val artworkUrl: String?
)

object WearPlaybackStateStore {
    private val nowPlayingState = MutableStateFlow<NowPlaying?>(null)

    fun nowPlaying(): StateFlow<NowPlaying?> = nowPlayingState.asStateFlow()

    fun currentState(): NowPlaying? = nowPlayingState.value

    internal fun publish(state: NowPlaying?) {
        nowPlayingState.value = state
    }
}