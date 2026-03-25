package com.hyliankid14.bbcradioplayer

import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.ViewModel

/**
 * ViewModel to hold transient UI state for PodcastsFragment, e.g., the active persisted search query.
 */
class PodcastsViewModel : ViewModel() {
    private val _activeSearchQuery = MutableLiveData<String?>(null)
    val activeSearchQuery: LiveData<String?> = _activeSearchQuery

    // Simple in-memory cache to hold the last search results for a query so we can reuse them
    data class SearchCache(
        val query: String,
        val titleMatches: List<Podcast>,
        val descMatches: List<Podcast>,
        val episodeMatches: List<Pair<Episode, Podcast>>,
        /**
         * Whether this cached result represents a completed search (episodes/FTS scanned)
         * or is a lightweight/partial cache populated by the quick-path. Partial caches
         * should *not* short-circuit the background episode search.
         */
        val isComplete: Boolean = false
    )

    @Volatile
    private var cachedSearch: SearchCache? = null

    // Prebuilt adapter items for fast restore (in-memory only)
    @Volatile
    var cachedSearchItems: List<SearchResultsAdapter.Item>? = null

    // Cached podcasts list + UI state to avoid visible refresh when returning to the Podcasts page
    var cachedPodcasts: List<Podcast> = emptyList()
    var cachedUpdates: Map<String, Long> = emptyMap()
    var cachedEarliestUpdates: Map<String, Long> = emptyMap()
    var cachedNewlyAddedPodcastEpochs: Map<String, Long> = emptyMap()
    var cachedPopularRanks: Map<String, Int> = emptyMap()
    var cachedPopularTitleRanks: Map<String, Int> = emptyMap()
    var cachedGenres: List<String> = emptyList()
    var cachedFilter: PodcastFilter = PodcastFilter()
    var cachedSort: String = "Most popular"

    fun setActiveSearch(query: String?) {
        // Use synchronous set so callers on the main (UI) thread can read the updated
        // value immediately (avoids races when applyFilters reads the LiveData right away).
        _activeSearchQuery.value = query

        // Seed a minimal in-memory cache for the query so the UI can restore quickly
        // even if the full/expensive search hasn't finished yet (e.g., user navigates
        // to an episode immediately after typing). This cache will be replaced with
        // real results once the background search completes.
        if (!query.isNullOrBlank() && cachedSearch?.query != query) {
            cachedSearch = SearchCache(query, emptyList(), emptyList(), emptyList())
        }
    }

    fun clearActiveSearch() {
        _activeSearchQuery.value = null
    }

    fun getCachedSearch(): SearchCache? = cachedSearch
    fun setCachedSearch(cache: SearchCache?) { cachedSearch = cache }
    fun clearCachedSearch() {
        cachedSearch = null
        cachedSearchItems = null
    }
}