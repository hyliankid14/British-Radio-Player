package com.hyliankid14.bbcradioplayer.wear

import android.app.Application
import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.hyliankid14.bbcradioplayer.wear.data.EpisodeSummary
import com.hyliankid14.bbcradioplayer.wear.data.PodcastRepository
import com.hyliankid14.bbcradioplayer.wear.data.PodcastSummary
import com.hyliankid14.bbcradioplayer.wear.data.Station
import com.hyliankid14.bbcradioplayer.wear.data.StationRepository
import com.hyliankid14.bbcradioplayer.wear.playback.NowPlaying
import com.hyliankid14.bbcradioplayer.wear.playback.WearPlaybackController
import com.hyliankid14.bbcradioplayer.wear.storage.EpisodeSyncStore
import com.hyliankid14.bbcradioplayer.wear.storage.FavouritesStore
import com.hyliankid14.bbcradioplayer.wear.storage.SubscriptionStore
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

class WearViewModel(application: Application) : AndroidViewModel(application) {
    private val favouritesStore = FavouritesStore(application)
    private val subscriptionStore = SubscriptionStore(application)
    private val episodeSyncStore = EpisodeSyncStore(application)
    private val podcastRepository = PodcastRepository(application)
    private val playbackController = WearPlaybackController(application)

    val stations: List<Station> = StationRepository.allStations()

    var favouriteIds by mutableStateOf(favouritesStore.getFavouriteIds())
        private set

    var favouriteOrder by mutableStateOf(favouritesStore.getFavouriteOrder())
        private set

    var subscribedPodcastIds by mutableStateOf(subscriptionStore.getSubscribedIds())
        private set

    var playedEpisodeIds by mutableStateOf(episodeSyncStore.getPlayedEpisodeIds())
        private set

    var episodeProgressMap by mutableStateOf(episodeSyncStore.getProgressMap())
        private set

    var podcasts by mutableStateOf<List<PodcastSummary>>(emptyList())
        private set

    var episodes by mutableStateOf<List<EpisodeSummary>>(emptyList())
        private set

    var loadingPodcasts by mutableStateOf(false)
        private set

    var loadingEpisodes by mutableStateOf(false)
        private set

    var selectedPodcast by mutableStateOf<PodcastSummary?>(null)
        private set

    var errorMessage by mutableStateOf<String?>(null)
        private set

    val nowPlaying: NowPlaying?
        get() = playbackState

    private var playbackState by mutableStateOf(playbackController.currentState)

    init {
        podcasts = podcastRepository.getCachedPodcasts()
        Log.d(TAG, "init favourites=${favouriteIds.size} order=${favouriteOrder.size} subscriptions=${subscribedPodcastIds.size} cachedPodcasts=${podcasts.size}")
        viewModelScope.launch {
            FavouritesStore.favouriteIdsFlow().collectLatest {
                favouriteIds = it
                Log.d(TAG, "favouriteIdsFlow size=${it.size}")
            }
        }
        viewModelScope.launch {
            FavouritesStore.favouriteOrderFlow().collectLatest {
                favouriteOrder = it
                Log.d(TAG, "favouriteOrderFlow size=${it.size}")
            }
        }
        viewModelScope.launch {
            SubscriptionStore.subscribedIdsFlow().collectLatest {
                subscribedPodcastIds = it
                Log.d(TAG, "subscribedIdsFlow size=${it.size}")
            }
        }
        viewModelScope.launch {
            EpisodeSyncStore.playedIdsFlow().collectLatest { playedIds ->
                playedEpisodeIds = playedIds
                Log.d(TAG, "playedIdsFlow size=${playedIds.size}")
            }
        }
        viewModelScope.launch {
            EpisodeSyncStore.progressMapFlow().collectLatest { progressMap ->
                episodeProgressMap = progressMap
                Log.d(TAG, "progressMapFlow size=${progressMap.size}")
            }
        }
        viewModelScope.launch {
            playbackController.nowPlaying.collectLatest { playbackState = it }
        }
        viewModelScope.launch {
            // Request an initial sync and retry a few times in case phone services are still waking.
            repeat(8) { attempt ->
                WatchAppStateSync.requestPhoneState(application)
                if (favouritesStore.hasRemoteSnapshot() && subscriptionStore.hasRemoteSnapshot() && episodeSyncStore.hasRemoteSnapshot()) {
                    return@launch
                }
                if (attempt < 7) {
                    delay(15_000L)
                }
            }
        }
        if (podcasts.isEmpty() || podcastRepository.shouldRefreshPodcasts()) {
            refreshPodcasts()
        }
    }

    fun refreshPodcasts() {
        viewModelScope.launch {
            loadingPodcasts = podcasts.isEmpty()
            errorMessage = null
            podcasts = try {
                podcastRepository.fetchPodcasts()
            } catch (e: Exception) {
                errorMessage = e.message ?: "Podcast loading failed"
                emptyList()
            } finally {
                loadingPodcasts = false
            }
            Log.d(TAG, "refreshPodcasts loaded=${podcasts.size} loading=$loadingPodcasts error=${errorMessage != null}")
        }
    }

    fun openPodcast(podcast: PodcastSummary) {
        selectedPodcast = podcast
        val cachedEpisodes = podcastRepository.getCachedEpisodes(podcast.id)
        if (cachedEpisodes.isNotEmpty()) {
            episodes = cachedEpisodes
        }
        if (cachedEpisodes.isNotEmpty() && !podcastRepository.shouldRefreshEpisodes(podcast.id)) {
            return
        }
        viewModelScope.launch {
            loadingEpisodes = episodes.isEmpty()
            errorMessage = null
            episodes = try {
                podcastRepository.fetchEpisodes(podcast)
            } catch (e: Exception) {
                errorMessage = e.message ?: "Episode loading failed"
                emptyList()
            } finally {
                loadingEpisodes = false
            }
            Log.d(TAG, "openPodcast id=${podcast.id} episodes=${episodes.size} loading=$loadingEpisodes error=${errorMessage != null}")
        }
    }

    fun toggleFavourite(station: Station) {
        favouriteIds = favouritesStore.toggle(station.id)
        WatchAppStateSync.pushCurrentState(getApplication(), favouritesStore, subscriptionStore, episodeSyncStore)
    }

    fun playStation(station: Station) {
        playbackController.playStation(station)
    }

    fun playEpisode(episode: EpisodeSummary, artworkUrl: String? = null) {
        playbackController.playEpisode(
            episode = episode,
            startPositionMs = episodeSyncStore.getProgress(episode.id),
            artworkUrl = artworkUrl
        )
    }

    fun togglePlayPause() {
        playbackController.togglePlayPause()
    }

    fun seekBack() {
        playbackController.seekBy(-10_000)
    }

    fun seekForward() {
        playbackController.seekBy(30_000)
    }

    fun stopPlayback() {
        playbackController.stop()
    }

    companion object {
        private const val TAG = "WearViewModel"
    }
}
