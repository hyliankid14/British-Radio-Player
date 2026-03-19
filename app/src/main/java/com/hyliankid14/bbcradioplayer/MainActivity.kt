package com.hyliankid14.bbcradioplayer

import android.Manifest
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Build
import android.util.Log
import android.view.KeyEvent
import android.content.res.ColorStateList
import androidx.core.content.ContextCompat
import android.net.Uri
import android.widget.Button
import android.widget.Toast
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import androidx.appcompat.app.AppCompatActivity
import androidx.fragment.app.FragmentManager
import androidx.recyclerview.widget.LinearLayoutManager
import android.support.v4.media.MediaDescriptionCompat
import android.support.v4.media.MediaBrowserCompat.MediaItem
import androidx.recyclerview.widget.RecyclerView
import androidx.recyclerview.widget.ItemTouchHelper
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.RadioGroup
import android.view.View
import android.graphics.Bitmap
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import com.bumptech.glide.Glide
import com.bumptech.glide.load.DataSource
import com.bumptech.glide.load.engine.GlideException
import com.bumptech.glide.request.RequestListener
import com.bumptech.glide.request.target.Target
import com.google.android.material.bottomnavigation.BottomNavigationView
import androidx.core.graphics.ColorUtils
import android.view.WindowManager
import android.view.GestureDetector
import android.view.MotionEvent
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.withContext
import com.google.android.material.tabs.TabLayout
import com.google.android.material.button.MaterialButtonToggleGroup
import com.hyliankid14.bbcradioplayer.PodcastSubscriptions
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding

class MainActivity : AppCompatActivity() {
    private lateinit var stationsList: RecyclerView
    private lateinit var settingsContainer: View
    private lateinit var fragmentContainer: View
    private lateinit var staticContentContainer: View
    private lateinit var stationsView: View
    private lateinit var stationsContent: View
    private lateinit var bottomNavigation: BottomNavigationView
    private lateinit var miniPlayer: LinearLayout
    private lateinit var miniPlayerTitle: TextView
    private lateinit var miniPlayerSubtitle: ScrollingTextView
    private lateinit var miniPlayerProgress: android.widget.ProgressBar
    private lateinit var miniPlayerArtwork: ImageView
    private lateinit var miniPlayerPrevious: ImageButton
    private lateinit var miniPlayerPlayPause: ImageButton
    private lateinit var miniPlayerNext: ImageButton
    private lateinit var miniPlayerStop: ImageButton
    private lateinit var miniPlayerFavorite: ImageButton
    private lateinit var createDocumentLauncher: ActivityResultLauncher<String>
    private lateinit var openDocumentLauncher: ActivityResultLauncher<Array<String>>
    private lateinit var requestNotificationPermissionLauncher: ActivityResultLauncher<String>
    // May be absent in some builds; make nullable and handle safely
    private var filterButtonsContainer: View? = null
    private lateinit var tabLayout: TabLayout
    private var categorizedAdapter: CategorizedStationAdapter? = null
    private var currentTabIndex = 0
    private var savedItemAnimator: androidx.recyclerview.widget.RecyclerView.ItemAnimator? = null
    private var selectionFromSwipe = false
    // Reference to the active swipe listener so it can be removed when not in the All Stations view
    private var stationsSwipeListener: RecyclerView.OnItemTouchListener? = null

    // Track whether a swipe-to-delete ItemTouchHelper has been attached to the Saved Episodes recycler
    private var savedItemTouchHelper: ItemTouchHelper? = null


    // ItemTouchHelpers to manage swipe-to-delete for History and Subscribed Podcasts
    private var historyItemTouchHelper: ItemTouchHelper? = null
    private var podcastsItemTouchHelper: ItemTouchHelper? = null
    
    private var currentMode = "list" // "favorites", "list", or "settings"
    // When true, programmatic bottom-navigation selections should not trigger the usual listener actions
    private var suppressBottomNavSelection = false
    private var miniPlayerUpdateTimer: Thread? = null
    private var lastArtworkUrl: String? = null
    // When opening a podcast from Favorites, return back to Favorites instead of Podcasts list
    private var returnToFavoritesOnBack: Boolean = false

    // Track the last visible percent for the episode/index progress bar so we can
    // defensively ignore any stray regressions emitted by background components.
    private var lastSeenIndexPercent: Int = 0
    private var savedSearchDateRefreshJob: Job? = null
    private lateinit var analytics: PrivacyAnalytics

    private val showChangeListener: (CurrentShow) -> Unit = { show ->
        runOnUiThread { updateMiniPlayerFromShow(show) }
    }
    private val backStackListener = FragmentManager.OnBackStackChangedListener {
        // Keep action bar title and bottom navigation in sync when fragments are pushed/popped.
        try {
            updateActionBarTitle()

            // If a fragment is visible in the fragment container assume Podcasts context,
            // otherwise infer the currentMode from which static container is visible.
            if (fragmentContainer.visibility == View.VISIBLE) {
                currentMode = "podcasts"
                // Avoid triggering the nav listener when updating selection due to fragment changes
                suppressBottomNavSelection = true
                try { bottomNavigation.selectedItemId = R.id.navigation_podcasts } catch (_: Exception) { }
                suppressBottomNavSelection = false
            } else {
                // Static content visible — decide between Favourites and List/Settings
                val favToggle = try { findViewById<LinearLayout>(R.id.favorites_toggle_group) } catch (_: Exception) { null }
                currentMode = if (stationsView.visibility == View.VISIBLE && favToggle?.visibility == View.VISIBLE) {
                    suppressBottomNavSelection = true
                    try { bottomNavigation.selectedItemId = R.id.navigation_favorites } catch (_: Exception) { }
                    suppressBottomNavSelection = false
                    "favorites"
                } else {
                    suppressBottomNavSelection = true
                    try { bottomNavigation.selectedItemId = R.id.navigation_list } catch (_: Exception) { }
                    suppressBottomNavSelection = false
                    if (settingsContainer.visibility == View.VISIBLE) "settings" else "list"
                }
            }

            // Ensure the favourites toggle visibility is corrected for the inferred mode
            updateFavoritesToggleVisibility()
            // Keep action bar visibility in sync with the currently visible container.
            syncActionBarVisibility()
        } catch (_: Exception) {
            // Defensive: never crash from backstack bookkeeping
            updateActionBarTitle()
            syncActionBarVisibility()
        }
    }

    private fun syncActionBarVisibility() {
        val actionBar = supportActionBar ?: return
        if (!::staticContentContainer.isInitialized || !::fragmentContainer.isInitialized) return
        val showingStaticContent = staticContentContainer.visibility == View.VISIBLE
        if (showingStaticContent) {
            actionBar.show()
            actionBar.setDisplayHomeAsUpEnabled(false)
            actionBar.setDisplayShowHomeEnabled(false)
            return
        }

        // Fragment content (podcasts) can have either list (own title bar) or detail pages.
        // Keep the existing behaviour: hide for list, show for detail/back stack.
        val hasDetailOnBackStack = supportFragmentManager.backStackEntryCount > 0
        if (hasDetailOnBackStack) {
            actionBar.show()
        } else {
            actionBar.hide()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Apply theme before creating the view
        val theme = ThemePreference.getTheme(this)
        ThemeManager.applyTheme(theme)
        
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // Local indexing is disabled in favour of cloud index search.
        // Cancel any stale one-time/periodic local indexing work on startup.
        try {
            IndexScheduler.cancel(this)
        } catch (e: Exception) {
            android.util.Log.w("MainActivity", "Failed to cancel background work: ${e.message}")
        }

        // Keep legacy schedule preferences in sync (forced to disabled).
        try {
            val days = IndexPreference.getIntervalDays(this)
            if (days > 0) {
                IndexScheduler.scheduleIndexing(this)
            }
        } catch (e: Exception) {
            android.util.Log.w("MainActivity", "Could not schedule background indexing: ${e.message}")
        }

        supportFragmentManager.addOnBackStackChangedListener(backStackListener)

        // Use Material Top App Bar instead of a classic action bar
        val toolbar = findViewById<com.google.android.material.appbar.MaterialToolbar>(R.id.top_app_bar)
        try {
            setSupportActionBar(toolbar)
        } catch (e: IllegalStateException) {
            android.util.Log.w("MainActivity", "Could not set support action bar: ${e.message}")
        }

        val mainRoot = findViewById<View>(R.id.main_root)
        ViewCompat.setOnApplyWindowInsetsListener(mainRoot) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            mainRoot.updatePadding(top = bars.top)
            if (::bottomNavigation.isInitialized) {
                bottomNavigation.updatePadding(bottom = bars.bottom)
            }
            insets
        }
        ViewCompat.requestApplyInsets(mainRoot)

        stationsList = findViewById(R.id.stations_list)
        stationsList.layoutManager = LinearLayoutManager(this)
        
        fragmentContainer = findViewById(R.id.fragment_container)
        staticContentContainer = findViewById(R.id.static_content_container)
        stationsView = findViewById(R.id.stations_view)
        stationsContent = findViewById(R.id.stations_content)
        
        // Try multiple ids because some build/tooling combinations either generate the include id
        // or only the ids from the included layout itself. Fall back to a hidden placeholder if none found.
        val fbRuntimeId = resources.getIdentifier("filter_buttons", "id", packageName).takeIf { it != 0 }
        val fbRuntimeView = fbRuntimeId?.let { findViewById<View?>(it) }
        filterButtonsContainer = findViewById<View?>(R.id.filter_buttons_include)
            ?: findViewById<View?>(R.id.filter_tabs)
            ?: fbRuntimeView
            ?: run {
                android.util.Log.w("MainActivity", "Filter buttons view not found; continuing without it")
                // Create an invisible placeholder so callers can safely invoke visibility changes
                View(this).apply { visibility = View.GONE }
            }
        
        settingsContainer = findViewById(R.id.settings_container)
        
        bottomNavigation = findViewById(R.id.bottom_navigation)
        bottomNavigation.setOnItemSelectedListener { item ->
            // When programmatically selecting a nav item we sometimes want to suppress the
            // listener's side-effects (caller will handle navigation). Honor that here.
            if (suppressBottomNavSelection) return@setOnItemSelectedListener true

            when (item.itemId) {
                R.id.navigation_favorites -> {
                    showFavorites()
                    true
                }
                R.id.navigation_list -> {
                    showAllStations()
                    true
                }
                R.id.navigation_podcasts -> {
                    showPodcasts()
                    true
                }
                R.id.navigation_settings -> {
                    showSettings()
                    true
                }
                else -> false
            }
        }

        // Intercept back presses to return to Favorites when a podcast was opened from Favorites
        onBackPressedDispatcher.addCallback(this, object : androidx.activity.OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                try {
                    val top = supportFragmentManager.findFragmentById(R.id.fragment_container)
                    if (returnToFavoritesOnBack && top is PodcastDetailFragment) {
                        returnToFavoritesOnBack = false
                        try { supportFragmentManager.popBackStack() } catch (_: Exception) { }

                        suppressBottomNavSelection = true
                        try { bottomNavigation.selectedItemId = R.id.navigation_favorites } catch (_: Exception) { }
                        suppressBottomNavSelection = false
                        showFavorites()
                        return
                    }
                } catch (_: Exception) { }

                // Default behavior
                isEnabled = false
                onBackPressedDispatcher.onBackPressed()
                isEnabled = true
            }
        })
        
        // Register Activity Result Launchers for Export / Import
        createDocumentLauncher = registerForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri: Uri? ->
            if (uri != null) {
                Thread {
                    runOnUiThread { Toast.makeText(this, "Export started...", Toast.LENGTH_SHORT).show() }
                    val success = exportPreferencesToUri(uri)
                    runOnUiThread { Toast.makeText(this, if (success) "Export successful" else "Export failed", Toast.LENGTH_LONG).show() }
                }.start()
            }
        }

        openDocumentLauncher = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
            if (uri != null) {
                try {
                    contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
                } catch (e: Exception) { }
                val progressDialog = createImportProgressDialog()
                progressDialog.show()
                Thread {
                    val success = importPreferencesFromUri(uri)
                    runOnUiThread {
                        progressDialog.dismiss()
                        Toast.makeText(this, if (success) "Import successful" else "Import failed", Toast.LENGTH_LONG).show()
                        ThemeManager.applyTheme(ThemePreference.getTheme(this))
                        refreshCurrentView()
                        refreshSavedEpisodesSection()
                        updateMiniPlayer()
                        // Ensure settings UI reflects the newly imported preferences immediately
                        setupSettings()
                        // Recreate the activity so any remaining listeners and UI are fully refreshed
                        recreate()
                    }
                }.start()
            }
        }

        // Request notification permission on Android 13+ (first run)
        requestNotificationPermissionLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { _ ->
            // No-op; UI can reflect permission state later if needed
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val prefs = getSharedPreferences("ui_prefs", MODE_PRIVATE)
            val asked = prefs.getBoolean("asked_notification_permission", false)
            val granted = ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
            if (!granted && !asked) {
                prefs.edit().putBoolean("asked_notification_permission", true).apply()
                requestNotificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }

        // Setup settings controls
        setupSettings()

        // Run a throttled sync on app start so subscription auto-downloads stay current
        // even before the next scheduled background refresh alarm fires.
        PodcastSubscriptions.triggerAutoDownloadForAllSubscriptions(this)
        
        // Create alarm notification channel
        createAlarmNotificationChannel()
        
        // Initialize analytics
        analytics = PrivacyAnalytics(this)
        
        // Show opt-in dialog on first run
        if (analytics.shouldShowOptInDialog()) {
            lifecycleScope.launch {
                kotlinx.coroutines.delay(1000)
                AnalyticsOptInDialog.show(this@MainActivity, analytics)
            }
        }
        
        // Mini player views
        miniPlayer = findViewById(R.id.mini_player)
        miniPlayerTitle = findViewById(R.id.mini_player_title)
        miniPlayerSubtitle = findViewById(R.id.mini_player_subtitle)
        miniPlayerProgress = findViewById(R.id.mini_player_progress)
        miniPlayerArtwork = findViewById(R.id.mini_player_artwork)
        miniPlayerPrevious = findViewById(R.id.mini_player_previous)
        miniPlayerPlayPause = findViewById(R.id.mini_player_play_pause)
        miniPlayerNext = findViewById(R.id.mini_player_next)
        miniPlayerStop = findViewById(R.id.mini_player_stop)
        miniPlayerFavorite = findViewById(R.id.mini_player_favorite)
        val miniPlayerTextContainer = findViewById<View>(R.id.mini_player_text_container)
        
        miniPlayerPrevious.setOnClickListener { skipToPrevious() }
        miniPlayerPlayPause.setOnClickListener { togglePlayPause() }
        miniPlayerNext.setOnClickListener { skipToNext() }
        miniPlayerStop.setOnClickListener { stopPlayback() }
        miniPlayerFavorite.setOnClickListener { toggleMiniPlayerFavorite() }
        miniPlayerArtwork.setOnClickListener { openNowPlaying() }
        miniPlayerTextContainer.setOnClickListener { openNowPlaying() }

        
        // Ensure mini player state is in sync immediately (avoids flicker on theme change)
        updateMiniPlayer()
        // Prevent navigation bar from resizing/moving when the keyboard appears
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING)
        
        // Restore previous section when recreating (e.g., theme change), otherwise default to list
        val restoredNavSelection = savedInstanceState?.getInt("selectedNavId")
        if (restoredNavSelection != null) {
            bottomNavigation.selectedItemId = restoredNavSelection
        } else {
            bottomNavigation.selectedItemId = R.id.navigation_list
        }

        updateActionBarTitle()
        
        // Start polling for playback state updates
        startPlaybackStateUpdates()

        // Handle any incoming intents that request opening a specific podcast or mode
        handleDeepLinkIntent(intent)
        handleOpenPodcastIntent(intent)
        handleOpenModeIntent(intent)
        handleOpenSavedSearchIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleDeepLinkIntent(intent)
        handleOpenPodcastIntent(intent)
        handleOpenModeIntent(intent)
        handleOpenSavedSearchIntent(intent)
    }

    private fun handleDeepLinkIntent(intent: Intent?) {
        val uri = intent?.data ?: return

        try {
            when {
                uri.scheme == "app" && uri.host == "podcast" -> {
                    val podcastId = uri.pathSegments.firstOrNull()?.let(Uri::decode) ?: return
                    handleOpenPodcastIntent(Intent().putExtra("open_podcast_id", podcastId))
                }

                uri.scheme == "app" && uri.host == "episode" -> {
                    val episodeId = uri.pathSegments.firstOrNull()?.let(Uri::decode).orEmpty()
                    val title = uri.getQueryParameter("title") ?: "Shared Episode"
                    val description = uri.getQueryParameter("desc") ?: ""
                    val audioUrl = uri.getQueryParameter("audio") ?: ""
                    val imageUrl = uri.getQueryParameter("img") ?: ""
                    val pubDate = uri.getQueryParameter("date") ?: ""
                    val durationMins = uri.getQueryParameter("duration")?.toIntOrNull() ?: 0
                    val podcastTitle = uri.getQueryParameter("podcast") ?: "British Radio Player"
                    val podcastId = uri.getQueryParameter("podcastId") ?: ""

                    if (audioUrl.isEmpty()) {
                        android.util.Log.w("MainActivity", "Episode deep link missing audio URL; cannot open episode directly")
                        return
                    }

                    Thread {
                        var resolvedPodcastTitle = podcastTitle
                        var resolvedPodcastId = podcastId
                        var resolvedPodcastImage = imageUrl

                        var resolvedTitle = title
                        var resolvedDescription = description
                        var resolvedAudioUrl = audioUrl
                        var resolvedEpisodeImage = imageUrl
                        var resolvedPubDate = pubDate
                        var resolvedDurationMins = durationMins

                        try {
                            val repo = PodcastRepository(this)
                            val allPodcasts = try {
                                kotlinx.coroutines.runBlocking { repo.fetchPodcasts(false) }
                            } catch (_: Exception) {
                                emptyList()
                            }

                            val matchedPodcast = when {
                                podcastId.isNotEmpty() -> allPodcasts.find { it.id == podcastId }
                                podcastTitle.isNotEmpty() -> allPodcasts.find { it.title.equals(podcastTitle, ignoreCase = true) }
                                else -> null
                            }

                            if (matchedPodcast != null) {
                                resolvedPodcastTitle = matchedPodcast.title
                                if (resolvedPodcastId.isEmpty()) resolvedPodcastId = matchedPodcast.id
                                if (resolvedPodcastImage.isEmpty()) resolvedPodcastImage = matchedPodcast.imageUrl

                                val episodes = try {
                                    kotlinx.coroutines.runBlocking { repo.fetchEpisodesIfNeeded(matchedPodcast) }
                                } catch (_: Exception) {
                                    emptyList()
                                }

                                val matchedEpisode = episodes.firstOrNull { episode ->
                                    (episodeId.isNotEmpty() && episode.id == episodeId) ||
                                    (audioUrl.isNotEmpty() && episode.audioUrl == audioUrl) ||
                                    (title.isNotEmpty() && episode.title.equals(title, ignoreCase = true))
                                }

                                if (matchedEpisode != null) {
                                    resolvedTitle = matchedEpisode.title
                                    resolvedDescription = matchedEpisode.description
                                    resolvedAudioUrl = matchedEpisode.audioUrl
                                    resolvedEpisodeImage = matchedEpisode.imageUrl.takeIf { it.isNotEmpty() } ?: resolvedEpisodeImage
                                    resolvedPubDate = matchedEpisode.pubDate
                                    resolvedDurationMins = matchedEpisode.durationMins
                                    if (resolvedPodcastId.isEmpty()) resolvedPodcastId = matchedEpisode.podcastId
                                }
                            }
                        } catch (e: Exception) {
                            android.util.Log.w("MainActivity", "Could not enrich episode deep link details: ${e.message}")
                        }

                        val safeEpisodeId = when {
                            episodeId.isNotEmpty() -> episodeId
                            resolvedAudioUrl.isNotEmpty() -> resolvedAudioUrl
                            else -> resolvedTitle
                        }

                        val episode = Episode(
                            id = safeEpisodeId,
                            title = resolvedTitle,
                            description = resolvedDescription,
                            audioUrl = resolvedAudioUrl,
                            imageUrl = resolvedEpisodeImage,
                            pubDate = resolvedPubDate,
                            durationMins = resolvedDurationMins,
                            podcastId = resolvedPodcastId
                        )

                        runOnUiThread {
                            val openIntent = Intent(this, NowPlayingActivity::class.java).apply {
                                putExtra("preview_episode", episode)
                                putExtra("preview_use_play_ui", true)
                                putExtra("preview_podcast_title", resolvedPodcastTitle)
                                putExtra("preview_podcast_image", resolvedPodcastImage)
                            }
                            startActivity(openIntent)
                        }
                    }.start()
                }
            }
        } catch (e: Exception) {
            android.util.Log.w("MainActivity", "Failed to handle deep link: ${e.message}")
        }
    }

    private fun handleOpenModeIntent(intent: Intent?) {
        val mode = intent?.getStringExtra("open_mode") ?: return
        when (mode) {
            "favorites" -> showFavorites()
            "list" -> showAllStations()
            else -> {
                // Unknown mode - ignore
            }
        }
    }

    private fun handleOpenSavedSearchIntent(intent: Intent?) {
        try {
            val searchId = intent?.getStringExtra("open_saved_search_id") ?: return
            val search = SavedSearchesPreference.getSearchById(this, searchId) ?: return
            // When a notification is clicked, it should always show the most recent results
            // (the default behavior of openSavedSearch ensures this)
            openSavedSearch(search)
        } catch (e: Exception) {
            android.util.Log.e("MainActivity", "Error handling open saved search intent", e)
        }
    }

    private fun openSavedSearch(search: SavedSearchesPreference.SavedSearch) {
        try {
            showPodcasts()
            suppressBottomNavSelection = true
            try { bottomNavigation.selectedItemId = R.id.navigation_podcasts } catch (_: Exception) { }
            suppressBottomNavSelection = false
            try { supportFragmentManager.executePendingTransactions() } catch (_: Exception) { }
            val existing = supportFragmentManager.findFragmentByTag("podcasts_fragment") as? PodcastsFragment
            if (existing != null) {
                // Launch the search with "Most recent" sort (forceMostRecent defaults to true)
                existing.applySavedSearch(search)
                return
            }
            fragmentContainer.post {
                try {
                    val fragment = supportFragmentManager.findFragmentByTag("podcasts_fragment") as? PodcastsFragment
                    fragment?.applySavedSearch(search)
                } catch (e: Exception) {
                    android.util.Log.e("MainActivity", "Error applying saved search from notification", e)
                }
            }
        } catch (e: Exception) {
            android.util.Log.e("MainActivity", "Error opening saved search", e)
        }
    }
    
    private fun refreshCurrentView() {
        // Always hide history when refreshing view (unless Favorites will explicitly show it)
        hideHistoryViews()
        // Clear show cache in the current adapter and refresh the view
        when (currentMode) {
            "list" -> {
                // Clear cache in categorized adapter if it exists
                categorizedAdapter?.clearShowCache()
                categorizedAdapter?.notifyDataSetChanged()
            }
            "favorites" -> {
                // Recreate favorites view to clear its cache
                showFavorites()
            }
        }
    }

    private fun refreshFavoriteStationsEmptyState() {
        try {
            val empty = findViewById<TextView>(R.id.favorite_stations_empty)
            val hasItems = FavoritesPreference.getFavorites(this).isNotEmpty()
            val stationsTabActive = (currentMode == "favorites" && isButtonChecked(R.id.fav_tab_stations))
            // Only control stationsList visibility when in favorites mode to avoid hiding All Stations view
            if (currentMode == "favorites") {
                stationsList.visibility = if (stationsTabActive && hasItems) View.VISIBLE else View.GONE
            }
            empty.visibility = if (stationsTabActive && !hasItems) View.VISIBLE else View.GONE
        } catch (_: Exception) { }
    }

    // Refresh the Saved Episodes UI card and adapter (called after import or when saved episodes change)
    private fun refreshSavedEpisodesSection() {
        try {
            val savedContainer = findViewById<View>(R.id.saved_episodes_container)
            val savedEmpty = findViewById<TextView>(R.id.saved_episodes_empty)
            if (currentMode != "favorites") {
                // Only show saved episodes when the Favorites view is active — avoids overlap in other views
                savedContainer.visibility = View.GONE
                savedEmpty.visibility = View.GONE
                try { findViewById<View>(R.id.saved_searches_container).visibility = View.GONE } catch (_: Exception) { }
                return
            }

            refreshSavedSearchesSection()

            val savedEntries = SavedEpisodes.getSavedEntries(this)
            val savedRecycler = findViewById<RecyclerView>(R.id.saved_episodes_recycler)

            // Prepare saved episodes recycler and adapter; visibility is controlled by the "Saved" tab
            if (savedEntries.isNotEmpty()) {
                savedRecycler.layoutManager = LinearLayoutManager(this)
                savedRecycler.isNestedScrollingEnabled = false
                savedEmpty.visibility = View.GONE
                val savedAdapter = SavedEpisodesAdapter(this, savedEntries, onPlayEpisode = { episode, podcastTitle, podcastImage ->
                    val intent = android.content.Intent(this, RadioService::class.java).apply {
                        action = RadioService.ACTION_PLAY_PODCAST_EPISODE
                        putExtra(RadioService.EXTRA_EPISODE, episode)
                        putExtra(RadioService.EXTRA_PODCAST_ID, episode.podcastId)
                        putExtra(RadioService.EXTRA_PODCAST_TITLE, podcastTitle)
                        putExtra(RadioService.EXTRA_PODCAST_IMAGE, episode.imageUrl.takeIf { it.isNotEmpty() } ?: podcastImage)
                    }
                    startService(intent)
                }, onOpenEpisode = { episode, podcastTitle, podcastImage ->
                    val intent = android.content.Intent(this, NowPlayingActivity::class.java).apply {
                        putExtra("preview_episode", episode)
                        putExtra("preview_use_play_ui", true)
                        putExtra("preview_podcast_title", podcastTitle)
                        putExtra("preview_podcast_image", episode.imageUrl.takeIf { it.isNotEmpty() } ?: podcastImage)
                    }
                    startActivity(intent)
                }, onRemoveSaved = { id ->
                    SavedEpisodes.remove(this, id)
                    EpisodeDownloadManager.deleteDownload(this, id, showToast = false)
                    val updated = SavedEpisodes.getSavedEntries(this)
                    savedRecycler.adapter?.let { (it as? SavedEpisodesAdapter)?.updateEntries(updated) }
                })

                savedRecycler.adapter = savedAdapter

                // Attach swipe-to-delete (only once) so users can swipe an item to reveal a delete background + icon
                if (savedItemTouchHelper == null) {
                    val swipeCallback = object : ItemTouchHelper.SimpleCallback(0, ItemTouchHelper.LEFT or ItemTouchHelper.RIGHT) {
                        override fun onMove(recyclerView: RecyclerView, viewHolder: RecyclerView.ViewHolder, target: RecyclerView.ViewHolder): Boolean = false

                        override fun onSwiped(viewHolder: RecyclerView.ViewHolder, direction: Int) {
                            val pos = viewHolder.bindingAdapterPosition
                            if (pos != RecyclerView.NO_POSITION) {
                                // Get the entry from the current adapter data (not a stale captured list)
                                val currentSavedAdapter = savedRecycler.adapter as? SavedEpisodesAdapter
                                val removedEntry = currentSavedAdapter?.getEntryAt(pos)
                                if (removedEntry == null) {
                                    try { savedRecycler.adapter?.notifyItemChanged(pos) } catch (_: Exception) { }
                                    return
                                }

                                // Remove saved entry and refresh adapter immediately
                                SavedEpisodes.remove(this@MainActivity, removedEntry.id)
                                EpisodeDownloadManager.deleteDownload(this@MainActivity, removedEntry.id, showToast = false)
                                val updated = SavedEpisodes.getSavedEntries(this@MainActivity)
                                savedRecycler.adapter?.let { (it as? SavedEpisodesAdapter)?.updateEntries(updated) }

                                // Show an Undo Snackbar — clicking Undo will restore the exact entry
                                com.google.android.material.snackbar.Snackbar
                                    .make(findViewById(android.R.id.content), "Saved episode removed", com.google.android.material.snackbar.Snackbar.LENGTH_LONG)
                                    .setAction("Undo") {
                                        SavedEpisodes.saveEntry(this@MainActivity, removedEntry)
                                        val refreshed = SavedEpisodes.getSavedEntries(this@MainActivity)
                                        savedRecycler.adapter?.let { (it as? SavedEpisodesAdapter)?.updateEntries(refreshed) }
                                    }
                                    .setAnchorView(findViewById(R.id.saved_episodes_container))
                                    .show()
                            }
                        }

                        override fun clearView(recyclerView: RecyclerView, viewHolder: RecyclerView.ViewHolder) {
                            super.clearView(recyclerView, viewHolder)
                            // Force a redraw of the item so any temporary canvas drawing is cleared
                            viewHolder.itemView.invalidate()
                            // Reset the haptic trigger tag so subsequent swipes can trigger again
                            try { viewHolder.itemView.setTag(R.id.swipe_haptic_trigger, false) } catch (_: Exception) { }
                        }

                        override fun onChildDraw(c: android.graphics.Canvas, recyclerView: RecyclerView, viewHolder: RecyclerView.ViewHolder, dX: Float, dY: Float, actionState: Int, isCurrentlyActive: Boolean) {
                            // If there's no displacement and the user isn't actively swiping, let the
                            // default implementation handle drawing — this avoids leaving the icon
                            // drawn after a partially-completed swipe is released.
                            if (kotlin.math.abs(dX) < 0.5f && !isCurrentlyActive) {
                                super.onChildDraw(c, recyclerView, viewHolder, dX, dY, actionState, isCurrentlyActive)
                                return
                            }

                            val itemView = viewHolder.itemView
                            val paint = android.graphics.Paint()
                            val icon = ContextCompat.getDrawable(this@MainActivity, android.R.drawable.ic_menu_delete)
                            val backgroundColor = android.graphics.Color.parseColor("#f44336") // material red 500
                            paint.color = backgroundColor

                            // Trigger a short haptic feedback once when swipe passes threshold
                            val triggerThreshold = itemView.width * 0.25f
                            val hasTriggered = (itemView.getTag(R.id.swipe_haptic_trigger) as? Boolean) ?: false
                            if (!hasTriggered && kotlin.math.abs(dX) > triggerThreshold && isCurrentlyActive) {
                                try {
                                    // Ensure haptic feedback is enabled on this view
                                    itemView.isHapticFeedbackEnabled = true
                                    val performed = itemView.performHapticFeedback(android.view.HapticFeedbackConstants.KEYBOARD_TAP)
                                    if (!performed) {
                                        // Fallback to Vibrator API for more reliable feedback on some devices
                                        try {
                                            val vib = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
                                                itemView.context.getSystemService(android.os.VibratorManager::class.java)?.defaultVibrator
                                            } else if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
                                                itemView.context.getSystemService(android.os.Vibrator::class.java)
                                            } else {
                                                @Suppress("DEPRECATION")
                                                itemView.context.getSystemService(android.content.Context.VIBRATOR_SERVICE) as? android.os.Vibrator
                                            }
                                            if (vib != null) {
                                                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                                                    vib.vibrate(android.os.VibrationEffect.createOneShot(20, android.os.VibrationEffect.DEFAULT_AMPLITUDE))
                                                } else {
                                                    @Suppress("DEPRECATION")
                                                    vib.vibrate(20)
                                                }
                                            }
                                        } catch (_: Exception) { }
                                    }
                                    itemView.setTag(R.id.swipe_haptic_trigger, true)
                                } catch (_: Exception) { }
                            }

                            if (dX > 0) {
                                // Swiping to the right — draw background from left edge to dX
                                val rect = android.graphics.RectF(itemView.left.toFloat(), itemView.top.toFloat(), itemView.left + dX, itemView.bottom.toFloat())
                                c.drawRect(rect, paint)
                                icon?.let {
                                    val iconTop = itemView.top + (itemView.height - it.intrinsicHeight) / 2
                                    val iconMargin = (itemView.height - it.intrinsicHeight) / 2
                                    val iconLeft = itemView.left + iconMargin
                                    val iconRight = iconLeft + it.intrinsicWidth
                                    val iconBottom = iconTop + it.intrinsicHeight
                                    it.setBounds(iconLeft, iconTop, iconRight, iconBottom)
                                    it.draw(c)
                                }
                            } else {
                                // Swiping to the left — draw background from right edge to dX
                                val rect = android.graphics.RectF(itemView.right + dX, itemView.top.toFloat(), itemView.right.toFloat(), itemView.bottom.toFloat())
                                c.drawRect(rect, paint)
                                icon?.let {
                                    val iconTop = itemView.top + (itemView.height - it.intrinsicHeight) / 2
                                    val iconMargin = (itemView.height - it.intrinsicHeight) / 2
                                    val iconRight = itemView.right - iconMargin
                                    val iconLeft = iconRight - it.intrinsicWidth
                                    val iconBottom = iconTop + it.intrinsicHeight
                                    it.setBounds(iconLeft, iconTop, iconRight, iconBottom)
                                    it.draw(c)
                                }
                            }

                            super.onChildDraw(c, recyclerView, viewHolder, dX, dY, actionState, isCurrentlyActive)
                        }
                    }
                    savedItemTouchHelper = ItemTouchHelper(swipeCallback).also { it.attachToRecyclerView(savedRecycler) }
                }

                // Show the saved episodes immediately if the Favorites view is active AND the Saved tab is selected.
                val savedTabActive = (currentMode == "favorites" && isButtonChecked(R.id.fav_tab_saved))
                if (savedTabActive) {
                    savedRecycler.visibility = View.VISIBLE
                    savedEmpty.visibility = View.GONE
                    savedContainer.visibility = View.VISIBLE
                } else {
                    // Keep the container hidden by default; the Saved tab will reveal it when selected
                    savedRecycler.visibility = View.GONE
                    savedEmpty.visibility = View.GONE
                    savedContainer.visibility = View.GONE
                }
            } else {
                savedRecycler.adapter = null
                val savedTabActive = (currentMode == "favorites" && isButtonChecked(R.id.fav_tab_saved))
                savedRecycler.visibility = View.GONE
                savedEmpty.visibility = if (savedTabActive) View.VISIBLE else View.GONE
                savedContainer.visibility = if (savedTabActive) View.VISIBLE else View.GONE
            }
        } catch (e: Exception) {
            // Swallow — UI refresh should never crash the app
            android.util.Log.w("MainActivity", "refreshSavedEpisodesSection failed: ${e.message}")
        }
    }

    // Refresh the History UI card and adapter (most-recent-first)
    private fun refreshHistorySection() {
        try {
            val historyContainer = findViewById<View>(R.id.favorites_history_container)
            val historyEmpty = findViewById<TextView>(R.id.favorites_history_empty)
            if (currentMode != "favorites") {
                historyContainer.visibility = View.GONE
                historyEmpty.visibility = View.GONE
                return
            }

            val historyEntries = PlayedHistoryPreference.getHistory(this)
            val historyRecycler = findViewById<RecyclerView>(R.id.favorites_history_recycler)

            // Only reveal the history RecyclerView when the Favorites *History* sub-tab is active.
            val historyTabActive = isButtonChecked(R.id.fav_tab_history)

            if (historyEntries.isNotEmpty()) {
                historyRecycler.layoutManager = LinearLayoutManager(this)
                historyRecycler.isNestedScrollingEnabled = false
                historyEmpty.visibility = View.GONE
                val adapter = (historyRecycler.adapter as? PlayedHistoryAdapter) ?: PlayedHistoryAdapter(
                    this,
                    historyEntries,
                    onPlayEpisode = { episode, podcastTitle, podcastImage ->
                        val intent = android.content.Intent(this, RadioService::class.java).apply {
                            action = RadioService.ACTION_PLAY_PODCAST_EPISODE
                            putExtra(RadioService.EXTRA_EPISODE, episode)
                            putExtra(RadioService.EXTRA_PODCAST_ID, episode.podcastId)
                            putExtra(RadioService.EXTRA_PODCAST_TITLE, podcastTitle)
                            putExtra(RadioService.EXTRA_PODCAST_IMAGE, podcastImage)
                        }
                        startService(intent)
                    },
                    onOpenEpisode = { episode, podcastTitle, podcastImage ->
                        val intent = android.content.Intent(this, NowPlayingActivity::class.java).apply {
                            putExtra("preview_episode", episode)
                            putExtra("preview_use_play_ui", true)
                            putExtra("preview_podcast_title", podcastTitle)
                            putExtra("preview_podcast_image", podcastImage)
                        }
                        startActivity(intent)
                    }
                )

                if (historyRecycler.adapter == null) {
                    historyRecycler.adapter = adapter
                }
                adapter.updateEntries(historyEntries)

                // Attach swipe-to-delete for History (only once)
                if (historyItemTouchHelper == null) {
                    val swipeCallbackHistory = object : ItemTouchHelper.SimpleCallback(0, ItemTouchHelper.LEFT or ItemTouchHelper.RIGHT) {
                        override fun onMove(recyclerView: RecyclerView, viewHolder: RecyclerView.ViewHolder, target: RecyclerView.ViewHolder): Boolean = false

                        override fun onSwiped(viewHolder: RecyclerView.ViewHolder, direction: Int) {
                            val pos = viewHolder.bindingAdapterPosition
                            if (pos != RecyclerView.NO_POSITION) {
                                val historyAdapter = historyRecycler.adapter as? PlayedHistoryAdapter
                                val removedEntry = historyAdapter?.getEntryAt(pos)
                                if (removedEntry == null) {
                                    try { historyRecycler.adapter?.notifyItemChanged(pos) } catch (_: Exception) { }
                                    return
                                }

                                // Remove entry from store and refresh adapter
                                PlayedHistoryPreference.removeEntry(this@MainActivity, removedEntry.id)
                                val updated = PlayedHistoryPreference.getHistory(this@MainActivity)
                                historyRecycler.adapter?.let { (it as? PlayedHistoryAdapter)?.updateEntries(updated) }

                                // Show Undo Snackbar
                                com.google.android.material.snackbar.Snackbar
                                    .make(findViewById(android.R.id.content), "History entry removed", com.google.android.material.snackbar.Snackbar.LENGTH_LONG)
                                    .setAction("Undo") {
                                        PlayedHistoryPreference.saveEntry(this@MainActivity, removedEntry)
                                        val refreshed = PlayedHistoryPreference.getHistory(this@MainActivity)
                                        historyRecycler.adapter?.let { (it as? PlayedHistoryAdapter)?.updateEntries(refreshed) }
                                    }
                                    .setAnchorView(findViewById(R.id.favorites_history_container))
                                    .show()
                            }
                        }

                        override fun clearView(recyclerView: RecyclerView, viewHolder: RecyclerView.ViewHolder) {
                            super.clearView(recyclerView, viewHolder)
                            viewHolder.itemView.invalidate()
                            try { viewHolder.itemView.setTag(R.id.swipe_haptic_trigger, false) } catch (_: Exception) { }
                        }

                        override fun onChildDraw(c: android.graphics.Canvas, recyclerView: RecyclerView, viewHolder: RecyclerView.ViewHolder, dX: Float, dY: Float, actionState: Int, isCurrentlyActive: Boolean) {
                            if (kotlin.math.abs(dX) < 0.5f && !isCurrentlyActive) {
                                super.onChildDraw(c, recyclerView, viewHolder, dX, dY, actionState, isCurrentlyActive)
                                return
                            }

                            val itemView = viewHolder.itemView
                            val triggerThreshold = itemView.width * 0.25f
                            val hasTriggered = (itemView.getTag(R.id.swipe_haptic_trigger) as? Boolean) ?: false
                            if (!hasTriggered && kotlin.math.abs(dX) > triggerThreshold && isCurrentlyActive) {
                                try { itemView.performHapticFeedback(android.view.HapticFeedbackConstants.VIRTUAL_KEY); itemView.setTag(R.id.swipe_haptic_trigger, true) } catch (_: Exception) { }
                            }

                            val paint = android.graphics.Paint()
                            val icon = ContextCompat.getDrawable(this@MainActivity, android.R.drawable.ic_menu_delete)
                            val backgroundColor = android.graphics.Color.parseColor("#f44336") // material red 500
                            paint.color = backgroundColor

                            if (dX > 0) {
                                val rect = android.graphics.RectF(itemView.left.toFloat(), itemView.top.toFloat(), itemView.left + dX, itemView.bottom.toFloat())
                                c.drawRect(rect, paint)
                                icon?.let {
                                    val iconTop = itemView.top + (itemView.height - it.intrinsicHeight) / 2
                                    val iconMargin = (itemView.height - it.intrinsicHeight) / 2
                                    val iconLeft = itemView.left + iconMargin
                                    val iconRight = iconLeft + it.intrinsicWidth
                                    val iconBottom = iconTop + it.intrinsicHeight
                                    it.setBounds(iconLeft, iconTop, iconRight, iconBottom)
                                    it.draw(c)
                                }
                            } else {
                                val rect = android.graphics.RectF(itemView.right + dX, itemView.top.toFloat(), itemView.right.toFloat(), itemView.bottom.toFloat())
                                c.drawRect(rect, paint)
                                icon?.let {
                                    val iconTop = itemView.top + (itemView.height - it.intrinsicHeight) / 2
                                    val iconMargin = (itemView.height - it.intrinsicHeight) / 2
                                    val iconRight = itemView.right - iconMargin
                                    val iconLeft = iconRight - it.intrinsicWidth
                                    val iconBottom = iconTop + it.intrinsicHeight
                                    it.setBounds(iconLeft, iconTop, iconRight, iconBottom)
                                    it.draw(c)
                                }
                            }

                            super.onChildDraw(c, recyclerView, viewHolder, dX, dY, actionState, isCurrentlyActive)
                        }
                    }
                    historyItemTouchHelper = ItemTouchHelper(swipeCallbackHistory).also { it.attachToRecyclerView(historyRecycler) }
                }

                if (historyTabActive) {
                    historyRecycler.visibility = View.VISIBLE
                    historyEmpty.visibility = View.GONE
                    historyContainer.visibility = View.VISIBLE
                    try { historyRecycler.scrollToPosition(0) } catch (_: Exception) { }
                } else {
                    // Keep the UI hidden when another Favorites sub-tab is active
                    historyRecycler.visibility = View.GONE
                    historyEmpty.visibility = View.GONE
                    historyContainer.visibility = View.GONE
                }
            } else {
                historyRecycler.adapter = null
                historyRecycler.visibility = View.GONE
                historyEmpty.visibility = if (historyTabActive) View.VISIBLE else View.GONE
                historyContainer.visibility = if (historyTabActive) View.VISIBLE else View.GONE
            }
        } catch (e: Exception) {
            android.util.Log.w("MainActivity", "refreshHistorySection failed: ${e.message}")
        }
    }

    // Hide history views (centralized) --------------------------------------------------------
    private fun hideHistoryViews() {
        try {
            val rv = findViewById<androidx.recyclerview.widget.RecyclerView>(R.id.favorites_history_recycler)
            val container = findViewById<View>(R.id.favorites_history_container)
            // Clear adapter defensively to prevent stale items remaining attached after view reparenting
            try { rv?.adapter = null } catch (_: Exception) { }
            rv?.visibility = View.GONE
            container?.visibility = View.GONE
        } catch (_: Exception) { }
    }

    // Centralise visibility for the favourites toggle group so it's only visible when
    // the app is actually showing the Favourites page.
    private fun updateFavoritesToggleVisibility() {
        try {
            val toggle = findViewById<LinearLayout>(R.id.favorites_toggle_group)
            toggle?.visibility = if (currentMode == "favorites") View.VISIBLE else View.GONE
        } catch (_: Exception) { }
    }

    private fun showAllStations() {
        // Ensure history UI is hidden when leaving Favorites
        hideHistoryViews()
        currentMode = "list"
        // Ensure swipe navigation is enabled for the All Stations view
        setupSwipeNavigation()
        fragmentContainer.visibility = View.GONE
        staticContentContainer.visibility = View.VISIBLE
        stationsView.visibility = View.VISIBLE
        stationsList.visibility = View.VISIBLE
        filterButtonsContainer?.visibility = View.VISIBLE
        settingsContainer.visibility = View.GONE
        // Hide favorites empty state message (only relevant in Favourites view)
        try { findViewById<TextView>(R.id.favorite_stations_empty).visibility = View.GONE } catch (_: Exception) { }
        // Ensure action bar reflects the section and clear any podcast-specific up affordance
        supportActionBar?.apply {
            show()
            title = "All Stations"
            setDisplayHomeAsUpEnabled(false)
            setDisplayShowHomeEnabled(false)
        }
        
        // Hide subscribed podcasts section (only show in Favorites)
        val favoritesPodcastsContainer = findViewById<View>(R.id.favorites_podcasts_container)
        favoritesPodcastsContainer.visibility = View.GONE
        try { findViewById<View>(R.id.saved_searches_container).visibility = View.GONE } catch (_: Exception) { }
        // Update favourites toggle visibility for this mode
        try { updateFavoritesToggleVisibility() } catch (_: Exception) { }
        
        // Default to National category
        showCategoryStations(StationCategory.NATIONAL)
        setupFilterButtons()
        // Ensure saved episodes UI is hidden when switching to All Stations
        refreshSavedEpisodesSection()
        
        // Hide filter buttons if not available
        filterButtonsContainer?.visibility = View.VISIBLE
    }

    private fun showFavorites() {
        currentMode = "favorites"
        // Disable swipe navigation in Favorites
        disableSwipeNavigation()
        fragmentContainer.visibility = View.GONE
        staticContentContainer.visibility = View.VISIBLE
        stationsView.visibility = View.VISIBLE
        stationsList.visibility = View.VISIBLE
        filterButtonsContainer?.visibility = View.GONE
        settingsContainer.visibility = View.GONE
        // Ensure action bar reflects the section and clear any podcast-specific up affordance
        supportActionBar?.apply {
            show()
            title = "Favourites"
            setDisplayHomeAsUpEnabled(false)
            setDisplayShowHomeEnabled(false)
        }
        
        val favoritesPodcastsContainer = findViewById<View>(R.id.favorites_podcasts_container)
        val favoritesPodcastsRecycler = findViewById<RecyclerView>(R.id.favorites_podcasts_recycler)
        val savedContainer = findViewById<View>(R.id.saved_episodes_container)
        val savedSearchesContainer = findViewById<View>(R.id.saved_searches_container)
        val historyContainer = findViewById<View>(R.id.favorites_history_container)
        // Ensure the favourites toggle group is visible when in Favorites
        try { updateFavoritesToggleVisibility() } catch (_: Exception) { }

        // Key for persisting the last-selected Favorites sub-tab (declare once)
        val LAST_FAV_TAB_KEY = "last_fav_tab_id"

        // Ensure the favorites-related containers are near the top of the parent column so they appear
        // above other content when the Favorites view is selected.
        val parent = favoritesPodcastsContainer.parent as? android.view.ViewGroup
        parent?.let {
            try {
                it.removeView(favoritesPodcastsContainer)
                it.addView(favoritesPodcastsContainer, 1)
            } catch (_: Exception) { /* best-effort */ }
            try {
                it.removeView(savedContainer)
                it.addView(savedContainer, 2)
            } catch (_: Exception) { /* best-effort */ }
            try {
                it.removeView(savedSearchesContainer)
                it.addView(savedSearchesContainer, 3)
            } catch (_: Exception) { /* best-effort */ }
            try {
                it.removeView(historyContainer)
                it.addView(historyContainer, 4)
            } catch (_: Exception) { /* best-effort */ }
        }

        // Ensure only the last-accessed favorites group is visible immediately (avoid flicker / defaulting)
        try {
            val prefs = getPreferences(android.content.Context.MODE_PRIVATE)
            val candidateIds = listOf(R.id.fav_tab_stations, R.id.fav_tab_subscribed, R.id.fav_tab_saved, R.id.fav_tab_searches, R.id.fav_tab_history)
            var initialLastChecked = prefs.getInt(LAST_FAV_TAB_KEY, R.id.fav_tab_stations)
            if (!candidateIds.contains(initialLastChecked)) initialLastChecked = R.id.fav_tab_stations

            stationsList.visibility = if (initialLastChecked == R.id.fav_tab_stations) View.VISIBLE else View.GONE
            favoritesPodcastsContainer.visibility = if (initialLastChecked == R.id.fav_tab_subscribed) View.VISIBLE else View.GONE
            savedContainer.visibility = if (initialLastChecked == R.id.fav_tab_saved) View.VISIBLE else View.GONE
            savedSearchesContainer.visibility = if (initialLastChecked == R.id.fav_tab_searches) View.VISIBLE else View.GONE
            historyContainer.visibility = if (initialLastChecked == R.id.fav_tab_history) View.VISIBLE else View.GONE
        } catch (_: Exception) { }

        val stations = FavoritesPreference.getFavorites(this).toMutableList()
        lateinit var adapter: FavoritesAdapter
        adapter = FavoritesAdapter(this, stations, { stationId ->
            playStation(stationId)
        }, { _ ->
            refreshFavoriteStationsEmptyState()
        }, {
            // Save the new order when changed
            FavoritesPreference.saveFavoritesOrder(this, stations.map { it.id })
        }, { station, position ->
            // Handle removal with undo
            adapter.removeItem(position)
            refreshFavoriteStationsEmptyState()
            
            // Show Snackbar with undo action
            com.google.android.material.snackbar.Snackbar
                .make(findViewById(android.R.id.content), "Removed from favourites", com.google.android.material.snackbar.Snackbar.LENGTH_LONG)
                .setAction("Undo") {
                    // Restore the item in the list
                    adapter.restoreItem(station, position)
                    refreshFavoriteStationsEmptyState()
                    // Don't persist the removal - item is still in favourites
                }
                .addCallback(object : com.google.android.material.snackbar.Snackbar.Callback() {
                    override fun onDismissed(transientBottomBar: com.google.android.material.snackbar.Snackbar?, event: Int) {
                        super.onDismissed(transientBottomBar, event)
                        // Only persist the removal if not dismissed by the undo action
                        if (event != DISMISS_EVENT_ACTION) {
                            FavoritesPreference.toggleFavorite(this@MainActivity, station.id)
                            // Update the saved order
                            FavoritesPreference.saveFavoritesOrder(this@MainActivity, stations.map { it.id })
                        }
                    }
                })
                .setAnchorView(findViewById(R.id.stations_content))
                .show()
        })
        stationsList.adapter = adapter
        refreshFavoriteStationsEmptyState()

        // Wire favorites tab group to show/hide the four sub-views — implementation moved to class-level `showFavoritesTab` to allow reuse from other lifecycle methods.

        // Restore last-selected favorites tab (fall back to Stations)
        val prefs = getPreferences(android.content.Context.MODE_PRIVATE)
        val candidateIds = listOf(R.id.fav_tab_stations, R.id.fav_tab_subscribed, R.id.fav_tab_saved, R.id.fav_tab_searches, R.id.fav_tab_history)
        var lastChecked = prefs.getInt(LAST_FAV_TAB_KEY, R.id.fav_tab_stations)
        if (!candidateIds.contains(lastChecked)) lastChecked = R.id.fav_tab_stations
        // Ensure UI and section match restored selection
        updateFavoritesToggleVisuals(lastChecked)
        when (lastChecked) {
            R.id.fav_tab_stations -> showFavoritesTab("stations")
            R.id.fav_tab_subscribed -> showFavoritesTab("subscribed")
            R.id.fav_tab_saved -> showFavoritesTab("saved")
            R.id.fav_tab_searches -> showFavoritesTab("searches")
            R.id.fav_tab_history -> showFavoritesTab("history")
        }



        // Initial visuals (restore last selection)
        updateFavoritesToggleVisuals(lastChecked)

        // Set up click listeners for each button (since we're not using MaterialButtonToggleGroup anymore)
        findViewById<com.google.android.material.button.MaterialButton>(R.id.fav_tab_stations).setOnClickListener {
            try { prefs.edit().putInt(LAST_FAV_TAB_KEY, R.id.fav_tab_stations).apply() } catch (_: Exception) { }
            updateFavoritesToggleVisuals(R.id.fav_tab_stations)
            showFavoritesTab("stations")
        }
        findViewById<com.google.android.material.button.MaterialButton>(R.id.fav_tab_subscribed).setOnClickListener {
            try { prefs.edit().putInt(LAST_FAV_TAB_KEY, R.id.fav_tab_subscribed).apply() } catch (_: Exception) { }
            updateFavoritesToggleVisuals(R.id.fav_tab_subscribed)
            showFavoritesTab("subscribed")
        }
        findViewById<com.google.android.material.button.MaterialButton>(R.id.fav_tab_saved).setOnClickListener {
            try { prefs.edit().putInt(LAST_FAV_TAB_KEY, R.id.fav_tab_saved).apply() } catch (_: Exception) { }
            updateFavoritesToggleVisuals(R.id.fav_tab_saved)
            showFavoritesTab("saved")
        }
        findViewById<com.google.android.material.button.MaterialButton>(R.id.fav_tab_searches).setOnClickListener {
            try { prefs.edit().putInt(LAST_FAV_TAB_KEY, R.id.fav_tab_searches).apply() } catch (_: Exception) { }
            updateFavoritesToggleVisuals(R.id.fav_tab_searches)
            showFavoritesTab("searches")
        }
        findViewById<com.google.android.material.button.MaterialButton>(R.id.fav_tab_history).setOnClickListener {
            try { prefs.edit().putInt(LAST_FAV_TAB_KEY, R.id.fav_tab_history).apply() } catch (_: Exception) { }
            updateFavoritesToggleVisuals(R.id.fav_tab_history)
            showFavoritesTab("history")
        }
        
        // Setup ItemTouchHelper for drag-and-drop. We disable the default long-press start and instead
        // start drags explicitly when the user long-presses the station name or touches the drag handle.
        val itemTouchHelperCallback = object : ItemTouchHelper.Callback() {
            override fun getMovementFlags(recyclerView: RecyclerView, viewHolder: RecyclerView.ViewHolder): Int {
                val dragFlags = ItemTouchHelper.UP or ItemTouchHelper.DOWN
                return makeMovementFlags(dragFlags, 0)
            }
            
            override fun onMove(recyclerView: RecyclerView, source: RecyclerView.ViewHolder, target: RecyclerView.ViewHolder): Boolean {
                adapter.moveItem(source.bindingAdapterPosition, target.bindingAdapterPosition)
                return true
            }
            
            override fun onSwiped(viewHolder: RecyclerView.ViewHolder, direction: Int) {}

            // We will call startDrag manually from the adapter's long-press so disable the default long-press behavior
            override fun isLongPressDragEnabled(): Boolean = false

            // Visual feedback when an item is selected for dragging
            override fun onSelectedChanged(viewHolder: RecyclerView.ViewHolder?, actionState: Int) {
                super.onSelectedChanged(viewHolder, actionState)
                if (actionState == ItemTouchHelper.ACTION_STATE_DRAG && viewHolder != null) {
                    val v = viewHolder.itemView
                    v.bringToFront()
                    v.animate().scaleX(1.02f).scaleY(1.02f).alpha(0.98f).setDuration(120).start()
                    v.elevation = (16 * resources.displayMetrics.density)
                }
            }

            override fun clearView(recyclerView: RecyclerView, viewHolder: RecyclerView.ViewHolder) {
                super.clearView(recyclerView, viewHolder)
                val v = viewHolder.itemView
                v.animate().scaleX(1f).scaleY(1f).alpha(1f).setDuration(150).start()
                v.elevation = 0f
            }
        }
        
        val itemTouchHelper = ItemTouchHelper(itemTouchHelperCallback)
        itemTouchHelper.attachToRecyclerView(stationsList)

        // Wire the adapter so it can start drags when the user long-presses the title or touches the handle
        adapter.onStartDrag = { vh, screenX, screenY ->
            // Start the ItemTouchHelper drag
            itemTouchHelper.startDrag(vh)
            // Synthesize a small ACTION_DOWN on the RecyclerView at the long-press location so the
            // active pointer is attached to the recycler for subsequent MOVE events (smooth drag)
            try {
                val rv = stationsList
                val rvLoc = IntArray(2).also { rv.getLocationOnScreen(it) }
                val x = (screenX - rvLoc[0]).toFloat()
                val y = (screenY - rvLoc[1]).toFloat()
                val now = android.os.SystemClock.uptimeMillis()
                val down = android.view.MotionEvent.obtain(now, now, android.view.MotionEvent.ACTION_DOWN, x, y, 0)
                rv.dispatchTouchEvent(down)
                down.recycle()
            } catch (_: Exception) { }
        }

        // Load subscribed podcasts into Favorites section — do not force visibility unless the Subscribed tab was last-selected
        val subscribedIds = PodcastSubscriptions.getSubscribedIds(this)
        if (subscribedIds.isNotEmpty()) {
            favoritesPodcastsRecycler.layoutManager = LinearLayoutManager(this)
            // Start hidden; the toggle/tab will reveal this when appropriate
            favoritesPodcastsRecycler.visibility = View.GONE
            favoritesPodcastsRecycler.isNestedScrollingEnabled = false

            // If the subscribed tab is already visible, show a loading indicator immediately
            val subscribedTabAlreadyActive = (currentMode == "favorites" && isButtonChecked(R.id.fav_tab_subscribed))
            if (subscribedTabAlreadyActive) {
                setSubscribedPodcastsLoading(true)
            }

            // Refresh Saved Episodes data (visibility itself handled by the Saved tab)
            refreshSavedEpisodesSection()

            val repo = PodcastRepository(this)
            Thread {
                val all = try { kotlinx.coroutines.runBlocking { repo.fetchPodcasts(false) } } catch (e: Exception) { emptyList<Podcast>() }
                var subs = all.filter { subscribedIds.contains(it.id) }
                // Fetch cached latest update epochs and sort subscribed podcasts by newest update first
                val updates = try { kotlinx.coroutines.runBlocking { repo.fetchLatestUpdates(subs) } } catch (e: Exception) { emptyMap<String, Long>() }
                subs = subs.sortedByDescending { updates[it.id] ?: Long.MAX_VALUE }
                // Determine which subscriptions have unseen episodes (latest update > last played epoch)
                val newSet = subs.filter { p ->
                    val latest = updates[p.id] ?: 0L
                    val lastPlayed = PlayedEpisodesPreference.getLastPlayedEpoch(this, p.id)
                    latest > lastPlayed
                }.map { it.id }.toSet()
                runOnUiThread {
                    setSubscribedPodcastsLoading(false)
                    val podcastAdapter = PodcastAdapter(this, onPodcastClick = { podcast ->
                        // Show app bar so podcast title and back button are visible
                        supportActionBar?.show()
                        // Navigate to podcast detail
                        fragmentContainer.visibility = View.VISIBLE
                        staticContentContainer.visibility = View.GONE
                        // Ensure the main navigation reflects the Podcasts context
                        currentMode = "podcasts"
                        // Mark origin so back returns to Favorites
                        returnToFavoritesOnBack = true
                        // Disable swipe navigation when leaving All Stations
                        disableSwipeNavigation()
                        // Programmatic selection should not trigger the bottom-nav listener (it would replace our fragment)
                        suppressBottomNavSelection = true
                        try { bottomNavigation.selectedItemId = R.id.navigation_podcasts } catch (_: Exception) { }
                        suppressBottomNavSelection = false
                        updateActionBarTitle()
                        // Hide the favourites toggle when showing a fragment/detail view
                        updateFavoritesToggleVisibility()
                        val detailFragment = PodcastDetailFragment().apply {
                            arguments = android.os.Bundle().apply { putParcelable("podcast", podcast) }
                        }
                        supportFragmentManager.beginTransaction().apply {
                            replace(R.id.fragment_container, detailFragment)
                            addToBackStack(null)
                            commit()
                        }
                    }, highlightSubscribed = true, showSubscribedIcon = false)

                    favoritesPodcastsRecycler.adapter = podcastAdapter
                    podcastAdapter.updatePodcasts(subs)
                    podcastAdapter.updateNewEpisodes(newSet)

                    // Attach swipe-to-unsubscribe (only once)
                    if (podcastsItemTouchHelper == null) {
                        val swipeCallbackPodcasts = object : ItemTouchHelper.SimpleCallback(0, ItemTouchHelper.LEFT or ItemTouchHelper.RIGHT) {
                            override fun onMove(recyclerView: RecyclerView, viewHolder: RecyclerView.ViewHolder, target: RecyclerView.ViewHolder): Boolean = false

                            override fun onSwiped(viewHolder: RecyclerView.ViewHolder, direction: Int) {
                                val pos = viewHolder.bindingAdapterPosition
                                if (pos != RecyclerView.NO_POSITION) {
                                    val podcastAdapterForSwipe = favoritesPodcastsRecycler.adapter as? PodcastAdapter
                                    val removedPodcast = podcastAdapterForSwipe?.removePodcastAt(pos)
                                    removedPodcast?.let { p ->
                                        // Toggle subscription (unsub)
                                        PodcastSubscriptions.toggleSubscription(this@MainActivity, p.id)
                                    }

                                    // Show Undo Snackbar
                                    com.google.android.material.snackbar.Snackbar
                                        .make(findViewById(android.R.id.content), "Unsubscribed", com.google.android.material.snackbar.Snackbar.LENGTH_LONG)
                                        .setAction("Undo") {
                                            removedPodcast?.let { p ->
                                                PodcastSubscriptions.toggleSubscription(this@MainActivity, p.id)
                                                // Re-insert into adapter at the original position
                                                favoritesPodcastsRecycler.adapter?.let { (it as? PodcastAdapter)?.insertPodcastAt(pos, p) }
                                            }
                                        }
                                        .setAnchorView(findViewById(R.id.favorites_podcasts_container))
                                        .show()
                                }
                            }

                            override fun clearView(recyclerView: RecyclerView, viewHolder: RecyclerView.ViewHolder) {
                                super.clearView(recyclerView, viewHolder)
                                viewHolder.itemView.invalidate()
                                try { viewHolder.itemView.setTag(R.id.swipe_haptic_trigger, false) } catch (_: Exception) { }
                            }

                            override fun onChildDraw(c: android.graphics.Canvas, recyclerView: RecyclerView, viewHolder: RecyclerView.ViewHolder, dX: Float, dY: Float, actionState: Int, isCurrentlyActive: Boolean) {
                                if (kotlin.math.abs(dX) < 0.5f && !isCurrentlyActive) {
                                    super.onChildDraw(c, recyclerView, viewHolder, dX, dY, actionState, isCurrentlyActive)
                                    return
                                }

                                val itemView = viewHolder.itemView
                                val triggerThreshold = itemView.width * 0.25f
                                val hasTriggered = (itemView.getTag(R.id.swipe_haptic_trigger) as? Boolean) ?: false
                                if (!hasTriggered && kotlin.math.abs(dX) > triggerThreshold && isCurrentlyActive) {
                                    try {
                                        itemView.isHapticFeedbackEnabled = true
                                        val performed = itemView.performHapticFeedback(android.view.HapticFeedbackConstants.KEYBOARD_TAP)
                                        if (!performed) {
                                            try {
                                                val vib = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
                                                    itemView.context.getSystemService(android.os.VibratorManager::class.java)?.defaultVibrator
                                                } else if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
                                                    itemView.context.getSystemService(android.os.Vibrator::class.java)
                                                } else {
                                                    @Suppress("DEPRECATION")
                                                    itemView.context.getSystemService(android.content.Context.VIBRATOR_SERVICE) as? android.os.Vibrator
                                                }
                                                if (vib != null) {
                                                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                                                        vib.vibrate(android.os.VibrationEffect.createOneShot(20, android.os.VibrationEffect.DEFAULT_AMPLITUDE))
                                                    } else {
                                                        @Suppress("DEPRECATION")
                                                        vib.vibrate(20)
                                                    }
                                                }
                                            } catch (_: Exception) { }
                                        }
                                        itemView.setTag(R.id.swipe_haptic_trigger, true)
                                    } catch (_: Exception) { }
                                }

                                val paint = android.graphics.Paint()
                                val icon = ContextCompat.getDrawable(this@MainActivity, android.R.drawable.ic_menu_delete)
                                val backgroundColor = android.graphics.Color.parseColor("#f44336") // material red 500
                                paint.color = backgroundColor

                                if (dX > 0) {
                                    val rect = android.graphics.RectF(itemView.left.toFloat(), itemView.top.toFloat(), itemView.left + dX, itemView.bottom.toFloat())
                                    c.drawRect(rect, paint)
                                    icon?.let {
                                        val iconTop = itemView.top + (itemView.height - it.intrinsicHeight) / 2
                                        val iconMargin = (itemView.height - it.intrinsicHeight) / 2
                                        val iconLeft = itemView.left + iconMargin
                                        val iconRight = iconLeft + it.intrinsicWidth
                                        val iconBottom = iconTop + it.intrinsicHeight
                                        it.setBounds(iconLeft, iconTop, iconRight, iconBottom)
                                        it.draw(c)
                                    }
                                } else {
                                    val rect = android.graphics.RectF(itemView.right + dX, itemView.top.toFloat(), itemView.right.toFloat(), itemView.bottom.toFloat())
                                    c.drawRect(rect, paint)
                                    icon?.let {
                                        val iconTop = itemView.top + (itemView.height - it.intrinsicHeight) / 2
                                        val iconMargin = (itemView.height - it.intrinsicHeight) / 2
                                        val iconRight = itemView.right - iconMargin
                                        val iconLeft = iconRight - it.intrinsicWidth
                                        val iconBottom = iconTop + it.intrinsicHeight
                                        it.setBounds(iconLeft, iconTop, iconRight, iconBottom)
                                        it.draw(c)
                                    }
                                }

                                super.onChildDraw(c, recyclerView, viewHolder, dX, dY, actionState, isCurrentlyActive)
                            }
                        }
                        podcastsItemTouchHelper = ItemTouchHelper(swipeCallbackPodcasts).also { it.attachToRecyclerView(favoritesPodcastsRecycler) }
                    }

                    // Reveal recycler only if the Subscribed tab is actually selected right now
                    val subscribedTabActive = (currentMode == "favorites" && isButtonChecked(R.id.fav_tab_subscribed))
                    if (subscribedTabActive) {
                        favoritesPodcastsRecycler.visibility = View.VISIBLE
                        favoritesPodcastsContainer.visibility = View.VISIBLE
                    } else {
                        // keep hidden until the user explicitly selects the Subscribed tab
                        favoritesPodcastsRecycler.visibility = View.GONE
                    }
                }
            }.start()
        } else {
            // No subscriptions — ensure the container remains hidden
            favoritesPodcastsRecycler.adapter = null
            favoritesPodcastsContainer.visibility = View.GONE
        }

        // Load saved episodes and display underneath Subscribed Podcasts in the Favorites section
        refreshSavedEpisodesSection()
        refreshHistorySection()
    }

    // BroadcastReceiver to respond to played-status changes and update the "new episodes" indicators
    private val playedStatusReceiver = object : android.content.BroadcastReceiver() {
        override fun onReceive(context: android.content.Context?, intent: android.content.Intent?) {
            try {
                // Recompute which subscribed podcasts have newer episodes and update adapter
                val subscribedIds = PodcastSubscriptions.getSubscribedIds(this@MainActivity)
                if (subscribedIds.isEmpty()) return
                Thread {
                    val repo = PodcastRepository(this@MainActivity)
                    val all = try { kotlinx.coroutines.runBlocking { repo.fetchPodcasts(false) } } catch (e: Exception) { emptyList<Podcast>() }
                    val subs = all.filter { subscribedIds.contains(it.id) }
                    val updates = try { kotlinx.coroutines.runBlocking { repo.fetchLatestUpdates(subs, forceRefresh = true) } } catch (e: Exception) { emptyMap<String, Long>() }
                    val newSet = subs.filter { p ->
                        val latest = updates[p.id] ?: 0L
                        val lastPlayed = PlayedEpisodesPreference.getLastPlayedEpoch(this@MainActivity, p.id)
                        latest > lastPlayed
                    }.map { it.id }.toSet()
                    runOnUiThread {
                        val rv = try { findViewById<RecyclerView>(R.id.favorites_podcasts_recycler) } catch (_: Exception) { null }
                        val adapter = rv?.adapter
                        if (adapter is PodcastAdapter) {
                            adapter.updateNewEpisodes(newSet)
                        }
                    }
                }.start()
            } catch (_: Exception) {}
        }
    }

    // BroadcastReceiver to refresh History UI when the played-history store changes
    private val historyChangedReceiver = object : android.content.BroadcastReceiver() {
        override fun onReceive(context: android.content.Context?, intent: android.content.Intent?) {
            try {
                runOnUiThread { refreshHistorySection() }
            } catch (_: Exception) { }
        }
    }

    // BroadcastReceiver to refresh UI when an episode download completes
    private val downloadCompleteReceiver = object : android.content.BroadcastReceiver() {
        override fun onReceive(context: android.content.Context?, intent: android.content.Intent?) {
            try {
                val success = intent?.getBooleanExtra(EpisodeDownloadManager.EXTRA_SUCCESS, false) ?: false
                if (success) {
                    runOnUiThread {
                        // Refresh saved episodes section if visible
                        try { refreshSavedEpisodesSection() } catch (_: Exception) { }
                        // Refresh history section if visible
                        try { refreshHistorySection() } catch (_: Exception) { }
                        // Refresh podcasts section if visible
                        try {
                            val rv = findViewById<RecyclerView>(R.id.favorites_podcasts_recycler)
                            rv?.adapter?.notifyDataSetChanged()
                        } catch (_: Exception) { }
                    }
                } else {
                    val reason = intent?.getStringExtra(EpisodeDownloadManager.EXTRA_FAILURE_REASON)
                    if (!reason.isNullOrBlank()) {
                        runOnUiThread {
                            try {
                                android.widget.Toast.makeText(this@MainActivity, "Download failed: $reason", android.widget.Toast.LENGTH_LONG).show()
                            } catch (_: Exception) { }
                        }
                    }
                }
            } catch (_: Exception) { }
        }
    }

    /** Show or hide the loading spinner in the Subscribed Podcasts section. */
    private fun setSubscribedPodcastsLoading(loading: Boolean) {
        try {
            val visibility = if (loading) View.VISIBLE else View.GONE
            findViewById<android.widget.ProgressBar>(R.id.favorites_podcasts_loading).visibility = visibility
        } catch (_: Exception) { }
    }

    /**
     * Show the requested Favorites sub-tab. Extracted to class level so it can be called from
     * lifecycle methods (onResume) and other places outside the original local scope.
     */
    private fun showFavoritesTab(tab: String) {
        when (tab) {
            "stations" -> {
                supportActionBar?.title = "Favourite Stations"
                refreshFavoriteStationsEmptyState()
                findViewById<View>(R.id.favorites_podcasts_container).visibility = View.GONE
                try { findViewById<TextView>(R.id.favorites_podcasts_empty).visibility = View.GONE } catch (_: Exception) { }
                findViewById<View>(R.id.saved_episodes_container).visibility = View.GONE
                try { findViewById<TextView>(R.id.saved_episodes_empty).visibility = View.GONE } catch (_: Exception) { }
                findViewById<View>(R.id.saved_searches_container).visibility = View.GONE
                findViewById<View>(R.id.favorites_history_container).visibility = View.GONE
                try { findViewById<TextView>(R.id.favorites_history_empty).visibility = View.GONE } catch (_: Exception) { }
                try { findViewById<RecyclerView>(R.id.favorites_history_recycler).visibility = View.GONE } catch (_: Exception) { }
            }
            "subscribed" -> {
                supportActionBar?.title = "Subscribed Podcasts"
                stationsList.visibility = View.GONE
                try { findViewById<TextView>(R.id.favorite_stations_empty).visibility = View.GONE } catch (_: Exception) { }
                findViewById<View>(R.id.favorites_podcasts_container).visibility = View.VISIBLE
                findViewById<View>(R.id.saved_episodes_container).visibility = View.GONE
                try { findViewById<TextView>(R.id.saved_episodes_empty).visibility = View.GONE } catch (_: Exception) { }
                findViewById<View>(R.id.saved_searches_container).visibility = View.GONE
                findViewById<View>(R.id.favorites_history_container).visibility = View.GONE
                try { findViewById<TextView>(R.id.favorites_history_empty).visibility = View.GONE } catch (_: Exception) { }
                try { findViewById<RecyclerView>(R.id.saved_episodes_recycler).visibility = View.GONE } catch (_: Exception) { }

                // Show loading indicator while fetching subscribed podcasts
                val existingAdapter = try { findViewById<RecyclerView>(R.id.favorites_podcasts_recycler).adapter as? PodcastAdapter } catch (_: Exception) { null }
                if (existingAdapter == null || existingAdapter.itemCount == 0) {
                    setSubscribedPodcastsLoading(true)
                }

                // Refresh subscribed podcasts list asynchronously
                Thread {
                    try {
                        val ids = PodcastSubscriptions.getSubscribedIds(this@MainActivity)
                        if (ids.isEmpty()) {
                            runOnUiThread {
                                val rv = findViewById<RecyclerView>(R.id.favorites_podcasts_recycler)
                                val empty = findViewById<TextView>(R.id.favorites_podcasts_empty)
                                setSubscribedPodcastsLoading(false)
                                rv.adapter = null
                                rv.visibility = View.GONE
                                empty.visibility = View.VISIBLE
                                findViewById<View>(R.id.favorites_podcasts_container).visibility = View.VISIBLE
                            }
                            return@Thread
                        }

                        val repo = PodcastRepository(this@MainActivity)
                        val all = try { kotlinx.coroutines.runBlocking { repo.fetchPodcasts(false) } } catch (e: Exception) { emptyList<Podcast>() }
                        val podcasts = all.filter { ids.contains(it.id) }
                        val updates = try { kotlinx.coroutines.runBlocking { repo.fetchLatestUpdates(podcasts) } } catch (e: Exception) { emptyMap<String, Long>() }
                        val sorted = podcasts.sortedByDescending { updates[it.id] ?: Long.MAX_VALUE }
                        val newSet = sorted.filter { p ->
                            val latest = updates[p.id] ?: 0L
                            val lastPlayed = PlayedEpisodesPreference.getLastPlayedEpoch(this@MainActivity, p.id)
                            latest > lastPlayed
                        }.map { it.id }.toSet()
                        runOnUiThread {
                            setSubscribedPodcastsLoading(false)
                            val rv = try { findViewById<RecyclerView>(R.id.favorites_podcasts_recycler) } catch (_: Exception) { null }
                            rv?.layoutManager = LinearLayoutManager(this@MainActivity)
                            val podcastAdapter = PodcastAdapter(this@MainActivity, onPodcastClick = { podcast ->
                                supportActionBar?.show()
                                fragmentContainer.visibility = View.VISIBLE
                                staticContentContainer.visibility = View.GONE
                                // Ensure the main navigation reflects the Podcasts context
                                currentMode = "podcasts"
                                // Mark origin so back returns to Favorites
                                returnToFavoritesOnBack = true
                                // Disable swipe navigation when leaving All Stations
                                disableSwipeNavigation()
                                // Programmatic selection should not trigger the bottom-nav listener
                                suppressBottomNavSelection = true
                                try { bottomNavigation.selectedItemId = R.id.navigation_podcasts } catch (_: Exception) { }
                                suppressBottomNavSelection = false
                                updateActionBarTitle()
                                // Hide the favourites toggle when showing a fragment/detail view
                                updateFavoritesToggleVisibility()
                                val detailFragment = PodcastDetailFragment().apply { arguments = android.os.Bundle().apply { putParcelable("podcast", podcast) } }
                                supportFragmentManager.beginTransaction().apply {
                                    replace(R.id.fragment_container, detailFragment)
                                    addToBackStack(null)
                                    commit()
                                }
                            }, highlightSubscribed = true, showSubscribedIcon = false)
                            rv?.adapter = podcastAdapter
                            podcastAdapter.updatePodcasts(sorted)
                            podcastAdapter.updateNewEpisodes(newSet)
                            findViewById<TextView>(R.id.favorites_podcasts_empty).visibility = View.GONE
                            rv?.visibility = View.VISIBLE
                        }
                    } catch (_: Exception) {
                        runOnUiThread { setSubscribedPodcastsLoading(false) }
                    }
                }.start()
            }
            "saved" -> {
                supportActionBar?.title = "Saved Episodes"
                stationsList.visibility = View.GONE
                try { findViewById<TextView>(R.id.favorite_stations_empty).visibility = View.GONE } catch (_: Exception) { }
                findViewById<View>(R.id.favorites_podcasts_container).visibility = View.GONE
                try { findViewById<TextView>(R.id.favorites_podcasts_empty).visibility = View.GONE } catch (_: Exception) { }
                findViewById<View>(R.id.saved_episodes_container).visibility = View.VISIBLE
                try { findViewById<RecyclerView>(R.id.saved_episodes_recycler).visibility = View.VISIBLE } catch (_: Exception) { }
                findViewById<View>(R.id.saved_searches_container).visibility = View.GONE
                findViewById<View>(R.id.favorites_history_container).visibility = View.GONE
                try { findViewById<TextView>(R.id.favorites_history_empty).visibility = View.GONE } catch (_: Exception) { }
                try { findViewById<RecyclerView>(R.id.favorites_history_recycler).visibility = View.GONE } catch (_: Exception) { }
                try { refreshSavedEpisodesSection() } catch (_: Exception) { }
            }
            "searches" -> {
                supportActionBar?.title = "Saved Searches"
                stationsList.visibility = View.GONE
                try { findViewById<TextView>(R.id.favorite_stations_empty).visibility = View.GONE } catch (_: Exception) { }
                findViewById<View>(R.id.favorites_podcasts_container).visibility = View.GONE
                try { findViewById<TextView>(R.id.favorites_podcasts_empty).visibility = View.GONE } catch (_: Exception) { }
                findViewById<View>(R.id.saved_episodes_container).visibility = View.GONE
                try { findViewById<TextView>(R.id.saved_episodes_empty).visibility = View.GONE } catch (_: Exception) { }
                findViewById<View>(R.id.saved_searches_container).visibility = View.VISIBLE
                try { findViewById<TextView>(R.id.saved_searches_title).visibility = View.GONE } catch (_: Exception) { }
                findViewById<View>(R.id.favorites_history_container).visibility = View.GONE
                try { findViewById<TextView>(R.id.favorites_history_empty).visibility = View.GONE } catch (_: Exception) { }
                try { findViewById<RecyclerView>(R.id.saved_episodes_recycler).visibility = View.GONE } catch (_: Exception) { }
                try { findViewById<RecyclerView>(R.id.favorites_history_recycler).visibility = View.GONE } catch (_: Exception) { }
                try { refreshSavedSearchesSection() } catch (_: Exception) { }
            }
            "history" -> {
                supportActionBar?.title = "History"
                stationsList.visibility = View.GONE
                try { findViewById<TextView>(R.id.favorite_stations_empty).visibility = View.GONE } catch (_: Exception) { }
                findViewById<View>(R.id.favorites_podcasts_container).visibility = View.GONE
                try { findViewById<TextView>(R.id.favorites_podcasts_empty).visibility = View.GONE } catch (_: Exception) { }
                findViewById<View>(R.id.saved_episodes_container).visibility = View.GONE
                try { findViewById<TextView>(R.id.saved_episodes_empty).visibility = View.GONE } catch (_: Exception) { }
                findViewById<View>(R.id.saved_searches_container).visibility = View.GONE
                findViewById<View>(R.id.favorites_history_container).visibility = View.VISIBLE
                try { findViewById<RecyclerView>(R.id.favorites_history_recycler).visibility = View.VISIBLE } catch (_: Exception) { }
                // Always refresh the history contents when the tab becomes active
                try { refreshHistorySection(); findViewById<RecyclerView>(R.id.favorites_history_recycler).scrollToPosition(0) } catch (_: Exception) { }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        try {
            registerReceiver(playedStatusReceiver, android.content.IntentFilter(PlayedEpisodesPreference.ACTION_PLAYED_STATUS_CHANGED))
        } catch (_: Exception) {}
        try {
            registerReceiver(historyChangedReceiver, android.content.IntentFilter(PlayedHistoryPreference.ACTION_HISTORY_CHANGED))
        } catch (_: Exception) {}
        try {
            registerReceiver(downloadCompleteReceiver, android.content.IntentFilter(EpisodeDownloadManager.ACTION_DOWNLOAD_COMPLETE))
        } catch (_: Exception) {}
    }



    override fun onStop() {
        super.onStop()
        try {
            unregisterReceiver(playedStatusReceiver)
        } catch (_: Exception) {}
        try {
            unregisterReceiver(historyChangedReceiver)
        } catch (_: Exception) {}
        try {
            unregisterReceiver(downloadCompleteReceiver)
        } catch (_: Exception) {}
    }

    private fun showSettings() {
        // Ensure history UI is hidden when navigating away from Favorites
        hideHistoryViews()
        // Disable swipe navigation in Settings
        disableSwipeNavigation()
        currentMode = "settings"
        fragmentContainer.visibility = View.GONE
        staticContentContainer.visibility = View.VISIBLE
        stationsView.visibility = View.GONE
        stationsList.visibility = View.GONE
        filterButtonsContainer?.visibility = View.GONE
        settingsContainer.visibility = View.VISIBLE
        // Ensure action bar reflects the section and clear any podcast-specific up affordance
        supportActionBar?.apply {
            show()
            title = "Settings"
            setDisplayHomeAsUpEnabled(false)
            setDisplayShowHomeEnabled(false)
        }
        // Refresh the settings UI so controls reflect current preferences
        setupSettings()
        // Hide favourites toggle group in settings
        try { updateFavoritesToggleVisibility() } catch (_: Exception) { }
    }

    private fun showPodcasts() {
        // Ensure history UI is hidden when navigating away from Favorites
        hideHistoryViews()
        // Disable swipe navigation in Podcasts
        disableSwipeNavigation()
        currentMode = "podcasts"
        returnToFavoritesOnBack = false
        fragmentContainer.visibility = View.VISIBLE
        staticContentContainer.visibility = View.GONE
        // Hide the global action bar since the fragment has its own title bar
        supportActionBar?.hide()
        // Hide favourites toggle group when viewing podcasts
        try { updateFavoritesToggleVisibility() } catch (_: Exception) { }

        val fm = supportFragmentManager

        // If we're already showing the Podcasts list with no detail on top, do nothing (avoid flicker)
        val existingVisible = fm.findFragmentById(R.id.fragment_container)
        if (existingVisible is PodcastsFragment && fm.backStackEntryCount == 0) {
            return
        }

        // If a detail fragment is on the back stack, pop it to reveal the existing list
        if (fm.backStackEntryCount > 0) {
            try { fm.popBackStack() } catch (_: Exception) { }
        }

        // Ensure a PodcastsFragment exists in the container
        val existing = fm.findFragmentByTag("podcasts_fragment") as? PodcastsFragment
        if (existing == null) {
            val podcastsFragment = PodcastsFragment()
            fm.beginTransaction().apply {
                replace(R.id.fragment_container, podcastsFragment, "podcasts_fragment")
                commit()
            }
        } else if (!existing.isAdded) {
            fm.beginTransaction().apply {
                replace(R.id.fragment_container, existing, "podcasts_fragment")
                commit()
            }
        }
    }

    private fun handleOpenPodcastIntent(intent: Intent?) {
        val podcastId = intent?.getStringExtra("open_podcast_id") ?: return
        // Ensure podcasts UI is shown
        showPodcasts()
        // Fetch podcasts and open the matching podcast detail when available
        val repo = PodcastRepository(this)
        Thread {
            val all = try { kotlinx.coroutines.runBlocking { repo.fetchPodcasts(false) } } catch (e: Exception) { emptyList<Podcast>() }
            val match = all.find { it.id == podcastId }
            if (match != null) {
                runOnUiThread {
                    // Show app bar so podcast title and back button are visible
                    supportActionBar?.show()

                    fragmentContainer.visibility = View.VISIBLE
                    staticContentContainer.visibility = View.GONE
                    // Ensure the main navigation reflects the Podcasts context
                    currentMode = "podcasts"
                    // Disable swipe navigation when leaving All Stations
                    disableSwipeNavigation()
                    // Programmatic selection should not trigger the bottom-nav listener
                    suppressBottomNavSelection = true
                    try { bottomNavigation.selectedItemId = R.id.navigation_podcasts } catch (_: Exception) { }
                    suppressBottomNavSelection = false
                    updateActionBarTitle()
                    // Hide the favourites toggle when showing a fragment/detail view
                    updateFavoritesToggleVisibility()
                    val detailFragment = PodcastDetailFragment().apply {
                        arguments = android.os.Bundle().apply { putParcelable("podcast", match) }
                    }
                    supportFragmentManager.beginTransaction().apply {
                        replace(R.id.fragment_container, detailFragment)
                        addToBackStack(null)
                        commit()
                    }
                }
            } else {
                runOnUiThread {
                    android.widget.Toast.makeText(this, "Podcast not found", android.widget.Toast.LENGTH_SHORT).show()
                }
            }
        }.start()
    }

    private fun updateActionBarTitle() {
        val title = when (currentMode) {
            "favorites" -> "Favourites"
            "settings" -> "Settings"
            "podcasts" -> "Podcasts"
            else -> "All Stations"
        }
        supportActionBar?.title = title
    }

    // Update visuals for the favorites button group (tablet shows labels; phone icon-only)
    private fun isButtonChecked(buttonId: Int): Boolean {
        return try {
            val prefs = getPreferences(android.content.Context.MODE_PRIVATE)
            val currentChecked = prefs.getInt("last_fav_tab_id", R.id.fav_tab_stations)
            currentChecked == buttonId
        } catch (_: Exception) {
            false
        }
    }

    private fun dpToPx(value: Float): Float {
        return value * resources.displayMetrics.density
    }

    private fun applyConnectedButtonShape(
        btn: com.google.android.material.button.MaterialButton,
        selected: Boolean,
        smallCornerPx: Float,
        selectedCornerPx: Float
    ) {
        try {
            val shapeBuilder = com.google.android.material.shape.ShapeAppearanceModel.builder()
            val smallCorner = com.google.android.material.shape.AbsoluteCornerSize(smallCornerPx)
            val selectedCorner = com.google.android.material.shape.AbsoluteCornerSize(selectedCornerPx)

            if (selected) {
                shapeBuilder.setAllCornerSizes(selectedCorner)
            } else {
                // All unselected buttons have equal rounding on inner and outer corners
                shapeBuilder.setAllCornerSizes(smallCorner)
            }

            btn.shapeAppearanceModel = shapeBuilder.build()
        } catch (_: Exception) { }
    }

    private fun animateCornerMorph(
        btn: com.google.android.material.button.MaterialButton,
        selected: Boolean,
        smallCornerPx: Float,
        selectedCornerPx: Float
    ) {
        val targetUniformCorner = if (selected) selectedCornerPx else smallCornerPx
        val tagKey = R.id.connected_button_corner_px
        val startCorner = (btn.getTag(tagKey) as? Float) ?: smallCornerPx

        if (startCorner == targetUniformCorner) {
            applyConnectedButtonShape(btn, selected, smallCornerPx, selectedCornerPx)
            return
        }

        btn.setTag(tagKey, targetUniformCorner)

        val animator = android.animation.ValueAnimator.ofFloat(startCorner, targetUniformCorner)
        animator.duration = 260
        animator.interpolator = androidx.interpolator.view.animation.FastOutSlowInInterpolator()
        animator.addUpdateListener { valueAnimator ->
            val animatedCorner = valueAnimator.animatedValue as Float
            try {
                val shapeBuilder = com.google.android.material.shape.ShapeAppearanceModel.builder()
                val animatedCornerSize = com.google.android.material.shape.AbsoluteCornerSize(animatedCorner)
                shapeBuilder.setAllCornerSizes(animatedCornerSize)
                btn.shapeAppearanceModel = shapeBuilder.build()
            } catch (_: Exception) { }
        }
        animator.addListener(object : android.animation.Animator.AnimatorListener {
            override fun onAnimationStart(animation: android.animation.Animator) {}
            override fun onAnimationEnd(animation: android.animation.Animator) {
                applyConnectedButtonShape(btn, selected, smallCornerPx, selectedCornerPx)
            }
            override fun onAnimationCancel(animation: android.animation.Animator) {
                applyConnectedButtonShape(btn, selected, smallCornerPx, selectedCornerPx)
            }
            override fun onAnimationRepeat(animation: android.animation.Animator) {}
        })
        animator.start()
    }

    private fun animateButtonColors(
        btn: com.google.android.material.button.MaterialButton,
        targetBackground: Int,
        targetIcon: Int,
        targetText: Int
    ) {
        val currentBg = btn.backgroundTintList?.defaultColor ?: targetBackground
        val currentIcon = btn.iconTint?.defaultColor ?: targetIcon
        val currentText = btn.currentTextColor

        if (currentBg == targetBackground && currentIcon == targetIcon && currentText == targetText) {
            return
        }

        val bgAnimator = android.animation.ValueAnimator.ofArgb(currentBg, targetBackground).apply {
            duration = 240
            interpolator = androidx.interpolator.view.animation.FastOutSlowInInterpolator()
            addUpdateListener { animator ->
                val color = animator.animatedValue as Int
                btn.backgroundTintList = android.content.res.ColorStateList.valueOf(color)
            }
        }

        val iconAnimator = android.animation.ValueAnimator.ofArgb(currentIcon, targetIcon).apply {
            duration = 240
            interpolator = androidx.interpolator.view.animation.FastOutSlowInInterpolator()
            addUpdateListener { animator ->
                val color = animator.animatedValue as Int
                btn.iconTint = android.content.res.ColorStateList.valueOf(color)
            }
        }

        val textAnimator = android.animation.ValueAnimator.ofArgb(currentText, targetText).apply {
            duration = 240
            interpolator = androidx.interpolator.view.animation.FastOutSlowInInterpolator()
            addUpdateListener { animator ->
                val color = animator.animatedValue as Int
                btn.setTextColor(color)
            }
        }

        bgAnimator.start()
        iconAnimator.start()
        textAnimator.start()
    }

    private fun updateFavoritesToggleVisuals(selectedId: Int) {
        val ids = listOf(R.id.fav_tab_stations, R.id.fav_tab_subscribed, R.id.fav_tab_saved, R.id.fav_tab_searches, R.id.fav_tab_history)
        val labels = mapOf(
            R.id.fav_tab_stations to "Stations",
            R.id.fav_tab_subscribed to "Subscribed",
            R.id.fav_tab_saved to "Saved",
            R.id.fav_tab_searches to "Searches",
            R.id.fav_tab_history to "History"
        )
        val isTablet = try { resources.getBoolean(R.bool.is_tablet) } catch (_: Exception) { false }

        // Colors from theme for selected/unselected states
        fun getThemeColorByName(attrName: String): Int {
            return try {
                val resId = resources.getIdentifier(attrName, "attr", packageName)
                if (resId == 0) return android.graphics.Color.BLACK
                val tv = android.util.TypedValue()
                theme.resolveAttribute(resId, tv, true)
                tv.data
            } catch (_: Exception) { android.graphics.Color.BLACK }
        }

        val colorPrimaryContainer = try { getThemeColorByName("colorPrimaryContainer") } catch (_: Exception) { getThemeColorByName("colorPrimary") }
        val colorOnPrimaryContainer = try { getThemeColorByName("colorOnPrimaryContainer") } catch (_: Exception) { getThemeColorByName("colorOnPrimary") }
        // Use Surface Container High for unselected background to match M3 Expressive (light purple/gray tone)
        val colorSurfaceUnselected = try { getThemeColorByName("colorSurfaceContainerHigh") } catch (_: Exception) {
            try { getThemeColorByName("colorSurfaceVariant") } catch (_: Exception) { getThemeColorByName("colorSurface") }
        }
        val colorOnSurface = try { getThemeColorByName("colorOnSurface") } catch (_: Exception) { android.graphics.Color.BLACK }

        for ((_, id) in ids.withIndex()) {
            try {
                val btn = findViewById<com.google.android.material.button.MaterialButton>(id)
                val lp = btn.layoutParams as? android.widget.LinearLayout.LayoutParams

                val selected = (id == selectedId)

                // Apply base layout changes (tablet: expanded selected with label; phone: icon-only but centered)
                if (!isTablet) {
                    // Icon-only on phones: center the icon horizontally/vertically and ensure equal weight
                    btn.text = ""
                    lp?.width = 0
                    lp?.weight = 1f
                    try {
                        // Remove extra icon padding so the drawable sits exactly centered when there's no text
                        btn.iconPadding = 0
                        // Remove asymmetric content padding coming from the style so icon can be centered
                        btn.setPaddingRelative(0, btn.paddingTop, 0, btn.paddingBottom)
                        // Allow the button to shrink below the default min width so equal-weight centering works
                        btn.minWidth = 0
                        // Center content inside the button (icon will be centered when text is empty)
                        btn.gravity = android.view.Gravity.CENTER
                        // Use text-relative gravity so the icon aligns as if text were present (helps centering)
                        btn.iconGravity = com.google.android.material.button.MaterialButton.ICON_GRAVITY_TEXT_START
                    } catch (_: Exception) { }
                } else {
                    if (selected) {
                        btn.text = labels[id]
                        lp?.width = 0
                        lp?.weight = 1f
                        try { btn.iconGravity = com.google.android.material.button.MaterialButton.ICON_GRAVITY_TEXT_START } catch (_: Exception) { }
                    } else {
                        btn.text = ""
                        lp?.width = android.view.ViewGroup.LayoutParams.WRAP_CONTENT
                        lp?.weight = 0f
                        try { btn.iconGravity = com.google.android.material.button.MaterialButton.ICON_GRAVITY_START } catch (_: Exception) { }
                    }
                }

                // Apply Material 3 Connected Button Group colors with smooth transitions
                try {
                    if (selected) {
                        animateButtonColors(btn, colorPrimaryContainer, colorOnPrimaryContainer, colorOnPrimaryContainer)
                    } else {
                        animateButtonColors(btn, colorSurfaceUnselected, colorOnSurface, colorOnSurface)
                    }
                } catch (_: Exception) { }

                // M3 Connected Button Group: Shape morphing based on selection
                // Selected: full stadium shape (pill)
                // Unselected: flat inner sides, slightly rounded outer edges
                val smallCornerPx = dpToPx(8f)
                val selectedCornerPx = dpToPx(1000f)
                animateCornerMorph(btn, selected, smallCornerPx, selectedCornerPx)

                btn.contentDescription = labels[id]
                btn.layoutParams = lp
            } catch (_: Exception) { }
        }
    }

    private var filterButtonsSetupTried = false

    private fun setupFilterButtons() {
        // Robustly find a TabLayout: try id lookup first, then search inside the stations view
        fun findTabLayoutRecursive(v: View): com.google.android.material.tabs.TabLayout? {
            if (v is com.google.android.material.tabs.TabLayout) return v
            if (v is android.view.ViewGroup) {
                for (i in 0 until v.childCount) {
                    val child = v.getChildAt(i)
                    val found = findTabLayoutRecursive(child)
                    if (found != null) return found
                }
            }
            return null
        }

        var tabs = findViewById<com.google.android.material.tabs.TabLayout?>(R.id.filter_tabs)
        if (tabs == null) {
            tabs = findTabLayoutRecursive(stationsView)
        }
        if (tabs == null) {
            tabs = findTabLayoutRecursive(staticContentContainer)
        }
        // If the include wrapper exists but the TabLayout id wasn't found, search inside it
        val fbContainer = filterButtonsContainer
        if (tabs == null && fbContainer is android.view.ViewGroup) {
            tabs = findTabLayoutRecursive(fbContainer)
        }

        if (tabs == null) {
            if (!filterButtonsSetupTried) {
                // Perhaps layout isn't laid out yet — try again after a layout pass
                filterButtonsSetupTried = true
                android.util.Log.d("MainActivity", "TabLayout not found yet; will retry after layout")
                stationsView.post {
                    setupFilterButtons()
                }
                return
            }

            android.util.Log.w("MainActivity", "TabLayout not found after retry; filter buttons disabled, but swipe navigation will still be enabled")
            // Ensure swipe navigation is enabled even if the tabs are missing
            setupSwipeNavigation()
            return
        }

        tabLayout = tabs

        tabLayout.addOnTabSelectedListener(object : com.google.android.material.tabs.TabLayout.OnTabSelectedListener {
            override fun onTabSelected(tab: com.google.android.material.tabs.TabLayout.Tab) {
                val newIndex = tab.position
                val direction = if (newIndex > currentTabIndex) 1 else -1
                android.util.Log.d("MainActivity", "Tab selected: $newIndex (current=$currentTabIndex), direction=$direction")
                currentTabIndex = newIndex

                val category = when (newIndex) {
                    0 -> StationCategory.NATIONAL
                    1 -> StationCategory.REGIONS
                    2 -> StationCategory.LOCAL
                    else -> StationCategory.NATIONAL
                }

                // If the stations content isn't laid out (width == 0), fall back to immediate update
                val wasSwipeSelection = selectionFromSwipe
                if (wasSwipeSelection) selectionFromSwipe = false
                val slowTransition = !wasSwipeSelection

                if (stationsContent.width <= 0) {
                    android.util.Log.d("MainActivity", "stationsContent not laid out yet; updating immediately")
                    showCategoryStations(category)
                } else {
                    animateListTransition(direction, {
                        showCategoryStations(category)
                    }, slowTransition)
                }
            }

            override fun onTabUnselected(tab: com.google.android.material.tabs.TabLayout.Tab) {}
            override fun onTabReselected(tab: com.google.android.material.tabs.TabLayout.Tab) {}
        })

        // Set National as default selected and sync index
        tabLayout.getTabAt(0)?.select()
        currentTabIndex = 0
        showCategoryStations(StationCategory.NATIONAL)

        // Enable swipe navigation on the stations list
        setupSwipeNavigation()
    }

    private fun animateListTransition(direction: Int, onFadeOutComplete: () -> Unit, slow: Boolean = false) {
        val screenWidth = stationsContent.width.toFloat().takeIf { it > 0f } ?: stationsList.width.toFloat()
        val exitTranslation = if (direction > 0) -screenWidth else screenWidth
        // Make incoming content start very close (15% off-screen) so it appears almost immediately
        val enterTranslation = if (direction > 0) screenWidth * 0.15f else -screenWidth * 0.15f
        val exitDuration = if (slow) 200L else 100L
        val enterDuration = if (slow) 200L else 100L
        // If we don't have a valid size, fall back to the simple animation
        if (stationsContent.width <= 0 || stationsContent.height <= 0) {
            stationsContent.setLayerType(View.LAYER_TYPE_HARDWARE, null)
            stationsList.isNestedScrollingEnabled = false
            // Hide actual RecyclerView and disable its animator to avoid a content flash
            stationsList.visibility = View.INVISIBLE
            try {
                savedItemAnimator = stationsList.itemAnimator
                stationsList.itemAnimator = null
            } catch (_: Exception) {}

            stationsContent.animate().translationX(exitTranslation).alpha(0f).setDuration(200).withEndAction {
                try {
                    onFadeOutComplete()
                } catch (_: Exception) {}
                stationsContent.translationX = enterTranslation
                stationsContent.alpha = 0f
                stationsContent.animate().translationX(0f).alpha(1f).setDuration(200).withEndAction {
                    stationsContent.setLayerType(View.LAYER_TYPE_NONE, null)
                    stationsList.isNestedScrollingEnabled = true
                    // Reveal RecyclerView and restore animator
                    stationsList.visibility = View.VISIBLE
                    try {
                        stationsList.itemAnimator = savedItemAnimator
                        savedItemAnimator = null
                    } catch (_: Exception) {}
                }.start()
            }.start()
            return
        }

        // Create a snapshot overlay (or fallback view) of the outgoing content so we can swap the RecyclerView's adapter
        val parent = staticContentContainer as? android.view.ViewGroup
        val bitmap = try {
            Bitmap.createBitmap(stationsContent.width, stationsContent.height, Bitmap.Config.ARGB_8888).also { b ->
                val c = android.graphics.Canvas(b)
                stationsContent.draw(c)
            }
        } catch (_: Exception) {
            null
        }

        // Prepare overlay view (image if possible, otherwise a solid surface copy)
        val overlayView = if (bitmap != null) {
            ImageView(this).apply {
                setImageBitmap(bitmap)
                translationX = stationsContent.x
                translationY = stationsContent.y
                alpha = 1f
                setLayerType(View.LAYER_TYPE_HARDWARE, null)
                layoutParams = android.view.ViewGroup.LayoutParams(stationsContent.width, stationsContent.height)
            }
        } else {
            View(this).apply {
                background = stationsContent.background ?: android.graphics.drawable.ColorDrawable(android.graphics.Color.WHITE)
                translationX = stationsContent.x
                translationY = stationsContent.y
                alpha = 1f
                setLayerType(View.LAYER_TYPE_HARDWARE, null)
                layoutParams = android.view.ViewGroup.LayoutParams(stationsContent.width, stationsContent.height)
            }
        }

        // Add overlay above the content so we can animate it away while preparing the new list
        try {
            val insertIndex = parent?.indexOfChild(stationsContent)?.plus(1) ?: -1
            if (insertIndex >= 0) parent?.addView(overlayView, insertIndex) else parent?.addView(overlayView)
        } catch (_: Exception) {}

        // Use hardware layer and disable nested scrolling during the animation to avoid blurring/jitter
        stationsContent.setLayerType(View.LAYER_TYPE_HARDWARE, null)
        stationsList.isNestedScrollingEnabled = false

        // Hide the actual RecyclerView content while overlay animates out
        stationsList.visibility = View.INVISIBLE

        // Disable item animator while swapping content
        try {
            savedItemAnimator = stationsList.itemAnimator
            stationsList.itemAnimator = null
        } catch (_: Exception) {}

        // Animate the overlay out and overlap the incoming content animation for a snappier feel
        // Start the incoming animation immediately so the new list is visible sooner

        // Start overlay exit animation immediately but keep it mostly transparent so incoming content shows through
        overlayView.alpha = 1f
        overlayView.animate()
            .translationX(exitTranslation)
            .setDuration(exitDuration)
            .start()

        // Immediately swap content so the incoming list can begin animating while the old one exits
        try {
            onFadeOutComplete()
        } catch (_: Exception) {}

        // Ensure the RecyclerView content is present underneath the overlay and prepare incoming animation
        stationsList.visibility = View.VISIBLE
        stationsContent.translationX = enterTranslation
        stationsContent.alpha = 0f

        // Start incoming animation without delay so it overlaps the overlay's exit
        stationsList.post {
            stationsContent.animate()
                .translationX(0f)
                .alpha(1f)
                .setDuration(enterDuration)
                .withEndAction {
                    // Restore normal rendering after animation completes
                    stationsContent.setLayerType(View.LAYER_TYPE_NONE, null)
                    stationsList.isNestedScrollingEnabled = true
                    // Remove overlay and recycle bitmap
                    try {
                        parent?.removeView(overlayView)
                    } catch (_: Exception) {}
                    (overlayView as? ImageView)?.drawable?.let { d ->
                        (d as? android.graphics.drawable.BitmapDrawable)?.bitmap?.recycle()
                    }
                    // Restore animator
                    try {
                        stationsList.itemAnimator = savedItemAnimator
                        savedItemAnimator = null
                    } catch (_: Exception) {}
                }
                .start()
        }
    }
    
    private fun showCategoryStations(category: StationCategory) {
        android.util.Log.d("MainActivity", "showCategoryStations: $category")
        val stations = StationRepository.getStationsByCategory(category)
        categorizedAdapter = CategorizedStationAdapter(this, stations, { stationId ->
            playStation(stationId)
        }, { _ ->
            // Do nothing to prevent list jump
        })
        stationsList.adapter = categorizedAdapter
        stationsList.scrollToPosition(0)
    }

    private fun setupSwipeNavigation() {
        // Remove any existing listener first (allows safe re-entry). Then only attach the swipe handler
        // when the All Stations view is active — disable for Favorites/Podcasts/Settings.
        try {
            stationsSwipeListener?.let { stationsList.removeOnItemTouchListener(it) }
        } catch (_: Exception) { }
        stationsSwipeListener = null

        if (currentMode != "list") {
            // Ensure UI state is reset when not in 'All Stations'
            try {
                stationsContent.translationX = 0f
                stationsList.isNestedScrollingEnabled = true
                stationsList.itemAnimator = savedItemAnimator
                savedItemAnimator = null
            } catch (_: Exception) { }
            return
        }

        // Use touch slop and velocity to start a drag and make the list follow the finger
        val touchSlop = android.view.ViewConfiguration.get(this).scaledTouchSlop
        val minFlingVelocity = android.view.ViewConfiguration.get(this).scaledMinimumFlingVelocity

        val listener = object : RecyclerView.OnItemTouchListener {
            private var downX = 0f
            private var downY = 0f
            private var activePointerId = MotionEvent.INVALID_POINTER_ID
            private var dragging = false
            private var velocityTracker: android.view.VelocityTracker? = null
            private var lastTranslation = 0f

            override fun onInterceptTouchEvent(rv: RecyclerView, e: MotionEvent): Boolean {
                when (e.actionMasked) {
                    MotionEvent.ACTION_DOWN -> {
                        // Start tracking this pointer explicitly
                        activePointerId = e.getPointerId(0)
                        downX = e.getX(0)
                        downY = e.getY(0)
                        dragging = false
                        lastTranslation = 0f
                        velocityTracker?.recycle()
                        velocityTracker = android.view.VelocityTracker.obtain()
                        velocityTracker?.addMovement(e)
                    }
                    MotionEvent.ACTION_MOVE -> {
                        val idx = try { e.findPointerIndex(activePointerId) } catch (_: Exception) { 0 }
                        val px = if (idx >= 0) e.getX(idx) else e.x
                        val py = if (idx >= 0) e.getY(idx) else e.y
                        val dx = px - downX
                        val dy = py - downY
                        val maxIndex = if (::tabLayout.isInitialized) tabLayout.tabCount - 1 else 2

                        if (!dragging) {
                            val horizontalEnough = Math.abs(dx) > Math.abs(dy) * 1.5f && Math.abs(dx) > touchSlop
                            if (horizontalEnough) {
                                // Do not start a horizontal drag if it would move past the first or last tab
                                if ((dx > 0 && currentTabIndex == 0) || (dx < 0 && currentTabIndex == maxIndex)) {
                                    return false
                                }

                                // Start dragging: take over touch events and prepare for smooth animation
                                dragging = true
                                lastTranslation = stationsContent.translationX
                                // Disable RecyclerView item animations to avoid layout jitter during drag
                                try {
                                    savedItemAnimator = stationsList.itemAnimator
                                    stationsList.itemAnimator = null
                                } catch (_: Exception) {}
                                rv.stopScroll() // stop any ongoing fling to avoid jitter
                                rv.parent?.requestDisallowInterceptTouchEvent(true)
                                rv.isNestedScrollingEnabled = false
                                stationsContent.animate().cancel()
                                stationsContent.setLayerType(View.LAYER_TYPE_HARDWARE, null)
                                return true
                            }
                        } else {
                            // already dragging; intercept
                            return true
                        }
                    }
                    MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                        // Clean up even if we never started dragging
                        velocityTracker?.recycle()
                        velocityTracker = null
                        dragging = false
                        rv.parent?.requestDisallowInterceptTouchEvent(false)
                        rv.isNestedScrollingEnabled = true
                        stationsContent.setLayerType(View.LAYER_TYPE_NONE, null)
                        activePointerId = MotionEvent.INVALID_POINTER_ID
                    }
                }
                return false
            }

            override fun onTouchEvent(rv: RecyclerView, e: MotionEvent) {
                velocityTracker?.addMovement(e)
                when (e.actionMasked) {
                    MotionEvent.ACTION_MOVE -> {
                        if (!dragging) return
                        val idx = try { e.findPointerIndex(activePointerId) } catch (_: Exception) { 0 }
                        val px = if (idx >= 0) e.getX(idx) else e.x
                        val dx = px - downX
                        val maxTrans = stationsContent.width.toFloat().takeIf { it > 0f } ?: rv.width.toFloat()
                        // Use float translation for smooth tracking; avoid aggressive rounding which can cause jitter
                        val trans = (dx).coerceIn(-maxTrans, maxTrans)
                        // Apply slight exponential smoothing to reduce micro-jitter while still following finger
                        val smoothed = lastTranslation + (trans - lastTranslation) * 0.35f
                        if (Math.abs(smoothed - lastTranslation) > 0.25f) {
                            stationsContent.translationX = smoothed
                            lastTranslation = smoothed
                        }
                    }
                    MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                        if (!dragging) {
                            activePointerId = MotionEvent.INVALID_POINTER_ID
                            return
                        }
                        velocityTracker?.computeCurrentVelocity(1000)
                        val vx = try { velocityTracker?.getXVelocity(activePointerId) ?: 0f } catch (_: Exception) { velocityTracker?.xVelocity ?: 0f }
                        val idx = try { e.findPointerIndex(activePointerId) } catch (_: Exception) { -1 }
                        val px = if (idx >= 0) e.getX(idx) else e.x
                        val dxTotal = px - downX
                        val threshold = (stationsContent.width.takeIf { it > 0 } ?: rv.width) * 0.25f
                        val maxIndex = if (::tabLayout.isInitialized) tabLayout.tabCount - 1 else 2
                        val target = if (dxTotal < 0) currentTabIndex + 1 else currentTabIndex - 1
                        val shouldNavigate = Math.abs(dxTotal) > threshold || Math.abs(vx) > Math.max(minFlingVelocity, 1000)

                        // Restore parent handling after the gesture is finished
                        rv.parent?.requestDisallowInterceptTouchEvent(false)
                        rv.isNestedScrollingEnabled = true
                        // Restore RecyclerView item animator
                        try {
                            stationsList.itemAnimator = savedItemAnimator
                            savedItemAnimator = null
                        } catch (_: Exception) {}

                        if (shouldNavigate && target in 0..maxIndex) {
                            // Animate off-screen in the swipe direction for a smooth feel, then navigate
                            val off = if (dxTotal < 0) -stationsContent.width.toFloat() else stationsContent.width.toFloat()
                            stationsContent.animate().translationX(off).setDuration(180).withEndAction {
                                if (dxTotal < 0) {
                                    selectionFromSwipe = true
                                    navigateToTab(currentTabIndex + 1)
                                } else {
                                    selectionFromSwipe = true
                                    navigateToTab(currentTabIndex - 1)
                                }
                                // Ensure translation reset after navigation (animateListTransition will animate new content)
                                stationsContent.translationX = 0f
                                stationsContent.setLayerType(View.LAYER_TYPE_NONE, null)
                                lastTranslation = 0f
                            }.start()
                        } else {
                            // animate back into place (apply to stationsContent, which is what we translate during the gesture)
                            stationsContent.animate().translationX(0f).setDuration(200).withEndAction {
                                stationsContent.setLayerType(View.LAYER_TYPE_NONE, null)
                                lastTranslation = 0f
                                // Restore animator if not already restored
                                try {
                                    stationsList.itemAnimator = savedItemAnimator
                                    savedItemAnimator = null
                                } catch (_: Exception) {}
                            }.start()
                        }
                        velocityTracker?.recycle()
                        velocityTracker = null
                        dragging = false
                        activePointerId = MotionEvent.INVALID_POINTER_ID
                    }
                }
            }

            override fun onRequestDisallowInterceptTouchEvent(disallowIntercept: Boolean) {
                // No-op
            }
        }

        stationsSwipeListener = listener
        stationsList.addOnItemTouchListener(listener)
    }

    // Disable and remove swipe navigation listener (used when not in All Stations)
    private fun disableSwipeNavigation() {
        try {
            stationsSwipeListener?.let { stationsList.removeOnItemTouchListener(it) }
        } catch (_: Exception) { }
        stationsSwipeListener = null
        try {
            stationsContent.animate().cancel()
            stationsContent.translationX = 0f
            stationsList.isNestedScrollingEnabled = true
            stationsList.itemAnimator = savedItemAnimator
            savedItemAnimator = null
        } catch (_: Exception) { }
    }

    private fun navigateToTab(index: Int) {
        android.util.Log.d("MainActivity", "navigateToTab: requested=$index current=$currentTabIndex")
        if (!::tabLayout.isInitialized) return
        val maxIndex = tabLayout.tabCount - 1
        val target = index.coerceIn(0, maxIndex)
        android.util.Log.d("MainActivity", "navigateToTab: target=$target")
        if (target != currentTabIndex) {
            tabLayout.getTabAt(target)?.select()
        }
    }

    private fun setupSettings() {
        // Set up click listeners for each settings card
        findViewById<View>(R.id.settings_theme_card)?.setOnClickListener {
            val intent = Intent(this, SettingsDetailActivity::class.java).apply {
                putExtra(SettingsDetailActivity.EXTRA_SECTION, SettingsDetailActivity.SECTION_THEME)
            }
            startActivity(intent)
        }
        
        findViewById<View>(R.id.settings_playback_card)?.setOnClickListener {
            val intent = Intent(this, SettingsDetailActivity::class.java).apply {
                putExtra(SettingsDetailActivity.EXTRA_SECTION, SettingsDetailActivity.SECTION_PLAYBACK)
            }
            startActivity(intent)
        }
        
        findViewById<View>(R.id.settings_android_auto_card)?.setOnClickListener {
            val intent = Intent(this, SettingsDetailActivity::class.java).apply {
                putExtra(SettingsDetailActivity.EXTRA_SECTION, SettingsDetailActivity.SECTION_ANDROID_AUTO)
            }
            startActivity(intent)
        }
        
        findViewById<View>(R.id.settings_subscriptions_card)?.setOnClickListener {
            val intent = Intent(this, SettingsDetailActivity::class.java).apply {
                putExtra(SettingsDetailActivity.EXTRA_SECTION, SettingsDetailActivity.SECTION_SUBSCRIPTIONS)
            }
            startActivity(intent)
        }
        
        findViewById<View>(R.id.settings_indexing_card)?.setOnClickListener {
            val intent = Intent(this, SettingsDetailActivity::class.java).apply {
                putExtra(SettingsDetailActivity.EXTRA_SECTION, SettingsDetailActivity.SECTION_INDEXING)
            }
            startActivity(intent)
        }
        
        findViewById<View>(R.id.settings_alarm_card)?.setOnClickListener {
            val intent = Intent(this, SettingsDetailActivity::class.java).apply {
                putExtra(SettingsDetailActivity.EXTRA_SECTION, SettingsDetailActivity.SECTION_ALARM)
            }
            startActivity(intent)
        }
        
        findViewById<View>(R.id.settings_backup_card)?.setOnClickListener {
            val intent = Intent(this, SettingsDetailActivity::class.java).apply {
                putExtra(SettingsDetailActivity.EXTRA_SECTION, SettingsDetailActivity.SECTION_BACKUP)
            }
            startActivity(intent)
        }
        
        findViewById<View>(R.id.settings_privacy_card)?.setOnClickListener {
            val intent = Intent(this, SettingsDetailActivity::class.java).apply {
                putExtra(SettingsDetailActivity.EXTRA_SECTION, SettingsDetailActivity.SECTION_PRIVACY)
            }
            startActivity(intent)
        }
        
        findViewById<View>(R.id.settings_about_card)?.setOnClickListener {
            val intent = Intent(this, SettingsDetailActivity::class.java).apply {
                putExtra(SettingsDetailActivity.EXTRA_SECTION, SettingsDetailActivity.SECTION_ABOUT)
            }
            startActivity(intent)
        }
    }

    private fun playStation(id: String) {
        val intent = Intent(this, RadioService::class.java).apply {
            action = RadioService.ACTION_PLAY_STATION
            putExtra(RadioService.EXTRA_STATION_ID, id)
        }
        startService(intent)
    }

    override fun onResume() {
        super.onResume()
        // Restore view when returning from settings
        PlaybackStateHelper.onShowChange(showChangeListener)
        startPlaybackStateUpdates()
        
        // Clear show cache and refresh the current view to prevent stale show names
        refreshCurrentView()
        // Ensure swipe navigation is active if we're in All Stations (defensive restore)
        try { if (currentMode == "list") setupSwipeNavigation() } catch (_: Exception) { }

        // Ensure the action bar reflects the current section when returning from other activities
        updateActionBarTitle()
        if (currentMode != "podcasts") {
            // Explicitly clear any Up/home affordance left by a detail fragment so
            // the 'Favourites' / 'All Stations' titles display correctly
            supportActionBar?.apply {
                show()
                setDisplayHomeAsUpEnabled(false)
                setDisplayShowHomeEnabled(false)
            }
        }
        // Defensive sync for intermittent cases where the action bar remains hidden
        // after returning from fragment-heavy flows.
        syncActionBarVisibility()

        // If returning to Favorites ensure the last-selected sub-tab is restored and its
        // content (Saved / History) is refreshed so it doesn't remain hidden after navigation.
        try {
            if (currentMode == "favorites") {
                val prefs = getPreferences(android.content.Context.MODE_PRIVATE)
                val lastChecked = prefs.getInt("last_fav_tab_id", R.id.fav_tab_stations)
                updateFavoritesToggleVisuals(lastChecked)
                // Ensure the toggle's visibility matches the restored mode
                updateFavoritesToggleVisibility()
                when (lastChecked) {
                    R.id.fav_tab_stations -> showFavoritesTab("stations")
                    R.id.fav_tab_subscribed -> showFavoritesTab("subscribed")
                    R.id.fav_tab_saved -> showFavoritesTab("saved")
                    R.id.fav_tab_searches -> showFavoritesTab("searches")
                    R.id.fav_tab_history -> showFavoritesTab("history")
                }
                refreshSavedEpisodesSection()
                refreshHistorySection()
            }
        } catch (_: Exception) { }
    }

    private fun refreshSavedSearchesSection() {
        val recycler = findViewById<RecyclerView>(R.id.saved_searches_recycler)
        val empty = findViewById<TextView>(R.id.saved_searches_empty)

        val searches = SavedSearchesPreference.getSavedSearches(this)
        if (recycler.layoutManager == null) {
            recycler.layoutManager = LinearLayoutManager(this)
        }
        recycler.isNestedScrollingEnabled = false

        val adapter = recycler.adapter as? SavedSearchAdapter
            ?: SavedSearchAdapter(searches.toMutableList(),
                onSearchClick = { openSavedSearch(it) },
                onRenameClick = { showSavedSearchEditDialog(it) },
                onNotifyToggle = { search, enabled ->
                    SavedSearchesPreference.updateNotifications(this, search.id, enabled)
                    refreshSavedSearchesSection()
                },
                onDeleteClick = { search ->
                    com.google.android.material.snackbar.Snackbar
                        .make(findViewById(android.R.id.content), "Delete saved search?", com.google.android.material.snackbar.Snackbar.LENGTH_LONG)
                        .setAction("Delete") {
                            SavedSearchesPreference.removeSearch(this, search.id)
                            refreshSavedSearchesSection()
                        }
                        .setAnchorView(findViewById(R.id.saved_searches_container))
                        .show()
                }
            ).also { recycler.adapter = it }

        adapter.updateSearches(searches)
        val hasItems = (recycler.adapter?.itemCount ?: 0) > 0
        recycler.visibility = if (hasItems) View.VISIBLE else View.GONE
        empty.visibility = if (hasItems) View.GONE else View.VISIBLE

        maybeRefreshSavedSearchDates(recycler, empty)
    }

    private fun maybeRefreshSavedSearchDates(
        recycler: RecyclerView,
        empty: TextView
    ) {
        if (savedSearchDateRefreshJob?.isActive == true) return

        savedSearchDateRefreshJob = lifecycleScope.launch(Dispatchers.IO) {
            SavedSearchManager.refreshLatestMatchDates(this@MainActivity)
            val updated = SavedSearchesPreference.getSavedSearches(this@MainActivity)
            withContext(Dispatchers.Main) {
                val adapter = recycler.adapter as? SavedSearchAdapter
                adapter?.updateSearches(updated)
                val hasItems = (adapter?.itemCount ?: 0) > 0
                recycler.visibility = if (hasItems) View.VISIBLE else View.GONE
                empty.visibility = if (hasItems) View.GONE else View.VISIBLE
            }
        }
    }

    private fun showSavedSearchEditDialog(search: SavedSearchesPreference.SavedSearch) {
        val dialogView = layoutInflater.inflate(R.layout.dialog_saved_search, null)
        val nameInput = dialogView.findViewById<com.google.android.material.textfield.TextInputEditText>(R.id.saved_search_name_input)
        val queryInput = dialogView.findViewById<com.google.android.material.textfield.TextInputEditText>(R.id.saved_search_query_input)
        val queryInfo = dialogView.findViewById<View>(R.id.saved_search_query_info)
        val notifySwitch = dialogView.findViewById<com.google.android.material.switchmaterial.SwitchMaterial>(R.id.saved_search_notify_switch)

        nameInput.setText(search.name)
        nameInput.setSelection(search.name.length)
        queryInput.setText(search.query)
        queryInput.setSelection(search.query.length)
        notifySwitch.isChecked = search.notificationsEnabled

        queryInfo.setOnClickListener { showSearchOperatorInfo() }

        androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("Edit Saved Search")
            .setView(dialogView)
            .setPositiveButton("Save") { _, _ ->
                val name = nameInput.text?.toString()?.trim().orEmpty().ifBlank { search.query }
                val query = queryInput.text?.toString()?.trim().orEmpty().ifBlank { search.query }
                SavedSearchesPreference.updateSearchName(this, search.id, name)
                if (query != search.query) {
                    SavedSearchesPreference.updateSearchQuery(this, search.id, query)
                }
                SavedSearchesPreference.updateNotifications(this, search.id, notifySwitch.isChecked)
                refreshSavedSearchesSection()
            }
            .setNegativeButton("Cancel", null)
            .show()
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
        androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("Search operators")
            .setMessage(message)
            .setPositiveButton("OK", null)
            .show()
    }
    
    override fun onPause() {
        super.onPause()
        PlaybackStateHelper.removeShowChangeListener(showChangeListener)
        stopPlaybackStateUpdates()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putString("currentMode", currentMode)
        outState.putInt("selectedNavId", bottomNavigation.selectedItemId)
    }

    private fun openNowPlaying() {
        val intent = Intent(this, NowPlayingActivity::class.java).apply {
            // Tell NowPlaying where we are so it can return to the correct view on back
            putExtra("origin_mode", currentMode)
        }
        startActivity(intent)
    }

    private fun stopPlayback() {
        val intent = Intent(this, RadioService::class.java).apply {
            action = RadioService.ACTION_STOP
        }
        startService(intent)
        updateMiniPlayer()
    }
    
    private fun skipToPrevious() {
        val intent = Intent(this, RadioService::class.java).apply {
            action = RadioService.ACTION_SKIP_TO_PREVIOUS
        }
        startService(intent)
    }

    private fun skipToNext() {
        val intent = Intent(this, RadioService::class.java).apply {
            action = RadioService.ACTION_SKIP_TO_NEXT
        }
        startService(intent)
    }

    private fun togglePlayPause() {
        // Toggle the state immediately for UI feedback
        val isCurrentlyPlaying = PlaybackStateHelper.getIsPlaying()
        PlaybackStateHelper.setIsPlaying(!isCurrentlyPlaying)
        
        val intent = Intent(this, RadioService::class.java).apply {
            action = if (isCurrentlyPlaying) {
                RadioService.ACTION_PAUSE
            } else {
                RadioService.ACTION_PLAY
            }
        }
        startService(intent)
        updateMiniPlayer()
    }
    
    private fun startPlaybackStateUpdates() {
        stopPlaybackStateUpdates()
        miniPlayerUpdateTimer = Thread {
            while (!Thread.currentThread().isInterrupted) {
                try {
                    Thread.sleep(500) // Update every 500ms
                    runOnUiThread { updateMiniPlayer() }
                } catch (e: InterruptedException) {
                    break
                }
            }
        }
        miniPlayerUpdateTimer?.start()
    }
    
    private fun stopPlaybackStateUpdates() {
        miniPlayerUpdateTimer?.interrupt()
        miniPlayerUpdateTimer = null
    }
    
    private fun updateMiniPlayer() {
        val station = PlaybackStateHelper.getCurrentStation()
        val isPlaying = PlaybackStateHelper.getIsPlaying()
        val show = PlaybackStateHelper.getCurrentShow()
        
        if (station != null) {
            // Show mini player
            miniPlayer.visibility = android.view.View.VISIBLE
            miniPlayerTitle.text = station.title
            
            // Display compact subtitle as: "Show name - Show description" (or fallback).
            val showName = show.title.ifEmpty { station.title }
            val hasSongData = !show.secondary.isNullOrEmpty() || !show.tertiary.isNullOrEmpty()
            val showDesc = PlaybackStateHelper.getCurrentShow().episodeTitle?.takeIf { it.isNotEmpty() }
                ?: show.secondary?.takeIf { it.isNotEmpty() }
                ?: show.getFormattedTitle().takeIf { it.isNotEmpty() }
                ?: ""
            val newTitle = when {
                hasSongData -> show.getFormattedTitle() // Artist - Track only
                showName.isNotEmpty() && showDesc.isNotEmpty() && showDesc != showName -> "$showName - $showDesc"
                else -> showDesc.ifEmpty { showName }
            }
            if (miniPlayerSubtitle.text.toString() != newTitle) {
                miniPlayerSubtitle.text = newTitle
                miniPlayerSubtitle.isSelected = true // Trigger marquee/scroll
                miniPlayerSubtitle.startScrolling()
            }
            
            // Load artwork: Use image_url from API if available and valid, otherwise station logo
            val artworkUrl = if (!show.imageUrl.isNullOrEmpty() && show.imageUrl.startsWith("http")) {
                show.imageUrl
            } else {
                station.logoUrl
            }
            
            // Only reload if URL changed to prevent flashing
            if (artworkUrl != lastArtworkUrl) {
                lastArtworkUrl = artworkUrl
                val fallbackUrl = station.logoUrl
                
                Glide.with(this)
                    .load(artworkUrl)
                    .placeholder(android.R.color.transparent)
                    .error(Glide.with(this).load(fallbackUrl))
                    .listener(object : RequestListener<Drawable> {
                        override fun onLoadFailed(e: GlideException?, model: Any?, target: Target<Drawable>?, isFirstResource: Boolean): Boolean {
                            return false
                        }

                        override fun onResourceReady(resource: Drawable?, model: Any?, target: Target<Drawable>?, dataSource: DataSource?, isFirstResource: Boolean): Boolean {
                            if (resource is BitmapDrawable && isPlaceholderImage(resource.bitmap)) {
                                Log.d("MainActivity", "Detected placeholder image, falling back to logo")
                                miniPlayerArtwork.post {
                                    Glide.with(this@MainActivity)
                                        .load(fallbackUrl)
                                        .into(miniPlayerArtwork)
                                }
                                return true
                            }
                            return false
                        }
                    })
                    .into(miniPlayerArtwork)
                Log.d("MainActivity", "Loading artwork from: $artworkUrl")
            }
            
            // Update play/pause button - always show the correct state
            miniPlayerPlayPause.setImageResource(if (isPlaying) R.drawable.ic_pause else R.drawable.ic_play_arrow)

            // Sync progress bar: only shown for podcasts with valid progress data.
            // This ensures the bar is always hidden when switching to a radio station,
            // even if the show-change listener fired while the view was temporarily detached.
            val isPodcast = station.id.startsWith("podcast_")
            val pos = show.segmentStartMs ?: -1L
            val dur = show.segmentDurationMs ?: -1L
            if (isPodcast && dur > 0 && pos >= 0) {
                val ratio = (pos.toDouble() / dur.toDouble()).coerceIn(0.0, 1.0)
                miniPlayerProgress.progress = (ratio * 100).toInt()
                miniPlayerProgress.visibility = android.view.View.VISIBLE
            } else {
                miniPlayerProgress.visibility = android.view.View.GONE
            }

            // Update favorite button state - for podcasts, show saved-episode state if an episode is playing; otherwise show podcast subscription
            val currentEpisodeId = PlaybackStateHelper.getCurrentEpisodeId()
            // If an episode is playing, treat the favorite button as an episode-save (bookmark).
            if (isPodcast && !currentEpisodeId.isNullOrEmpty()) {
                val saved = SavedEpisodes.isSaved(this, currentEpisodeId)
                if (saved) {
                    miniPlayerFavorite.setImageResource(R.drawable.ic_bookmark)
                    miniPlayerFavorite.setColorFilter(ContextCompat.getColor(this, R.color.favorite_star_color))
                } else {
                    miniPlayerFavorite.setImageResource(R.drawable.ic_bookmark_outline_stroked)
                    miniPlayerFavorite.clearColorFilter()
                }
            } else {
                val isFavorited = if (isPodcast) {
                    PodcastSubscriptions.isSubscribed(this, station.id.removePrefix("podcast_"))
                } else {
                    FavoritesPreference.isFavorite(this, station.id)
                }
                if (isFavorited) {
                    miniPlayerFavorite.setImageResource(R.drawable.ic_star_filled)
                    miniPlayerFavorite.setColorFilter(ContextCompat.getColor(this, R.color.favorite_star_color))
                } else {
                    miniPlayerFavorite.setImageResource(R.drawable.ic_star_outline_stroked)
                    miniPlayerFavorite.clearColorFilter()
                }
            }
        } else {
            // Hide mini player
            miniPlayer.visibility = android.view.View.GONE
        }
    }
    
    private fun updateMiniPlayerFromShow(show: CurrentShow) {
        if (isFinishing || isDestroyed) {
            Log.w("MainActivity", "Ignoring show update because activity is finishing/destroyed")
            return
        }
        if (!miniPlayerArtwork.isAttachedToWindow) {
            Log.w("MainActivity", "Ignoring show update because mini player view is detached")
            return
        }

        // Update station title immediately so podcast name doesn't persist after switching to a radio station
        val currentStation = PlaybackStateHelper.getCurrentStation()
        if (currentStation != null) {
            miniPlayerTitle.text = currentStation.title
        }

        // Update subtitle with compact "Show name - Show description" (consistent with notification)
        val showName = show.title.ifEmpty { currentStation?.title ?: "" }
        val showDesc = PlaybackStateHelper.getCurrentShow().episodeTitle?.takeIf { it.isNotEmpty() }
            ?: show.secondary?.takeIf { it.isNotEmpty() }
            ?: show.getFormattedTitle().takeIf { it.isNotEmpty() }
            ?: ""
        val newTitle = if (showName.isNotEmpty() && showDesc.isNotEmpty() && showDesc != showName) "$showName - $showDesc" else (showDesc.ifEmpty { showName })
        if (miniPlayerSubtitle.text.toString() != newTitle) {
            miniPlayerSubtitle.text = newTitle
            miniPlayerSubtitle.isSelected = true
            miniPlayerSubtitle.startScrolling()
        }
        
        // Load new artwork - use image_url if available and valid, otherwise station logo
        val artworkUrl = if (!show.imageUrl.isNullOrEmpty() && show.imageUrl.startsWith("http")) {
            show.imageUrl
        } else {
            PlaybackStateHelper.getCurrentStation()?.logoUrl
        }
        
        // Only reload if URL changed
        if (artworkUrl != null && artworkUrl != lastArtworkUrl) {
            lastArtworkUrl = artworkUrl
            val fallbackUrl = PlaybackStateHelper.getCurrentStation()?.logoUrl
            
            Glide.with(this)
                .load(artworkUrl)
                .placeholder(android.R.color.transparent)
                .error(Glide.with(this).load(fallbackUrl))
                .listener(object : RequestListener<Drawable> {
                    override fun onLoadFailed(e: GlideException?, model: Any?, target: Target<Drawable>?, isFirstResource: Boolean): Boolean {
                        return false
                    }

                    override fun onResourceReady(resource: Drawable?, model: Any?, target: Target<Drawable>?, dataSource: DataSource?, isFirstResource: Boolean): Boolean {
                        if (resource is BitmapDrawable && isPlaceholderImage(resource.bitmap)) {
                            Log.d("MainActivity", "Detected placeholder image, falling back to logo")
                            miniPlayerArtwork.post {
                                Glide.with(this@MainActivity)
                                    .load(fallbackUrl)
                                    .into(miniPlayerArtwork)
                            }
                            return true
                        }
                        return false
                    }
                })
                .into(miniPlayerArtwork)
            Log.d("MainActivity", "Loading artwork from: $artworkUrl")
        }

        // Show episode progress only for podcast playback
        val isPodcastStation = PlaybackStateHelper.getCurrentStation()?.id?.startsWith("podcast_") == true
        val pos = show.segmentStartMs ?: -1L
        val dur = show.segmentDurationMs ?: -1L
        if (isPodcastStation && dur > 0 && pos >= 0) {
            val ratio = (pos.toDouble() / dur.toDouble()).coerceIn(0.0, 1.0)
            val percent = (ratio * 100).toInt()
            miniPlayerProgress.progress = percent
            miniPlayerProgress.visibility = android.view.View.VISIBLE
        } else {
            miniPlayerProgress.visibility = android.view.View.GONE
        }
    }
    
    private fun toggleMiniPlayerFavorite() {
        val station = PlaybackStateHelper.getCurrentStation()
        if (station != null) {
            if (station.id.startsWith("podcast_")) {
                // If an episode is currently playing, save/unsave the episode. Otherwise toggle podcast subscription.
                val currentEpisodeId = PlaybackStateHelper.getCurrentEpisodeId()
                if (!currentEpisodeId.isNullOrEmpty()) {
                    val episode = com.hyliankid14.bbcradioplayer.Episode(
                        id = currentEpisodeId,
                        title = PlaybackStateHelper.getCurrentShow().episodeTitle ?: "Saved episode",
                        description = PlaybackStateHelper.getCurrentShow().description ?: "",
                        audioUrl = "",
                        imageUrl = PlaybackStateHelper.getCurrentShow().imageUrl ?: "",
                        pubDate = "",
                        durationMins = 0,
                        podcastId = station.id.removePrefix("podcast_")
                    )
                    val podcastTitle = PlaybackStateHelper.getCurrentStation()?.title ?: ""
                    val nowSaved = SavedEpisodes.toggleSaved(this, episode, podcastTitle)
                    if (currentMode == "favorites") showFavorites()
                    updateMiniPlayer()
                    val msg = if (nowSaved) "Saved episode: ${episode.title}" else "Removed saved episode: ${episode.title}"
                    com.google.android.material.snackbar.Snackbar.make(findViewById(android.R.id.content), msg, com.google.android.material.snackbar.Snackbar.LENGTH_SHORT).setAnchorView(miniPlayer).show()
                } else {
                    PodcastSubscriptions.toggleSubscription(this, station.id.removePrefix("podcast_"))
                    if (currentMode == "favorites") {
                        showFavorites()
                    }
                }
            } else {
                FavoritesPreference.toggleFavorite(this, station.id)
                
                // Refresh the current view to update the station's favorite status
                when (currentMode) {
                    "list" -> showAllStations()
                    "favorites" -> showFavorites()
                }
            }
            updateMiniPlayer()
        }
    }
    
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        return when (keyCode) {
            KeyEvent.KEYCODE_MEDIA_NEXT -> {
                scrollToNextStation()
                true
            }
            KeyEvent.KEYCODE_MEDIA_PREVIOUS -> {
                scrollToPreviousStation()
                true
            }
            else -> super.onKeyDown(keyCode, event)
        }
    }
    
    private fun scrollToNextStation() {
        val scrollMode = ScrollingPreference.getScrollMode(this)
        val stations = if (scrollMode == ScrollingPreference.MODE_FAVORITES) {
            val favorites = FavoritesPreference.getFavorites(this)
            if (favorites.isEmpty()) {
                Log.w("MainActivity", "No favorites available for scrolling")
                return
            }
            favorites
        } else {
            StationRepository.getStations()
        }
        
        val currentStation = PlaybackStateHelper.getCurrentStation()
        val currentIndex = stations.indexOfFirst { it.id == currentStation?.id }
        
        val nextIndex = if (currentIndex == -1) {
            0
        } else {
            (currentIndex + 1) % stations.size
        }
        
        playStation(stations[nextIndex].id)
    }
    
    private fun scrollToPreviousStation() {
        val scrollMode = ScrollingPreference.getScrollMode(this)
        val stations = if (scrollMode == ScrollingPreference.MODE_FAVORITES) {
            val favorites = FavoritesPreference.getFavorites(this)
            if (favorites.isEmpty()) {
                Log.w("MainActivity", "No favorites available for scrolling")
                return
            }
            favorites
        } else {
            StationRepository.getStations()
        }
        
        val currentStation = PlaybackStateHelper.getCurrentStation()
        val currentIndex = stations.indexOfFirst { it.id == currentStation?.id }
        
        val prevIndex = if (currentIndex == -1) {
            stations.size - 1
        } else {
            (currentIndex - 1 + stations.size) % stations.size
        }
        
        playStation(stations[prevIndex].id)
    }

    private fun isPlaceholderImage(bitmap: Bitmap): Boolean {
        val width = bitmap.width
        val height = bitmap.height
        
        if (width < 10 || height < 10) return false
        
        // Sample 5 points: corners and center
        val p1 = bitmap.getPixel(5, 5)
        val p2 = bitmap.getPixel(width - 5, 5)
        val p3 = bitmap.getPixel(5, height - 5)
        val p4 = bitmap.getPixel(width - 5, height - 5)
        val p5 = bitmap.getPixel(width / 2, height / 2)
        
        val pixels = listOf(p1, p2, p3, p4, p5)
        val first = pixels[0]
        
        // Check if all sampled pixels are similar to the first one
        for (p in pixels) {
            if (!areColorsSimilar(first, p)) return false
        }
        
        // Check if the color is grey-ish (R ~= G ~= B)
        return isGrey(first)
    }

    override fun onDestroy() {
        super.onDestroy()
        PlaybackStateHelper.removeShowChangeListener(showChangeListener)
        supportFragmentManager.removeOnBackStackChangedListener(backStackListener)
    }
    
    private fun areColorsSimilar(c1: Int, c2: Int): Boolean {
        val r1 = (c1 shr 16) and 0xFF
        val g1 = (c1 shr 8) and 0xFF
        val b1 = c1 and 0xFF
        
        val r2 = (c2 shr 16) and 0xFF
        val g2 = (c2 shr 8) and 0xFF
        val b2 = c2 and 0xFF
        
        val diff = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2)
        return diff < 30 // Tolerance
    }
    
    private fun isGrey(color: Int): Boolean {
        val r = (color shr 16) and 0xFF
        val g = (color shr 8) and 0xFF
        val b = color and 0xFF
        
        // Grey means R, G, and B are close to each other
        val maxDiff = Math.max(Math.abs(r - g), Math.max(Math.abs(r - b), Math.abs(g - b)))
        return maxDiff < 20
    }

    // Export preferences to the given Uri as JSON. Returns true on success.
    private fun exportPreferencesToUri(uri: Uri): Boolean {
        return try {
            val names = listOf("favorites_prefs", "podcast_subscriptions", "saved_episodes_prefs", "saved_searches_prefs", "played_episodes_prefs", "played_history_prefs", "playback_prefs", "scrolling_prefs", "index_prefs", "subscription_refresh_prefs", "podcast_filter_prefs", "theme_prefs", "download_prefs")
            val root = JSONObject()
            for (name in names) {
                val prefs = getSharedPreferences(name, MODE_PRIVATE)
                val obj = JSONObject()
                for ((k, v) in prefs.all) {
                    when (v) {
                        is Set<*> -> {
                            val arr = JSONArray()
                            v.forEach { arr.put(it.toString()) }
                            obj.put(k, arr)
                        }
                        is Boolean -> obj.put(k, v)
                        is Number -> obj.put(k, v)
                        else -> obj.put(k, v?.toString())
                    }
                }
                // Ensure known defaults are present even if they were never explicitly stored
                if (name == "scrolling_prefs") {
                    if (!obj.has("scroll_mode")) obj.put("scroll_mode", ScrollingPreference.getScrollMode(this))
                }
                if (name == "playback_prefs") {
                    if (!obj.has("auto_resume_android_auto")) obj.put("auto_resume_android_auto", PlaybackPreference.isAutoResumeAndroidAutoEnabled(this))
                }
                if (name == "index_prefs") {
                    if (!obj.has("index_interval_days")) obj.put("index_interval_days", IndexPreference.getIntervalDays(this))
                    // Do not export the persisted last reindex timestamp because the on-disk
                    // index is machine-local and is cleared on uninstall. Exporting it can
                    // lead to misleading "Last rebuilt" values on import.
                    if (obj.has("last_reindex_time")) obj.remove("last_reindex_time")
                }
                if (name == "subscription_refresh_prefs") {
                    if (!obj.has("refresh_interval_minutes")) obj.put("refresh_interval_minutes", SubscriptionRefreshPreference.getIntervalMinutes(this))
                }
                if (name == "podcast_filter_prefs") {
                    if (!obj.has("exclude_non_english")) obj.put("exclude_non_english", PodcastFilterPreference.excludeNonEnglish(this))
                }
                if (name == "download_prefs") {
                    if (!obj.has("auto_download_enabled")) obj.put("auto_download_enabled", DownloadPreferences.isAutoDownloadEnabled(this))
                    if (!obj.has("auto_download_limit")) obj.put("auto_download_limit", DownloadPreferences.getAutoDownloadLimit(this))
                    if (!obj.has("download_on_wifi_only")) obj.put("download_on_wifi_only", DownloadPreferences.isDownloadOnWifiOnly(this))
                    if (!obj.has("delete_on_played")) obj.put("delete_on_played", DownloadPreferences.isDeleteOnPlayed(this))
                }
                // Ensure notification preferences are explicitly included for podcast subscriptions
                if (name == "podcast_subscriptions") {
                    if (!obj.has("notifications_enabled")) {
                        val enabledIds = PodcastSubscriptions.getSubscribedIds(this).filter { 
                            PodcastSubscriptions.isNotificationsEnabled(this, it) 
                        }.toSet()
                        val arr = JSONArray()
                        enabledIds.forEach { arr.put(it) }
                        obj.put("notifications_enabled", arr)
                    }
                }
                root.put(name, obj)
            }

            contentResolver.openOutputStream(uri)?.use { out ->
                out.write(root.toString(2).toByteArray())
            }
            true
        } catch (e: Exception) {
            Log.e("MainActivity", "Failed to export preferences", e)
            false
        }
    }

    private fun createImportProgressDialog(): androidx.appcompat.app.AlertDialog {
        return androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("Restoring backup…")
            .setMessage("Restoring your subscriptions and preferences. Please wait.")
            .setView(android.widget.ProgressBar(this).apply {
                isIndeterminate = true
                val pad = (16 * resources.displayMetrics.density).toInt()
                setPadding(pad, pad, pad, pad)
            })
            .setCancelable(false)
            .create()
    }

    // Import preferences from the given Uri (JSON). Returns true on success.
    private fun importPreferencesFromUri(uri: Uri): Boolean {
        return try {
            val text = contentResolver.openInputStream(uri)?.use { it.bufferedReader().readText() } ?: return false
            val root = JSONObject(text)
            val keys = root.keys()
            while (keys.hasNext()) {
                val prefsName = keys.next()
                val prefsObj = root.getJSONObject(prefsName)
                val prefs = getSharedPreferences(prefsName, MODE_PRIVATE)
                val edit = prefs.edit()
                edit.clear()
                val kIt = prefsObj.keys()
                while (kIt.hasNext()) {
                    val key = kIt.next()
                    // Do not import the persisted last reindex timestamp because the on-disk
                    // index and its stored timestamp are cleared when the app is uninstalled.
                    // Restoring this value would show a misleading "Last rebuilt" time.
                    if (prefsName == "index_prefs" && key == "last_reindex_time") continue
                    val value = prefsObj.get(key)
                    when (value) {
                        is JSONArray -> {
                            val set = mutableSetOf<String>()
                            for (i in 0 until value.length()) set.add(value.getString(i))
                            edit.putStringSet(key, set)
                        }
                        is Boolean -> edit.putBoolean(key, value)
                        is Int -> edit.putInt(key, value)
                        is Long -> edit.putLong(key, value)
                        is Double -> {
                            // JSONObject represents numbers as Double. Decide whether to store as int/long/float
                            val d = value
                            if (d % 1.0 == 0.0) {
                                val l = d.toLong()
                                if (l <= Int.MAX_VALUE && l >= Int.MIN_VALUE) edit.putInt(key, l.toInt()) else edit.putLong(key, l)
                            } else {
                                edit.putFloat(key, d.toFloat())
                            }
                        }
                        else -> {
                            val s = if (value == JSONObject.NULL) null else value.toString()
                            edit.putString(key, s)
                        }
                    }
                }
                edit.apply()
            }

            // Ensure critical preferences are set via their helpers so any logic they perform runs
            try {
                if (root.has("scrolling_prefs")) {
                    val sp = root.getJSONObject("scrolling_prefs")
                    if (sp.has("scroll_mode")) {
                        val mode = sp.optString("scroll_mode", ScrollingPreference.MODE_ALL_STATIONS)
                        ScrollingPreference.setScrollMode(this, mode)
                    }
                }
            } catch (e: Exception) { /* Ignore */ }

            try {
                if (root.has("playback_prefs")) {
                    val pp = root.getJSONObject("playback_prefs")
                    if (pp.has("auto_resume_android_auto")) {
                        val enabled = pp.optBoolean("auto_resume_android_auto", false)
                        PlaybackPreference.setAutoResumeAndroidAuto(this, enabled)
                    }
                }
            } catch (e: Exception) { /* Ignore */ }

            try {
                if (root.has("index_prefs")) {
                    val ip = root.getJSONObject("index_prefs")
                    if (ip.has("index_interval_days")) {
                        val days = ip.optInt("index_interval_days", 0)
                        IndexPreference.setIntervalDays(this, days)
                        // Apply scheduling immediately to match imported state
                        if (days > 0) IndexScheduler.scheduleIndexing(this) else IndexScheduler.cancel(this)
                    }
                }
            } catch (e: Exception) { /* Ignore */ }

            try {
                if (root.has("subscription_refresh_prefs")) {
                    val sr = root.getJSONObject("subscription_refresh_prefs")
                    if (sr.has("refresh_interval_minutes")) {
                        val minutes = sr.optInt("refresh_interval_minutes", SubscriptionRefreshPreference.getIntervalMinutes(this))
                        SubscriptionRefreshPreference.setIntervalMinutes(this, minutes)
                        if (minutes > 0) SubscriptionRefreshScheduler.scheduleRefresh(this) else SubscriptionRefreshScheduler.cancel(this)

                        runOnUiThread {
                            try {
                                val spinner: com.google.android.material.textfield.MaterialAutoCompleteTextView? = findViewById(R.id.subscription_refresh_spinner)
                                val options = arrayOf("Disabled", "15 minutes", "30 minutes", "60 minutes", "2 hours", "6 hours", "12 hours", "24 hours")
                                val values = intArrayOf(0, 15, 30, 60, 120, 360, 720, 1440)
                                val pos = values.indexOf(minutes).takeIf { it >= 0 } ?: 3
                                spinner?.setText(options[pos], false)
                            } catch (_: Exception) {}
                        }
                    }
                }
            } catch (e: Exception) { /* Ignore */ }

            try {
                if (root.has("podcast_filter_prefs")) {
                    val pf = root.getJSONObject("podcast_filter_prefs")
                    if (pf.has("exclude_non_english")) {
                        val exclude = pf.optBoolean("exclude_non_english", false)
                        PodcastFilterPreference.setExcludeNonEnglish(this, exclude)
                        // Apply immediately: update UI and refresh view
                        runOnUiThread {
                            try {
                                val cb: android.widget.CheckBox? = findViewById(R.id.exclude_non_english_checkbox)
                                cb?.isChecked = exclude
                            } catch (_: Exception) {}
                            try { refreshCurrentView() } catch (_: Exception) {}
                        }
                    }
                }
            } catch (e: Exception) { /* Ignore */ }

            try {
                if (root.has("download_prefs")) {
                    val dp = root.getJSONObject("download_prefs")
                    if (dp.has("auto_download_enabled")) {
                        val enabled = dp.optBoolean("auto_download_enabled", false)
                        DownloadPreferences.setAutoDownloadEnabled(this, enabled)
                    }
                    if (dp.has("auto_download_limit")) {
                        val limit = dp.optInt("auto_download_limit", 1)
                        DownloadPreferences.setAutoDownloadLimit(this, limit)
                    }
                    if (dp.has("download_on_wifi_only")) {
                        val wifiOnly = dp.optBoolean("download_on_wifi_only", true)
                        DownloadPreferences.setDownloadOnWifiOnly(this, wifiOnly)
                    }
                    if (dp.has("delete_on_played")) {
                        val deleteOnPlayed = dp.optBoolean("delete_on_played", false)
                        DownloadPreferences.setDeleteOnPlayed(this, deleteOnPlayed)
                    }
                    // Update UI to reflect imported settings
                    runOnUiThread {
                        try {
                            val autoDownloadCheckbox: android.widget.CheckBox? = findViewById(R.id.auto_download_checkbox)
                            autoDownloadCheckbox?.isChecked = DownloadPreferences.isAutoDownloadEnabled(this)
                            
                            val autoDownloadLimitSpinner: com.google.android.material.textfield.MaterialAutoCompleteTextView? = findViewById(R.id.auto_download_limit_spinner)
                            val limitOptions = arrayOf("Latest episode", "Latest 2 episodes", "Latest 3 episodes", "Latest 5 episodes", "Latest 10 episodes")
                            val limitValues = intArrayOf(1, 2, 3, 5, 10)
                            val savedLimit = DownloadPreferences.getAutoDownloadLimit(this)
                            val limitPos = limitValues.indexOf(savedLimit).takeIf { it >= 0 } ?: 0
                            autoDownloadLimitSpinner?.setText(limitOptions[limitPos], false)
                            
                            val wifiOnlyCheckbox: android.widget.CheckBox? = findViewById(R.id.wifi_only_download_checkbox)
                            wifiOnlyCheckbox?.isChecked = DownloadPreferences.isDownloadOnWifiOnly(this)
                            
                            val deleteOnPlayedCheckbox: android.widget.CheckBox? = findViewById(R.id.delete_on_played_checkbox)
                            deleteOnPlayedCheckbox?.isChecked = DownloadPreferences.isDeleteOnPlayed(this)
                        } catch (_: Exception) {}
                    }
                }
            } catch (e: Exception) { /* Ignore */ }

            // Notify listeners that played-status/progress may have changed so UI updates
            try {
                val intent = android.content.Intent(PlayedEpisodesPreference.ACTION_PLAYED_STATUS_CHANGED)
                sendBroadcast(intent)
            } catch (e: Exception) { }
            try {
                val intent = android.content.Intent(PlayedHistoryPreference.ACTION_HISTORY_CHANGED)
                sendBroadcast(intent)
            } catch (e: Exception) { }
            true
        } catch (e: Exception) {
            Log.e("MainActivity", "Failed to import preferences", e)
            false
        }
    }
    
    private fun createAlarmNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val notificationManager = getSystemService(NOTIFICATION_SERVICE) as android.app.NotificationManager
            
            // Check if channel already exists
            if (notificationManager.getNotificationChannel(AlarmReceiver.ALARM_CHANNEL_ID) != null) {
                return
            }
            
            val channel = android.app.NotificationChannel(
                AlarmReceiver.ALARM_CHANNEL_ID,
                getString(R.string.alarm_notification_channel),
                android.app.NotificationManager.IMPORTANCE_HIGH
            )
            channel.description = "Alarm notifications"
            channel.enableVibration(true)
            channel.enableLights(true)
            channel.setShowBadge(true)
            // Allow sound to bypass DND (alarm-like semantics)
            channel.setBypassDnd(true)
            
            notificationManager.createNotificationChannel(channel)
        }
    }

}
