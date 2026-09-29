package com.hyliankid14.bbcradioplayer

/**
 * Helper to track playback state across the app
 */
object PlaybackStateHelper {
    private var currentStation: Station? = null
    private var isPlaying: Boolean = false
    private var isBuffering: Boolean = false
    private var currentShow: CurrentShow = CurrentShow("BBC Radio")
    private var currentEpisodeId: String? = null
    // Track the actual media/playback URI that the player is currently using (helps saved-episode resolution)
    private var currentMediaUri: String? = null
    private val showChangeListeners = mutableListOf<(CurrentShow) -> Unit>()
    
    fun setCurrentStation(station: Station?) {
        android.util.Log.d("PlaybackStateHelper", "setCurrentStation called: ${station?.title}")
        currentStation = station
        // Clear episode id when switching away from podcasts/stations
        if (station == null || !station.id.startsWith("podcast_")) {
            currentEpisodeId = null
            // Clear any episode-specific playback URI when leaving podcast context
            currentMediaUri = null
            // Reset the show so podcast episode/progress details don't persist in the UI
            // while the new station's show info is being fetched.
            currentShow = CurrentShow(station?.title ?: "BBC Radio")
            notifyShowChangeListeners()
        }
    }
    
    fun getCurrentStation(): Station? = currentStation

    /** Return the current media/playback URI (may be null). */
    fun getCurrentMediaUri(): String? = currentMediaUri

    /** Inform the helper of the current media/playback URI. Pass null to clear. */
    fun setCurrentMediaUri(uri: String?) {
        currentMediaUri = uri
        android.util.Log.d("PlaybackStateHelper", "setCurrentMediaUri: ${uri?.takeIf { it.isNotBlank() } ?: "<cleared>"}")
    }

    fun setCurrentEpisodeId(episodeId: String?) {
        currentEpisodeId = episodeId
        android.util.Log.d("PlaybackStateHelper", "setCurrentEpisodeId: $episodeId")
    }

    fun getCurrentEpisodeId(): String? = currentEpisodeId
    
    fun setIsPlaying(playing: Boolean) {
        isPlaying = playing
    }
    
    fun getIsPlaying(): Boolean = isPlaying

    fun setIsBuffering(buffering: Boolean) {
        isBuffering = buffering
    }

    fun getIsBuffering(): Boolean = isBuffering
    
    fun setCurrentShow(show: CurrentShow) {
        android.util.Log.d("PlaybackStateHelper", "setCurrentShow called: title='${show.title}', listeners count=${showChangeListeners.size}")
        currentShow = show
        notifyShowChangeListeners()
    }
    
    fun getCurrentShow(): CurrentShow = currentShow
    
    fun getCurrentShowTitle(): String = currentShow.getFormattedTitle()
    
    fun onShowChange(listener: (CurrentShow) -> Unit) {
        showChangeListeners.add(listener)
        android.util.Log.d("PlaybackStateHelper", "Listener registered, total listeners now: ${showChangeListeners.size}")
    }
    
    fun removeShowChangeListener(listener: (CurrentShow) -> Unit) {
        showChangeListeners.remove(listener)
        android.util.Log.d("PlaybackStateHelper", "Listener removed, total listeners now: ${showChangeListeners.size}")
    }
    
    private fun notifyShowChangeListeners() {
        android.util.Log.d("PlaybackStateHelper", "notifyShowChangeListeners: notifying ${showChangeListeners.size} listeners")
        showChangeListeners.forEach { it(currentShow) }
    }
    
    fun isPlayingAny(): Boolean = currentStation != null && isPlaying
}
