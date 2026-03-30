package com.hyliankid14.bbcradioplayer.wear

import android.app.Application
import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

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

    var podcastUpdatedAtMap by mutableStateOf(podcastRepository.getCachedPodcastUpdatedAtMap())
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

    val stationLiveTitleMap = mutableStateMapOf<String, String>()

    val stationLiveDetailMap = mutableStateMapOf<String, String>()

    val nowPlaying: NowPlaying?
        get() = playbackState

    private var playbackState by mutableStateOf(playbackController.currentState)
    private var stationNavigationIds by mutableStateOf<List<String>>(emptyList())
    private var stationNavigationIndex by mutableStateOf(-1)
    private var refreshingUpdatedHints = false
    private var refreshingPodcasts = false
    private val stationShowsInFlight = mutableSetOf<String>()
    private val stationLiveFetchedAtMap = mutableMapOf<String, Long>()

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
                refreshPodcasts()
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
            repeat(5) { attempt ->
                WatchAppStateSync.requestPhoneState(application)
                if (favouritesStore.hasRemoteSnapshot() && subscriptionStore.hasRemoteSnapshot() && episodeSyncStore.hasRemoteSnapshot()) {
                    return@launch
                }
                if (attempt < 4) {
                    delay(15_000L)
                }
            }
        }
        if (podcasts.isEmpty() || podcastRepository.shouldRefreshPodcasts()) {
            refreshPodcasts()
        }
    }

    fun refreshPodcasts() {
        if (refreshingPodcasts) return
        viewModelScope.launch {
            refreshingPodcasts = true
            loadingPodcasts = podcasts.isEmpty()
            errorMessage = null
            podcasts = try {
                podcastRepository.fetchPodcastsForSubscriptions(subscribedPodcastIds)
            } catch (e: Exception) {
                errorMessage = e.message ?: "Podcast loading failed"
                emptyList()
            } finally {
                loadingPodcasts = false
                refreshingPodcasts = false
            }
            refreshPodcastUpdatedHints()
            Log.d(TAG, "refreshPodcasts loaded=${podcasts.size} loading=$loadingPodcasts error=${errorMessage != null}")
        }
    }

    fun prefetchStationShows(stations: List<Station>, limit: Int = 8, forceRefresh: Boolean = false) {
        if (stations.isEmpty()) return
        val targets = stations
            .filter { station ->
                station.serviceId.isNotBlank() &&
                    (
                        stationLiveTitleMap[station.id].isNullOrBlank() ||
                            forceRefresh ||
                            isStationLiveDataStale(station.id)
                        ) &&
                    stationShowsInFlight.add(station.id)
            }
            .take(limit)

        if (targets.isEmpty()) return

        viewModelScope.launch {
            val requestAtMs = System.currentTimeMillis()
            val updates = try {
                withContext(Dispatchers.IO) {
                    targets.associate { station ->
                        station.id to fetchCurrentShow(station.serviceId)
                    }
                }
            } finally {
                targets.forEach { stationShowsInFlight.remove(it.id) }
            }
            val titleUpdates = mutableMapOf<String, String>()
            val detailUpdates = mutableMapOf<String, String>()
            updates.forEach { (stationId, show) ->
                if (show != null) {
                    titleUpdates[stationId] = show.title
                    if (show.detail.isNotBlank()) {
                        detailUpdates[stationId] = show.detail
                    }
                    stationLiveFetchedAtMap[stationId] = requestAtMs
                }
            }
            if (titleUpdates.isNotEmpty()) {
                stationLiveTitleMap.putAll(titleUpdates)
            }
            if (detailUpdates.isNotEmpty()) {
                stationLiveDetailMap.putAll(detailUpdates)
            }
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

    fun playStation(station: Station, navigationStations: List<Station> = emptyList()) {
        val ids = navigationStations.map { it.id }
        if (ids.isNotEmpty()) {
            stationNavigationIds = ids
            stationNavigationIndex = ids.indexOf(station.id)
        } else {
            stationNavigationIds = emptyList()
            stationNavigationIndex = -1
        }
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

    fun skipPreviousInNowPlaying() {
        if (nowPlaying?.isLive == true) {
            skipStation(-1)
        } else {
            seekBack()
        }
    }

    fun skipNextInNowPlaying() {
        if (nowPlaying?.isLive == true) {
            skipStation(1)
        } else {
            seekForward()
        }
    }

    fun canSkipPreviousInNowPlaying(): Boolean {
        if (nowPlaying?.isLive != true) return true
        return stationNavigationIds.size > 1 && stationNavigationIndex in stationNavigationIds.indices
    }

    fun canSkipNextInNowPlaying(): Boolean {
        if (nowPlaying?.isLive != true) return true
        return stationNavigationIds.size > 1 && stationNavigationIndex in stationNavigationIds.indices
    }

    fun stopPlayback() {
        playbackController.stop()
    }

    fun volumeUp() {
        playbackController.adjustVolume(1)
    }

    fun volumeDown() {
        playbackController.adjustVolume(-1)
    }

    fun openVolumeControls() {
        playbackController.adjustVolume(0)
    }

    private fun refreshPodcastUpdatedHints() {
        if (refreshingUpdatedHints) return
        if (subscribedPodcastIds.isEmpty() || podcasts.isEmpty()) return
        val subscribedKnown = podcasts.filter { it.id in subscribedPodcastIds && it.rssUrl.isNotBlank() }
        if (subscribedKnown.isEmpty()) return

        viewModelScope.launch {
            refreshingUpdatedHints = true
            try {
                var remaining = subscribedKnown
                var currentMap = podcastUpdatedAtMap

                while (remaining.isNotEmpty()) {
                    val missing = remaining.filter { (currentMap[it.id] ?: 0L) <= 0L }
                    if (missing.isEmpty()) break

                    val batch = missing.take(MAX_HINT_REFRESH_COUNT)
                    currentMap = podcastRepository.refreshPodcastUpdatedAtHints(batch)
                    podcastUpdatedAtMap = currentMap

                    remaining = missing.drop(batch.size)
                    if (remaining.isNotEmpty()) {
                        delay(HINT_REFRESH_BATCH_DELAY_MS)
                    }
                }
            } finally {
                refreshingUpdatedHints = false
            }
        }
    }

    private fun skipStation(delta: Int) {
        if (stationNavigationIds.isEmpty() || stationNavigationIndex !in stationNavigationIds.indices) {
            return
        }
        val size = stationNavigationIds.size
        val nextIndex = (stationNavigationIndex + delta + size) % size
        val nextId = stationNavigationIds[nextIndex]
        val nextStation = stations.firstOrNull { it.id == nextId } ?: return
        stationNavigationIndex = nextIndex
        playbackController.playStation(nextStation)
    }

    private fun fetchCurrentShow(serviceId: String): LiveShow? {
        return runCatching {
            val url = "https://ess.api.bbci.co.uk/schedules?serviceId=$serviceId&t=${System.currentTimeMillis()}"
            val connection = (URL(url).openConnection() as HttpURLConnection).apply {
                connectTimeout = 4000
                readTimeout = 4000
                requestMethod = "GET"
                setRequestProperty("User-Agent", "BBC Radio Player Wear/1.0")
            }
            if (connection.responseCode != HttpURLConnection.HTTP_OK) {
                connection.disconnect()
                return@runCatching null
            }
            val response = connection.inputStream.bufferedReader().use { it.readText() }
            connection.disconnect()

            val root = JSONObject(response)
            val items = root.optJSONArray("items") ?: return@runCatching null
            val now = System.currentTimeMillis()
            for (index in 0 until items.length()) {
                val item = items.optJSONObject(index) ?: continue
                val published = item.optJSONObject("published_time")
                val start = parseIsoTimeMs(published?.optString("start").orEmpty())
                val end = parseIsoTimeMs(published?.optString("end").orEmpty())
                if (start <= 0L || end <= 0L || now !in start..end) continue

                val brand = item.optJSONObject("brand")
                val episode = item.optJSONObject("episode")
                val brandTitle = brand?.optString("title").orEmpty().trim()
                val episodeTitle = episode?.optString("title").orEmpty().trim()
                val title = brandTitle.ifBlank { episodeTitle }.ifBlank { "On air" }

                val synopsisObj = episode?.optJSONObject("synopses") ?: brand?.optJSONObject("synopses")
                val synopsis = listOf(
                    synopsisObj?.optString("short").orEmpty().trim(),
                    synopsisObj?.optString("medium").orEmpty().trim(),
                    synopsisObj?.optString("long").orEmpty().trim()
                ).firstOrNull { it.isNotBlank() }.orEmpty()

                val detail = when {
                    episodeTitle.isNotBlank() && !episodeTitle.equals(title, ignoreCase = true) -> episodeTitle
                    synopsis.isNotBlank() -> synopsis
                    else -> "On air now"
                }
                return@runCatching LiveShow(title = title, detail = detail)
            }
            null
        }.getOrNull()
    }

    private fun parseIsoTimeMs(rawIso: String): Long {
        return runCatching { java.time.Instant.parse(rawIso).toEpochMilli() }.getOrDefault(0L)
    }

    private fun isStationLiveDataStale(stationId: String): Boolean {
        val fetchedAt = stationLiveFetchedAtMap[stationId] ?: return true
        return (System.currentTimeMillis() - fetchedAt) >= STATION_LIVE_REFRESH_INTERVAL_MS
    }

    private data class LiveShow(
        val title: String,
        val detail: String
    )

    companion object {
        private const val TAG = "WearViewModel"
        private const val MAX_HINT_REFRESH_COUNT = 10
        private const val HINT_REFRESH_BATCH_DELAY_MS = 200L
        private const val STATION_LIVE_REFRESH_INTERVAL_MS = 120_000L
    }
}
