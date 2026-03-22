package com.hyliankid14.bbcradioplayer

import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.EditText
import android.widget.ImageView
import android.widget.ProgressBar
import android.widget.SeekBar
import android.widget.Spinner
import android.widget.TextView
import androidx.fragment.app.Fragment
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withTimeoutOrNull
import java.util.Locale
import android.view.KeyEvent
import android.widget.Toast

class PodcastsFragment : Fragment() {
    private lateinit var viewModel: PodcastsViewModel
    private lateinit var repository: PodcastRepository
    // Keep both adapters and swap depending on whether a search query is active
    private lateinit var podcastAdapter: PodcastAdapter
    private var searchAdapter: SearchResultsAdapter? = null
    private var allPodcasts: List<Podcast> = emptyList()
    private var currentFilter = PodcastFilter()
    private var currentSort: String = "Most popular"
    private var cachedUpdates: Map<String, Long> = emptyMap()
    private var searchQuery = ""
    private var searchEditText: com.google.android.material.textfield.MaterialAutoCompleteTextView? = null
    private var searchInputLayout: com.google.android.material.textfield.TextInputLayout? = null
    private var saveSearchButton: android.widget.Button? = null
    // Active search state is persisted in the ViewModel while the activity lives
    // Suppress the text watcher when programmatically updating the search EditText
    private var suppressSearchWatcher: Boolean = false
    // Debounce job for search input changes
    private var filterDebounceJob: kotlinx.coroutines.Job? = null
    // Job for ongoing search; cancel when a new query arrives
    private var searchJob: kotlinx.coroutines.Job? = null
    // When true, suppress automatic applyFilters calls during restore
    private var restoringFromCache: Boolean = false
    // When restoring a large cached adapter, append items in chunks
    private var restoreAppendJob: kotlinx.coroutines.Job? = null
    private var usingCachedItemAppend: Boolean = false
    // Flag to scroll to top when next results are displayed
    private var shouldScrollToTopOnNextResults: Boolean = false
    // Use viewLifecycleOwner.lifecycleScope for UI coroutines (auto-cancelled when the view is destroyed)

    // Shake-to-random-podcast detection
    private var sensorManager: android.hardware.SensorManager? = null
    private var lastShakeTime: Long = 0L
    private val shakeListener = object : android.hardware.SensorEventListener {
        private var lastUpdate: Long = 0L
        override fun onSensorChanged(event: android.hardware.SensorEvent) {
            val now = System.currentTimeMillis()
            if (now - lastUpdate < 100) return
            lastUpdate = now
            val x = event.values[0]
            val y = event.values[1]
            val z = event.values[2]
            val gForce = kotlin.math.sqrt((x * x + y * y + z * z).toDouble()).toFloat() /
                android.hardware.SensorManager.GRAVITY_EARTH
            if (gForce > SHAKE_THRESHOLD_GRAVITY && now - lastShakeTime > SHAKE_DEBOUNCE_MS) {
                lastShakeTime = now
                activity?.runOnUiThread {
                    try { shuffleAndOpenRandomPodcast() } catch (e: Exception) {
                        android.util.Log.w("PodcastsFragment", "Shake shuffle failed: ${e.message}")
                    }
                }
            }
        }
        override fun onAccuracyChanged(sensor: android.hardware.Sensor?, accuracy: Int) {}
    }

    // Normalize queries for robust cache lookups (trim + locale-aware lowercase)
    private fun normalizeQuery(q: String?): String = q?.trim()?.lowercase(Locale.getDefault()) ?: ""

    // Small delay to let IMEs commit composition before we read the EditText text
    private val IME_COMMIT_DELAY_MS = 50L
    private val BROWSE_SPINNER_DELAY_MS = 120L
    private val SEARCH_SPINNER_DELAY_MS = 60L

    // Snapshot of what's currently displayed to avoid redundant adapter/visibility swaps
    private data class DisplaySnapshot(val queryNorm: String, val filterHash: Int, val isSearchAdapter: Boolean)
    private var lastDisplaySnapshot: DisplaySnapshot? = null
    private var lastActiveQueryNorm: String = ""

    // Track the language filter preference value that was active when the podcast list was last loaded
    private var lastLoadedExcludeNonEnglish: Boolean? = null

    private fun currentFilterHash(): Int = (currentFilter.hashCode() * 31) xor currentSort.hashCode()

    /** Update the search field's end icon based on whether the field is empty.
     *  Empty → shuffle icon; non-empty → clear (X) icon. */
    private fun updateSearchEndIcon(empty: Boolean) {
        val layout = searchInputLayout ?: return
        val editText = searchEditText ?: return
        try {
            layout.endIconMode = com.google.android.material.textfield.TextInputLayout.END_ICON_CUSTOM
            if (empty) {
                layout.endIconDrawable = requireContext().getDrawable(R.drawable.ic_shuffle)
                layout.endIconContentDescription = getString(R.string.shuffle_podcast_desc)
                layout.setEndIconOnClickListener {
                    try { shuffleAndOpenRandomPodcast() } catch (e: Exception) {
                        android.util.Log.w("PodcastsFragment", "Shuffle failed: ${e.message}")
                    }
                }
            } else {
                layout.endIconDrawable = requireContext().getDrawable(R.drawable.ic_clear)
                layout.endIconContentDescription = getString(R.string.clear_search)
                layout.setEndIconOnClickListener {
                    suppressSearchWatcher = true
                    editText.text?.clear()
                    suppressSearchWatcher = false
                    viewModel.clearActiveSearch()
                    updateSearchEndIcon(true)
                    val imm = requireContext().getSystemService(android.content.Context.INPUT_METHOD_SERVICE)
                        as android.view.inputmethod.InputMethodManager
                    imm.hideSoftInputFromWindow(editText.windowToken, 0)
                    editText.clearFocus()
                }
            }
            layout.isEndIconVisible = true
        } catch (e: Exception) {
            android.util.Log.w("PodcastsFragment", "updateSearchEndIcon failed: ${e.message}")
        }
    }

    private fun updateSaveSearchButtonVisibility() {
        val active = viewModel.activeSearchQuery.value ?: searchQuery
        val visible = active.isNotBlank()
        saveSearchButton?.visibility = if (visible) View.VISIBLE else View.GONE
    }

    private fun bindGenreSpinner(
        genreSpinner: com.google.android.material.textfield.MaterialAutoCompleteTextView,
        genres: List<String>,
        emptyState: TextView,
        recyclerView: RecyclerView
    ) {
        val spinnerAdapter = NoFilterArrayAdapter(requireContext(), R.layout.dropdown_item_large, genres)
        spinnerAdapter.setDropDownViewResource(R.layout.dropdown_item_large)
        genreSpinner.setAdapter(spinnerAdapter)

        val desired = currentFilter.genres.firstOrNull() ?: "All Genres"
        val safeSelection = if (genres.contains(desired)) desired else "All Genres"
        genreSpinner.setText(safeSelection, false)

        genreSpinner.setOnItemClickListener { parent, _, position, _ ->
            if (suppressSearchWatcher) return@setOnItemClickListener
            restoreAppendJob?.cancel()
            usingCachedItemAppend = false
            restoringFromCache = false
            val selected = parent?.getItemAtPosition(position) as? String ?: return@setOnItemClickListener
            currentFilter = if (selected == "All Genres") {
                currentFilter.copy(genres = emptySet())
            } else {
                currentFilter.copy(genres = setOf(selected))
            }
            viewModel.cachedFilter = currentFilter
            // Re-apply filters against any existing cached search (do NOT clear cache here).
            applyFilters(emptyState, recyclerView)
        }
    }

    private fun bindSortSpinner(
        sortSpinner: com.google.android.material.textfield.MaterialAutoCompleteTextView,
        emptyState: TextView,
        recyclerView: RecyclerView
    ) {
        val sortOptions = listOf("Most popular", "Most recent", "Alphabetical (A-Z)")
        val sortAdapter = NoFilterArrayAdapter(requireContext(), R.layout.dropdown_item_large, sortOptions)
        sortAdapter.setDropDownViewResource(R.layout.dropdown_item_large)
        sortSpinner.setAdapter(sortAdapter)
        sortSpinner.setText(currentSort, false)
        sortSpinner.setOnItemClickListener { parent, _, position, _ ->
            if (suppressSearchWatcher) return@setOnItemClickListener
            restoreAppendJob?.cancel()
            usingCachedItemAppend = false
            restoringFromCache = false
            val selected = parent?.getItemAtPosition(position) as? String ?: return@setOnItemClickListener
            android.util.Log.d("PodcastsFragment", "Sort spinner listener: selected='$selected', currentSort='$currentSort'")
            if (selected == currentSort) {
                android.util.Log.d("PodcastsFragment", "Sort order unchanged, skipping applyFilters")
                return@setOnItemClickListener
            }
            currentSort = selected
            viewModel.cachedSort = currentSort
            android.util.Log.d("PodcastsFragment", "Sort changed to: $currentSort, calling applyFilters")
            // Re-apply sort against any existing cached search (do NOT clear cache here).
            applyFilters(emptyState, recyclerView)
        }
    }

    private fun rebuildFilterSpinners(emptyState: TextView, recyclerView: RecyclerView) {
        val view = view ?: return
        val genreSpinner = view.findViewById<com.google.android.material.textfield.MaterialAutoCompleteTextView>(R.id.genre_filter_spinner)
        val sortSpinner = view.findViewById<com.google.android.material.textfield.MaterialAutoCompleteTextView>(R.id.sort_spinner)
        val genres = if (allPodcasts.isNotEmpty()) {
            listOf("All Genres") + repository.getUniqueGenres(allPodcasts)
        } else if (viewModel.cachedGenres.isNotEmpty()) {
            viewModel.cachedGenres
        } else {
            listOf("All Genres")
        }
        viewModel.cachedGenres = genres
        suppressSearchWatcher = true
        try {
            bindGenreSpinner(genreSpinner, genres, emptyState, recyclerView)
            bindSortSpinner(sortSpinner, emptyState, recyclerView)
        } finally {
            suppressSearchWatcher = false
        }
    }

    private fun showResultsSafely(
        recyclerView: RecyclerView,
        adapter: RecyclerView.Adapter<*>?,
        isSearchAdapter: Boolean,
        hasContent: Boolean,
        emptyState: TextView
    ) {
        val queryNorm = normalizeQuery(viewModel.activeSearchQuery.value ?: searchQuery)
        val snap = DisplaySnapshot(queryNorm, currentFilterHash(), isSearchAdapter)
        // Capture current adapter to avoid races with mutable properties
        val currentAdapter = recyclerView.adapter
        
        android.util.Log.d("PodcastsFragment", "showResultsSafely: snap=$snap lastDisplaySnapshot=$lastDisplaySnapshot currentAdapter=$currentAdapter adapter=$adapter hasContent=$hasContent")
        
        // If the same snapshot is already displayed and adapter instance matches, skip any UI work
        if (lastDisplaySnapshot == snap && currentAdapter == adapter) {
            android.util.Log.d("PodcastsFragment", "showResultsSafely: snapshot and adapter match, skipping UI update")
            return
        }
        lastDisplaySnapshot = snap
        lastActiveQueryNorm = queryNorm

        // Apply adapter and visibility in a single, atomic UI update to avoid flicker
        android.util.Log.d("PodcastsFragment", "showResultsSafely: updating UI - adapter=${adapter?.javaClass?.simpleName} hasContent=$hasContent")
        recyclerView.adapter = adapter
        
        // Scroll to top when displaying new search results if flag is set
        // Use post() to defer scroll until after the adapter layout is complete
        if (shouldScrollToTopOnNextResults) {
            recyclerView.post {
                recyclerView.scrollToPosition(0)
            }
            shouldScrollToTopOnNextResults = false
        }
        
        if (hasContent) {
            emptyState.visibility = View.GONE
            recyclerView.visibility = View.VISIBLE
        } else {
            emptyState.visibility = View.VISIBLE
            recyclerView.visibility = View.GONE
        }
    }

    // Leading quick-search helper: run the unified search immediately for snappy UX
    private fun scheduleQuickSearch(emptyState: TextView, recyclerView: RecyclerView) {
        // Use the same single-path search so there's only one codepath to maintain
        viewLifecycleOwner.lifecycleScope.launch { if (isAdded) applyFilters(emptyState, recyclerView) }
    }

    // Keep a tiny suspend wrapper for compatibility with any callers — it delegates to applyFilters
    private suspend fun applyFiltersQuick(emptyState: TextView, recyclerView: RecyclerView) {
        withContext(Dispatchers.Main) { applyFilters(emptyState, recyclerView) }
    }

    // Pagination / lazy-loading state
    private val pageSize = 15
    private var currentPage = 0
    private var isLoadingPage = false
    private var filteredList: List<Podcast> = emptyList()

    // Episode-search pagination state (index-backed)
    private val INITIAL_EPISODE_DISPLAY_LIMIT = 150        // how many episodes to try to show immediately
    private val EPISODE_PAGE_SIZE = 25                    // page size when scrolling
    private val INDEX_STALE_THRESHOLD_MS = 7L * 24L * 60L * 60L * 1_000L  // 7 days
    private var resolvedEpisodeMatches: MutableList<Pair<Episode, Podcast>> = mutableListOf()
    // How many episode items are currently displayed by the adapter (used for search pagination)
    private var displayedEpisodeCount: Int = 0
    // Cached full episode matches for fast restore pagination (to avoid UI hangs)
    private var cachedEpisodeMatchesFull: List<Pair<Episode, Podcast>> = emptyList()
    private var isSearchPopulating: Boolean = false
    private var searchGeneration: Long = 0L
    private var episodePaginationJob: kotlinx.coroutines.Job? = null
    private var usingCachedEpisodePagination: Boolean = false
    private val RESTORE_ITEM_INITIAL = 100
    private val RESTORE_ITEM_CHUNK = 100
    private var cachedSearchAdapter: SearchResultsAdapter? = null

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View? {
        return inflater.inflate(R.layout.fragment_podcasts, container, false)
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        repository = PodcastRepository(requireContext())
        // Initialize ViewModel scoped to the Activity so it survives fragment navigation
        viewModel = ViewModelProvider(requireActivity()).get(PodcastsViewModel::class.java)

        val recyclerView: RecyclerView = view.findViewById(R.id.podcasts_recycler)
        val searchEditText: com.google.android.material.textfield.MaterialAutoCompleteTextView = view.findViewById(R.id.search_podcast_edittext)
        // TextInputLayout that wraps the EditText — used to control the end-icon visibility reliably
        val searchInputLayout = view.findViewById<com.google.android.material.textfield.TextInputLayout>(R.id.search_podcast_text_input)
        this.searchEditText = searchEditText
        this.searchInputLayout = searchInputLayout

        // Setup search history backing and adapter
        val searchHistory = SearchHistory(requireContext())
        val historyAdapter = android.widget.ArrayAdapter(requireContext(), android.R.layout.simple_dropdown_item_1line, searchHistory.getRecent())
        searchEditText.setAdapter(historyAdapter)

        // Restore the active search into the edit text when the view is (re)created, without triggering the watcher
        suppressSearchWatcher = true
        val restored = viewModel.activeSearchQuery.value
        searchEditText.setText(restored ?: "")
        if (!restored.isNullOrEmpty()) searchEditText.setSelection(searchEditText.text.length)
        // Ensure the clear (end) icon reflects the restored text immediately (fixes OEMs that only show it after IME events)
        updateSearchEndIcon(searchEditText.text.isNullOrEmpty())
        suppressSearchWatcher = false
        android.util.Log.d("PodcastsFragment", "onViewCreated: viewModel.activeSearchQuery='${restored}' searchEditText='${searchEditText.text}'")

        // Try to restore a persisted search cache (survives navigation/process-restores). Only restore
        // if the persisted query matches the currently active query so we don't override unrelated state.
        try {
            val persisted = SearchCacheStore.load(requireContext())
            if (persisted != null && normalizeQuery(persisted.query) == normalizeQuery(viewModel.activeSearchQuery.value) && viewModel.getCachedSearch() == null) {
                android.util.Log.d("PodcastsFragment", "Restoring persisted search cache for='${persisted.query}'")
                viewModel.setCachedSearch(persisted)
            }
        } catch (_: Exception) { /* best-effort */ }

        // If we have an active cached search, suppress automatic reloads during restore
        try {
            val activeNorm = normalizeQuery(viewModel.activeSearchQuery.value)
            val cached = viewModel.getCachedSearch()
            if (activeNorm.isNotEmpty() && cached != null && normalizeQuery(cached.query) == activeNorm) {
                restoringFromCache = true
            }
        } catch (_: Exception) { }

        // Observe active search and update hint + edit text when it changes
        viewModel.activeSearchQuery.observe(viewLifecycleOwner) { q ->

            // Avoid invalidating the display snapshot when the same query is re-applied programmatically
            val newNorm = normalizeQuery(q)
            if (newNorm != lastActiveQueryNorm) {
                lastDisplaySnapshot = null
                lastActiveQueryNorm = newNorm
            }

            // Ensure edit text reflects current active search without triggering watcher
            val current = searchEditText.text?.toString() ?: ""
            if (current != (q ?: "")) {
                suppressSearchWatcher = true
                searchEditText.setText(q ?: "")
                if (!q.isNullOrEmpty()) searchEditText.setSelection(searchEditText.text.length)
                suppressSearchWatcher = false
            }
            // Always sync icon state (covers both text changes and programmatic clears)
            updateSearchEndIcon(q.isNullOrEmpty())

            updateSaveSearchButtonVisibility()
        }

        val filterButton: android.widget.ImageButton = view.findViewById(R.id.podcasts_filter_button)
        val shuffleButton: android.widget.ImageButton = view.findViewById(R.id.podcasts_shuffle_button)
        shuffleButton.setOnClickListener {
            try { shuffleAndOpenRandomPodcast() } catch (e: Exception) {
                android.util.Log.w("PodcastsFragment", "Shuffle button failed: ${e.message}")
            }
        }
        val genreSpinner: com.google.android.material.textfield.MaterialAutoCompleteTextView = view.findViewById(R.id.genre_filter_spinner)
        val sortSpinner: com.google.android.material.textfield.MaterialAutoCompleteTextView = view.findViewById(R.id.sort_spinner)
        val resetButton: android.widget.Button = view.findViewById(R.id.reset_filters_button)
        val saveButton: android.widget.Button = view.findViewById(R.id.save_search_button)
        saveSearchButton = saveButton
        updateSaveSearchButtonVisibility()
        val loadingIndicator: ProgressBar = view.findViewById(R.id.loading_progress)
        val emptyState: TextView = view.findViewById(R.id.empty_state_text)
        val filtersContainer: View = view.findViewById(R.id.filters_container)

        searchEditText.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: Editable?) {
                if (suppressSearchWatcher) return
                // If we're restoring a cached search, ignore any text events triggered by setup
                if (restoringFromCache) return
                restoreAppendJob?.cancel()
                usingCachedItemAppend = false
                restoringFromCache = false
                // Update the end-icon: show shuffle when empty, clear when non-empty
                updateSearchEndIcon(s.isNullOrEmpty())

                searchQuery = s?.toString() ?: ""
                // If the user cleared the search box, clear the active persisted search and update immediately
                if (searchQuery.isBlank()) {
                    android.util.Log.d("PodcastsFragment", "afterTextChanged: search box cleared, clearing active search (was='${viewModel.activeSearchQuery.value}')")
                    viewModel.clearActiveSearch()
                    // Cancel any ongoing searches immediately
                    searchJob?.cancel()
                    searchJob = null
                    filterDebounceJob?.cancel()
                    filterDebounceJob = null

                    updateSaveSearchButtonVisibility()
                    return
                }

                // When user types a non-empty query, set it as the active search that will persist
                // Clear any previously cached results so we rebuild for the new query
                // Clear both in-memory and persisted search cache
                clearCachedSearchPersisted()
                viewModel.setActiveSearch(searchQuery)

                updateSaveSearchButtonVisibility()

                // Leading-edge quick update: show title/description matches immediately for snappy UX
                // while the debounced full search (episodes + FTS) is scheduled.
                if (filterDebounceJob == null || filterDebounceJob?.isActive == false) {
                    // Schedule the suspendable quick search from a coroutine (cancellable)
                    scheduleQuickSearch(emptyState, recyclerView)
                }

                // Debounce the application of filters to avoid running heavy searches on every keystroke
                filterDebounceJob?.cancel()
                filterDebounceJob = viewLifecycleOwner.lifecycleScope.launch {
                    kotlinx.coroutines.delay(150) // shorter debounce for snappier typing
                    // If fragment is gone, abort
                    if (!isAdded) return@launch
                    applyFilters(emptyState, recyclerView)

                    // Add to search history (deduplicated and prefix-guarded inside helper) and refresh adapter
                    try {
                        // Avoid adding very short queries from debounce (reduces noise)
                        val MIN_HISTORY_LENGTH = 3
                        if (searchQuery.length >= MIN_HISTORY_LENGTH) {
                            searchHistory.add(searchQuery)
                        }
                        withContext(Dispatchers.Main) {
                            historyAdapter.clear()
                            historyAdapter.addAll(searchHistory.getRecent())
                        }
                    } catch (e: Exception) {
                        android.util.Log.w("PodcastsFragment", "Failed to update search history: ${e.message}")
                    }
                }
            }
        })

        // Handle IME action (search/enter) to apply filters immediately and hide keyboard.
        // Some keyboards send IME_ACTION_DONE or a raw ENTER key event, so handle those too.
        searchEditText.setOnEditorActionListener { v, actionId, event ->
            val isSearchKey = (actionId == android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH)
                    || (actionId == android.view.inputmethod.EditorInfo.IME_ACTION_DONE)
                    || (actionId == android.view.inputmethod.EditorInfo.IME_ACTION_GO)
                    || (event != null && event.keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_DOWN)

            if (!isSearchKey) return@setOnEditorActionListener false

            // Cancel any pending debounce and apply filters immediately
            filterDebounceJob?.cancel()
            restoreAppendJob?.cancel()
            usingCachedItemAppend = false
            restoringFromCache = false

            val imm = requireContext().getSystemService(android.content.Context.INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager
            imm.hideSoftInputFromWindow(v.windowToken, 0)
            v.clearFocus()

            // Read the current text directly from the view to avoid races (IME or composition may not have updated local state)
            val current = (v.text?.toString() ?: "").trim()
            // Keep local searchQuery in sync so other code paths rely on the latest value
            searchQuery = current

            // Re-assert end-icon visibility after the IME is dismissed (icon is always visible)
            try { searchInputLayout.isEndIconVisible = true } catch (_: Exception) { }

            // Commit current query as active search and add to history
            if (current.isNotBlank()) {
                viewModel.setActiveSearch(current)
                try {
                    searchHistory.add(current)
                    historyAdapter.clear()
                    historyAdapter.addAll(searchHistory.getRecent())
                } catch (e: Exception) {
                    android.util.Log.w("PodcastsFragment", "Failed to persist search history: ${e.message}")
                }
            }

            // Post the apply so the IME/view has time to commit composition state — prevents "stops after submit" bugs
            v.postDelayed({ if (isAdded) applyFilters(emptyState, recyclerView) }, IME_COMMIT_DELAY_MS)
            true
        }

        recyclerView.layoutManager = LinearLayoutManager(requireContext())
        podcastAdapter = PodcastAdapter(requireContext(), onPodcastClick = { podcast -> onPodcastClicked(podcast) }, showNotificationBell = false)
        recyclerView.itemAnimator = null

        // Shuffle helper: open episodes page for a random podcast
        fun shuffleAndOpenRandomPodcastLocal() { shuffleAndOpenRandomPodcast() }
        recyclerView.adapter = podcastAdapter

        // Show a dropdown of recent searches when the field is focused or typed into
        searchEditText.onFocusChangeListener = View.OnFocusChangeListener { _, hasFocus ->
            if (hasFocus) {
                historyAdapter.clear()
                historyAdapter.addAll(searchHistory.getRecent())
                searchEditText.showDropDown()
            }
            // Always keep the end icon visible regardless of focus state
            try { searchInputLayout.isEndIconVisible = true } catch (_: Exception) { }
        }
        // When the user selects a history item, populate search and apply immediately
        searchEditText.setOnItemClickListener { parent, _, position, _ ->
            val sel = parent?.getItemAtPosition(position) as? String ?: return@setOnItemClickListener
            restoreAppendJob?.cancel()
            usingCachedItemAppend = false
            restoringFromCache = false
            suppressSearchWatcher = true
            searchEditText.setText(sel)
            searchEditText.setSelection(sel.length)
            // Ensure clear icon is visible for the selected text
            try { searchInputLayout.isEndIconVisible = true } catch (_: Exception) { }
            suppressSearchWatcher = false
            // Keep local state in sync and commit immediately so applyFilters uses the selected text
            searchQuery = sel
            viewModel.setActiveSearch(sel)
            try {
                searchHistory.add(sel)
                historyAdapter.clear()
                historyAdapter.addAll(searchHistory.getRecent())
            } catch (e: Exception) {
                android.util.Log.w("PodcastsFragment", "Failed to update search history on selection: ${e.message}")
            }
            // Post with a tiny delay so AutoCompleteTextView finishes its internal state changes
            // (some implementations update internal state asynchronously) before running search.
            searchEditText.postDelayed({ if (isAdded) applyFilters(emptyState, recyclerView) }, IME_COMMIT_DELAY_MS)
        }

        // Ensure the global action bar is shown when navigating into a podcast detail

        // Subscribed podcasts are shown in Favorites section, not here

        // Duration filter removed

        resetButton.setOnClickListener {
            // Clear both the typed query and the active persisted search; clear cached search results
            searchJob?.cancel()
            restoringFromCache = false
            restoreAppendJob?.cancel()
            usingCachedItemAppend = false
            usingCachedEpisodePagination = false
            cachedEpisodeMatchesFull = emptyList()
            searchQuery = ""
            viewModel.clearActiveSearch()
            // Clear both in-memory and persisted search cache
            clearCachedSearchPersisted()
            // Also forget the last displayed snapshot so UI won't attempt to re-use it
            lastDisplaySnapshot = null
            lastActiveQueryNorm = ""
            currentFilter = PodcastFilter()
            currentSort = "Most popular"
            // Set exposed dropdowns back to 'All Genres' / default label
            genreSpinner.setText("All Genres", false)
            sortSpinner.setText("Most popular", false)
            viewModel.cachedFilter = currentFilter
            viewModel.cachedSort = "Most popular"
            // Reset the title bar to the default Podcasts state (remove back navigation)
            resetTitleBar()
            applyFilters(emptyState, recyclerView)
            updateSaveSearchButtonVisibility()
        }

        saveButton.setOnClickListener {
            showSaveSearchDialog()
        }

        // Toggle filters visibility from the search app bar filter button
        filterButton.setOnClickListener {
            filtersContainer.visibility = if (filtersContainer.visibility == View.VISIBLE) View.GONE else View.VISIBLE
        }

        // Show a FAB when the user scrolls and implement lazy loading near list end.
        val fab: com.google.android.material.floatingactionbutton.FloatingActionButton? = view.findViewById(R.id.scroll_to_top_fab)
        val recyclerViewForScroll: RecyclerView = view.findViewById(R.id.podcasts_recycler)

        // Prevent navbar from resizing when keyboard opens while in this fragment
        val previousSoftInputMode = requireActivity().window.attributes.softInputMode
        requireActivity().window.setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING)

        // Recycler-native scroll listener for FAB visibility and pagination
        recyclerViewForScroll.addOnScrollListener(object : RecyclerView.OnScrollListener() {
            override fun onScrolled(recyclerView: RecyclerView, dx: Int, dy: Int) {
                super.onScrolled(recyclerView, dx, dy)
                val layoutManager = recyclerView.layoutManager as? LinearLayoutManager ?: return

                // Show/hide FAB based on vertical offset in the RecyclerView
                val verticalOffset = recyclerView.computeVerticalScrollOffset()
                val dp200 = (200 * resources.displayMetrics.density).toInt()
                if (verticalOffset > dp200) fab?.visibility = View.VISIBLE else fab?.visibility = View.GONE

                if (isLoadingPage) return
                val total = layoutManager.itemCount
                if (total <= 0) return
                val lastVisible = layoutManager.findLastVisibleItemPosition()
                if (lastVisible >= total - 5) {
                    loadNextPage()
                }
            }
        })

        // Restore previous mode when view is destroyed
        viewLifecycleOwner.lifecycle.addObserver(object : androidx.lifecycle.LifecycleEventObserver {
            override fun onStateChanged(source: androidx.lifecycle.LifecycleOwner, event: androidx.lifecycle.Lifecycle.Event) {
                if (event == androidx.lifecycle.Lifecycle.Event.ON_DESTROY) {
                    requireActivity().window.setSoftInputMode(previousSoftInputMode)
                    // Cancel any ongoing search jobs to prevent crashes and memory leaks
                    searchJob?.cancel()
                    searchJob = null
                    filterDebounceJob?.cancel()
                    filterDebounceJob = null
                }
            }
        })

        // FAB jumps the list back to top immediately
        fab?.setOnClickListener {
            recyclerViewForScroll.stopScroll()
            recyclerViewForScroll.scrollToPosition(0)
        }

        // Fast restore: if we already have cached data in the ViewModel, reuse it to avoid UI flicker
        if (viewModel.cachedPodcasts.isNotEmpty()) {
            allPodcasts = viewModel.cachedPodcasts
            cachedUpdates = viewModel.cachedUpdates
            currentFilter = viewModel.cachedFilter
            // Restore sort: use cached sort if available, otherwise use default
            currentSort = if (viewModel.cachedSort.isNotEmpty()) {
                viewModel.cachedSort
            } else {
                "Most popular"
            }

            // Always rebuild genres from the cached podcasts so the spinner stays populated
            val genres = listOf("All Genres") + repository.getUniqueGenres(allPodcasts)
            viewModel.cachedGenres = genres

            // Check if we have a cached search that onResume will restore
            val activeNorm = normalizeQuery(viewModel.activeSearchQuery.value)
            val cached = viewModel.getCachedSearch()
            val hasCachedSearch = activeNorm.isNotEmpty() && cached != null && normalizeQuery(cached.query) == activeNorm
            
            // Bind spinners first so filters work (suppress initial callbacks)
            suppressSearchWatcher = true
            try {
                bindGenreSpinner(genreSpinner, genres, emptyState, recyclerView)
                bindSortSpinner(sortSpinner, emptyState, recyclerView)
            } finally {
                suppressSearchWatcher = false
            }
            loadingIndicator.visibility = View.GONE
            emptyState.text = "No podcasts found"
            
            if (hasCachedSearch && cached != null) {
                // Don't do anything - let onResume handle the instant restore
                // This prevents slow adapter recreation and keeps everything fast
                restoringFromCache = true
                android.util.Log.d("PodcastsFragment", "onViewCreated: cached search exists, letting onResume restore it")
            } else {
                // No cached search, proceed with normal setup
                restoringFromCache = false
                applyFilters(emptyState, recyclerView)
            }
            return
        }

        loadPodcasts(loadingIndicator, emptyState, recyclerView, genreSpinner, sortSpinner)
    }

    /**
     * Called by host activity after podcast-related preferences change (eg. exclude non-English)
     * to refresh the list immediately if this fragment is visible.
     */
    fun refreshPodcastsDueToPreferenceChange() {
        try {
            val view = view ?: return
            val loadingIndicator: ProgressBar = view.findViewById(R.id.loading_progress)
            val emptyState: TextView = view.findViewById(R.id.empty_state_text)
            val recyclerView: RecyclerView = view.findViewById(R.id.podcasts_recycler)
            val genreSpinner: com.google.android.material.textfield.MaterialAutoCompleteTextView = view.findViewById(R.id.genre_filter_spinner)
            val sortSpinner: com.google.android.material.textfield.MaterialAutoCompleteTextView = view.findViewById(R.id.sort_spinner)
            loadPodcasts(loadingIndicator, emptyState, recyclerView, genreSpinner, sortSpinner)
        } catch (e: Exception) {
            android.util.Log.w("PodcastsFragment", "refreshPodcastsDueToPreferenceChange failed: ${e.message}")
        }
    }

    private fun loadPodcasts(
        loadingIndicator: ProgressBar,
        emptyState: TextView,
        recyclerView: RecyclerView,
        genreSpinner: com.google.android.material.textfield.MaterialAutoCompleteTextView,
        sortSpinner: com.google.android.material.textfield.MaterialAutoCompleteTextView
    ) {
        lastLoadedExcludeNonEnglish = PodcastFilterPreference.excludeNonEnglish(requireContext())
        loadingIndicator.visibility = View.VISIBLE
        emptyState.text = "No podcasts found"
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                // STEP 1: Show any locally available data immediately (stale disk cache or bundled
                //         seed asset) so the list appears without waiting for a network round-trip.
                val (immediate, needsRefresh) = withContext(Dispatchers.IO) {
                    repository.getAvailablePodcastsNow() to repository.needsNetworkRefresh()
                }

                if (immediate.isNotEmpty()) {
                    android.util.Log.d("PodcastsFragment", "Showing ${immediate.size} local podcasts immediately (needsRefresh=$needsRefresh)")
                    displayPodcasts(immediate, loadingIndicator, emptyState, recyclerView, genreSpinner, sortSpinner)
                }

                // STEP 2: If the cache is stale or missing, fetch fresh data from the network.
                //         This runs in the background after the local data is already displayed.
                if (needsRefresh) {
                    // forceRefresh=false: use the network only when the TTL has expired
                    val fresh = withContext(Dispatchers.IO) { repository.fetchPodcasts(forceRefresh = false) }
                    android.util.Log.d("PodcastsFragment", "Network refresh: loaded ${fresh.size} podcasts")

                    if (fresh.isEmpty()) {
                        if (allPodcasts.isEmpty()) {
                            emptyState.text = "No podcasts found. Check your connection and try again."
                            emptyState.visibility = View.VISIBLE
                            loadingIndicator.visibility = View.GONE
                        }
                        return@launch
                    }

                    displayPodcasts(fresh, loadingIndicator, emptyState, recyclerView, genreSpinner, sortSpinner)
                } else if (immediate.isEmpty()) {
                    // This branch should not occur in practice: a fresh cache implies data exists.
                    // Handled defensively to avoid leaving the UI in a broken state.
                    emptyState.text = "No podcasts found. Try refreshing the app."
                    emptyState.visibility = View.VISIBLE
                    loadingIndicator.visibility = View.GONE
                    return@launch
                }

                // STEP 3 runs after Steps 1 and 2 have completed (all sequential in this coroutine).
                // Fetch update timestamps in the background for "Most recent" sort.
                // allPodcasts has been updated by whichever display step ran last.
                val updates = withContext(Dispatchers.IO) { repository.fetchLatestUpdates(allPodcasts) }
                cachedUpdates = updates
                viewModel.cachedUpdates = updates
                loadingIndicator.visibility = View.GONE
                applyFilters(emptyState, recyclerView)

                // STEP 4: Background prefetch of episode metadata for top podcasts.
                // (prefetching all podcasts was too expensive and caused slowdown).
                viewLifecycleOwner.lifecycleScope.launch {
                    try {
                        val prefetchCount = Math.min(100, allPodcasts.size)
                        withContext(Dispatchers.IO) { repository.prefetchEpisodesForPodcasts(allPodcasts.take(prefetchCount), limit = prefetchCount) }
                        android.util.Log.d("PodcastsFragment", "Prefetched episode metadata for top $prefetchCount podcasts")
                    } catch (e: Exception) {
                        android.util.Log.w("PodcastsFragment", "Episode prefetch failed: ${e.message}")
                    }
                }

                // Background indexing (Room FTS) disabled (waiting for Gradle/Kapt fix). In the meantime we rely on limited prefetches for search.

                loadingIndicator.visibility = View.GONE
            } catch (e: Exception) {
                android.util.Log.e("PodcastsFragment", "Error loading podcasts", e)
                if (allPodcasts.isEmpty()) {
                    emptyState.text = "Error loading podcasts: ${e.message}"
                    emptyState.visibility = View.VISIBLE
                }
                loadingIndicator.visibility = View.GONE
            }
        }
    }

    /**
     * Update [allPodcasts] with the given list and refresh all related UI state:
     * genre/sort spinners, default sort order, loading indicator, and the list display.
     * Called from [loadPodcasts] both for the immediate local result and the subsequent
     * network-refresh result.
     */
    private fun displayPodcasts(
        podcasts: List<Podcast>,
        loadingIndicator: ProgressBar,
        emptyState: TextView,
        recyclerView: RecyclerView,
        genreSpinner: com.google.android.material.textfield.MaterialAutoCompleteTextView,
        sortSpinner: com.google.android.material.textfield.MaterialAutoCompleteTextView
    ) {
        val genres = listOf("All Genres") + repository.getUniqueGenres(podcasts)
        viewModel.cachedGenres = genres
        bindGenreSpinner(genreSpinner, genres, emptyState, recyclerView)
        bindSortSpinner(sortSpinner, emptyState, recyclerView)

        val hasActiveSearch = !viewModel.activeSearchQuery.value.isNullOrBlank() || searchQuery.isNotBlank()
        allPodcasts = if (!hasActiveSearch) {
            currentSort = "Most popular"
            currentFilter = PodcastFilter(genres = emptySet(), minDuration = 0, maxDuration = Int.MAX_VALUE, searchQuery = "")
            viewModel.cachedSort = currentSort
            viewModel.cachedFilter = currentFilter
            podcasts.sortedWith(compareBy { getPopularRank(it) })
        } else {
            podcasts
        }
        viewModel.cachedPodcasts = allPodcasts

        loadingIndicator.visibility = View.GONE
        applyFilters(emptyState, recyclerView)
    }

    private fun applyFilters(
        emptyState: TextView,
        recyclerView: RecyclerView
    ) {
        // If we're restoring from cache, skip automatic reloads
        val activeNorm = normalizeQuery(viewModel.activeSearchQuery.value ?: searchQuery)
        if (restoringFromCache && activeNorm.isNotEmpty()) {
            android.util.Log.d("PodcastsFragment", "applyFilters: skipping due to cache restore for '$activeNorm'")
            return
        }
        // Simplified path: delegate to a single, cancellable search implementation and skip legacy logic.
        // (Legacy incremental/FTS implementation remains below but is intentionally bypassed
        //  for now to keep the behavior minimal and deterministic.)
        searchJob?.cancel()
        episodePaginationJob?.cancel()
        searchGeneration += 1L
        // Clear the display snapshot to ensure UI is updated
        lastDisplaySnapshot = null
        // Discard the previous search adapter so simplifiedApplyFilters always builds
        // a fresh one for the new query — prevents old results from persisting when
        // switching between saved searches.
        searchAdapter = null
        // Clear cached search items and persisted search to force rebuilding with fresh sort order
        viewModel.cachedSearchItems = null
        clearCachedSearchPersisted()
        android.util.Log.d("PodcastsFragment", "applyFilters called with sort='$currentSort'")
        simplifiedApplyFilters(emptyState, recyclerView)
        return
    }

    private fun loadNextPage() {
        if (isLoadingPage) return
        // If we're showing search results, paginate episodes from the pending index queue
        val rv = view?.findViewById<RecyclerView>(R.id.podcasts_recycler)
        if (rv?.adapter == searchAdapter) {
            // While search results are still being built/enriched, avoid concurrent pagination work.
            if (isSearchPopulating) return
            if (usingCachedItemAppend) return
            // If we restored from cache with a large episode list, paginate from the cached full list
            if (usingCachedEpisodePagination && cachedEpisodeMatchesFull.isNotEmpty()) {
                if (displayedEpisodeCount >= cachedEpisodeMatchesFull.size) return
                isLoadingPage = true
                val generation = searchGeneration
                episodePaginationJob = viewLifecycleOwner.lifecycleScope.launch {
                    try {
                        if (!isActive || generation != searchGeneration) return@launch
                        val next = cachedEpisodeMatchesFull
                            .subList(displayedEpisodeCount, cachedEpisodeMatchesFull.size)
                            .take(EPISODE_PAGE_SIZE)
                        if (next.isNotEmpty()) {
                            resolvedEpisodeMatches.addAll(next)
                            displayedEpisodeCount += next.size
                            searchAdapter?.appendEpisodeMatches(next)
                            // Update in-memory cache only (avoid disk writes)
                            val cached = viewModel.getCachedSearch()
                            if (cached != null) {
                                viewModel.setCachedSearch(
                                    PodcastsViewModel.SearchCache(
                                        cached.query,
                                        cached.titleMatches,
                                        cached.descMatches,
                                        resolvedEpisodeMatches.toList(),
                                        cached.isComplete
                                    )
                                )
                            }
                        }
                    } catch (e: Exception) {
                        android.util.Log.e("PodcastsFragment", "Error paginating cached episodes", e)
                    } finally {
                        isLoadingPage = false
                    }
                }
                return
            }
            // No pagination to do for non-cached episode mode.
            return
        }

        // Default: paginate podcasts list as before
        val start = (currentPage + 1) * pageSize
        if (start >= filteredList.size) return
        isLoadingPage = true

        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val end = (start + pageSize).coerceAtMost(filteredList.size)
                val next = filteredList.subList(start, end)
                podcastAdapter.addPodcasts(next)
                currentPage += 1
            } catch (e: Exception) {
                android.util.Log.e("PodcastsFragment", "Error loading next page", e)
            } finally {
                isLoadingPage = false
            }
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        sensorManager?.unregisterListener(shakeListener)
        filterDebounceJob?.cancel()
        searchJob?.cancel()
        episodePaginationJob?.cancel()
        restoreAppendJob?.cancel()
        // Cache search adapter if active to avoid expensive rebuild on back navigation
        val rv = view?.findViewById<RecyclerView>(R.id.podcasts_recycler)
        if (rv?.adapter is SearchResultsAdapter) {
            cachedSearchAdapter = rv.adapter as SearchResultsAdapter
            // Don't clear the adapter to avoid RecyclerView relayout on restore
            // rv?.adapter = null
        } else {
            // Only clear non-search adapters to avoid memory leaks
            rv?.adapter = null
        }
    }

    override fun onPause() {
        super.onPause()
        sensorManager?.unregisterListener(shakeListener)
    }

    override fun onHiddenChanged(hidden: Boolean) {
        super.onHiddenChanged(hidden)
        if (hidden) {
            sensorManager?.unregisterListener(shakeListener)
        } else {
            registerShakeListener()
        }
    }

    private fun registerShakeListener() {
        if (isHidden) return
        if (!PlaybackPreference.isShakeRandomPodcastEnabled(requireContext())) {
            sensorManager?.unregisterListener(shakeListener)
            return
        }
        if (sensorManager == null) {
            sensorManager = requireContext().getSystemService(android.content.Context.SENSOR_SERVICE)
                as? android.hardware.SensorManager
        }
        val sensor = sensorManager?.getDefaultSensor(android.hardware.Sensor.TYPE_ACCELEROMETER)
        if (sensor == null) {
            android.util.Log.d("PodcastsFragment", "Accelerometer not available; shake-to-random disabled")
            return
        }
        sensorManager?.registerListener(shakeListener, sensor, android.hardware.SensorManager.SENSOR_DELAY_UI)
    }

    override fun onResume() {
        super.onResume()
        registerShakeListener()
        android.util.Log.d("PodcastsFragment", "onResume: activeSearchQuery='${viewModel.activeSearchQuery.value}' searchQuery='${searchQuery}' allPodcasts.size=${allPodcasts.size}")
        
        // Refresh the adapter's subscription cache to reflect any changes
        podcastAdapter.refreshCache()
        
        // Super fast-path: if we have a cached adapter from before view destruction, restore it immediately
        val rv = view?.findViewById<RecyclerView>(R.id.podcasts_recycler)
        if (cachedSearchAdapter != null && rv != null) {
            val activeNorm = normalizeQuery(viewModel.activeSearchQuery.value)
            val cached = viewModel.getCachedSearch()
            if (activeNorm.isNotEmpty() && cached != null && normalizeQuery(cached.query) == activeNorm) {
                android.util.Log.d("PodcastsFragment", "onResume: restoring cached search adapter instance (instant)")
                // Adapter should still be attached from before, but ensure it's set
                if (rv.adapter != cachedSearchAdapter) {
                    rv.adapter = cachedSearchAdapter
                }
                searchAdapter = cachedSearchAdapter
                cachedSearchAdapter = null
                restoringFromCache = false
                rv.visibility = View.VISIBLE
                view?.findViewById<TextView>(R.id.empty_state_text)?.visibility = View.GONE
                
                // Rebind filters to ensure they show all available options
                try {
                    val genreSpinner = view?.findViewById<com.google.android.material.textfield.MaterialAutoCompleteTextView>(R.id.genre_filter_spinner)
                    val sortSpinner = view?.findViewById<com.google.android.material.textfield.MaterialAutoCompleteTextView>(R.id.sort_spinner)
                    if (genreSpinner != null && sortSpinner != null) {
                        if (viewModel.cachedSort.isNotEmpty()) {
                            currentSort = viewModel.cachedSort
                        }
                        val genres = if (viewModel.cachedGenres.isNotEmpty()) {
                            viewModel.cachedGenres
                        } else {
                            listOf("All Genres") + repository.getUniqueGenres(allPodcasts)
                        }
                        suppressSearchWatcher = true
                        try {
                            bindGenreSpinner(genreSpinner, genres, view?.findViewById(R.id.empty_state_text) ?: return, rv)
                            bindSortSpinner(sortSpinner, view?.findViewById(R.id.empty_state_text) ?: return, rv)
                        } finally {
                            suppressSearchWatcher = false
                        }
                    }
                } catch (_: Exception) { }
                
                return
            } else {
                // Query changed, clear the cached adapter
                cachedSearchAdapter = null
            }
        }
        
        if (viewModel.activeSearchQuery.value.isNullOrBlank()) {
            restoringFromCache = false
        }
        if (allPodcasts.isNotEmpty()) {
            // If we're already showing the search results adapter and an active search exists, keep them
            val active = viewModel.activeSearchQuery.value
            val podcastsRecycler = view?.findViewById<RecyclerView>(R.id.podcasts_recycler)
            if (podcastsRecycler != null) {
                if (active.isNullOrBlank()) {
                    // No active persisted search — if we're already showing the main podcasts list, skip reapplying filters
                    if (searchQuery.isBlank() && podcastsRecycler.adapter == podcastAdapter) {
                        android.util.Log.d("PodcastsFragment", "onResume: no active search and already showing podcasts, ensuring visibility")
                        // If the language filter preference changed since the list was last loaded,
                        // reload the list immediately so the setting takes effect.
                        val currentExclude = PodcastFilterPreference.excludeNonEnglish(requireContext())
                        if (lastLoadedExcludeNonEnglish?.let { it != currentExclude } == true) {
                            android.util.Log.d("PodcastsFragment", "onResume: language filter preference changed ($lastLoadedExcludeNonEnglish -> $currentExclude), refreshing podcast list")
                            refreshPodcastsDueToPreferenceChange()
                            return
                        }
                        // Ensure the list is visible (it may have been hidden when navigating away)
                        podcastsRecycler.visibility = View.VISIBLE
                        view?.findViewById<TextView>(R.id.empty_state_text)?.visibility = View.GONE
                        // If the adapter has no data, refresh it
                        if (podcastAdapter.itemCount == 0) {
                            android.util.Log.d("PodcastsFragment", "onResume: adapter is empty, refreshing podcast list")
                            view?.findViewById<ProgressBar>(R.id.loading_progress)?.let { _ ->
                                view?.findViewById<TextView>(R.id.empty_state_text)?.let { empty ->
                                    applyFilters(empty, podcastsRecycler)
                                }
                            }
                        }
                        return
                    }
                } else {
                    // An active search is persisted; if we're already showing the search results adapter, keep it to avoid re-running expensive searches
                    if (podcastsRecycler.adapter == searchAdapter) {
                        android.util.Log.d("PodcastsFragment", "onResume: keeping existing search results (active='${active}'), skipping rebuild")
                        return
                    }
                }
            }

            // Fast-path: if we have a cached search that matches the active query, restore it
            // immediately to avoid re-running expensive searches when returning from other screens
            val activeNorm = normalizeQuery(viewModel.activeSearchQuery.value)
            val cached = viewModel.getCachedSearch()
            if (activeNorm.isNotEmpty() && cached != null && normalizeQuery(cached.query) == activeNorm) {
                // Check if we already have the search adapter set up
                if (rv?.adapter is SearchResultsAdapter) {
                    android.util.Log.d("PodcastsFragment", "onResume: cached search adapter already active, skipping")
                    restoringFromCache = false
                    return
                }
                
                // Restore adapter from cache - create new one
                if (searchAdapter == null) {
                    val prebuilt = viewModel.cachedSearchItems
                    // If cached episodes are large, show only an initial page to avoid UI hangs
                    val fullEpisodes = cached.episodeMatches
                    val initialEpisodes = if (fullEpisodes.size > INITIAL_EPISODE_DISPLAY_LIMIT) {
                        // Keep the full list for lazy-loading as the user reaches the bottom.
                        usingCachedEpisodePagination = true
                        cachedEpisodeMatchesFull = fullEpisodes
                        fullEpisodes.take(INITIAL_EPISODE_DISPLAY_LIMIT)
                    } else {
                        usingCachedEpisodePagination = false
                        cachedEpisodeMatchesFull = emptyList()
                        fullEpisodes
                    }
                    resolvedEpisodeMatches = initialEpisodes.toMutableList()
                    displayedEpisodeCount = resolvedEpisodeMatches.size
                    val initialItems = if (prebuilt != null && prebuilt.size > RESTORE_ITEM_INITIAL) {
                        usingCachedItemAppend = true
                        prebuilt.take(RESTORE_ITEM_INITIAL)
                    } else {
                        usingCachedItemAppend = false
                        prebuilt
                    }
                    searchAdapter = SearchResultsAdapter(
                        context = requireContext(),
                        titleMatches = cached.titleMatches,
                        descMatches = cached.descMatches,
                        episodeMatches = resolvedEpisodeMatches,
                        onPodcastClick = { podcast -> onPodcastClicked(podcast) },
                        onPlayEpisode = { ep -> playEpisode(ep) },
                        onOpenEpisode = { ep, pod -> openEpisodePreview(ep, pod) },
                        prebuiltItems = initialItems
                    )
                    android.util.Log.d("PodcastsFragment", "onResume: created search adapter from cache (${cached.titleMatches.size}+${cached.descMatches.size}+${resolvedEpisodeMatches.size} results, fullEpisodes=${fullEpisodes.size}, prebuilt=${prebuilt?.size ?: 0})")

                    // Append remaining cached items in small chunks to avoid UI hang
                    if (usingCachedItemAppend && prebuilt != null && prebuilt.size > RESTORE_ITEM_INITIAL) {
                        restoreAppendJob?.cancel()
                        restoreAppendJob = viewLifecycleOwner.lifecycleScope.launch {
                            var idx = RESTORE_ITEM_INITIAL
                            while (idx < prebuilt.size && isActive) {
                                val next = prebuilt.subList(idx, minOf(idx + RESTORE_ITEM_CHUNK, prebuilt.size))
                                searchAdapter?.appendItems(next)
                                idx += next.size
                                kotlinx.coroutines.delay(16)
                            }
                            usingCachedItemAppend = false
                        }
                    }
                }
                
                view?.findViewById<RecyclerView>(R.id.podcasts_recycler)?.let { cachedRv ->
                    cachedRv.adapter = searchAdapter
                    view?.findViewById<TextView>(R.id.empty_state_text)?.let { empty ->
                        val hasContent = cached.titleMatches.isNotEmpty() || cached.descMatches.isNotEmpty() || cached.episodeMatches.isNotEmpty()
                        if (!hasContent) {
                            empty.text = getString(R.string.no_podcasts_found)
                            empty.visibility = View.VISIBLE
                            cachedRv.visibility = View.GONE
                        } else {
                            empty.visibility = View.GONE
                            cachedRv.visibility = View.VISIBLE
                        }
                    }
                }

                // Ensure filters are populated after restore
                try {
                    val genreSpinner = view?.findViewById<com.google.android.material.textfield.MaterialAutoCompleteTextView>(R.id.genre_filter_spinner)
                    val sortSpinner = view?.findViewById<com.google.android.material.textfield.MaterialAutoCompleteTextView>(R.id.sort_spinner)
                    val emptyState = view?.findViewById<TextView>(R.id.empty_state_text)
                    val cachedPodcastsRecycler = view?.findViewById<RecyclerView>(R.id.podcasts_recycler)
                    if (genreSpinner != null && sortSpinner != null && emptyState != null && cachedPodcastsRecycler != null) {
                        if (viewModel.cachedSort.isNotEmpty()) {
                            currentSort = viewModel.cachedSort
                        }
                        val pods = if (allPodcasts.isNotEmpty()) allPodcasts
                        else (cached.titleMatches + cached.descMatches + cached.episodeMatches.map { it.second }).distinct()
                        val genres = listOf("All Genres") + repository.getUniqueGenres(pods)
                        viewModel.cachedGenres = genres
                        suppressSearchWatcher = true
                        try {
                            bindGenreSpinner(genreSpinner, genres, emptyState, cachedPodcastsRecycler)
                            bindSortSpinner(sortSpinner, emptyState, cachedPodcastsRecycler)
                        } finally {
                            suppressSearchWatcher = false
                        }
                    }
                } catch (_: Exception) { }

                android.util.Log.d("PodcastsFragment", "onResume: restored cached search instantly")
                // Now that the cached adapter is visible, allow user-driven searches/filters again
                restoringFromCache = false
                return
            }

            view?.findViewById<ProgressBar>(R.id.loading_progress)?.let { _ ->
                view?.findViewById<TextView>(R.id.empty_state_text)?.let { empty ->
                    view?.findViewById<RecyclerView>(R.id.podcasts_recycler)?.let { rv ->
                        applyFilters(empty, rv)
                    }
                }
            }
        }
    }

    // Centralized UI action helpers + adapter factory to reduce duplication and make callbacks testable
    private fun onPodcastClicked(podcast: Podcast) {
        android.util.Log.d("PodcastsFragment", "onPodcastClick triggered for: ${'$'}{podcast.title}")
        (activity as? androidx.appcompat.app.AppCompatActivity)?.supportActionBar?.show()
        val detailFragment = PodcastDetailFragment().apply { arguments = Bundle().apply { putParcelable("podcast", podcast) } }
        parentFragmentManager.beginTransaction().apply {
            setReorderingAllowed(true)
            add(R.id.fragment_container, detailFragment, "podcast_detail")
            hide(this@PodcastsFragment)
            addToBackStack("podcast_detail")
            commit()
        }
    }

    private fun shuffleAndOpenRandomPodcast() {
        // Choose a random podcast from the currently loaded directory (respecting any language filter applied)
        val pool = if (allPodcasts.isNotEmpty()) allPodcasts else emptyList()
        if (pool.isEmpty()) {
            Toast.makeText(requireContext(), getString(R.string.no_podcasts_shuffle), Toast.LENGTH_SHORT).show()
            return
        }
        val picked = try { pool.random() } catch (e: Exception) { pool[0] }
        android.util.Log.d("PodcastsFragment", "Shuffle selected podcast: ${picked.title}")
        onPodcastClicked(picked)
    }

    private fun playEpisode(episode: Episode) {
        // If we already have a playable URL, start immediately
        if (episode.audioUrl.isNotBlank()) {
            val intent = android.content.Intent(requireContext(), RadioService::class.java).apply {
                action = RadioService.ACTION_PLAY_PODCAST_EPISODE
                putExtra(RadioService.EXTRA_EPISODE, episode)
                putExtra(RadioService.EXTRA_PODCAST_ID, episode.podcastId)
            }
            requireContext().startService(intent)
            return
        }

        // Otherwise attempt a fast background resolution from the repository (bounded) and
        // only start playback if we obtain a playable audioUrl. This avoids a full navigation
        // to the podcast detail for index-only hits while respecting the no-spam network rule.
        viewLifecycleOwner.lifecycleScope.launch {
            val pod = allPodcasts.find { it.id == episode.podcastId }
            if (pod == null) {
                // Unknown podcast — open preview so user can navigate
                Toast.makeText(requireContext(), "Episode details unavailable", Toast.LENGTH_SHORT).show()
                openEpisodePreview(episode, Podcast(id = episode.podcastId, title = "", description = "", rssUrl = "", htmlUrl = "", imageUrl = "", genres = emptyList(), typicalDurationMins = 0))
                return@launch
            }

            // Try a quick fetch with timeout so we don't block the UI for long
            val resolved: Episode? = try {
                withTimeoutOrNull(3000L) {
                    val fetched = repository.fetchEpisodesIfNeeded(pod)
                    fetched.firstOrNull { it.id == episode.id }
                }
            } catch (e: Exception) {
                null
            }

            if (resolved?.audioUrl?.isNotBlank() == true) {
                val intent = android.content.Intent(requireContext(), RadioService::class.java).apply {
                    action = RadioService.ACTION_PLAY_PODCAST_EPISODE
                    putExtra(RadioService.EXTRA_EPISODE, resolved)
                    putExtra(RadioService.EXTRA_PODCAST_ID, resolved.podcastId)
                }
                requireContext().startService(intent)
                return@launch
            }

            // Fallback UX: let the user open the episode preview (which can trigger a full fetch)
            Toast.makeText(requireContext(), "Fetching episode details — open podcast to play", Toast.LENGTH_SHORT).show()
            openEpisodePreview(episode, pod)
        }
    }

    private fun openEpisodePreview(episode: Episode, podcast: Podcast) {
        val intent = android.content.Intent(requireContext(), NowPlayingActivity::class.java).apply {
            putExtra("preview_episode", episode)
            putExtra("preview_use_play_ui", true)
            putExtra("preview_podcast_title", podcast.title)
            putExtra("preview_podcast_image", podcast.imageUrl)
        }
        startActivity(intent)
    }

    private fun createSearchAdapter(
        titles: List<Podcast>,
        descs: List<Podcast>,
        episodes: List<Pair<Episode, Podcast>>
    ): SearchResultsAdapter {
        return SearchResultsAdapter(requireContext(), titles, descs, episodes,
            onPodcastClick = { onPodcastClicked(it) },
            onPlayEpisode = { playEpisode(it) },
            onOpenEpisode = { ep, pod -> openEpisodePreview(ep, pod) }
        )
    }

    // Persist the UI search cache both in-memory (ViewModel) and on-disk so it survives
    // navigation and short-lived process restarts. Clearing is best-effort.
    private fun persistCachedSearch(cache: PodcastsViewModel.SearchCache) {
        viewModel.setCachedSearch(cache)
        try { SearchCacheStore.save(requireContext(), cache) } catch (_: Exception) {}
    }

    private fun clearCachedSearchPersisted() {
        viewModel.clearCachedSearch()
        try { SearchCacheStore.clear(requireContext()) } catch (_: Exception) {}
    }

    private fun resetTitleBar() {
        view?.findViewById<com.google.android.material.appbar.MaterialToolbar>(R.id.podcasts_title_bar)
            ?.apply {
                title = "Podcasts"
                navigationIcon = null
                setNavigationOnClickListener(null)
            }
    }

    private fun showSaveSearchDialog() {
        val q = (viewModel.activeSearchQuery.value ?: searchQuery).trim()
        if (q.isBlank()) return

        val dialogView = layoutInflater.inflate(R.layout.dialog_saved_search, null)
        val nameInput = dialogView.findViewById<com.google.android.material.textfield.TextInputEditText>(R.id.saved_search_name_input)
        val queryInput = dialogView.findViewById<com.google.android.material.textfield.TextInputEditText>(R.id.saved_search_query_input)
        val queryInfo = dialogView.findViewById<View>(R.id.saved_search_query_info)
        val notifySwitch = dialogView.findViewById<com.google.android.material.switchmaterial.SwitchMaterial>(R.id.saved_search_notify_switch)

        nameInput.setText(q)
        nameInput.setSelection(q.length)
        queryInput.setText(q)
        queryInput.setSelection(q.length)
        queryInfo.setOnClickListener { showSearchOperatorInfo() }

        val latestMatchEpoch = viewModel.getCachedSearch()?.episodeMatches
            ?.map { com.hyliankid14.bbcradioplayer.db.IndexStore.parsePubEpoch(it.first.pubDate) }
            ?.maxOrNull()
            ?: 0L

        val dialog = androidx.appcompat.app.AlertDialog.Builder(requireContext())
            .setTitle("Save Search")
            .setView(dialogView)
            .setPositiveButton("Save") { _, _ ->
                val name = nameInput.text?.toString()?.trim().orEmpty().ifBlank { q }
                val query = queryInput.text?.toString()?.trim().orEmpty().ifBlank { q }
                val cached = viewModel.getCachedSearch()
                val episodeIds = cached?.episodeMatches?.map { it.first.id }?.distinct()?.take(50) ?: emptyList()
                val saved = SavedSearchesPreference.SavedSearch(
                    id = java.util.UUID.randomUUID().toString(),
                    name = name,
                    query = query,
                    genres = currentFilter.genres.toList(),
                    minDuration = currentFilter.minDuration,
                    maxDuration = currentFilter.maxDuration,
                    sort = currentSort,
                    notificationsEnabled = notifySwitch.isChecked,
                    lastSeenEpisodeIds = episodeIds,
                    createdAt = System.currentTimeMillis(),
                    lastMatchEpoch = latestMatchEpoch
                )
                SavedSearchesPreference.saveSearch(requireContext(), saved)

                Toast.makeText(requireContext(), "Search saved", Toast.LENGTH_SHORT).show()
            }
            .setNegativeButton("Cancel", null)
            .create()

        dialog.show()
    }

    private fun showSearchOperatorInfo() {
        val message = "Operators:\n" +
            "- AND: both terms must appear\n" +
            "- OR: either term can appear\n" +
            "- Minus (-): exclude a term\n" +
            "- NEAR/x: terms within x words (e.g. NEAR/10)\n" +
            "- \"phrase\": exact phrase match\n" +
            "- *: prefix wildcard (e.g. child*)\n\n" +
            "Examples:\n" +
            "climate AND politics\n" +
            "sports OR news\n" +
            "climate -politics\n" +
            "climate NEAR/5 change\n" +
            "\"bbc news\"\n" +
            "child*"
        androidx.appcompat.app.AlertDialog.Builder(requireContext())
            .setTitle("Search operators")
            .setMessage(message)
            .setPositiveButton("OK", null)
            .show()
    }

    fun applySavedSearch(savedSearch: SavedSearchesPreference.SavedSearch, forceMostRecent: Boolean = true) {
        if (!isAdded) return
        
        // If the fragment's view hasn't been created yet, defer the operation 
        if (view == null) {
            android.util.Log.d("PodcastsFragment", "applySavedSearch: view is null, deferring with handler")
            // Post to main handler with a delay to ensure view is created
            android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                if (isAdded && view != null) {
                    applySavedSearch(savedSearch, forceMostRecent)
                }
            }, 100)  // Give view creation time
            return
        }

        searchJob?.cancel()
        filterDebounceJob?.cancel()
        restoreAppendJob?.cancel()
        usingCachedItemAppend = false
        usingCachedEpisodePagination = false
        cachedEpisodeMatchesFull = emptyList()
        restoringFromCache = false
        lastDisplaySnapshot = null

        searchQuery = savedSearch.query
        viewModel.setActiveSearch(savedSearch.query)
        currentFilter = PodcastFilter(
            genres = savedSearch.genres.toSet(),
            minDuration = savedSearch.minDuration,
            maxDuration = savedSearch.maxDuration,
            searchQuery = ""
        )
        // When a saved search is opened from a notification, forceMostRecent defaults to true
        // which ensures results are sorted by publication date (most recent episodes first).
        // When opened in-app via SavedSearchAdapter, the same default applies for consistency.
        currentSort = if (forceMostRecent) {
            "Most recent"
        } else {
            if (savedSearch.sort.isNotBlank()) savedSearch.sort else "Most popular"
        }
        viewModel.cachedFilter = currentFilter
        viewModel.cachedSort = currentSort

        clearCachedSearchPersisted()

        val editText = searchEditText
        val inputLayout = searchInputLayout
        val emptyState = view?.findViewById<TextView>(R.id.empty_state_text)
        val recyclerView = view?.findViewById<RecyclerView>(R.id.podcasts_recycler)
        val genreSpinner = view?.findViewById<com.google.android.material.textfield.MaterialAutoCompleteTextView>(R.id.genre_filter_spinner)
        val sortSpinner = view?.findViewById<com.google.android.material.textfield.MaterialAutoCompleteTextView>(R.id.sort_spinner)

        suppressSearchWatcher = true
        try {
            editText?.setText(savedSearch.query)
            if (!savedSearch.query.isBlank()) editText?.setSelection(savedSearch.query.length)
            try {
                inputLayout?.endIconMode = com.google.android.material.textfield.TextInputLayout.END_ICON_CUSTOM
                inputLayout?.endIconDrawable = requireContext().getDrawable(R.drawable.ic_clear)
                inputLayout?.endIconContentDescription = getString(R.string.clear_search)
                inputLayout?.setEndIconOnClickListener {
                    suppressSearchWatcher = true
                    editText?.text?.clear()
                    suppressSearchWatcher = false
                    viewModel.clearActiveSearch()
                    val imm = requireContext().getSystemService(android.content.Context.INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager
                    imm.hideSoftInputFromWindow(editText?.windowToken, 0)
                    editText?.clearFocus()
                }
                inputLayout?.isEndIconVisible = true
            } catch (_: Exception) { }

            val genreValue = savedSearch.genres.firstOrNull() ?: "All Genres"
            genreSpinner?.setText(genreValue, false)
            sortSpinner?.setText(currentSort, false)
        } finally {
            suppressSearchWatcher = false
        }

        updateSaveSearchButtonVisibility()

        // Show a back arrow on the title bar so the user can navigate back to the Saved Searches list.
        view?.findViewById<com.google.android.material.appbar.MaterialToolbar>(R.id.podcasts_title_bar)
            ?.apply {
                setNavigationIcon(R.drawable.ic_arrow_back)
                setNavigationOnClickListener {
                    requireActivity().onBackPressedDispatcher.onBackPressed()
                }
            }

        // Re-bind sort spinner to ensure it reflects the current sort and has proper listener
        if (sortSpinner != null && emptyState != null && recyclerView != null) {
            bindSortSpinner(sortSpinner, emptyState, recyclerView)
        }

        if (emptyState != null && recyclerView != null) {
            // Immediately clear the old search results before starting a new search
            // to prevent the previous search from briefly showing
            searchAdapter = null
            recyclerView.adapter = null
            recyclerView.visibility = View.VISIBLE
            emptyState.visibility = View.GONE

            // Reset scroll position/header immediately so the user sees filters + search progress
            recyclerView.stopScroll()
            recyclerView.scrollToPosition(0)
            view?.findViewById<com.google.android.material.appbar.AppBarLayout>(R.id.podcasts_header_appbar)
                ?.setExpanded(true, false)

            // Set flag to scroll to top when displaying the new search results
            shouldScrollToTopOnNextResults = true
            applyFilters(emptyState, recyclerView)
        }
    }

    // Progressive search implementation that shows results incrementally:
    // 1. Show podcast name/description matches immediately (fast)
    // 2. Continue loading episode matches in background (slower)
    private fun simplifiedApplyFilters(emptyState: TextView, recyclerView: RecyclerView) {
        android.util.Log.d("PodcastsFragment", "simplifiedApplyFilters called - BEFORE coroutine launch")
        // Hard-stop if we're restoring cached results to avoid reloading the search
        val activeNorm = normalizeQuery(viewModel.activeSearchQuery.value ?: searchQuery)
        if (restoringFromCache && activeNorm.isNotEmpty()) {
            android.util.Log.d("PodcastsFragment", "simplifiedApplyFilters: skipping due to cache restore for '$activeNorm'")
            return
        }
        // Ensure only one search runs at a time
        searchJob?.cancel()
        android.util.Log.d("PodcastsFragment", "simplifiedApplyFilters: About to launch coroutine in viewLifecycleOwner.lifecycleScope")
        val generation = searchGeneration
        searchJob = viewLifecycleOwner.lifecycleScope.launch {
            android.util.Log.d("PodcastsFragment", "simplifiedApplyFilters: INSIDE coroutine, isAdded=$isAdded")
            if (!isAdded) {
                android.util.Log.d("PodcastsFragment", "simplifiedApplyFilters: Fragment not added, returning")
                return@launch
            }
            if (generation != searchGeneration) return@launch

            val loadingView = view?.findViewById<ProgressBar>(R.id.loading_progress)
            
            // Get the query first to determine if we should show the large spinner
            val q = (viewModel.activeSearchQuery.value ?: searchQuery).trim()
            searchQuery = q
            
            // Delay showing the spinner slightly to avoid flicker on very-fast updates.
            // For typed searches, use a shorter delay so users see immediate feedback during
            // the brief pause before results are rendered.
            val showSpinnerJob = if (allPodcasts.isNotEmpty()) {
                val spinnerDelayMs = if (q.isEmpty()) BROWSE_SPINNER_DELAY_MS else SEARCH_SPINNER_DELAY_MS
                launch spinner@{
                    kotlinx.coroutines.delay(spinnerDelayMs)
                    if (!isActive) return@spinner
                    loadingView?.visibility = View.VISIBLE
                }
            } else {
                null
            }

            try {
                android.util.Log.d("PodcastsFragment", "simplifiedApplyFilters START: query='$q' allPodcasts.size=${allPodcasts.size} currentSort='$currentSort'")
                
                // Check if job was cancelled early
                if (!isActive) {
                    android.util.Log.d("PodcastsFragment", "simplifiedApplyFilters: job was cancelled early")
                    showSpinnerJob?.cancel()
                    loadingView?.visibility = View.GONE
                    return@launch
                }

                // If no podcasts are loaded yet, still allow non-empty queries to use
                // cloud/live-search results. Only short-circuit the blank-query state.
                if (allPodcasts.isEmpty() && q.isEmpty()) {
                    android.util.Log.d("PodcastsFragment", "simplifiedApplyFilters: allPodcasts is empty and query is blank, showing empty state")
                    showResultsSafely(recyclerView, podcastAdapter, isSearchAdapter = false, hasContent = false, emptyState)
                    showSpinnerJob?.cancel()
                    loadingView?.visibility = View.GONE
                    return@launch
                }

                // Empty -> show main list (preserve sorting/pagination)
                if (q.isEmpty()) {
                    android.util.Log.d("PodcastsFragment", "simplifiedApplyFilters: Empty query, showing main list")
                    val effectiveFilter = currentFilter.copy(searchQuery = "")
                    val filtered = withContext(Dispatchers.Default) { repository.filterPodcasts(allPodcasts, effectiveFilter) }

                    val sortedList = when (currentSort) {
                        "Most popular" -> filtered.sortedWith(
                            compareBy<Podcast> { getPopularRank(it) }
                                .thenByDescending { if (getPopularRank(it) > 100) cachedUpdates[it.id] ?: Long.MAX_VALUE else 0L }
                        )
                        "Most recent" -> filtered.sortedByDescending { cachedUpdates[it.id] ?: Long.MAX_VALUE }
                        "Alphabetical (A-Z)" -> filtered.sortedBy { it.title }
                        else -> filtered
                    }

                    filteredList = sortedList
                    currentPage = 0
                    isLoadingPage = false
                    val initialPage = if (filteredList.size <= pageSize) filteredList else filteredList.take(pageSize)
                    podcastAdapter.updatePodcasts(initialPage)

                    android.util.Log.d("PodcastsFragment", "simplifiedApplyFilters: About to call showResultsSafely with ${initialPage.size} podcasts")
                    showResultsSafely(recyclerView, podcastAdapter, isSearchAdapter = false, hasContent = filteredList.isNotEmpty(), emptyState)
                    android.util.Log.d("PodcastsFragment", "simplifiedApplyFilters: After showResultsSafely, cancelling spinner")
                    showSpinnerJob?.cancel()
                    loadingView?.visibility = View.GONE
                    return@launch
                }

                // Hide empty state while searching
                emptyState.visibility = View.GONE
                isSearchPopulating = true
                // Reset episode pagination state at the start of a fresh search to avoid stale data/races.
                usingCachedEpisodePagination = false
                cachedEpisodeMatchesFull = emptyList()
                resolvedEpisodeMatches = mutableListOf()
                displayedEpisodeCount = 0
                val qLower = q.lowercase(Locale.getDefault())
                // Strip NOT terms (e.g. "-football") before sending to the FTS engine (remote cloud
                // or local SQLite).  The remote endpoint does not support the "-term" exclusion
                // syntax; passing it raw returns zero results. NOT filtering is applied in-memory
                // by episodeMatchesQuery / textMatchesNormalized after FTS retrieval.
                val qFts = repository.extractPositiveQuery(q)
                
                val remoteIndexClient = com.hyliankid14.bbcradioplayer.RemoteIndexClient(requireContext())

                // Check local index availability and whether cloud search is reachable.
                val hasIndexedEpisodesLocal = withContext(Dispatchers.IO) {
                    try {
                        com.hyliankid14.bbcradioplayer.db.IndexStore.getInstance(requireContext()).hasAnyEpisodes()
                    } catch (e: Exception) {
                        false
                    }
                }
                // Skip explicit availability probing here to avoid an extra
                // request/latency hit before each search. We optimistically try
                // cloud queries directly and fall back on exceptions.
                val cloudSearchAvailable = true
                val hasIndexedEpisodes = hasIndexedEpisodesLocal || cloudSearchAvailable

                // PHASE 1: Quick podcast title/description matches from FTS index
                val indexPodcastResults = withContext(Dispatchers.IO) {
                    val localResults = try {
                        com.hyliankid14.bbcradioplayer.db.IndexStore.getInstance(requireContext()).searchPodcasts(qFts, 100)
                    } catch (e: Exception) {
                        android.util.Log.w("PodcastsFragment", "FTS podcast search failed: ${e.message}")
                        emptyList()
                    }

                    if (localResults.isNotEmpty() || !cloudSearchAvailable) {
                        localResults
                    } else {
                        try {
                            remoteIndexClient.searchPodcasts(qFts, 100)
                        } catch (e: Exception) {
                            android.util.Log.w("PodcastsFragment", "Remote podcast search failed: ${e.message}")
                            emptyList()
                        }
                    }
                }

                // Enrich FTS results with full metadata from allPodcasts (RSS URLs, artwork, etc.)
                val titleMatches = withContext(Dispatchers.Default) {
                    val podcastById = allPodcasts.associateBy { it.id }
                    var enriched = 0
                    var fallback = 0
                    val podcasts = indexPodcastResults
                        // Reject any FTS hit that doesn't have a word-boundary match in title or
                        // description — the remote server may use substring matching and return
                        // results like "Miranda" for the query "iran".
                        .filter { fts ->
                            repository.textMatchesNormalized(fts.title, q) ||
                            repository.textMatchesNormalized(fts.description, q)
                        }
                        .mapNotNull { fts ->
                        // First try to match against allPodcasts to get full metadata
                        val fullPodcast = podcastById[fts.podcastId]
                        if (fullPodcast != null) {
                            enriched++
                            fullPodcast
                        } else {
                            fallback++
                            // FTS result not in allPodcasts - create podcast with reconstructed RSS URL
                            // BBC RSS URLs follow pattern: https://podcasts.files.bbci.co.uk/{id}.rss
                            // Description may have HTML - strip it for display
                            val cleanDesc = androidx.core.text.HtmlCompat.fromHtml(
                                fts.description,
                                androidx.core.text.HtmlCompat.FROM_HTML_MODE_LEGACY
                            ).toString().trim()
                            Podcast(
                                id = fts.podcastId,
                                title = fts.title,
                                description = cleanDesc,
                                rssUrl = "https://podcasts.files.bbci.co.uk/${fts.podcastId}.rss",
                                htmlUrl = "",
                                imageUrl = "",
                                genres = emptyList(),
                                typicalDurationMins = 0
                            )
                        }
                    }
                    android.util.Log.d("PodcastsFragment", "FTS enrichment: ${indexPodcastResults.size} results -> $enriched enriched, $fallback fallback")
                    if (fallback > 0 && indexPodcastResults.isNotEmpty()) {
                        val sampleFtsId = indexPodcastResults.firstOrNull()?.podcastId ?: ""
                        val sampleAllPodcastsIds = allPodcasts.take(3).map { it.id }
                        android.util.Log.d("PodcastsFragment", "Sample FTS ID: $sampleFtsId, Sample allPodcasts IDs: $sampleAllPodcastsIds")
                    }
                    repository.filterPodcasts(podcasts, currentFilter)
                }

                android.util.Log.d("PodcastsFragment", "FTS podcast search: query='$q' returned ${indexPodcastResults.size} results, after enrichment and filter=${titleMatches.size}")

                // For now, use titleMatches for both (FTS doesn't distinguish title vs description)
                val descMatches = emptyList<Podcast>()

                // Check if the podcast FTS index has any data (empty on first launch before the
                // index file has been downloaded).
                val hasIndexedPodcasts = withContext(Dispatchers.IO) {
                    try {
                        com.hyliankid14.bbcradioplayer.db.IndexStore.getInstance(requireContext()).hasAnyPodcasts()
                    } catch (e: Exception) { false }
                }

                // FALLBACK: When the FTS index has no podcast data (e.g. first launch before the
                // index is downloaded), fall back to basic in-memory text matching on the loaded
                // podcast list so that basic search always works.
                val effectiveTitleMatches: List<Podcast> = if (titleMatches.isEmpty() && !hasIndexedPodcasts) {
                    withContext(Dispatchers.Default) {
                        val wordBoundaryRegex = Regex("\\b${Regex.escape(qLower)}")
                        val basicResults = allPodcasts.filter { pod ->
                            pod.title.lowercase().contains(wordBoundaryRegex) ||
                            pod.description.lowercase().contains(wordBoundaryRegex)
                        }
                        repository.filterPodcasts(basicResults, currentFilter)
                    }
                } else titleMatches

                // Apply sort order to podcast matches
                android.util.Log.d("PodcastsFragment", "simplifiedApplyFilters: applying sort order '$currentSort' to effectiveTitleMatches=${effectiveTitleMatches.size} descMatches=${descMatches.size}")
                val sortedTitleMatches = withContext(Dispatchers.Default) {
                    when (currentSort) {
                        "Most popular" -> effectiveTitleMatches.sortedWith(
                            compareBy<Podcast> { getPopularRank(it) }
                                .thenByDescending { if (getPopularRank(it) > 100) cachedUpdates[it.id] ?: Long.MAX_VALUE else 0L }
                        )
                        "Most recent" -> effectiveTitleMatches.sortedByDescending { cachedUpdates[it.id] ?: Long.MAX_VALUE }
                        "Alphabetical (A-Z)" -> effectiveTitleMatches.sortedBy { it.title }
                        else -> effectiveTitleMatches
                    }
                }
                
                val sortedDescMatches = withContext(Dispatchers.Default) {
                    when (currentSort) {
                        "Most popular" -> descMatches.sortedWith(
                            compareBy<Podcast> { getPopularRank(it) }
                                .thenByDescending { if (getPopularRank(it) > 100) cachedUpdates[it.id] ?: Long.MAX_VALUE else 0L }
                        )
                        "Most recent" -> descMatches.sortedByDescending { cachedUpdates[it.id] ?: Long.MAX_VALUE }
                        "Alphabetical (A-Z)" -> descMatches.sortedBy { it.title }
                        else -> descMatches
                    }
                }
                
                // Show podcast matches immediately (before episode loading)
                val podcastMatches = (sortedTitleMatches + sortedDescMatches).distinctBy { it.id }
                android.util.Log.d("PodcastsFragment", "simplifiedApplyFilters: sorted results - titleMatches=${sortedTitleMatches.size} descMatches=${sortedDescMatches.size} combined=${podcastMatches.size}")
                if (sortedTitleMatches.isNotEmpty()) {
                    android.util.Log.d("PodcastsFragment", "simplifiedApplyFilters: First 3 title matches: ${sortedTitleMatches.take(3).map { it.title }}")
                }
                if (podcastMatches.isNotEmpty() && isActive) {
                    if (generation != searchGeneration) return@launch
                    // Initialize search adapter with podcast-only results
                    if (searchAdapter == null) {
                        searchAdapter = SearchResultsAdapter(
                            context = requireContext(),
                            titleMatches = sortedTitleMatches,
                            descMatches = sortedDescMatches,
                            episodeMatches = emptyList(),
                            onPodcastClick = { podcast -> onPodcastClicked(podcast) },
                            onPlayEpisode = { ep -> playEpisode(ep) },
                            onOpenEpisode = { ep, pod -> openEpisodePreview(ep, pod) }
                        )
                        viewModel.cachedSearchItems = searchAdapter?.snapshotItems()
                    }
                    showResultsSafely(recyclerView, searchAdapter, isSearchAdapter = true, hasContent = true, emptyState)
                    rebuildFilterSpinners(emptyState, recyclerView)
                }

                // Persist the quick (podcast-only) results so we can restore instantly on back navigation.
                // Mark as complete only if episodes won't be searched (short query or no index).
                if (isActive) {
                    val quickComplete = (!hasIndexedEpisodes) || q.length < 3
                    persistCachedSearch(
                        PodcastsViewModel.SearchCache(
                            query = q,
                            titleMatches = sortedTitleMatches,
                            descMatches = sortedDescMatches,
                            episodeMatches = emptyList(),
                            isComplete = quickComplete
                        )
                    )
                }
                
                // PHASE 2: Episodes — show first 30 immediately (fast), load full 400 in background
                //
                // FTS returns results ordered pubEpoch DESC. Fetching 30 records is near-instant
                // (~50 ms) so the UI is never blocked waiting for a large result set. The remaining
                // episodes load silently and become available for scroll-pagination.

                if (!hasIndexedEpisodes) {
                    // No episode index available. Show the podcast results found (via basic search
                    // or FTS), and append an inline hint where episode results would appear.
                    if (isActive && generation == searchGeneration) {
                        if (podcastMatches.isNotEmpty()) {
                            // Podcast results are already displayed — add hint in episode slot
                            val hintMessage = getString(R.string.search_no_results_download_hint)
                            searchAdapter?.setIndexHint(hintMessage) {
                                val intent = android.content.Intent(requireContext(), SettingsDetailActivity::class.java).apply {
                                    putExtra(SettingsDetailActivity.EXTRA_SECTION, SettingsDetailActivity.SECTION_INDEXING)
                                }
                                startActivity(intent)
                            }
                            viewModel.cachedSearchItems = searchAdapter?.snapshotItems()
                        } else if (q.isNotEmpty()) {
                            // Nothing found at all and no episode index — show index download hint
                            if (searchAdapter == null) {
                                searchAdapter = SearchResultsAdapter(
                                    context = requireContext(),
                                    titleMatches = emptyList(),
                                    descMatches = emptyList(),
                                    episodeMatches = emptyList(),
                                    onPodcastClick = { podcast -> onPodcastClicked(podcast) },
                                    onPlayEpisode = { ep -> playEpisode(ep) },
                                    onOpenEpisode = { ep, pod -> openEpisodePreview(ep, pod) }
                                )
                            }
                            val hintMessage = getString(R.string.search_no_results_download_hint)
                            searchAdapter?.setIndexHint(hintMessage) {
                                val intent = android.content.Intent(requireContext(), SettingsDetailActivity::class.java).apply {
                                    putExtra(SettingsDetailActivity.EXTRA_SECTION, SettingsDetailActivity.SECTION_INDEXING)
                                }
                                startActivity(intent)
                            }
                            showResultsSafely(recyclerView, searchAdapter, isSearchAdapter = true, hasContent = true, emptyState)
                            rebuildFilterSpinners(emptyState, recyclerView)
                            viewModel.cachedSearchItems = searchAdapter?.snapshotItems()
                        }
                    }
                } else {
                    // ── STEP 2a: fast first batch ────────────────────────────────────────────
                    // Fetch the 30 newest matching episodes without any timeout. This should
                    // complete in well under 200 ms and lets us paint results immediately.
                    val quickEps: List<Pair<Episode, Podcast>> = if (q.length >= 3) {
                        withContext(Dispatchers.IO) {
                            val eps = mutableListOf<Pair<Episode, Podcast>>()
                            try {
                                // Prefer cloud search. Only fall back to local SQLite FTS if cloud
                                // is unavailable or errors; do not fall back merely because cloud
                                // returned zero matches.
                                val ftsResults: List<com.hyliankid14.bbcradioplayer.db.EpisodeFts> = run {
                                    val remote = com.hyliankid14.bbcradioplayer.RemoteIndexClient(requireContext())
                                    if (cloudSearchAvailable) {
                                        try {
                                            return@run remote.searchEpisodes(qFts, 30)
                                        } catch (e: Exception) {
                                            android.util.Log.w("PodcastsFragment", "Remote episode search (quick) failed: ${e.message}")
                                        }
                                    }
                                    // Local fallback for offline/error mode.
                                    try {
                                        com.hyliankid14.bbcradioplayer.db.IndexStore.getInstance(requireContext())
                                            .searchEpisodes(qFts, 30)
                                    } catch (e: Exception) {
                                        android.util.Log.w("PodcastsFragment", "FTS episode search (quick) failed: ${e.message}")
                                        emptyList()
                                    }
                                }
                                if (ftsResults.isNotEmpty()) {
                                    val deduped = ftsResults.distinctBy { it.episodeId }
                                    val podcastById = allPodcasts.associateBy { it.id }
                                    val uniqueResults = deduped
                                        // Reject FTS hits that don't have a word-boundary match in title
                                        // or description, and enforce any NOT terms against the podcast name.
                                        .filter { ef ->
                                            val podcastName = podcastById[ef.podcastId]?.title ?: ""
                                            repository.episodeMatchesQuery(ef.title, ef.description, podcastName, q)
                                        }
                                    val episodeCacheById: Map<String, List<Episode>?> =
                                        uniqueResults.map { it.podcastId }.distinct()
                                            .associateWith { pid -> repository.getEpisodesFromCache(pid) }
                                    for (ef in uniqueResults) {
                                        if (!coroutineContext.isActive) break
                                        val p = podcastById[ef.podcastId] ?: continue
                                        val found = episodeCacheById[ef.podcastId]?.find { it.id == ef.episodeId }
                                        eps.add((found ?: Episode(
                                            id = ef.episodeId,
                                            title = ef.title,
                                            description = ef.description,
                                            audioUrl = "",
                                            imageUrl = p.imageUrl,
                                            pubDate = ef.pubDate,
                                            durationMins = 0,
                                            podcastId = p.id
                                        )) to p)
                                    }
                                }
                            } catch (e: Exception) {
                                android.util.Log.w("PodcastsFragment", "IndexStore unavailable (quick): ${e.message}")
                            }
                            // Apply filters so stubs from excluded podcasts don't appear.
                            val filtered = eps.filter { (_, pod) ->
                                repository.filterPodcasts(listOf(pod), currentFilter).isNotEmpty()
                            }.filter { (ep, _) ->
                                ep.durationMins in currentFilter.minDuration..currentFilter.maxDuration
                            }
                            // Sort episodes according to current sort preference
                            sortEpisodeMatches(filtered)
                        }
                    } else emptyList()

                    if (!isActive || generation != searchGeneration) return@launch

                    android.util.Log.d("PodcastsFragment", "Quick episode batch: ${quickEps.size} episodes sorted by '$currentSort'")

                    if (searchAdapter == null) {
                        searchAdapter = SearchResultsAdapter(
                            context = requireContext(),
                            titleMatches = sortedTitleMatches,
                            descMatches = sortedDescMatches,
                            episodeMatches = quickEps,
                            onPodcastClick = { podcast -> onPodcastClicked(podcast) },
                            onPlayEpisode = { ep -> playEpisode(ep) },
                            onOpenEpisode = { ep, pod -> openEpisodePreview(ep, pod) }
                        )
                        val hasContent = quickEps.isNotEmpty()
                        if (!hasContent && q.isNotEmpty()) {
                            emptyState.text = getString(R.string.no_podcasts_found)
                        }
                        showResultsSafely(recyclerView, searchAdapter, isSearchAdapter = true, hasContent = hasContent, emptyState)
                        rebuildFilterSpinners(emptyState, recyclerView)
                    } else {
                        searchAdapter?.appendEpisodeMatches(quickEps)
                        val hasContent = podcastMatches.isNotEmpty() || quickEps.isNotEmpty()
                        if (!hasContent && q.isNotEmpty()) {
                            emptyState.text = getString(R.string.no_podcasts_found)
                        }
                        rebuildFilterSpinners(emptyState, recyclerView)
                    }

                    resolvedEpisodeMatches = quickEps.toMutableList()
                    displayedEpisodeCount = resolvedEpisodeMatches.size
                    viewModel.cachedSearchItems = searchAdapter?.snapshotItems()
                    loadingView?.visibility = View.GONE

                    // ── STEP 2b: full background load ────────────────────────────────────────
                    // Fetch all matching episodes in pages without blocking the UI. When done,
                    // extra results are wired into scroll-pagination so users can reach older
                    // matches instead of being capped to a fixed top-N window.
                    val fullLoadGen = generation
                    launch(Dispatchers.IO) fullLoad@{
                        if (!isActive || fullLoadGen != searchGeneration) return@fullLoad

                        val eps = mutableListOf<Pair<Episode, Podcast>>()

                        if (q.length >= 3) {
                            try {
                                // Prefer cloud search. Only fall back to local SQLite FTS if cloud
                                // is unavailable or errors; do not treat "0 cloud matches" as a
                                // fallback condition.
                                val ftsResults: List<com.hyliankid14.bbcradioplayer.db.EpisodeFts> = run {
                                    val remote = com.hyliankid14.bbcradioplayer.RemoteIndexClient(requireContext())
                                    if (cloudSearchAvailable) {
                                        try {
                                            return@run remote.searchEpisodes(qFts, 500, 0)
                                        } catch (e: Exception) {
                                            android.util.Log.w("PodcastsFragment", "Remote episode search (full) failed: ${e.message}")
                                        }
                                    }
                                    // Local fallback — searchEpisodes does an unlimited FTS scan
                                    // internally, so a single call fetches all matching episodes
                                    // in one pass (sorted by pubEpoch DESC).
                                    try {
                                        com.hyliankid14.bbcradioplayer.db.IndexStore.getInstance(requireContext())
                                            .searchEpisodes(qFts, Int.MAX_VALUE, 0)
                                    } catch (e: Exception) {
                                        android.util.Log.w("PodcastsFragment", "FTS episode search (full) failed: ${e.message}")
                                        emptyList()
                                    }
                                }

                                val podcastById = allPodcasts.associateBy { it.id }
                                val episodeCacheByPodcastId = mutableMapOf<String, List<Episode>?>()

                                // Reject FTS hits that don't have a word-boundary match in title
                                // or description, and enforce any NOT terms against the podcast name.
                                val validFtsResults = ftsResults.filter { ef ->
                                    val podcastName = podcastById[ef.podcastId]?.title ?: ""
                                    repository.episodeMatchesQuery(ef.title, ef.description, podcastName, q)
                                }
                                for (ef in validFtsResults) {
                                    if (!coroutineContext.isActive) break
                                    val p = podcastById[ef.podcastId] ?: continue
                                    val cachedEpisodes = episodeCacheByPodcastId.getOrPut(ef.podcastId) {
                                        repository.getEpisodesFromCache(ef.podcastId)
                                    }
                                    val found = cachedEpisodes?.find { it.id == ef.episodeId }
                                    eps.add((found ?: Episode(
                                        id = ef.episodeId,
                                        title = ef.title,
                                        description = ef.description,
                                        audioUrl = "",
                                        imageUrl = p.imageUrl,
                                        pubDate = ef.pubDate,
                                        durationMins = 0,
                                        podcastId = p.id
                                    )) to p)
                                }
                            } catch (e: Exception) {
                                android.util.Log.w("PodcastsFragment", "IndexStore unavailable (full): ${e.message}")
                            }

                            // Fallback: if both the quick and full FTS searches returned nothing,
                            // try the in-memory cached episode search.
                            if (eps.isEmpty() && quickEps.isEmpty()) {
                                val perPodcastLimit = 50
                                val podcastsToSearch = allPodcasts.take(20)
                                for (p in podcastsToSearch) {
                                    if (!coroutineContext.isActive) break
                                    val hits = repository.searchCachedEpisodes(p.id, qLower, perPodcastLimit)
                                    for (ep in hits) {
                                        if (!coroutineContext.isActive) break
                                        eps.add(ep to p)
                                        if (eps.size >= 50) break
                                    }
                                    if (eps.size >= 50) break
                                }
                            }
                        }

                        if (!isActive || fullLoadGen != searchGeneration) return@fullLoad

                        // Filter (same criteria as the quick path).
                        val epsFiltered = eps.filter { (_, pod) ->
                            repository.filterPodcasts(listOf(pod), currentFilter).isNotEmpty()
                        }.filter { (ep, _) ->
                            ep.durationMins in currentFilter.minDuration..currentFilter.maxDuration
                        }

                        // Sort episodes according to current sort preference
                        val episodes: List<Pair<Episode, Podcast>> = sortEpisodeMatches(epsFiltered)
                        android.util.Log.d("PodcastsFragment", "Full episode batch: ${episodes.size} episodes sorted by '$currentSort'")

                        withContext(Dispatchers.Main) {
                            if (!isActive || fullLoadGen != searchGeneration) return@withContext

                            // Compute which episodes are genuinely new (not in the quick batch).
                            val seenIds = quickEps.map { it.first.id }.toSet()
                            val newEps = episodes.filter { it.first.id !in seenIds }

                            // Build the canonical merged list in sorted order.
                            val mergedAll: List<Pair<Episode, Podcast>> = episodes

                            // For "Most recent" sort, quickEps is a prefix of the full sorted list,
                            // so we can just append new episodes. For other sorts (alphabetical, popular),
                            // the full sorted list may have a completely different order, so we need to
                            // rebuild the episode section entirely.
                            if (currentSort == "Most recent") {
                                // Append episodes not yet visible up to INITIAL_EPISODE_DISPLAY_LIMIT.
                                val toAppendNow = newEps.take(INITIAL_EPISODE_DISPLAY_LIMIT - quickEps.size)
                                if (toAppendNow.isNotEmpty()) {
                                    searchAdapter?.appendEpisodeMatches(toAppendNow)
                                }
                            } else {
                                // For alphabetical or popularity sort, replace the entire episode list
                                // with the properly sorted full results to avoid showing two separate
                                // sorted segments (quick batch + new episodes appended).
                                val initialBatchToDisplay = mergedAll.take(INITIAL_EPISODE_DISPLAY_LIMIT)
                                if (initialBatchToDisplay.size > quickEps.size) {
                                    // Only update if we have more episodes to show
                                    searchAdapter?.updateEpisodeMatches(initialBatchToDisplay)
                                    android.util.Log.d("PodcastsFragment", "Replaced episode list with ${initialBatchToDisplay.size} sorted episodes (sort='$currentSort')")
                                }
                            }

                            // Wire remaining results into scroll-pagination.
                            val initialBatch = mergedAll.take(INITIAL_EPISODE_DISPLAY_LIMIT)
                            usingCachedEpisodePagination = mergedAll.size > INITIAL_EPISODE_DISPLAY_LIMIT
                            cachedEpisodeMatchesFull = if (usingCachedEpisodePagination) mergedAll else emptyList()
                            resolvedEpisodeMatches = initialBatch.toMutableList()
                            displayedEpisodeCount = resolvedEpisodeMatches.size

                            // If no episodes were found at all, show a hint about the index
                            if (episodes.isEmpty() && quickEps.isEmpty() && q.length >= 3) {
                                val hintMessage = if (isEpisodeIndexStale()) {
                                    getString(R.string.search_index_outdated_hint)
                                } else {
                                    getString(R.string.search_no_results_download_hint)
                                }
                                searchAdapter?.setIndexHint(hintMessage) {
                                    val intent = android.content.Intent(requireContext(), SettingsDetailActivity::class.java).apply {
                                        putExtra(SettingsDetailActivity.EXTRA_SECTION, SettingsDetailActivity.SECTION_INDEXING)
                                    }
                                    startActivity(intent)
                                }
                            }

                            viewModel.cachedSearchItems = searchAdapter?.snapshotItems()

                            // Background enrichment: fill in missing audio URLs / durations.
                            val incompletePodcasts = episodes
                                .filter { (ep, _) -> ep.audioUrl.isBlank() || ep.pubDate.isBlank() || ep.durationMins <= 0 }
                                .map { it.second }
                                .distinctBy { it.id }

                            if (incompletePodcasts.isNotEmpty()) {
                                launch enrichment@ {
                                    val enrichGen = fullLoadGen
                                    val enrichmentMap = mutableMapOf<String, Episode>()
                                    try {
                                        incompletePodcasts.chunked(4).forEach batches@{ batch ->
                                            if (!isActive || enrichGen != searchGeneration) return@batches
                                            val jobs = batch.map { pod ->
                                                async(Dispatchers.IO) {
                                                    val fullEpisodes = withTimeoutOrNull(3000L) {
                                                        try { repository.fetchEpisodesIfNeeded(pod) }
                                                        catch (e: Exception) { null }
                                                    }
                                                    if (fullEpisodes != null) pod.id to fullEpisodes else null
                                                }
                                            }
                                            val newPatches = mutableMapOf<String, Episode>()
                                            jobs.mapNotNull { it.await() }.forEach { (pid, list) ->
                                                if (!isActive || enrichGen != searchGeneration) return@forEach
                                                episodes
                                                    .filter { it.second.id == pid &&
                                                        (it.first.audioUrl.isBlank() || it.first.pubDate.isBlank() || it.first.durationMins <= 0) }
                                                    .forEach { (ep, _) ->
                                                        val full = list.find { it.id == ep.id }
                                                        if (full != null && full.audioUrl.isNotBlank()) {
                                                            newPatches[ep.id] = full
                                                            enrichmentMap[ep.id] = full
                                                        }
                                                    }
                                            }
                                            if (isActive && enrichGen == searchGeneration && newPatches.isNotEmpty()) {
                                                searchAdapter?.patchEpisodes(newPatches)
                                                cachedEpisodeMatchesFull = cachedEpisodeMatchesFull.map { (ep, p) ->
                                                    (newPatches[ep.id] ?: ep) to p
                                                }
                                                resolvedEpisodeMatches = resolvedEpisodeMatches.map { (ep, p) ->
                                                    (newPatches[ep.id] ?: ep) to p
                                                }.toMutableList()
                                            }
                                        }
                                    } catch (e: Exception) {
                                        android.util.Log.w("PodcastsFragment", "Background enrichment failed: ${e.message}")
                                    }

                                    if (isActive && enrichGen == searchGeneration) {
                                        val enrichedEpisodes = episodes.map { (ep, p) ->
                                            (enrichmentMap[ep.id] ?: ep) to p
                                        }
                                        persistCachedSearch(
                                            PodcastsViewModel.SearchCache(
                                                query = q,
                                                titleMatches = sortedTitleMatches,
                                                descMatches = sortedDescMatches,
                                                episodeMatches = enrichedEpisodes,
                                                isComplete = true
                                            )
                                        )
                                        viewModel.cachedSearchItems = searchAdapter?.snapshotItems()
                                    }
                                }
                            } else {
                                persistCachedSearch(
                                    PodcastsViewModel.SearchCache(
                                        query = q,
                                        titleMatches = sortedTitleMatches,
                                        descMatches = sortedDescMatches,
                                        episodeMatches = episodes,
                                        isComplete = true
                                    )
                                )
                            }
                        }
                    } // end background full-load launch
                } // end hasIndexedEpisodes

                @Suppress("UNUSED_EXPRESSION")
                Unit // satisfies the expression requirement after the if/else block
            } finally {
                if (generation == searchGeneration) {
                    isSearchPopulating = false
                }
                showSpinnerJob?.cancel()
                loadingView?.visibility = View.GONE
            }
        }
    }

    private fun sortEpisodeMatches(episodes: List<Pair<Episode, Podcast>>): List<Pair<Episode, Podcast>> {
        return when (currentSort) {
            "Most recent" -> episodes
            "Alphabetical (A-Z)" -> episodes.sortedWith(
                compareBy<Pair<Episode, Podcast>>({ it.first.title }, { it.second.title })
            )
            else -> {
                // Most popular: sort by podcast popularity, then by episode pub date
                val epochMap: Map<String, Long> = episodes.associate { (ep, _) ->
                    ep.id to com.hyliankid14.bbcradioplayer.db.IndexStore.parsePubEpoch(ep.pubDate)
                }
                episodes.sortedWith(
                    compareBy<Pair<Episode, Podcast>> { getPopularRank(it.second) }
                        .thenByDescending { epochMap[it.first.id] ?: 0L }
                )
            }
        }
    }

    private fun isEpisodeIndexStale(): Boolean {
        return try {
            val lastReindex = com.hyliankid14.bbcradioplayer.db.IndexStore.getInstance(requireContext()).getLastReindexTime()
                ?: return false // no recorded reindex time — cannot determine staleness
            System.currentTimeMillis() - lastReindex > INDEX_STALE_THRESHOLD_MS
        } catch (_: Exception) { false }
    }

    private fun getPopularRank(podcast: Podcast): Int {
        for ((key, rank) in POPULAR_RANKING) {
            if (podcast.title.equals(key, ignoreCase = true)) return rank
        }
        return 101
    }

    companion object {
        private const val SHAKE_THRESHOLD_GRAVITY = 2.7f
        private const val SHAKE_DEBOUNCE_MS = 1000L
        private val POPULAR_RANKING = mapOf(
            "Global News Podcast" to 1,
            "Football Daily" to 2,
            "Newshour" to 3,
            "Radio 1's All Day Breakfast with Greg James" to 4,
            "Test Match Special" to 5,
            "Best of Nolan" to 6,
            "Rugby Union Weekly" to 7,
            "Wake Up To Money" to 8,
            "Ten To The Top" to 9,
            "Witness History" to 10,
            "Focus on Africa" to 11,
            "BBC Music Introducing Mixtape" to 12,
            "F1: Chequered Flag" to 13,
            "BBC Introducing in Oxfordshire & Berkshire" to 14,
            "Business Daily" to 15,
            "Americast" to 16,
            "CrowdScience" to 17,
            "The Interview" to 18,
            "Six O'Clock News" to 19,
            "Science In Action" to 20,
            "Today in Parliament" to 21,
            "Talkback" to 22,
            "Access All: Disability News and Mental Health" to 23,
            "Fighting Talk" to 24,
            "World Business Report" to 25,
            "Business Matters" to 26,
            "Tailenders" to 27,
            "Moral Maze" to 28,
            "Any Questions? and Any Answers?" to 29,
            "Health Check" to 30,
            "Friday Night Comedy from BBC Radio 4" to 31,
            "BBC Inside Science" to 32,
            "People Fixing the World" to 33,
            "Add to Playlist" to 34,
            "In Touch" to 35,
            "Limelight" to 36,
            "Evil Genius with Russell Kane" to 37,
            "Africa Daily" to 38,
            "Broadcasting House" to 39,
            "From Our Own Correspondent" to 40,
            "Newscast" to 41,
            "Derby County" to 42,
            "Learning English Stories" to 43,
            "Tech Life" to 44,
            "World Football" to 45,
            "Private Passions" to 46,
            "Sunday Supplement" to 47,
            "Drama of the Week" to 48,
            "Sporting Witness" to 49,
            "File on 4 Investigates" to 50,
            "Nottingham Forest: Shut Up and Show More Football" to 51,
            "Soul Music" to 52,
            "Westminster Hour" to 53,
            "Inside Health" to 54,
            "5 Live's World Football Phone-in" to 55,
            "Over to You" to 56,
            "Political Thinking with Nick Robinson" to 57,
            "Sport's Strangest Crimes" to 58,
            "Inheritance Tracks" to 59,
            "The Archers" to 60,
            "Profile" to 61,
            "Sacked in the Morning" to 62,
            "The World Tonight" to 63,
            "Record Review Podcast" to 64,
            "Composer of the Week" to 65,
            "Short Cuts" to 66,
            "The History Hour" to 67,
            "The Archers Omnibus" to 68,
            "The Lazarus Heist" to 69,
            "Bad People" to 70,
            "Jill Scott's Coffee Club" to 71,
            "5 Live Boxing with Steve Bunce" to 72,
            "Unexpected Elements" to 73,
            "The Inquiry" to 74,
            "Not by the Playbook" to 75,
            "The Bottom Line" to 76,
            "Stumped" to 77,
            "Sliced Bread" to 78,
            "Sound of Cinema" to 79,
            "5 Live News Specials" to 80,
            "Comedy of the Week" to 81,
            "Curious Cases" to 82,
            "Breaking the News" to 83,
            "The Skewer" to 84,
            "5 Live Sport: All About..." to 85,
            "The Briefing Room" to 86,
            "The Early Music Show" to 87,
            "The Life Scientific" to 88,
            "5 Live Rugby League" to 89,
            "Learning English from the News" to 90,
            "The GAA Social" to 91,
            "Sportsworld" to 92,
            "Assume Nothing" to 93,
            "The LGBT Sport Podcast" to 94,
            "Fairy Meadow" to 95,
            "Kermode and Mayo's Film Review" to 96,
            "In Our Time: History" to 97,
            "Digital Planet" to 98,
            "Just One Thing - with Michael Mosley" to 99,
            "Scientifically..." to 100
        )
    } // End of PodcastsFragment class

    /**
     * Custom adapter that ignores filtering (always shows all items).
     * This prevents the "exposed dropdown" from filtering its list based on the currently selected text.
     */
    private class NoFilterArrayAdapter(context: android.content.Context, layout: Int, val items: List<String>) :
        ArrayAdapter<String>(context, layout, items) {

        private val noOpFilter = object : android.widget.Filter() {
            override fun performFiltering(constraint: CharSequence?): FilterResults {
                val results = FilterResults()
                results.values = items
                results.count = items.size
                return results
            }

            override fun publishResults(constraint: CharSequence?, results: FilterResults?) {
                if (results != null && results.count > 0) {
                    notifyDataSetChanged()
                } else {
                    notifyDataSetInvalidated()
                }
            }
        }

        override fun getFilter(): android.widget.Filter = noOpFilter
    }
}
