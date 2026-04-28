package com.hyliankid14.bbcradioplayer

import android.Manifest
import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.os.Bundle
import android.os.Build
import android.provider.Settings
import android.util.Log
import android.view.KeyEvent
import android.content.res.ColorStateList
import androidx.core.content.ContextCompat
import android.net.Uri
import android.widget.Button
import android.widget.PopupMenu
import android.widget.Toast
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AlertDialog
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
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.graphics.Bitmap
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.graphics.Color
import android.text.SpannableString
import android.text.Spanned
import android.text.TextPaint
import android.text.method.LinkMovementMethod
import android.text.style.ClickableSpan
import com.bumptech.glide.Glide
import com.bumptech.glide.load.DataSource
import com.bumptech.glide.load.engine.GlideException
import com.bumptech.glide.request.RequestListener
import com.bumptech.glide.request.target.Target
import com.google.android.material.bottomnavigation.BottomNavigationView
import com.google.android.material.progressindicator.CircularProgressIndicator
import com.google.android.material.progressindicator.LinearProgressIndicator
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
    companion object {
        private const val GITHUB_UPDATE_PREFS = "github_update_prefs"
        private const val KEY_LAST_AUTO_CHECK_AT = "last_auto_check_at"
        private const val KEY_LAST_DECLINED_VERSION = "last_declined_version"
        private const val AUTO_UPDATE_CHECK_INTERVAL_MS = 6L * 60L * 60L * 1000L
    }

    private lateinit var stationsList: RecyclerView
    private lateinit var settingsContainer: View
    private lateinit var fragmentContainer: View
    private lateinit var staticContentContainer: View
    private lateinit var stationsView: View
    private lateinit var stationsContent: View
    private lateinit var vpnWarningBanner: View
    private lateinit var bottomNavigation: BottomNavigationView
    private lateinit var miniPlayer: LinearLayout
    private lateinit var miniPlayerTitle: TextView
    private lateinit var miniPlayerSubtitle: ScrollingTextView
    private lateinit var miniPlayerProgress: LinearProgressIndicator
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
    private val categoryAdapters = mutableMapOf<StationCategory, CategorizedStationAdapter>()
    private var currentTabIndex = 0
    private var savedItemAnimator: androidx.recyclerview.widget.RecyclerView.ItemAnimator? = null
    private var selectionFromSwipe = false
    // Reference to the active swipe listener so it can be removed when not in the All Stations view
    private var stationsSwipeListener: RecyclerView.OnItemTouchListener? = null
    // Track any in-flight transition overlay so it can be cleaned up before starting a new one
    private var activeOverlayView: View? = null

    // Track whether a swipe-to-delete ItemTouchHelper has been attached to the Saved Episodes recycler
    private var savedItemTouchHelper: ItemTouchHelper? = null
    private var activePlaylistId: String? = null
    private var playlistSelectionPlaylistId: String? = null
    private val selectedPlaylistEpisodeEntries = linkedMapOf<String, PodcastPlaylists.Entry>()


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
    // When opening a saved search from Favorites, return back to the Saved Searches list on back press
    private var returnToSavedSearchesOnBack: Boolean = false
    // When opening a podcast from the radio schedule, return back to that schedule on back press
    private var returnToScheduleOnBack: Boolean = false
    private var scheduleReturnStationId: String? = null
    private var scheduleReturnStationTitle: String? = null
    // The mode (currentMode) that was active when the user first navigated from the Schedule to a Podcast,
    // so we can restore it after they back out past the Schedule.
    private var scheduleReturnOriginMode: String = "list"

    // Track the last visible percent for the episode/index progress bar so we can
    // defensively ignore any stray regressions emitted by background components.
    private var lastSeenIndexPercent: Int = 0
    private var savedSearchDateRefreshJob: Job? = null
    private lateinit var analytics: PrivacyAnalytics
    private var updateDownloadId: Long? = null
    private var updateDownloadReceiver: BroadcastReceiver? = null
    private var vpnStatusCallback: ConnectivityManager.NetworkCallback? = null
    private var vpnWarningDismissed = false

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
        // Fragments that manage their own full-screen toolbar should always hide the Activity bar.
        val top = supportFragmentManager.findFragmentById(R.id.fragment_container)
        val topHasOwnToolbar = top is PodcastSearchFragment ||
            top is PodcastGenreResultsFragment ||
            (top is PodcastsFragment && top.isSearchContextMode())
        val hasDetailOnBackStack = supportFragmentManager.backStackEntryCount > 0
        if (hasDetailOnBackStack && !topHasOwnToolbar) {
            actionBar.show()
        } else {
            actionBar.hide()
        }
    }

    private fun restoreTopAppBarState() {
        val toolbar = findViewById<com.google.android.material.appbar.MaterialToolbar?>(R.id.top_app_bar) ?: return
        toolbar.visibility = View.VISIBLE
        toolbar.alpha = 1f
        toolbar.translationY = 0f

        // Re-apply section-specific bar state after wake/focus changes.
        if (currentMode != "podcasts") {
            supportActionBar?.show()
        }
        syncActionBarVisibility()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Apply theme before creating the view
        val theme = ThemePreference.getTheme(this)
        ThemeManager.applyTheme(theme)
        enableEdgeToEdge()
        
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        WearAppStateSync.pushCurrentState(this)

        lifecycleScope.launch(Dispatchers.IO) {
            try {
                EpisodeDownloadManager.recoverStuckDownloads(this@MainActivity)
            } catch (e: Exception) {
                Log.w("MainActivity", "Pending download recovery failed: ${e.message}")
            }
        }

        // Refresh home-screen widgets on every app launch so they pick up the latest
        // playback state and artwork (including the generic station icons) without
        // requiring the user to play a station first.
        WidgetUpdateHelper.updateAllWidgets(this)

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
        val playlistSelectionToolbar = findViewById<com.google.android.material.appbar.MaterialToolbar>(R.id.playlist_selection_toolbar)
        try {
            setSupportActionBar(toolbar)
        } catch (e: IllegalStateException) {
            android.util.Log.w("MainActivity", "Could not set support action bar: ${e.message}")
        }

        playlistSelectionToolbar.setNavigationOnClickListener {
            clearPlaylistEpisodeSelection()
        }
        playlistSelectionToolbar.setOnMenuItemClickListener { item ->
            when (item.itemId) {
                R.id.action_playlist_download_selected -> {
                    downloadSelectedPlaylistEpisodes()
                    true
                }
                R.id.action_playlist_delete_downloads_selected -> {
                    deleteDownloadsForSelectedPlaylistEpisodes()
                    true
                }
                R.id.action_playlist_remove_selected -> {
                    removeSelectedEpisodesFromActivePlaylist()
                    true
                }
                else -> false
            }
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
        vpnWarningBanner = findViewById(R.id.vpn_warning_banner)
        findViewById<android.widget.ImageButton>(R.id.vpn_warning_dismiss)?.setOnClickListener {
            vpnWarningDismissed = true
            updateVpnWarningBanner()
        }
        updateVpnWarningBanner()
        
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
                        try { showFavorites() } catch (_: Exception) { }
                        return
                    }
                    if (returnToSavedSearchesOnBack && top is PodcastDetailFragment) {
                        // User is viewing a podcast detail opened from within a saved search session;
                        // pop the detail and return directly to Favorites Searches.
                        returnToSavedSearchesOnBack = false
                        try { supportFragmentManager.popBackStack() } catch (_: Exception) { }
                        suppressBottomNavSelection = true
                        try { bottomNavigation.selectedItemId = R.id.navigation_favorites } catch (_: Exception) { }
                        suppressBottomNavSelection = false
                        try { getPreferences(android.content.Context.MODE_PRIVATE).edit()
                            .putInt("last_fav_tab_id", R.id.fav_tab_searches).apply() } catch (_: Exception) { }
                        try { showFavorites() } catch (_: Exception) { }
                        return
                    }
                    if (returnToSavedSearchesOnBack && top is PodcastsFragment && top.isSearchContextMode()) {
                        returnToSavedSearchesOnBack = false
                        try { supportFragmentManager.popBackStack(null, androidx.fragment.app.FragmentManager.POP_BACK_STACK_INCLUSIVE) } catch (_: Exception) { }
                        suppressBottomNavSelection = true
                        try { bottomNavigation.selectedItemId = R.id.navigation_favorites } catch (_: Exception) { }
                        suppressBottomNavSelection = false
                        try { getPreferences(android.content.Context.MODE_PRIVATE).edit()
                            .putInt("last_fav_tab_id", R.id.fav_tab_searches).apply() } catch (_: Exception) { }
                        try { showFavorites() } catch (_: Exception) { }
                        return
                    }
                    if (returnToSavedSearchesOnBack && top is PodcastsFragment
                            && supportFragmentManager.backStackEntryCount == 0) {
                        returnToSavedSearchesOnBack = false
                        suppressBottomNavSelection = true
                        try { bottomNavigation.selectedItemId = R.id.navigation_favorites } catch (_: Exception) { }
                        suppressBottomNavSelection = false
                        // Persist the searches sub-tab as the active tab before restoring Favorites
                        try { getPreferences(android.content.Context.MODE_PRIVATE).edit()
                            .putInt("last_fav_tab_id", R.id.fav_tab_searches).apply() } catch (_: Exception) { }
                        try { showFavorites() } catch (_: Exception) { }
                        return
                    }
                    if (returnToSavedSearchesOnBack && top is PodcastSearchFragment) {
                        returnToSavedSearchesOnBack = false
                        try { supportFragmentManager.popBackStack(null, androidx.fragment.app.FragmentManager.POP_BACK_STACK_INCLUSIVE) } catch (_: Exception) { }
                        suppressBottomNavSelection = true
                        try { bottomNavigation.selectedItemId = R.id.navigation_favorites } catch (_: Exception) { }
                        suppressBottomNavSelection = false
                        try { getPreferences(android.content.Context.MODE_PRIVATE).edit()
                            .putInt("last_fav_tab_id", R.id.fav_tab_searches).apply() } catch (_: Exception) { }
                        try { showFavorites() } catch (_: Exception) { }
                        return
                    }
                    // Fallback: if returnToSavedSearchesOnBack is still set but the fragment is in an
                    // unexpected state (e.g. the transaction hasn't committed yet, or top is null),
                    // still navigate back to the Saved Searches list rather than closing the activity.
                    if (returnToSavedSearchesOnBack) {
                        returnToSavedSearchesOnBack = false
                        try { supportFragmentManager.popBackStack(null, androidx.fragment.app.FragmentManager.POP_BACK_STACK_INCLUSIVE) } catch (_: Exception) { }
                        suppressBottomNavSelection = true
                        try { bottomNavigation.selectedItemId = R.id.navigation_favorites } catch (_: Exception) { }
                        suppressBottomNavSelection = false
                        try { getPreferences(android.content.Context.MODE_PRIVATE).edit()
                            .putInt("last_fav_tab_id", R.id.fav_tab_searches).apply() } catch (_: Exception) { }
                        try { showFavorites() } catch (_: Exception) { }
                        return
                    }
                    if (returnToScheduleOnBack && top is PodcastDetailFragment) {
                        returnToScheduleOnBack = false
                        val stationId = scheduleReturnStationId
                        val stationTitle = scheduleReturnStationTitle
                        val originMode = scheduleReturnOriginMode
                        scheduleReturnStationId = null
                        scheduleReturnStationTitle = null
                        scheduleReturnOriginMode = "list"
                        try { supportFragmentManager.popBackStack() } catch (_: Exception) { }
                        if (!stationId.isNullOrEmpty()) {
                            val scheduleIntent = Intent(this@MainActivity, ScheduleActivity::class.java).apply {
                                putExtra(ScheduleActivity.EXTRA_STATION_ID, stationId)
                                putExtra(ScheduleActivity.EXTRA_STATION_TITLE, stationTitle ?: "Schedule")
                            }
                            startActivity(scheduleIntent)
                        }
                        // Restore the page the user was on before navigating into the schedule, so
                        // pressing back from ScheduleActivity returns to the correct screen.
                        try { if (originMode == "favorites") showFavorites() else showAllStations() } catch (_: Exception) { }
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
        vpnWarningDismissed = savedInstanceState?.getBoolean("vpnWarningDismissed") ?: false

        updateActionBarTitle()
        
        // Start polling for playback state updates
        startPlaybackStateUpdates()

        // Handle any incoming intents that request opening a specific podcast or mode
        handleDeepLinkIntent(intent)
        handleOpenEpisodeNotificationIntent(intent)
        handleOpenPodcastIntent(intent)
        handleOpenModeIntent(intent)
        handleOpenSavedSearchIntent(intent)

        maybeAutoCheckForGitHubUpdates()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleDeepLinkIntent(intent)
        handleOpenEpisodeNotificationIntent(intent)
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
            "favorites" -> {
                showFavorites()
                // Optionally switch to a specific favorites sub-tab
                val favTab = intent.getStringExtra("open_fav_tab")
                if (!favTab.isNullOrEmpty()) {
                    val tabId = when (favTab) {
                        "playlists" -> R.id.fav_tab_saved
                        "saved" -> R.id.fav_tab_saved
                        "history" -> R.id.fav_tab_history
                        "subscribed" -> R.id.fav_tab_subscribed
                        "searches" -> R.id.fav_tab_searches
                        "stations" -> R.id.fav_tab_stations
                        else -> null
                    }
                    if (tabId != null) {
                        try {
                            getPreferences(android.content.Context.MODE_PRIVATE)
                                .edit().putInt("last_fav_tab_id", tabId).apply()
                        } catch (e: Exception) {
                            android.util.Log.w("MainActivity", "Failed to persist fav tab selection: ${e.message}")
                        }
                        activePlaylistId = intent.getStringExtra("open_playlist_id")
                        updateFavoritesToggleVisuals(tabId)
                        showFavoritesTab(if (favTab == "playlists") "saved" else favTab)
                    }
                }
            }
            "list" -> showAllStations()
            "podcasts" -> {
                try { bottomNavigation.selectedItemId = R.id.navigation_podcasts } catch (e: Exception) {
                    android.util.Log.w("MainActivity", "Failed to navigate to podcasts tab", e)
                }
            }
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
            // Flag that back should return to the Saved Searches list in Favorites
            returnToSavedSearchesOnBack = true
            suppressBottomNavSelection = true
            try { bottomNavigation.selectedItemId = R.id.navigation_podcasts } catch (_: Exception) { }
            suppressBottomNavSelection = false
            val resultsFragment = PodcastsFragment.newSearchResultsInstance(search.query)
            supportFragmentManager.beginTransaction().apply {
                setReorderingAllowed(true)
                replace(R.id.fragment_container, resultsFragment, "podcast_search_results")
                commit()
            }
            return
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
                // Clear cache in all cached category adapters and refresh the active one
                categoryAdapters.values.forEach { it.clearShowCache() }
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

    // Refresh the playlist UI card and adapter (Saved Episodes is the default playlist)
    private fun refreshSavedEpisodesSection() {
        try {
            val savedContainer = findViewById<View>(R.id.saved_episodes_container)
            val savedEmpty = findViewById<TextView>(R.id.saved_episodes_empty)
            val playlistsEmpty = findViewById<TextView>(R.id.playlists_empty)
            val playlistsRecycler = findViewById<RecyclerView>(R.id.playlists_recycler)
            val savedRecycler = findViewById<RecyclerView>(R.id.saved_episodes_recycler)

            if (currentMode != "favorites") {
                clearPlaylistEpisodeSelection()
                savedContainer.visibility = View.GONE
                savedEmpty.visibility = View.GONE
                playlistsEmpty.visibility = View.GONE
                playlistsRecycler.visibility = View.GONE
                savedRecycler.visibility = View.GONE
                supportActionBar?.setDisplayHomeAsUpEnabled(false)
                invalidateOptionsMenu()
                return
            }

            val savedTabActive = isButtonChecked(R.id.fav_tab_saved)
            val playlists = PodcastPlaylists.getPlaylists(this)
            val currentPlaylistId = activePlaylistId?.takeIf { requestedId -> playlists.any { it.id == requestedId } }
            if (activePlaylistId != currentPlaylistId) activePlaylistId = currentPlaylistId

            if (activePlaylistId == null) {
                clearPlaylistEpisodeSelection()
                supportActionBar?.title = "Playlists"
                supportActionBar?.setDisplayHomeAsUpEnabled(false)
                invalidateOptionsMenu()
                savedRecycler.visibility = View.GONE
                savedEmpty.visibility = View.GONE
                playlistsRecycler.layoutManager = LinearLayoutManager(this)
                playlistsRecycler.isNestedScrollingEnabled = false
                val adapter = (playlistsRecycler.adapter as? PlaylistSummaryAdapter)
                    ?: PlaylistSummaryAdapter(
                        playlists = playlists,
                        onOpenPlaylist = { playlist ->
                            activePlaylistId = playlist.id
                            refreshSavedEpisodesSection()
                        },
                        onRenamePlaylist = { playlist -> showRenamePlaylistDialog(playlist) },
                        onDeletePlaylist = { playlist -> confirmDeletePlaylist(playlist) }
                    ).also { playlistsRecycler.adapter = it }
                adapter.updatePlaylists(playlists)

                if (savedTabActive) {
                    savedContainer.visibility = View.VISIBLE
                    playlistsRecycler.visibility = View.VISIBLE
                    playlistsEmpty.visibility = View.GONE
                } else {
                    savedContainer.visibility = View.GONE
                    playlistsRecycler.visibility = View.GONE
                    playlistsEmpty.visibility = View.GONE
                }
                return
            }

            val playlistId = activePlaylistId ?: PodcastPlaylists.DEFAULT_PLAYLIST_ID
            if (playlistSelectionPlaylistId != playlistId) {
                clearPlaylistEpisodeSelection()
            }
            val hidePlayed = PlaybackPreference.isHidePlayedEpisodesInPlaylistsEnabled(this)
            val allPlaylistEntries = PodcastPlaylists.getPlaylistEntries(this, playlistId)
            val playlistEntries = PlaylistSortPreference.applySort(this, playlistId, allPlaylistEntries)
            supportActionBar?.title = PodcastPlaylists.getPlaylistName(this, playlistId)
            supportActionBar?.setDisplayHomeAsUpEnabled(true)
            invalidateOptionsMenu()
            playlistsRecycler.visibility = View.GONE
            playlistsEmpty.visibility = View.GONE

            savedRecycler.layoutManager = LinearLayoutManager(this)
            savedRecycler.isNestedScrollingEnabled = false
            val adapter = (savedRecycler.adapter as? PlaylistEpisodesAdapter)
                ?: PlaylistEpisodesAdapter(
                    context = this,
                    entries = playlistEntries,
                    onPlayEpisode = { episode, podcastTitle, podcastImage ->
                        val intent = android.content.Intent(this, RadioService::class.java).apply {
                            action = RadioService.ACTION_PLAY_PODCAST_EPISODE
                            putExtra(RadioService.EXTRA_EPISODE, episode)
                            putExtra(RadioService.EXTRA_PODCAST_ID, episode.podcastId)
                            putExtra(RadioService.EXTRA_PODCAST_TITLE, podcastTitle)
                            putExtra(RadioService.EXTRA_PODCAST_IMAGE, episode.imageUrl.takeIf { it.isNotEmpty() } ?: podcastImage)
                            putExtra(RadioService.EXTRA_PLAYLIST_ID, playlistId)
                        }
                        startService(intent)
                    },
                    onOpenEpisode = { episode, podcastTitle, podcastImage ->
                        val intent = android.content.Intent(this, NowPlayingActivity::class.java).apply {
                            putExtra("preview_episode", episode)
                            putExtra("preview_use_play_ui", true)
                            putExtra("preview_podcast_title", podcastTitle)
                            putExtra("preview_podcast_image", episode.imageUrl.takeIf { it.isNotEmpty() } ?: podcastImage)
                            putExtra("back_source", "playlists")
                            putExtra("back_playlist_id", playlistId)
                        }
                        startActivity(intent)
                    },
                    onRemoveSaved = { id ->
                        PodcastPlaylists.removeEpisode(this, playlistId, id)
                        EpisodeDownloadManager.deleteDownload(this, id, showToast = false)
                        refreshSavedEpisodesSection()
                    },
                    onEpisodeLongPress = { entry ->
                        onPlaylistEpisodeLongPress(playlistId, entry)
                    },
                    onEpisodeSelectionClick = { entry ->
                        onPlaylistEpisodeSelectionClick(playlistId, entry)
                    }
                ).also { savedRecycler.adapter = it }
            adapter.setShowPlayedSection(hidePlayed)
            adapter.updatePlaylistEntries(playlistEntries)
            // Preserve current selections when refreshing adapter
            adapter.setSelectedEntryIds(selectedPlaylistEpisodeEntries.keys)
            updatePlaylistSelectionToolbar()

            if (savedItemTouchHelper == null) {
                val swipeCallback = object : ItemTouchHelper.SimpleCallback(ItemTouchHelper.UP or ItemTouchHelper.DOWN, ItemTouchHelper.LEFT or ItemTouchHelper.RIGHT) {
                    override fun getDragDirs(recyclerView: RecyclerView, viewHolder: RecyclerView.ViewHolder): Int {
                        val playlist = activePlaylistId ?: return 0
                        val isManual = PlaylistSortPreference.getSortOrder(this@MainActivity, playlist) == PlaylistSortPreference.SORT_MANUAL
                        val hidePlayedEnabled = PlaybackPreference.isHidePlayedEpisodesInPlaylistsEnabled(this@MainActivity)
                        return if (isManual && !hidePlayedEnabled) super.getDragDirs(recyclerView, viewHolder) else 0
                    }

                    override fun onMove(recyclerView: RecyclerView, viewHolder: RecyclerView.ViewHolder, target: RecyclerView.ViewHolder): Boolean {
                        val playlistAdapter = recyclerView.adapter as? PlaylistEpisodesAdapter ?: return false
                        val moved = playlistAdapter.moveEntry(viewHolder.bindingAdapterPosition, target.bindingAdapterPosition)
                        if (moved) {
                            val playlist = activePlaylistId ?: return true
                            PlaylistSortPreference.setManualOrder(this@MainActivity, playlist, playlistAdapter.getPlaylistEntries().map { it.id })
                        }
                        return moved
                    }

                    override fun isLongPressDragEnabled(): Boolean {
                        val playlist = activePlaylistId ?: return false
                        val isManual = PlaylistSortPreference.getSortOrder(this@MainActivity, playlist) == PlaylistSortPreference.SORT_MANUAL
                        val hidePlayedEnabled = PlaybackPreference.isHidePlayedEpisodesInPlaylistsEnabled(this@MainActivity)
                        return isManual && !hidePlayedEnabled
                    }

                    override fun isItemViewSwipeEnabled(): Boolean = activePlaylistId != null

                    override fun onSwiped(viewHolder: RecyclerView.ViewHolder, direction: Int) {
                        val currentPlaylist = activePlaylistId ?: PodcastPlaylists.DEFAULT_PLAYLIST_ID
                        val pos = viewHolder.bindingAdapterPosition
                        if (pos != RecyclerView.NO_POSITION) {
                            val currentAdapter = savedRecycler.adapter as? PlaylistEpisodesAdapter
                            val removedEntry = currentAdapter?.getPlaylistEntryAt(pos)
                            if (removedEntry == null) {
                                try { savedRecycler.adapter?.notifyItemChanged(pos) } catch (_: Exception) { }
                                return
                            }

                            PodcastPlaylists.removeEpisode(this@MainActivity, currentPlaylist, removedEntry.id)
                            EpisodeDownloadManager.deleteDownload(this@MainActivity, removedEntry.id, showToast = false)
                            selectedPlaylistEpisodeEntries.remove(removedEntry.id)
                            refreshSavedEpisodesSection()

                            com.google.android.material.snackbar.Snackbar
                                .make(findViewById(android.R.id.content), "Episode removed from playlist", com.google.android.material.snackbar.Snackbar.LENGTH_LONG)
                                .setAction("Undo") {
                                    PodcastPlaylists.addEntry(this@MainActivity, currentPlaylist, removedEntry)
                                    refreshSavedEpisodesSection()
                                }
                                .setAnchorView(findViewById(R.id.saved_episodes_container))
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
                        val paint = android.graphics.Paint()
                        val icon = ContextCompat.getDrawable(this@MainActivity, android.R.drawable.ic_menu_delete)
                        paint.color = android.graphics.Color.parseColor("#f44336")
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
                savedItemTouchHelper = ItemTouchHelper(swipeCallback).also { it.attachToRecyclerView(savedRecycler) }
            }

            if (savedTabActive) {
                savedContainer.visibility = View.VISIBLE
                savedRecycler.visibility = if (playlistEntries.isNotEmpty()) View.VISIBLE else View.GONE
                savedEmpty.visibility = if (playlistEntries.isEmpty()) View.VISIBLE else View.GONE
            } else {
                savedContainer.visibility = View.GONE
                savedRecycler.visibility = View.GONE
                savedEmpty.visibility = View.GONE
            }
        } catch (e: Exception) {
            android.util.Log.w("MainActivity", "refreshSavedEpisodesSection failed: ${e.message}")
        }
    }

    private fun showPlaylistsOverflowMenu(anchor: View) {
        val menu = PopupMenu(this, anchor)
        val sortNewestId = 2
        val sortOldestId = 3
        val sortTitleId = 4
        val sortManualId = 5
        val hidePlayedId = 6
        val bulkDownloadId = 7
        val bulkDeleteDownloadsId = 8

        menu.menu.add(2, hidePlayedId, 20, "Hide played episodes")
            .setCheckable(true)
            .isChecked = PlaybackPreference.isHidePlayedEpisodesInPlaylistsEnabled(this)

        val currentPlaylist = activePlaylistId
        if (currentPlaylist != null) {
            menu.menu.add(1, sortNewestId, 10, "Sort: Newest first").isCheckable = true
            menu.menu.add(1, sortOldestId, 11, "Sort: Oldest first").isCheckable = true
            menu.menu.add(1, sortTitleId, 12, "Sort: Title").isCheckable = true
            menu.menu.add(1, sortManualId, 13, "Sort: Manual").isCheckable = true
            menu.menu.setGroupCheckable(1, true, true)

            val allEntries = PodcastPlaylists.getPlaylistEntries(this, currentPlaylist)
            if (allEntries.isNotEmpty()) {
                if (areAllPlaylistEpisodesDownloaded(allEntries)) {
                    menu.menu.add(3, bulkDeleteDownloadsId, 14, "Delete all episode downloads")
                } else {
                    menu.menu.add(3, bulkDownloadId, 14, "Download all episodes")
                }
            }

            when (PlaylistSortPreference.getSortOrder(this, currentPlaylist)) {
                PlaylistSortPreference.SORT_OLDEST_FIRST -> menu.menu.findItem(sortOldestId)?.isChecked = true
                PlaylistSortPreference.SORT_TITLE -> menu.menu.findItem(sortTitleId)?.isChecked = true
                PlaylistSortPreference.SORT_MANUAL -> menu.menu.findItem(sortManualId)?.isChecked = true
                else -> menu.menu.findItem(sortNewestId)?.isChecked = true
            }
        }

        menu.setOnMenuItemClickListener { item ->
            when (item.itemId) {
                sortNewestId, sortOldestId, sortTitleId, sortManualId -> {
                    val playlistId = activePlaylistId ?: return@setOnMenuItemClickListener false
                    val sort = when (item.itemId) {
                        sortOldestId -> PlaylistSortPreference.SORT_OLDEST_FIRST
                        sortTitleId -> PlaylistSortPreference.SORT_TITLE
                        sortManualId -> PlaylistSortPreference.SORT_MANUAL
                        else -> PlaylistSortPreference.SORT_NEWEST_FIRST
                    }

                    if (sort == PlaylistSortPreference.SORT_MANUAL) {
                        val currentIds = PodcastPlaylists.getPlaylistEntries(this, playlistId).map { it.id }
                        if (PlaylistSortPreference.getManualOrder(this, playlistId).isEmpty()) {
                            PlaylistSortPreference.setManualOrder(this, playlistId, currentIds)
                        }
                        if (PlaybackPreference.isHidePlayedEpisodesInPlaylistsEnabled(this)) {
                            Toast.makeText(this, "Disable 'Hide played episodes in playlists' to reorder manually", Toast.LENGTH_SHORT).show()
                        } else {
                            Toast.makeText(this, "Long press and drag episodes to reorder", Toast.LENGTH_SHORT).show()
                        }
                    }

                    PlaylistSortPreference.setSortOrder(this, playlistId, sort)
                    refreshSavedEpisodesSection()
                    true
                }
                hidePlayedId -> {
                    val next = !PlaybackPreference.isHidePlayedEpisodesInPlaylistsEnabled(this)
                    PlaybackPreference.setHidePlayedEpisodesInPlaylists(this, next)
                    item.isChecked = next
                    refreshSavedEpisodesSection()
                    true
                }
                bulkDownloadId -> {
                    val playlistId = activePlaylistId ?: return@setOnMenuItemClickListener false
                    val entries = PodcastPlaylists.getPlaylistEntries(this, playlistId)
                    maybeConfirmAndDownloadAllEpisodesForPlaylist(entries)
                    true
                }
                bulkDeleteDownloadsId -> {
                    val playlistId = activePlaylistId ?: return@setOnMenuItemClickListener false
                    val entries = PodcastPlaylists.getPlaylistEntries(this, playlistId)
                    deleteAllDownloadsForPlaylist(entries)
                    refreshSavedEpisodesSection()
                    true
                }
                else -> false
            }
        }

        menu.show()
    }

    private fun showCreatePlaylistDialog() {
        val input = android.widget.EditText(this).apply {
            hint = "Playlist name"
            setSingleLine()
        }
        val container = createDialogInputContainer(input)
        AlertDialog.Builder(this)
            .setTitle("Create playlist")
            .setView(container)
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Create") { _, _ ->
                val name = input.text?.toString().orEmpty().trim()
                if (name.isBlank()) {
                    Toast.makeText(this, "Playlist name required", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }
                val playlist = PodcastPlaylists.createPlaylist(this, name)
                activePlaylistId = playlist.id
                refreshSavedEpisodesSection()
            }
            .show()
    }

    private fun showRenamePlaylistDialog(playlist: PodcastPlaylists.PlaylistSummary) {
        val input = android.widget.EditText(this).apply {
            setText(playlist.name)
            setSelection(text?.length ?: 0)
            setSingleLine()
        }
        val container = createDialogInputContainer(input)
        AlertDialog.Builder(this)
            .setTitle("Rename playlist")
            .setView(container)
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Save") { _, _ ->
                val name = input.text?.toString().orEmpty().trim()
                if (name.isBlank()) {
                    Toast.makeText(this, "Playlist name required", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }
                PodcastPlaylists.renamePlaylist(this, playlist.id, name)
                refreshSavedEpisodesSection()
            }
            .show()
    }

    private fun confirmDeletePlaylist(playlist: PodcastPlaylists.PlaylistSummary) {
        AlertDialog.Builder(this)
            .setTitle("Delete playlist")
            .setMessage("Delete ${playlist.name}?")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Delete") { _, _ ->
                PodcastPlaylists.getPlaylistEntries(this, playlist.id).forEach { entry ->
                    EpisodeDownloadManager.deleteDownload(this, entry.id, showToast = false)
                }
                PodcastPlaylists.deletePlaylist(this, playlist.id)
                if (activePlaylistId == playlist.id) activePlaylistId = null
                refreshSavedEpisodesSection()
            }
            .show()
    }

    private fun createDialogInputContainer(input: android.widget.EditText): View {
        val horizontalPaddingPx = (24 * resources.displayMetrics.density).toInt()
        return android.widget.FrameLayout(this).apply {
            setPadding(horizontalPaddingPx, 0, horizontalPaddingPx, 0)
            input.layoutParams = android.widget.FrameLayout.LayoutParams(
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                android.widget.FrameLayout.LayoutParams.WRAP_CONTENT
            )
            addView(input)
        }
    }

    private fun playlistEntryToEpisode(entry: PodcastPlaylists.Entry): Episode {
        return Episode(
            id = entry.id,
            title = entry.title,
            description = entry.description,
            audioUrl = entry.audioUrl,
            imageUrl = entry.imageUrl,
            pubDate = entry.pubDate,
            durationMins = entry.durationMins,
            podcastId = entry.podcastId
        )
    }

    private fun clearPlaylistEpisodeSelection() {
        selectedPlaylistEpisodeEntries.clear()
        playlistSelectionPlaylistId = null
        (findViewById<RecyclerView>(R.id.saved_episodes_recycler).adapter as? PlaylistEpisodesAdapter)
            ?.setSelectedEntryIds(emptySet())
        updatePlaylistSelectionToolbar()
    }

    private fun togglePlaylistEpisodeSelection(playlistId: String, entry: PodcastPlaylists.Entry) {
        if (playlistSelectionPlaylistId != playlistId) {
            selectedPlaylistEpisodeEntries.clear()
        }
        playlistSelectionPlaylistId = playlistId
        if (selectedPlaylistEpisodeEntries.containsKey(entry.id)) {
            selectedPlaylistEpisodeEntries.remove(entry.id)
        } else {
            selectedPlaylistEpisodeEntries[entry.id] = entry
        }
        
        // Update adapter's selected entries to show checkboxes
        val adapter = findViewById<RecyclerView>(R.id.saved_episodes_recycler).adapter as? PlaylistEpisodesAdapter
        adapter?.setSelectedEntryIds(selectedPlaylistEpisodeEntries.keys)
        
        updatePlaylistSelectionToolbar()
    }

    private fun updatePlaylistSelectionToolbar() {
        val toolbar = findViewById<com.google.android.material.appbar.MaterialToolbar>(R.id.playlist_selection_toolbar)
        val count = selectedPlaylistEpisodeEntries.size
        val shouldShow = count > 0 && currentMode == "favorites" && isButtonChecked(R.id.fav_tab_saved) && activePlaylistId != null
        if (!shouldShow) {
            toolbar.visibility = View.GONE
            return
        }

        toolbar.title = if (count == 1) "1 selected" else "$count selected"
        toolbar.visibility = View.VISIBLE

        // Determine download state of selection to toggle between Download All / Delete Downloads
        val selected = selectedPlaylistEpisodeEntries.values.toList()
        val allDownloaded = selected.isNotEmpty() && selected.all { DownloadedEpisodes.isDownloaded(this, playlistEntryToEpisode(it)) }
        toolbar.menu.findItem(R.id.action_playlist_download_selected)?.isVisible = !allDownloaded
        toolbar.menu.findItem(R.id.action_playlist_delete_downloads_selected)?.isVisible = allDownloaded
    }

    private fun onPlaylistEpisodeLongPress(playlistId: String, entry: PodcastPlaylists.Entry) {
        // Enter selection mode by toggling the selected state of this episode
        togglePlaylistEpisodeSelection(playlistId, entry)
    }

    private fun onPlaylistEpisodeSelectionClick(playlistId: String, entry: PodcastPlaylists.Entry): Boolean {
        // Keep normal tap-to-open behavior unless selection mode is already active.
        if (selectedPlaylistEpisodeEntries.isEmpty()) return false
        togglePlaylistEpisodeSelection(playlistId, entry)
        return true
    }

    private fun downloadSelectedPlaylistEpisodes() {
        val selected = selectedPlaylistEpisodeEntries.values.toList()
        if (selected.isEmpty()) return
        val pending = selected.filterNot { DownloadedEpisodes.isDownloaded(this, playlistEntryToEpisode(it)) }
        if (pending.isEmpty()) {
            Toast.makeText(this, "All selected episodes are already downloaded", Toast.LENGTH_SHORT).show()
            return
        }
        startBulkPlaylistDownload(pending)
        clearPlaylistEpisodeSelection()
    }

    private fun deleteDownloadsForSelectedPlaylistEpisodes() {
        val selected = selectedPlaylistEpisodeEntries.values.toList()
        if (selected.isEmpty()) return
        var deleted = 0
        selected.forEach { entry ->
            if (EpisodeDownloadManager.deleteDownload(this, entry.id, showToast = false)) {
                deleted++
            }
        }
        Toast.makeText(this, "Deleted $deleted download(s)", Toast.LENGTH_SHORT).show()
        clearPlaylistEpisodeSelection()
        refreshSavedEpisodesSection()
    }

    private fun removeSelectedEpisodesFromActivePlaylist() {
        val selected = selectedPlaylistEpisodeEntries.values.toList()
        if (selected.isEmpty()) return
        val playlistId = playlistSelectionPlaylistId ?: PodcastPlaylists.DEFAULT_PLAYLIST_ID
        selected.forEach { entry ->
            PodcastPlaylists.removeEpisode(this, playlistId, entry.id)
            EpisodeDownloadManager.deleteDownload(this, entry.id, showToast = false)
        }
        Toast.makeText(this, "Removed ${selected.size} episode(s) from playlist", Toast.LENGTH_SHORT).show()
        clearPlaylistEpisodeSelection()
        refreshSavedEpisodesSection()
    }

    private fun areAllPlaylistEpisodesDownloaded(entries: List<PodcastPlaylists.Entry>): Boolean {
        if (entries.isEmpty()) return false
        return entries.all { DownloadedEpisodes.isDownloaded(this, playlistEntryToEpisode(it)) }
    }

    private fun maybeConfirmAndDownloadAllEpisodesForPlaylist(entries: List<PodcastPlaylists.Entry>) {
        if (entries.isEmpty()) return
        val pending = entries.filterNot { DownloadedEpisodes.isDownloaded(this, playlistEntryToEpisode(it)) }
        if (pending.isEmpty()) {
            Toast.makeText(this, "All episodes are already downloaded", Toast.LENGTH_SHORT).show()
            return
        }

        val start = {
            startBulkPlaylistDownload(pending)
        }

        if (pending.size > 10) {
            AlertDialog.Builder(this)
                .setTitle("Download all episodes?")
                .setMessage("This will download ${pending.size} episodes and may use significant storage/data.")
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Download") { _, _ -> start() }
                .show()
        } else {
            start()
        }
    }

    private fun startBulkPlaylistDownload(entries: List<PodcastPlaylists.Entry>) {
        var started = 0
        entries.forEach { entry ->
            val episode = playlistEntryToEpisode(entry)
            val startedDownload = EpisodeDownloadManager.downloadEpisode(
                this,
                episode,
                entry.podcastTitle,
                isAutoDownload = false,
                suppressSuccessNotification = true
            )
            if (startedDownload) started++
        }
        EpisodeDownloadManager.showBulkDownloadQueuedNotification(this, started, "Playlist")
        Toast.makeText(this, "Started $started download(s)", Toast.LENGTH_SHORT).show()
    }

    private fun deleteAllDownloadsForPlaylist(entries: List<PodcastPlaylists.Entry>) {
        if (entries.isEmpty()) return
        var deleted = 0
        entries.forEach { entry ->
            if (EpisodeDownloadManager.deleteDownload(this, entry.id, showToast = false)) {
                deleted++
            }
        }
        Toast.makeText(this, "Deleted $deleted download(s)", Toast.LENGTH_SHORT).show()
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
                            putExtra("back_source", "history")
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

    private fun shouldShowVpnWarningBanner(): Boolean {
        if (vpnWarningDismissed) return false
        if (!NetworkQualityDetector.isVpnActive(this)) return false

        return when (currentMode) {
            "list" -> true
            "favorites" -> isButtonChecked(R.id.fav_tab_stations)
            else -> false
        }
    }

    private fun updateVpnWarningBanner() {
        if (!::vpnWarningBanner.isInitialized) return
        vpnWarningBanner.visibility = if (shouldShowVpnWarningBanner()) View.VISIBLE else View.GONE
    }

    private fun registerVpnStatusMonitoring() {
        if (vpnStatusCallback != null) return
        vpnStatusCallback = NetworkQualityDetector.registerVpnStatusCallback(this) {
            runOnUiThread {
                if (!NetworkQualityDetector.isVpnActive(this)) {
                    vpnWarningDismissed = false
                }
                updateVpnWarningBanner()
            }
        }
    }

    private fun unregisterVpnStatusMonitoring() {
        val callback = vpnStatusCallback ?: return
        NetworkQualityDetector.unregisterVpnStatusCallback(this, callback)
        vpnStatusCallback = null
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
        updateVpnWarningBanner()
        
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
        // Hide recent songs views so they don't bleed into the empty space of the Favourites section
        try { findViewById<View>(R.id.recent_songs_list).visibility = View.GONE } catch (_: Exception) { }
        try { findViewById<View>(R.id.recent_songs_empty).visibility = View.GONE } catch (_: Exception) { }
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
        updateVpnWarningBanner()

        // Key for persisting the last-selected Favorites sub-tab (declare once)
        val LAST_FAV_TAB_KEY = "last_fav_tab_id"

        // Ensure the favorites-related containers are near the top of the parent column so they appear
        // above other content when the Favorites view is selected.
        try {
            favoritesPodcastsContainer?.let { pc ->
                val parent = pc.parent as? android.view.ViewGroup
                parent?.let {
                    try {
                        it.removeView(pc)
                        it.addView(pc, 1)
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
            }
        } catch (_: Exception) { /* best-effort */ }

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
            activePlaylistId = null
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
            try {
                favoritesPodcastsRecycler?.layoutManager = LinearLayoutManager(this)
                // Start hidden; the toggle/tab will reveal this when appropriate
                favoritesPodcastsRecycler?.visibility = View.GONE
                favoritesPodcastsRecycler?.isNestedScrollingEnabled = false
            } catch (_: Exception) { }

            // If the subscribed tab is already visible, show a loading indicator immediately
            val subscribedTabAlreadyActive = (currentMode == "favorites" && isButtonChecked(R.id.fav_tab_subscribed))
            if (subscribedTabAlreadyActive) {
                setSubscribedPodcastsLoading(true)
            }

            // Refresh Saved Episodes data (visibility itself handled by the Saved tab)
            refreshSavedEpisodesSection()

            val repo = PodcastRepository(this)

            // Create the adapter up-front on the UI thread so cached data can populate it
            // the moment the background thread finishes reading from disk — no spinner needed.
            val favPodcastAdapter = PodcastAdapter(this, onPodcastClick = { podcast ->
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
                    arguments = android.os.Bundle().apply {
                        putParcelable("podcast", podcast)
                        putString("back_context", "favorites")
                    }
                }
                supportFragmentManager.beginTransaction().apply {
                    replace(R.id.fragment_container, detailFragment)
                    addToBackStack(null)
                    commit()
                }
            }, highlightSubscribed = true, showSubscribedIcon = false)

            // Set drag handles visibility based on current sort preference
            val initialSort = SubscribedPodcastSortPreference.getSortOrder(this)
            favPodcastAdapter.showDragHandles = (initialSort == SubscribedPodcastSortPreference.SORT_MANUAL)

            favoritesPodcastsRecycler.adapter = favPodcastAdapter

            // Attach combined drag-to-reorder / swipe-to-unsubscribe ItemTouchHelper (only once)
            if (podcastsItemTouchHelper == null) {
                val combinedCallback = object : ItemTouchHelper.Callback() {
                    override fun getMovementFlags(recyclerView: RecyclerView, viewHolder: RecyclerView.ViewHolder): Int {
                        val isManual = SubscribedPodcastSortPreference.getSortOrder(this@MainActivity) ==
                            SubscribedPodcastSortPreference.SORT_MANUAL
                        return if (isManual) {
                            makeMovementFlags(ItemTouchHelper.UP or ItemTouchHelper.DOWN, 0)
                        } else {
                            makeMovementFlags(0, ItemTouchHelper.LEFT or ItemTouchHelper.RIGHT)
                        }
                    }

                    override fun onMove(recyclerView: RecyclerView, viewHolder: RecyclerView.ViewHolder, target: RecyclerView.ViewHolder): Boolean {
                        val fromPos = viewHolder.bindingAdapterPosition
                        val toPos = target.bindingAdapterPosition
                        if (fromPos == RecyclerView.NO_POSITION || toPos == RecyclerView.NO_POSITION) return false
                        (recyclerView.adapter as? PodcastAdapter)?.moveItem(fromPos, toPos)
                        return true
                    }

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

                    override fun isLongPressDragEnabled(): Boolean = false

                    override fun clearView(recyclerView: RecyclerView, viewHolder: RecyclerView.ViewHolder) {
                        super.clearView(recyclerView, viewHolder)
                        viewHolder.itemView.invalidate()
                        try { viewHolder.itemView.setTag(R.id.swipe_haptic_trigger, false) } catch (_: Exception) { }
                        // Persist manual order after a drag is released
                        if (SubscribedPodcastSortPreference.getSortOrder(this@MainActivity) ==
                            SubscribedPodcastSortPreference.SORT_MANUAL) {
                            val podcastsAdapter = recyclerView.adapter as? PodcastAdapter
                            if (podcastsAdapter != null) {
                                SubscribedPodcastSortPreference.setManualOrder(this@MainActivity, podcastsAdapter.getPodcasts().map { it.id })
                            }
                        }
                    }

                    override fun onChildDraw(c: android.graphics.Canvas, recyclerView: RecyclerView, viewHolder: RecyclerView.ViewHolder, dX: Float, dY: Float, actionState: Int, isCurrentlyActive: Boolean) {
                        if (actionState != ItemTouchHelper.ACTION_STATE_SWIPE) {
                            super.onChildDraw(c, recyclerView, viewHolder, dX, dY, actionState, isCurrentlyActive)
                            return
                        }
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
                podcastsItemTouchHelper = ItemTouchHelper(combinedCallback).also { helper ->
                    helper.attachToRecyclerView(favoritesPodcastsRecycler)
                    favPodcastAdapter.onStartDrag = { viewHolder -> helper.startDrag(viewHolder) }
                }
            } else {
                // Re-wire onStartDrag to the existing helper whenever the adapter is recreated
                val helper = podcastsItemTouchHelper
                if (helper != null) {
                    favPodcastAdapter.onStartDrag = { viewHolder -> helper.startDrag(viewHolder) }
                }
            }

            Thread {
                // ── Phase 1: instant render from local disk caches (no network I/O) ───────────
                // Reads the podcast list from the on-disk / bundled seed cache and the persisted
                // update timestamps.  Both are synchronous disk reads (< 50 ms) so the
                // subscription list appears almost immediately, without a visible loading spinner.
                val fastSubs = repo.getAvailablePodcastsNow().filter { subscribedIds.contains(it.id) }
                val fastUpdates = repo.getAvailableUpdatesNow(fastSubs)
                if (fastSubs.isNotEmpty()) {
                    val fastSorted = SubscribedPodcastSortPreference.applySortOrder(this, fastSubs, fastUpdates)
                    val fastNewSet = fastSorted.filter { p ->
                        (fastUpdates[p.id] ?: 0L) > PlayedEpisodesPreference.getLastPlayedEpoch(this, p.id)
                    }.map { it.id }.toSet()
                    runOnUiThread {
                        setSubscribedPodcastsLoading(false)
                        favPodcastAdapter.updatePodcasts(fastSorted)
                        favPodcastAdapter.updateNewEpisodes(fastNewSet)
                        val subscribedTabActive = (currentMode == "favorites" && isButtonChecked(R.id.fav_tab_subscribed))
                        if (subscribedTabActive) {
                            favoritesPodcastsRecycler.visibility = View.VISIBLE
                            favoritesPodcastsContainer.visibility = View.VISIBLE
                        }
                    }
                }

                // ── Phase 2: fetch fresh data ─────────────────────────────────────────────────
                // fetchLatestUpdates now runs all stale RSS lookups in parallel, so this
                // completes quickly even with many subscriptions.
                val all = try { kotlinx.coroutines.runBlocking { repo.fetchPodcasts(false) } } catch (e: Exception) { emptyList<Podcast>() }
                var subs = all.filter { subscribedIds.contains(it.id) }
                val updates = try { kotlinx.coroutines.runBlocking { repo.fetchLatestUpdates(subs) } } catch (e: Exception) { emptyMap<String, Long>() }
                subs = SubscribedPodcastSortPreference.applySortOrder(this, subs, updates)
                // Determine which subscriptions have unseen episodes (latest update > last played epoch)
                val newSet = subs.filter { p ->
                    val latest = updates[p.id] ?: 0L
                    val lastPlayed = PlayedEpisodesPreference.getLastPlayedEpoch(this, p.id)
                    latest > lastPlayed
                }.map { it.id }.toSet()
                runOnUiThread {
                    setSubscribedPodcastsLoading(false)
                    favPodcastAdapter.updatePodcasts(subs)
                    favPodcastAdapter.updateNewEpisodes(newSet)
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
                // Refresh playlist adapter played section when an episode's played status changes
                runOnUiThread {
                    val savedRecycler = try { findViewById<RecyclerView>(R.id.saved_episodes_recycler) } catch (_: Exception) { null }
                    (savedRecycler?.adapter as? PlaylistEpisodesAdapter)?.refreshPlayedState()
                }
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

    private val playlistChangedReceiver = object : android.content.BroadcastReceiver() {
        override fun onReceive(context: android.content.Context?, intent: android.content.Intent?) {
            try {
                runOnUiThread { refreshSavedEpisodesSection() }
            } catch (_: Exception) { }
        }
    }

    // BroadcastReceiver to refresh the Recent Songs tab when a new song is detected
    private val recentSongsChangedReceiver = object : android.content.BroadcastReceiver() {
        override fun onReceive(context: android.content.Context?, intent: android.content.Intent?) {
            try {
                runOnUiThread {
                    if (currentMode == "list" && currentTabIndex == 3) {
                        showRecentSongs()
                    }
                }
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
            findViewById<CircularProgressIndicator>(R.id.favorites_podcasts_loading).visibility = visibility
        } catch (_: Exception) { }
    }

    /**
     * Show the requested Favorites sub-tab. Extracted to class level so it can be called from
     * lifecycle methods (onResume) and other places outside the original local scope.
     */
    private fun showFavoritesTab(tab: String) {
        if (tab != "saved") {
            clearPlaylistEpisodeSelection()
        }
        when (tab) {
            "stations" -> {
                supportActionBar?.title = "Favourite Stations"
                invalidateOptionsMenu()
                refreshFavoriteStationsEmptyState()
                // Hide recent songs views so they don't persist into the blank space below favourite stations
                try { findViewById<View>(R.id.recent_songs_list).visibility = View.GONE } catch (_: Exception) { }
                try { findViewById<View>(R.id.recent_songs_empty).visibility = View.GONE } catch (_: Exception) { }
                try { findViewById<View>(R.id.favorites_podcasts_container).visibility = View.GONE } catch (_: Exception) { }
                try { findViewById<TextView>(R.id.favorites_podcasts_empty).visibility = View.GONE } catch (_: Exception) { }
                try { findViewById<View>(R.id.saved_episodes_container).visibility = View.GONE } catch (_: Exception) { }
                try { findViewById<TextView>(R.id.saved_episodes_empty).visibility = View.GONE } catch (_: Exception) { }
                try { findViewById<View>(R.id.saved_searches_container).visibility = View.GONE } catch (_: Exception) { }
                try { findViewById<View>(R.id.favorites_history_container).visibility = View.GONE } catch (_: Exception) { }
                try { findViewById<TextView>(R.id.favorites_history_empty).visibility = View.GONE } catch (_: Exception) { }
                try { findViewById<RecyclerView>(R.id.favorites_history_recycler).visibility = View.GONE } catch (_: Exception) { }
                updateVpnWarningBanner()
            }
            "subscribed" -> {
                supportActionBar?.title = "Subscribed Podcasts"
                invalidateOptionsMenu()
                stationsList.visibility = View.GONE
                try { findViewById<TextView>(R.id.favorite_stations_empty).visibility = View.GONE } catch (_: Exception) { }
                try { findViewById<View>(R.id.favorites_podcasts_container).visibility = View.VISIBLE } catch (_: Exception) { }
                try { findViewById<View>(R.id.saved_episodes_container).visibility = View.GONE } catch (_: Exception) { }
                try { findViewById<TextView>(R.id.saved_episodes_empty).visibility = View.GONE } catch (_: Exception) { }
                try { findViewById<View>(R.id.saved_searches_container).visibility = View.GONE } catch (_: Exception) { }
                try { findViewById<View>(R.id.favorites_history_container).visibility = View.GONE } catch (_: Exception) { }
                try { findViewById<TextView>(R.id.favorites_history_empty).visibility = View.GONE } catch (_: Exception) { }
                try { findViewById<RecyclerView>(R.id.saved_episodes_recycler).visibility = View.GONE } catch (_: Exception) { }

                // Show loading indicator while fetching subscribed podcasts
                val existingAdapter = try { findViewById<RecyclerView>(R.id.favorites_podcasts_recycler).adapter as? PodcastAdapter } catch (_: Exception) { null }
                if (existingAdapter == null || existingAdapter.itemCount == 0) {
                    setSubscribedPodcastsLoading(true)
                }
                updateVpnWarningBanner()

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

                        // Phase 1: instant render from local disk caches (no network I/O).
                        // Only needed when the adapter is empty (e.g. first switch to this tab
                        // before the initial background load has finished).
                        val rv = findViewById<RecyclerView>(R.id.favorites_podcasts_recycler)
                        val currentAdapter = rv.adapter as? PodcastAdapter
                        if (currentAdapter == null || currentAdapter.itemCount == 0) {
                            val fastSubs = repo.getAvailablePodcastsNow().filter { ids.contains(it.id) }
                            val fastUpdates = repo.getAvailableUpdatesNow(fastSubs)
                            if (fastSubs.isNotEmpty()) {
                                val fastSorted = SubscribedPodcastSortPreference.applySortOrder(this@MainActivity, fastSubs, fastUpdates)
                                val fastNewSet = fastSorted.filter { p ->
                                    (fastUpdates[p.id] ?: 0L) > PlayedEpisodesPreference.getLastPlayedEpoch(this@MainActivity, p.id)
                                }.map { it.id }.toSet()
                                runOnUiThread {
                                    setSubscribedPodcastsLoading(false)
                                    val adapter = rv.adapter as? PodcastAdapter
                                    adapter?.updatePodcasts(fastSorted)
                                    adapter?.updateNewEpisodes(fastNewSet)
                                    findViewById<TextView>(R.id.favorites_podcasts_empty).visibility = View.GONE
                                    rv.visibility = View.VISIBLE
                                }
                            }
                        }

                        // Phase 2: fetch fresh data (parallel network for stale cache entries).
                        val all = try { kotlinx.coroutines.runBlocking { repo.fetchPodcasts(false) } } catch (e: Exception) { emptyList<Podcast>() }
                        val podcasts = all.filter { ids.contains(it.id) }
                        val updates = try { kotlinx.coroutines.runBlocking { repo.fetchLatestUpdates(podcasts) } } catch (e: Exception) { emptyMap<String, Long>() }
                        val sorted = SubscribedPodcastSortPreference.applySortOrder(this@MainActivity, podcasts, updates)
                        val newSet = sorted.filter { p ->
                            val latest = updates[p.id] ?: 0L
                            val lastPlayed = PlayedEpisodesPreference.getLastPlayedEpoch(this@MainActivity, p.id)
                            latest > lastPlayed
                        }.map { it.id }.toSet()
                        runOnUiThread {
                            setSubscribedPodcastsLoading(false)
                            val adapter = rv.adapter as? PodcastAdapter
                            if (adapter != null) {
                                // Update the existing adapter in place — no need to recreate it.
                                adapter.updatePodcasts(sorted)
                                adapter.updateNewEpisodes(newSet)
                            } else {
                                // Adapter was removed (e.g. unsubscribed from all) — set up fresh.
                                rv.layoutManager = LinearLayoutManager(this@MainActivity)
                                val podcastAdapter = PodcastAdapter(this@MainActivity, onPodcastClick = { podcast ->
                                    supportActionBar?.show()
                                    fragmentContainer.visibility = View.VISIBLE
                                    staticContentContainer.visibility = View.GONE
                                    currentMode = "podcasts"
                                    returnToFavoritesOnBack = true
                                    disableSwipeNavigation()
                                    suppressBottomNavSelection = true
                                    try { bottomNavigation.selectedItemId = R.id.navigation_podcasts } catch (_: Exception) { }
                                    suppressBottomNavSelection = false
                                    updateActionBarTitle()
                                    updateFavoritesToggleVisibility()
                                    val detailFragment = PodcastDetailFragment().apply {
                                        arguments = android.os.Bundle().apply {
                                            putParcelable("podcast", podcast)
                                            putString("back_context", "favorites")
                                        }
                                    }
                                    supportFragmentManager.beginTransaction().apply {
                                        replace(R.id.fragment_container, detailFragment)
                                        addToBackStack(null)
                                        commit()
                                    }
                                }, highlightSubscribed = true, showSubscribedIcon = false)
                                val currentSort = SubscribedPodcastSortPreference.getSortOrder(this@MainActivity)
                                podcastAdapter.showDragHandles = (currentSort == SubscribedPodcastSortPreference.SORT_MANUAL)
                                val helper = podcastsItemTouchHelper
                                if (helper != null) {
                                    podcastAdapter.onStartDrag = { viewHolder -> helper.startDrag(viewHolder) }
                                }
                                rv.adapter = podcastAdapter
                                podcastAdapter.updatePodcasts(sorted)
                                podcastAdapter.updateNewEpisodes(newSet)
                            }
                            findViewById<TextView>(R.id.favorites_podcasts_empty).visibility = View.GONE
                            rv.visibility = View.VISIBLE
                        }
                    } catch (_: Exception) {
                        runOnUiThread { setSubscribedPodcastsLoading(false) }
                    }
                }.start()
            }
            "saved" -> {
                supportActionBar?.title = "Playlists"
                invalidateOptionsMenu()
                stationsList.visibility = View.GONE
                try { findViewById<TextView>(R.id.favorite_stations_empty).visibility = View.GONE } catch (_: Exception) { }
                try { findViewById<View>(R.id.favorites_podcasts_container).visibility = View.GONE } catch (_: Exception) { }
                try { findViewById<TextView>(R.id.favorites_podcasts_empty).visibility = View.GONE } catch (_: Exception) { }
                try { findViewById<View>(R.id.saved_episodes_container).visibility = View.VISIBLE } catch (_: Exception) { }
                try { findViewById<View>(R.id.saved_searches_container).visibility = View.GONE } catch (_: Exception) { }
                try { findViewById<View>(R.id.favorites_history_container).visibility = View.GONE } catch (_: Exception) { }
                try { findViewById<TextView>(R.id.favorites_history_empty).visibility = View.GONE } catch (_: Exception) { }
                try { findViewById<RecyclerView>(R.id.favorites_history_recycler).visibility = View.GONE } catch (_: Exception) { }
                try { refreshSavedEpisodesSection() } catch (_: Exception) { }
            }
            "searches" -> {
                supportActionBar?.title = "Saved Searches"
                invalidateOptionsMenu()
                stationsList.visibility = View.GONE
                try { findViewById<TextView>(R.id.favorite_stations_empty).visibility = View.GONE } catch (_: Exception) { }
                try { findViewById<View>(R.id.favorites_podcasts_container).visibility = View.GONE } catch (_: Exception) { }
                try { findViewById<TextView>(R.id.favorites_podcasts_empty).visibility = View.GONE } catch (_: Exception) { }
                try { findViewById<View>(R.id.saved_episodes_container).visibility = View.GONE } catch (_: Exception) { }
                try { findViewById<TextView>(R.id.saved_episodes_empty).visibility = View.GONE } catch (_: Exception) { }
                try { findViewById<View>(R.id.saved_searches_container).visibility = View.VISIBLE } catch (_: Exception) { }
                try { findViewById<TextView>(R.id.saved_searches_title).visibility = View.GONE } catch (_: Exception) { }
                try { findViewById<View>(R.id.favorites_history_container).visibility = View.GONE } catch (_: Exception) { }
                try { findViewById<TextView>(R.id.favorites_history_empty).visibility = View.GONE } catch (_: Exception) { }
                try { findViewById<RecyclerView>(R.id.saved_episodes_recycler).visibility = View.GONE } catch (_: Exception) { }
                try { findViewById<RecyclerView>(R.id.favorites_history_recycler).visibility = View.GONE } catch (_: Exception) { }
                try { refreshSavedSearchesSection() } catch (_: Exception) { }
            }
            "history" -> {
                supportActionBar?.title = "History"
                invalidateOptionsMenu()
                stationsList.visibility = View.GONE
                try { findViewById<TextView>(R.id.favorite_stations_empty).visibility = View.GONE } catch (_: Exception) { }
                try { findViewById<View>(R.id.favorites_podcasts_container).visibility = View.GONE } catch (_: Exception) { }
                try { findViewById<TextView>(R.id.favorites_podcasts_empty).visibility = View.GONE } catch (_: Exception) { }
                try { findViewById<View>(R.id.saved_episodes_container).visibility = View.GONE } catch (_: Exception) { }
                try { findViewById<TextView>(R.id.saved_episodes_empty).visibility = View.GONE } catch (_: Exception) { }
                try { findViewById<View>(R.id.saved_searches_container).visibility = View.GONE } catch (_: Exception) { }
                try { findViewById<View>(R.id.favorites_history_container).visibility = View.VISIBLE } catch (_: Exception) { }
                try { findViewById<RecyclerView>(R.id.favorites_history_recycler).visibility = View.VISIBLE } catch (_: Exception) { }
                // Always refresh the history contents when the tab becomes active
                try { refreshHistorySection(); findViewById<RecyclerView>(R.id.favorites_history_recycler).scrollToPosition(0) } catch (_: Exception) { }
            }
        }
        updateVpnWarningBanner()
    }

    override fun onStart() {
        super.onStart()
        registerVpnStatusMonitoring()
        updateVpnWarningBanner()
        val receiverFlags = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
            android.content.Context.RECEIVER_NOT_EXPORTED
        } else 0
        try {
            registerReceiver(playedStatusReceiver, android.content.IntentFilter(PlayedEpisodesPreference.ACTION_PLAYED_STATUS_CHANGED), receiverFlags)
        } catch (_: Exception) {}
        try {
            registerReceiver(historyChangedReceiver, android.content.IntentFilter(PlayedHistoryPreference.ACTION_HISTORY_CHANGED), receiverFlags)
        } catch (_: Exception) {}
        try {
            registerReceiver(playlistChangedReceiver, android.content.IntentFilter(PodcastPlaylists.ACTION_PLAYLISTS_CHANGED), receiverFlags)
        } catch (_: Exception) {}
        try {
            registerReceiver(downloadCompleteReceiver, android.content.IntentFilter(EpisodeDownloadManager.ACTION_DOWNLOAD_COMPLETE), receiverFlags)
        } catch (_: Exception) {}
        try {
            registerReceiver(recentSongsChangedReceiver, android.content.IntentFilter(RecentSongsPreference.ACTION_RECENT_SONGS_CHANGED), receiverFlags)
        } catch (_: Exception) {}
    }



    override fun onStop() {
        super.onStop()
        unregisterVpnStatusMonitoring()
        try {
            unregisterReceiver(playedStatusReceiver)
        } catch (_: Exception) {}
        try {
            unregisterReceiver(historyChangedReceiver)
        } catch (_: Exception) {}
        try {
            unregisterReceiver(playlistChangedReceiver)
        } catch (_: Exception) {}
        try {
            unregisterReceiver(downloadCompleteReceiver)
        } catch (_: Exception) {}
        try {
            unregisterReceiver(recentSongsChangedReceiver)
        } catch (_: Exception) {}
    }

    private fun showSettings() {
        // Ensure history UI is hidden when navigating away from Favorites
        hideHistoryViews()
        clearPlaylistEpisodeSelection()
        // Disable swipe navigation in Settings
        disableSwipeNavigation()
        currentMode = "settings"
        invalidateOptionsMenu()
        fragmentContainer.visibility = View.GONE
        staticContentContainer.visibility = View.VISIBLE
        stationsView.visibility = View.GONE
        updateVpnWarningBanner()
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
        clearPlaylistEpisodeSelection()
        // Disable swipe navigation in Podcasts
        disableSwipeNavigation()
        currentMode = "podcasts"
        returnToFavoritesOnBack = false
        returnToSavedSearchesOnBack = false
        returnToScheduleOnBack = false
        scheduleReturnStationId = null
        scheduleReturnStationTitle = null
        fragmentContainer.visibility = View.VISIBLE
        staticContentContainer.visibility = View.GONE
        // Hide the global action bar since the fragment has its own title bar
        supportActionBar?.hide()
        // Hide favourites toggle group when viewing podcasts
        try { updateFavoritesToggleVisibility() } catch (_: Exception) { }

        val fm = supportFragmentManager

        // If we're already showing the browse Podcasts list with no detail on top, reset any
        // stale search state (e.g. after returning from Favorites where a saved search was run)
        // so the default browse view is shown.
        // NOTE: a search-context PodcastsFragment (isSearchContextMode() == true) must NOT be
        // given the early-return shortcut — it needs to be replaced by the browse fragment below.
        val existingVisible = fm.findFragmentById(R.id.fragment_container)
        if (existingVisible is PodcastsFragment && !existingVisible.isSearchContextMode() && fm.backStackEntryCount == 0) {
            existingVisible.resetToDefaultBrowse()
            return
        }

        // Clear ALL back stack entries synchronously.  A single pop is not sufficient when the
        // user navigated through multiple podcast screens (e.g. Podcasts → Search → Search
        // Results), which leaves 2+ entries.  Any stale entry causes syncActionBarVisibility()
        // to show the activity action bar on top of PodcastsFragment's own toolbar, producing
        // a duplicate "Podcasts" header.
        if (fm.backStackEntryCount > 0) {
            try { fm.popBackStackImmediate(null, androidx.fragment.app.FragmentManager.POP_BACK_STACK_INCLUSIVE) } catch (_: Exception) { }
        }

        // After clearing the back stack the fragment manager may have restored the browse
        // PodcastsFragment to the container.  Reuse it rather than replacing it unnecessarily
        // (which would reset its view state).
        val afterPopVisible = fm.findFragmentById(R.id.fragment_container)
        if (afterPopVisible is PodcastsFragment && !afterPopVisible.isSearchContextMode()) {
            afterPopVisible.resetToDefaultBrowse()
            return
        }

        // Ensure a browse PodcastsFragment exists in the container.
        // If a search-context fragment is currently showing (e.g. from a saved-search opened via
        // Favorites → Saved Searches), it will be replaced here by the browse fragment.
        val searchContextShowing = (afterPopVisible as? PodcastsFragment)?.isSearchContextMode() == true
        val existing = fm.findFragmentByTag("podcasts_fragment") as? PodcastsFragment
        if (existing == null || searchContextShowing) {
            // Reuse the browse PF if it's still a distinct object (wasn't the search-context PF
            // itself). In practice existing is null here because replace() destroyed the browse PF.
            val podcastsFragment = if (existing != null && existing !== afterPopVisible) existing else PodcastsFragment()
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

    private fun handleOpenEpisodeNotificationIntent(intent: Intent?) {
        val episode = intent?.getParcelableExtraCompat<Episode>("open_episode", Episode::class.java) ?: return
        intent.removeExtra("open_episode")
        try {
            val podcastTitle = intent.getStringExtra("open_podcast_title") ?: ""
            val podcastImage = intent.getStringExtra("open_podcast_image") ?: ""
            val openIntent = Intent(this, NowPlayingActivity::class.java).apply {
                putExtra("preview_episode", episode)
                putExtra("preview_use_play_ui", true)
                putExtra("preview_podcast_title", podcastTitle)
                putExtra("preview_podcast_image", podcastImage)
                putExtra("initial_podcast_title", podcastTitle)
                putExtra("initial_podcast_image", podcastImage)
            }
            startActivity(openIntent)
        } catch (e: Exception) {
            android.util.Log.e("MainActivity", "Error handling open episode notification intent", e)
        }
    }

    private fun handleOpenPodcastIntent(intent: Intent?) {
        val podcastId = intent?.getStringExtra("open_podcast_id") ?: return
        // Check if this navigation came from the radio schedule or Favourites so back can return there
        val backSource = intent.getStringExtra("back_source")
        val fromSchedule = backSource == "schedule"
        val fromFavorites = backSource == "favorites"
        val scheduleStationId = if (fromSchedule) intent.getStringExtra("schedule_station_id") else null
        val scheduleStationTitle = if (fromSchedule) intent.getStringExtra("schedule_station_title") else null
        // Capture the current mode BEFORE showPodcasts() changes it to "podcasts", and only on a
        // fresh schedule→podcast navigation (not re-entry from NowPlayingActivity where
        // returnToScheduleOnBack is already true).
        val isFreshScheduleNav = fromSchedule && !returnToScheduleOnBack
        val originModeSnapshot = currentMode
        // Ensure podcasts UI is shown
        showPodcasts()
        if (fromSchedule && !scheduleStationId.isNullOrEmpty()) {
            returnToScheduleOnBack = true
            scheduleReturnStationId = scheduleStationId
            scheduleReturnStationTitle = scheduleStationTitle
            if (isFreshScheduleNav) {
                // Persist where the user came from so we can restore it when they back out past the Schedule
                scheduleReturnOriginMode = if (originModeSnapshot == "favorites") "favorites" else "list"
            }
        } else if (fromFavorites) {
            returnToFavoritesOnBack = true
        }
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
                        arguments = android.os.Bundle().apply {
                            putParcelable("podcast", match)
                            if (fromSchedule) {
                                putString("back_context", "schedule")
                                putString("back_context_station_id", scheduleStationId ?: "")
                                putString("back_context_station_title", scheduleStationTitle ?: "")
                            } else if (fromFavorites) {
                                putString("back_context", "favorites")
                            }
                        }
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

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menuInflater.inflate(R.menu.top_app_bar_menu, menu)
        return true
    }

    override fun onPrepareOptionsMenu(menu: Menu): Boolean {
        val sortItem = menu.findItem(R.id.action_subscribed_sort)
        sortItem?.isVisible = currentMode == "favorites" && isButtonChecked(R.id.fav_tab_subscribed)
        val playlistMoreItem = menu.findItem(R.id.action_playlist_more)
        playlistMoreItem?.isVisible = currentMode == "favorites" && isButtonChecked(R.id.fav_tab_saved)
        val createPlaylistItem = menu.findItem(R.id.action_create_playlist)
        createPlaylistItem?.isVisible = currentMode == "favorites" && isButtonChecked(R.id.fav_tab_saved)
        return super.onPrepareOptionsMenu(menu)
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        return when (item.itemId) {
            android.R.id.home -> {
                if (currentMode == "favorites" && isButtonChecked(R.id.fav_tab_saved) && activePlaylistId != null) {
                    activePlaylistId = null
                    refreshSavedEpisodesSection()
                    true
                } else {
                    super.onOptionsItemSelected(item)
                }
            }
            R.id.action_subscribed_sort -> {
                val toolbar = findViewById<com.google.android.material.appbar.MaterialToolbar>(R.id.top_app_bar)
                val anchor = toolbar?.findViewById<View>(R.id.action_subscribed_sort) ?: toolbar
                if (anchor != null) {
                    showSubscribedSortMenu(anchor)
                }
                true
            }
            R.id.action_create_playlist -> {
                showCreatePlaylistDialog()
                true
            }
            R.id.action_playlist_more -> {
                val toolbar = findViewById<com.google.android.material.appbar.MaterialToolbar>(R.id.top_app_bar)
                val anchor = toolbar?.findViewById<View>(R.id.action_playlist_more) ?: toolbar
                if (anchor != null) {
                    showPlaylistsOverflowMenu(anchor)
                }
                true
            }
            else -> super.onOptionsItemSelected(item)
        }
    }

    /**
     * Show a popup menu anchored to [anchor] with all four sort options for subscribed podcasts.
     * The currently active sort option is shown as checked.
     */
    private fun showSubscribedSortMenu(anchor: View) {
        val popup = PopupMenu(this, anchor)
        val groupId = 1
        popup.menu.apply {
            add(groupId, 1, 0, "Most recently updated")
            add(groupId, 2, 1, "Least recently updated")
            add(groupId, 3, 2, "Alphabetical (A-Z)")
            add(groupId, 4, 3, "Manual sort")
            setGroupCheckable(groupId, true, true)
        }
        val current = SubscribedPodcastSortPreference.getSortOrder(this)
        val checkedId = when (current) {
            SubscribedPodcastSortPreference.SORT_MOST_RECENTLY_UPDATED -> 1
            SubscribedPodcastSortPreference.SORT_LEAST_RECENTLY_UPDATED -> 2
            SubscribedPodcastSortPreference.SORT_ALPHABETICAL -> 3
            SubscribedPodcastSortPreference.SORT_MANUAL -> 4
            else -> 1
        }
        popup.menu.findItem(checkedId)?.isChecked = true
        popup.setOnMenuItemClickListener { menuItem ->
            val newSort = when (menuItem.itemId) {
                1 -> SubscribedPodcastSortPreference.SORT_MOST_RECENTLY_UPDATED
                2 -> SubscribedPodcastSortPreference.SORT_LEAST_RECENTLY_UPDATED
                3 -> SubscribedPodcastSortPreference.SORT_ALPHABETICAL
                4 -> SubscribedPodcastSortPreference.SORT_MANUAL
                else -> return@setOnMenuItemClickListener false
            }
            SubscribedPodcastSortPreference.setSortOrder(this, newSort)
            applySubscribedPodcastSort(newSort)
            true
        }
        popup.show()
    }

    /**
     * Re-sort the subscribed podcasts adapter and toggle drag handles based on [sortOrder].
     * When switching to manual sort the existing display order is saved as the manual order.
     */
    private fun applySubscribedPodcastSort(sortOrder: String) {
        try {
            val rv = findViewById<RecyclerView>(R.id.favorites_podcasts_recycler) ?: return
            val adapter = rv.adapter as? PodcastAdapter ?: return
            val isManual = sortOrder == SubscribedPodcastSortPreference.SORT_MANUAL
            if (isManual) {
                val existingManual = SubscribedPodcastSortPreference.getManualOrder(this)
                if (existingManual.isEmpty()) {
                    // No saved manual order yet — snapshot the current display order
                    SubscribedPodcastSortPreference.setManualOrder(this, adapter.getPodcasts().map { it.id })
                } else {
                    // Restore the previously saved manual order
                    val podcasts = adapter.getPodcasts()
                    val orderMap = existingManual.mapIndexed { idx, id -> id to idx }.toMap()
                    val sorted = podcasts.sortedWith(compareBy { orderMap[it.id] ?: Int.MAX_VALUE })
                    adapter.updatePodcasts(sorted)
                }
                adapter.showDragHandles = true
            } else {
                adapter.showDragHandles = false
                // Re-sort the currently loaded podcasts using locally cached timestamps.
                // This is instant and works offline — no network re-fetch needed.
                val podcasts = adapter.getPodcasts()
                if (podcasts.isNotEmpty()) {
                    Thread {
                        try {
                            val repo = PodcastRepository(this)
                            val updates = repo.getAvailableUpdatesNow(podcasts)
                            val sorted = SubscribedPodcastSortPreference.applySortOrder(this, podcasts, updates)
                            runOnUiThread { adapter.updatePodcasts(sorted) }
                        } catch (e: Exception) {
                            android.util.Log.w("MainActivity", "Failed to re-sort subscribed podcasts: ${e.message}")
                        }
                    }.start()
                }
            }
        } catch (e: Exception) {
            android.util.Log.w("MainActivity", "applySubscribedPodcastSort failed: ${e.message}")
        }
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
            R.id.fav_tab_saved to "Playlists",
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

            android.util.Log.w("MainActivity", "TabLayout not found after retry; filter buttons disabled")
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

                // If the stations content isn't laid out (width == 0), fall back to immediate update
                val wasSwipeSelection = selectionFromSwipe
                if (wasSwipeSelection) selectionFromSwipe = false
                val slowTransition = !wasSwipeSelection

                if (newIndex == 3) {
                    // Songs tab — use a simple fade rather than the station-list slide animation
                    // because the animation code hardcodes stationsList visibility
                    showRecentSongs()
                } else {
                    val category = when (newIndex) {
                        0 -> StationCategory.NATIONAL
                        1 -> StationCategory.REGIONS
                        2 -> StationCategory.LOCAL
                        else -> StationCategory.NATIONAL
                    }
                    if (stationsContent.width <= 0) {
                        android.util.Log.d("MainActivity", "stationsContent not laid out yet; updating immediately")
                        showCategoryStations(category)
                    } else {
                        animateListTransition(direction, {
                            showCategoryStations(category)
                        }, slowTransition)
                    }
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

        // Clean up any previous overlay immediately to prevent memory accumulation during rapid tab switches
        activeOverlayView?.let { prev ->
            prev.animate().cancel()
            try { (prev.parent as? android.view.ViewGroup)?.removeView(prev) } catch (_: Exception) {}
            if (prev is ImageView) {
                val bmp = (prev.drawable as? android.graphics.drawable.BitmapDrawable)?.bitmap
                prev.setImageDrawable(null)
                try { bmp?.recycle() } catch (_: Exception) {}
            }
        }
        activeOverlayView = null

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
        activeOverlayView = overlayView

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
                    // Remove overlay, clear active reference, and recycle bitmap
                    if (activeOverlayView === overlayView) activeOverlayView = null
                    try {
                        parent?.removeView(overlayView)
                    } catch (_: Exception) {}
                    (overlayView as? ImageView)?.let { iv ->
                        val bmp = (iv.drawable as? android.graphics.drawable.BitmapDrawable)?.bitmap
                        iv.setImageDrawable(null)
                        try { bmp?.recycle() } catch (_: Exception) {}
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
        // Hide recent songs views; show station list
        try { findViewById<View>(R.id.recent_songs_list).visibility = View.GONE } catch (_: Exception) { }
        try { findViewById<View>(R.id.recent_songs_empty).visibility = View.GONE } catch (_: Exception) { }
        stationsList.visibility = View.VISIBLE
        // Reuse the cached adapter for this category to avoid repeated network requests and GC pressure
        val adapter = categoryAdapters.getOrPut(category) {
            val stations = StationRepository.getStationsByCategory(category)
            CategorizedStationAdapter(this, stations, { stationId ->
                playStation(stationId)
            }, { _ ->
                // Do nothing to prevent list jump
            })
        }
        categorizedAdapter = adapter
        stationsList.adapter = adapter
        stationsList.scrollToPosition(0)
    }

    private fun showRecentSongs() {
        android.util.Log.d("MainActivity", "showRecentSongs")
        // Hide the station list; show recent songs
        stationsList.visibility = View.GONE
        try { findViewById<TextView>(R.id.favorite_stations_empty).visibility = View.GONE } catch (_: Exception) { }

        val recentSongsList = try { findViewById<RecyclerView>(R.id.recent_songs_list) } catch (_: Exception) { null } ?: return
        val recentSongsEmpty = try { findViewById<TextView>(R.id.recent_songs_empty) } catch (_: Exception) { null }

        val songs = RecentSongsPreference.getSongs(this)
        if (songs.isEmpty()) {
            recentSongsList.visibility = View.GONE
            recentSongsEmpty?.visibility = View.VISIBLE
        } else {
            recentSongsEmpty?.visibility = View.GONE
            recentSongsList.visibility = View.VISIBLE
            if (recentSongsList.layoutManager == null) {
                recentSongsList.layoutManager = LinearLayoutManager(this)
            }
            val existing = recentSongsList.adapter as? RecentSongsAdapter
            if (existing != null) {
                existing.updateSongs(songs)
            } else {
                recentSongsList.adapter = RecentSongsAdapter(this, songs) { song ->
                    showStreamingLinksDialog(song)
                }
            }
        }
    }

    private fun showStreamingLinksDialog(song: RecentSongsPreference.SongEntry) {
        val query = buildString {
            if (song.artist.isNotBlank()) append(song.artist)
            if (song.artist.isNotBlank() && song.track.isNotBlank()) append(" ")
            if (song.track.isNotBlank()) append(song.track)
        }.trim()
        if (query.isBlank()) return

        val encodedQuery = android.net.Uri.encode(query)
        val title = buildString {
            if (song.track.isNotBlank()) append(song.track)
            if (song.track.isNotBlank() && song.artist.isNotBlank()) append(" · ")
            if (song.artist.isNotBlank()) append(song.artist)
        }

        data class StreamingService(val name: String, val iconUrl: String, val searchUrl: String)
        data class Holder(val icon: ImageView, val name: TextView)

        val services = listOf(
            StreamingService("Spotify",
                "https://www.google.com/s2/favicons?domain=open.spotify.com&sz=128",
                "https://open.spotify.com/search/$encodedQuery"),
            StreamingService("YouTube Music",
                "https://www.google.com/s2/favicons?domain=music.youtube.com&sz=128",
                "https://music.youtube.com/search?q=$encodedQuery"),
            StreamingService("Amazon Music",
                "https://www.google.com/s2/favicons?domain=music.amazon.co.uk&sz=128",
                "https://music.amazon.co.uk/search/$encodedQuery"),
            StreamingService("Apple Music",
                "https://www.google.com/s2/favicons?domain=music.apple.com&sz=128",
                "https://music.apple.com/gb/search?term=$encodedQuery"),
            StreamingService("Deezer",
                "https://www.google.com/s2/favicons?domain=deezer.com&sz=128",
                "https://www.deezer.com/search/$encodedQuery")
        )

        val adapter = object : android.widget.ArrayAdapter<StreamingService>(
            this, R.layout.item_streaming_service, R.id.streaming_service_name, services) {

            override fun getView(position: Int, convertView: View?, parent: android.view.ViewGroup): View {
                val view: View
                val holder: Holder
                if (convertView == null) {
                    view = layoutInflater.inflate(R.layout.item_streaming_service, parent, false)
                    holder = Holder(
                        view.findViewById(R.id.streaming_service_icon),
                        view.findViewById(R.id.streaming_service_name)
                    )
                    view.tag = holder
                } else {
                    view = convertView
                    holder = convertView.tag as Holder
                }
                val service = getItem(position)!!
                holder.name.text = service.name
                Glide.with(this@MainActivity)
                    .load(service.iconUrl)
                    .placeholder(R.drawable.ic_music_note)
                    .error(R.drawable.ic_music_note)
                    .into(holder.icon)
                return view
            }
        }

        androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("Listen to: $title")
            .setAdapter(adapter) { _, which ->
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse(services[which].searchUrl)))
                } catch (_: Exception) {
                    Toast.makeText(this, "Could not open link", Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton("Close", null)
            .show()
    }

    private fun setupSwipeNavigation() {
        // Swipe-to-navigate between tabs is disabled; just ensure any existing listener is removed.
        disableSwipeNavigation()
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

        // Defensive restore for OEM/device wake paths that leave the app bar hidden.
        window.decorView.post { restoreTopAppBarState() }
        
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
        updateVpnWarningBanner()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            window.decorView.post { restoreTopAppBarState() }
        }
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
        if (savedSearchDateRefreshJob?.isActive == true) {
            // If there are newly saved searches with no date yet, cancel the current job so the
            // new job (started below) picks them up. Searches with genuine zero results also have
            // lastMatchEpoch == 0, but re-running is harmless and ensures the UI stays up-to-date.
            val searches = SavedSearchesPreference.getSavedSearches(this)
            if (searches.none { it.lastMatchEpoch == 0L && it.query.isNotBlank() }) return
            savedSearchDateRefreshJob?.cancel()
        }

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
        outState.putBoolean("vpnWarningDismissed", vpnWarningDismissed)
    }

    private fun openNowPlaying() {
        val intent = Intent(this, NowPlayingActivity::class.java).apply {
            // Tell NowPlaying where we are so it can return to the correct view on back
            putExtra("origin_mode", currentMode)
            // Pass the current back context so NowPlayingActivity can relay it when returning to a podcast detail
            if (returnToFavoritesOnBack) {
                putExtra("back_context", "favorites")
            } else if (returnToScheduleOnBack) {
                putExtra("back_context", "schedule")
                putExtra("back_context_station_id", scheduleReturnStationId ?: "")
                putExtra("back_context_station_title", scheduleReturnStationTitle ?: "")
            }
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
            val isBuffering = PlaybackStateHelper.getIsBuffering()
            val showName = show.title.ifEmpty { station.title }
            val hasSongData = !show.secondary.isNullOrEmpty() || !show.tertiary.isNullOrEmpty()
            val showDesc = PlaybackStateHelper.getCurrentShow().episodeTitle?.takeIf { it.isNotEmpty() }
                ?: show.secondary?.takeIf { it.isNotEmpty() }
                ?: show.getFormattedTitle().takeIf { it.isNotEmpty() }
                ?: ""
            val resolvedTitle = when {
                hasSongData -> show.getFormattedTitle() // Artist - Track only
                showName.isNotEmpty() && showDesc.isNotEmpty() && showDesc != showName -> "$showName - $showDesc"
                else -> showDesc.ifEmpty { showName }
            }
            val newTitle = if (isBuffering) getString(R.string.loading_stream) else resolvedTitle
            if (miniPlayerSubtitle.text.toString() != newTitle) {
                miniPlayerSubtitle.text = newTitle
                miniPlayerSubtitle.isSelected = true // Trigger marquee/scroll
                miniPlayerSubtitle.startScrolling()
            }
            
            // Load artwork:
            // - Podcasts: use episode/podcast image URL
            // - Radio with song playing (hasSongData && imageUrl valid): use song artwork from feed
            // - Radio with no song playing: show generic station artwork (no BBC branding)
            val isPodcast = station.id.startsWith("podcast_")
            if (isPodcast) {
                val podArtworkUrl = show.imageUrl?.takeIf { it.startsWith("http") }
                if (podArtworkUrl != null && podArtworkUrl != lastArtworkUrl) {
                    lastArtworkUrl = podArtworkUrl
                    Glide.with(this)
                        .load(podArtworkUrl)
                        .placeholder(android.R.color.transparent)
                        .into(miniPlayerArtwork)
                    Log.d("MainActivity", "Loading podcast artwork from: $podArtworkUrl")
                }
            } else if (hasSongData && !show.imageUrl.isNullOrEmpty() && show.imageUrl.startsWith("http")) {
                val songArtworkUrl = show.imageUrl
                if (songArtworkUrl != lastArtworkUrl) {
                    lastArtworkUrl = songArtworkUrl
                    Glide.with(this)
                        .load(songArtworkUrl)
                        .placeholder(StationArtwork.createDrawable(station.id))
                        .error(StationArtwork.createDrawable(station.id))
                        .listener(object : RequestListener<Drawable> {
                            override fun onLoadFailed(e: GlideException?, model: Any?, target: Target<Drawable>?, isFirstResource: Boolean): Boolean = false
                            override fun onResourceReady(resource: Drawable?, model: Any?, target: Target<Drawable>?, dataSource: DataSource?, isFirstResource: Boolean): Boolean {
                                if (resource is BitmapDrawable && isPlaceholderImage(resource.bitmap)) {
                                    miniPlayerArtwork.setImageDrawable(StationArtwork.createDrawable(station.id))
                                    return true
                                }
                                return false
                            }
                        })
                        .into(miniPlayerArtwork)
                    Log.d("MainActivity", "Loading song artwork from: $songArtworkUrl")
                }
            } else {
                val genericKey = "generic:${station.id}"
                if (genericKey != lastArtworkUrl) {
                    lastArtworkUrl = genericKey
                    miniPlayerArtwork.setImageDrawable(StationArtwork.createDrawable(station.id))
                }
            }
            
            // Update play/pause button - always show the correct state
            miniPlayerPlayPause.setImageResource(if (isPlaying) R.drawable.ic_pause else R.drawable.ic_play_arrow)

            // Sync progress bar: only shown for podcasts with valid progress data.
            // This ensures the bar is always hidden when switching to a radio station,
            // even if the show-change listener fired while the view was temporarily detached.
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
        val resolvedTitle = if (showName.isNotEmpty() && showDesc.isNotEmpty() && showDesc != showName) "$showName - $showDesc" else (showDesc.ifEmpty { showName })
        val newTitle = if (PlaybackStateHelper.getIsBuffering()) getString(R.string.loading_stream) else resolvedTitle
        if (miniPlayerSubtitle.text.toString() != newTitle) {
            miniPlayerSubtitle.text = newTitle
            miniPlayerSubtitle.isSelected = true
            miniPlayerSubtitle.startScrolling()
        }
        
        // Load artwork:
        // - Podcasts: use episode/podcast image URL
        // - Radio with song playing (artist/track data present): use song artwork from feed
        // - Radio with no song playing: show generic station artwork (no BBC branding)
        val isPodcastStation = currentStation?.id?.startsWith("podcast_") == true
        if (isPodcastStation) {
            val podArtworkUrl = show.imageUrl?.takeIf { it.startsWith("http") }
            if (podArtworkUrl != null && podArtworkUrl != lastArtworkUrl) {
                lastArtworkUrl = podArtworkUrl
                Glide.with(this)
                    .load(podArtworkUrl)
                    .placeholder(android.R.color.transparent)
                    .into(miniPlayerArtwork)
                Log.d("MainActivity", "Loading podcast artwork from: $podArtworkUrl")
            }
        } else if (currentStation != null) {
            val hasSongArtwork = (!show.secondary.isNullOrEmpty() || !show.tertiary.isNullOrEmpty()) &&
                !show.imageUrl.isNullOrEmpty() && show.imageUrl.startsWith("http")
            if (hasSongArtwork) {
                val songArtworkUrl = show.imageUrl
                if (songArtworkUrl != lastArtworkUrl) {
                    lastArtworkUrl = songArtworkUrl
                    Glide.with(this)
                        .load(songArtworkUrl)
                        .placeholder(StationArtwork.createDrawable(currentStation.id))
                        .error(StationArtwork.createDrawable(currentStation.id))
                        .listener(object : RequestListener<Drawable> {
                            override fun onLoadFailed(e: GlideException?, model: Any?, target: Target<Drawable>?, isFirstResource: Boolean): Boolean = false
                            override fun onResourceReady(resource: Drawable?, model: Any?, target: Target<Drawable>?, dataSource: DataSource?, isFirstResource: Boolean): Boolean {
                                if (resource is BitmapDrawable && isPlaceholderImage(resource.bitmap)) {
                                    miniPlayerArtwork.setImageDrawable(StationArtwork.createDrawable(currentStation.id))
                                    return true
                                }
                                return false
                            }
                        })
                        .into(miniPlayerArtwork)
                    Log.d("MainActivity", "Loading song artwork from: $songArtworkUrl")
                }
            } else {
                val genericKey = "generic:${currentStation.id}"
                if (genericKey != lastArtworkUrl) {
                    lastArtworkUrl = genericKey
                    miniPlayerArtwork.setImageDrawable(StationArtwork.createDrawable(currentStation.id))
                }
            }
        }

        // Show episode progress only for podcast playback
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
        unregisterUpdateReceiver()
        super.onDestroy()
        PlaybackStateHelper.removeShowChangeListener(showChangeListener)
        supportFragmentManager.removeOnBackStackChangedListener(backStackListener)
    }

    private fun maybeAutoCheckForGitHubUpdates() {
        if (!BuildConfig.ENABLE_GITHUB_UPDATER) return

        val prefs = getSharedPreferences(GITHUB_UPDATE_PREFS, MODE_PRIVATE)
        val now = System.currentTimeMillis()
        val lastCheckAt = prefs.getLong(KEY_LAST_AUTO_CHECK_AT, 0L)
        if (now - lastCheckAt < AUTO_UPDATE_CHECK_INTERVAL_MS) return

        prefs.edit().putLong(KEY_LAST_AUTO_CHECK_AT, now).apply()

        lifecycleScope.launch {
            kotlinx.coroutines.delay(1500)

            val currentVersion = try {
                packageManager.getPackageInfo(packageName, 0).versionName ?: return@launch
            } catch (_: Exception) {
                return@launch
            }

            val latestRelease = GitHubAppUpdater.fetchLatestRelease() ?: return@launch
            if (!GitHubAppUpdater.isUpdateAvailable(currentVersion, latestRelease.version)) return@launch

            val lastDeclinedVersion = prefs.getString(KEY_LAST_DECLINED_VERSION, null)
            if (lastDeclinedVersion == latestRelease.version) return@launch

            showGitHubUpdateDialog(latestRelease, prefs)
        }
    }

    private fun showGitHubUpdateDialog(releaseInfo: GitHubReleaseInfo, prefs: android.content.SharedPreferences) {
        if (isFinishing || isDestroyed) return

        AlertDialog.Builder(this)
            .setTitle("Update available")
            .setMessage("Version ${releaseInfo.version} is available. Download and install now?")
            .setPositiveButton("Download") { _, _ ->
                try {
                    val downloadId = GitHubAppUpdater.enqueueApkDownload(this, releaseInfo)
                    updateDownloadId = downloadId
                    registerUpdateReceiver()
                    prefs.edit().remove(KEY_LAST_DECLINED_VERSION).apply()
                    Toast.makeText(this, getString(R.string.update_download_started), Toast.LENGTH_SHORT).show()
                } catch (_: Exception) {
                    Toast.makeText(this, getString(R.string.update_check_failed), Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton("Later") { _, _ ->
                prefs.edit().putString(KEY_LAST_DECLINED_VERSION, releaseInfo.version).apply()
            }
            .show()
    }

    private fun registerUpdateReceiver() {
        if (updateDownloadReceiver != null) return

        updateDownloadReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (intent.action != DownloadManager.ACTION_DOWNLOAD_COMPLETE) return

                val completedId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L)
                if (completedId <= 0 || completedId != updateDownloadId) return

                val apkUri = GitHubAppUpdater.getDownloadedApkUri(this@MainActivity, completedId)
                if (apkUri == null) {
                    Toast.makeText(this@MainActivity, getString(R.string.update_download_failed), Toast.LENGTH_SHORT).show()
                    return
                }

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !packageManager.canRequestPackageInstalls()) {
                    val settingsIntent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
                        data = Uri.parse("package:$packageName")
                    }
                    startActivity(settingsIntent)
                    Toast.makeText(this@MainActivity, "Allow installs from this app, then run update again.", Toast.LENGTH_LONG).show()
                    return
                }

                val installIntent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(apkUri, "application/vnd.android.package-archive")
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }

                try {
                    startActivity(installIntent)
                } catch (_: Exception) {
                    Toast.makeText(this@MainActivity, getString(R.string.update_download_failed), Toast.LENGTH_SHORT).show()
                }
            }
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(updateDownloadReceiver, IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE), RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(updateDownloadReceiver, IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE))
        }
    }

    private fun unregisterUpdateReceiver() {
        val receiver = updateDownloadReceiver ?: return
        try {
            unregisterReceiver(receiver)
        } catch (_: Exception) {
        } finally {
            updateDownloadReceiver = null
            updateDownloadId = null
        }
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
            val names = listOf("favorites_prefs", "podcast_subscriptions", "saved_episodes_prefs", "podcast_playlists_prefs", "saved_searches_prefs", "played_episodes_prefs", "played_history_prefs", "playback_prefs", "scrolling_prefs", "index_prefs", "subscription_refresh_prefs", "podcast_filter_prefs", "theme_prefs", "download_prefs")
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
            .setView(CircularProgressIndicator(this).apply {
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
