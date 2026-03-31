package com.hyliankid14.bbcradioplayer

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.os.Bundle
import android.widget.ImageView
import com.google.android.material.slider.Slider
import android.widget.TextView
import android.text.method.ScrollingMovementMethod
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.palette.graphics.Palette
import com.bumptech.glide.Glide
import com.bumptech.glide.load.DataSource
import com.bumptech.glide.load.engine.GlideException
import com.bumptech.glide.request.RequestListener
import com.bumptech.glide.request.target.Target
import com.google.android.material.button.MaterialButton
import android.content.res.ColorStateList
import com.hyliankid14.bbcradioplayer.PodcastSubscriptions
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Locale
import android.view.View
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.view.updatePadding

class NowPlayingActivity : AppCompatActivity() {
    private lateinit var stationArtwork: ImageView
    private lateinit var rootLayout: androidx.constraintlayout.widget.ConstraintLayout
    private lateinit var toolbar: com.google.android.material.appbar.MaterialToolbar
    private lateinit var showName: TextView
    private lateinit var nextShowView: TextView
    private lateinit var episodeTitle: TextView
    private lateinit var artistTrack: TextView
    private lateinit var releaseDateView: TextView
    private lateinit var showMoreLink: TextView
    private lateinit var stopButton: MaterialButton
    private lateinit var previousButton: MaterialButton
    private lateinit var playPauseButton: MaterialButton
    private lateinit var nextButton: MaterialButton
    private lateinit var favoriteButton: MaterialButton
    private lateinit var openPodcastButton: MaterialButton
    private lateinit var seekBar: Slider
    private lateinit var progressGroup: android.view.View
    private lateinit var elapsedView: TextView
    private lateinit var remainingView: TextView
    private lateinit var markPlayedButton: android.widget.ImageButton
    private var currentShownEpisodeId: String? = null
    private var matchedPodcast: Podcast? = null
    // Track the async job/generation for finding matching podcasts to avoid flicker
    private var openPodcastJob: kotlinx.coroutines.Job? = null
    private var openPodcastGeneration: Int = 0
    private var lastOpenPodcastStationId: String? = null
    // Store the episode currently being played to preserve scrubber visibility during initial playback
    private var playingEpisode: Episode? = null

    // When true the activity is showing a preview episode passed via intent and should not be
    // overwritten by subsequent playback state updates until playback starts.
    private var isPreviewMode = false
    private var previewEpisodeProp: Episode? = null
    private var isSeekBarDragging = false
    
    private var updateTimer: Thread? = null
    private var lastArtworkUrl: String? = null
    private var currentButtonOutlineColor: Int = android.graphics.Color.TRANSPARENT
    private var currentPlayPauseButtonColor: Int = android.graphics.Color.TRANSPARENT
    private var currentIconColor: Int = android.graphics.Color.WHITE
    private var currentIsLightBackground: Boolean = false
    // Store raw HTML for the full description so the dialog can render the complete content
    private var fullDescriptionHtml: String = ""
    private val showChangeListener: (CurrentShow) -> Unit = { show ->
        runOnUiThread { updateFromShow(show) }
    }
    private val podcastCacheLock = Any()
    private var cachedPodcasts: List<Podcast>? = null
    private var cachedPodcastsAtMs: Long = 0L
    private var lastMatchStationId: String? = null
    private var lastMatchShowTitle: String? = null
    private var lastMatchAttemptMs: Long = 0L
    private val MATCH_MIN_INTERVAL_MS = 5_000L
    private val PODCAST_CACHE_TTL_MS = 5 * 60_000L

    // BroadcastReceiver to refresh menu when download completes
    private val downloadCompleteReceiver = object : android.content.BroadcastReceiver() {
        override fun onReceive(context: android.content.Context?, intent: android.content.Intent?) {
            try {
                val episodeId = intent?.getStringExtra(EpisodeDownloadManager.EXTRA_EPISODE_ID)
                val currentEpisodeId = PlaybackStateHelper.getCurrentEpisodeId()
                // If the completed download is for the currently playing episode, refresh the menu
                if (episodeId == currentEpisodeId) {
                    runOnUiThread { invalidateOptionsMenu() }
                }
            } catch (_: Exception) { }
        }
    }

    private fun findMatchingPodcastAsync(station: Station?, show: CurrentShow, generation: Int) {
        // Cancel any previous job for finding an open podcast match
        openPodcastJob?.cancel()
        openPodcastJob = lifecycleScope.launch {
            try {
                // Only attempt when we have a radio station (not a podcast) and a non-empty show title
                if (station == null || station.id.startsWith("podcast_") || show.title.isBlank()) return@launch

                val repo = PodcastRepository(this@NowPlayingActivity)
                val podcasts = getCachedPodcasts(repo)
                val queries = listOfNotNull(
                    show.title.takeIf { it.isNotEmpty() },
                    show.episodeTitle?.takeIf { it.isNotEmpty() },
                    station.title.takeIf { it.isNotEmpty() }
                )
                // Only accept exact title match (case-insensitive). Do NOT fall back to approximate matching here.
                var found: Podcast? = null
                for (q in queries) {
                    found = podcasts.find { it.title.equals(q, ignoreCase = true) }
                    if (found != null) break
                }

                // Ensure the result is still relevant for the current generation and station
                if (generation == openPodcastGeneration) {
                    val currentStationId = PlaybackStateHelper.getCurrentStation()?.id
                    if (found != null && currentStationId == station.id && !station.id.startsWith("podcast_")) {
                        matchedPodcast = found
                        lastOpenPodcastStationId = station.id
                        findViewById<MaterialButton>(R.id.now_playing_open_podcast).visibility = View.VISIBLE
                    } else {
                        // No exact match — ensure button is hidden and any previous match cleared
                        matchedPodcast = null
                        findViewById<MaterialButton>(R.id.now_playing_open_podcast).visibility = View.GONE
                    }
                }
            } catch (e: Exception) {
                android.util.Log.w("NowPlayingActivity", "Failed to find matching podcast: ${e.message}")
            }
        }
    }

    private suspend fun getCachedPodcasts(repo: PodcastRepository): List<Podcast> {
        val now = System.currentTimeMillis()
        synchronized(podcastCacheLock) {
            val cached = cachedPodcasts
            if (cached != null && (now - cachedPodcastsAtMs) <= PODCAST_CACHE_TTL_MS) {
                return cached
            }
        }

        val fetched = withContext(Dispatchers.IO) { repo.fetchPodcasts(false) }
        synchronized(podcastCacheLock) {
            cachedPodcasts = fetched
            cachedPodcastsAtMs = now
        }
        return fetched
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_now_playing)

        // Setup action bar with back button using Material Top App Bar
        toolbar = findViewById(R.id.top_app_bar)
        setSupportActionBar(toolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)

        // Initialize views
        rootLayout = findViewById(R.id.root)

        ViewCompat.setOnApplyWindowInsetsListener(rootLayout) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            rootLayout.updatePadding(top = bars.top, bottom = bars.bottom)
            insets
        }
        ViewCompat.requestApplyInsets(rootLayout)
        stationArtwork = findViewById(R.id.now_playing_artwork)
        showName = findViewById(R.id.now_playing_show_name)
        nextShowView = findViewById(R.id.now_playing_next_show)
        episodeTitle = findViewById(R.id.now_playing_episode_title)
        artistTrack = findViewById(R.id.now_playing_artist_track)
        releaseDateView = findViewById(R.id.now_playing_release_date)
        showMoreLink = findViewById(R.id.now_playing_show_more)
        stopButton = findViewById(R.id.now_playing_stop)
        previousButton = findViewById(R.id.now_playing_previous)
        playPauseButton = findViewById(R.id.now_playing_play_pause)
        nextButton = findViewById(R.id.now_playing_next)
        favoriteButton = findViewById(R.id.now_playing_favorite)
        openPodcastButton = findViewById(R.id.now_playing_open_podcast)
        progressGroup = findViewById(R.id.podcast_progress_group)
        seekBar = findViewById(R.id.playback_seekbar)
        elapsedView = findViewById(R.id.playback_elapsed)
        remainingView = findViewById(R.id.playback_remaining)
        markPlayedButton = findViewById(R.id.now_playing_mark_played) 

        // Keep a high-contrast white glyph for the play/pause control.
        playPauseButton.iconTint = android.content.res.ColorStateList.valueOf(android.graphics.Color.WHITE)

        // Setup control button listeners
        stopButton.setOnClickListener { stopPlayback() }
        previousButton.setOnClickListener { skipToPrevious() }
        playPauseButton.setOnClickListener {
            // If we're previewing an episode (opened from list), start playback of that episode
            val preview = previewEpisodeProp
            if (isPreviewMode && preview != null) {
                playEpisodePreview(preview)
            } else {
                togglePlayPause()
            }
        }
        nextButton.setOnClickListener { skipToNext() }
        favoriteButton.setOnClickListener { toggleFavorite() }
        showMoreLink.setOnClickListener { showFullDescription() }
        artistTrack.setOnClickListener { showFullDescription() }

        // Mark-as-played button (manual toggle)
        // Hidden by design to avoid duplication with subscription controls in the app bar
        markPlayedButton.visibility = android.view.View.GONE
        // (Intentional: keep logic available if needed later, but do not assign a click listener.)

        // Open podcast button (initially hidden). Will be shown when a matching podcast is found for current show.
        val openPodcastButton: MaterialButton = findViewById(R.id.now_playing_open_podcast)
        openPodcastButton.visibility = android.view.View.GONE
        openPodcastButton.setOnClickListener {
            matchedPodcast?.let { p ->
                // Navigate back to MainActivity and open the podcast detail
                val intent = Intent(this, MainActivity::class.java).apply {
                    addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                    putExtra("open_podcast_id", p.id)
                }
                startActivity(intent)
                finish()
            }
        }


        seekBar.addOnSliderTouchListener(object : Slider.OnSliderTouchListener {
            override fun onStartTrackingTouch(slider: Slider) {
                isSeekBarDragging = true
            }

            override fun onStopTrackingTouch(slider: Slider) {
                isSeekBarDragging = false
                // Send seek command only when user releases the slider
                val show = PlaybackStateHelper.getCurrentShow()
                val duration = show.segmentDurationMs ?: return
                if (duration <= 0) return
                val newPos = (duration * slider.value).toLong()
                sendSeekTo(newPos, slider.value)
            }
        })
        
        // No longer send seek in addOnChangeListener - only when user releases slider
        seekBar.addOnChangeListener { _, _, _ ->
            // Just track that the value changed; seek happens on touch release
        }
        
        // Format slider label to show time instead of decimal value
        seekBar.setLabelFormatter { value ->
            val show = PlaybackStateHelper.getCurrentShow()
            val duration = show.segmentDurationMs ?: return@setLabelFormatter "0:00"
            val timeMs = (duration * value).toLong()
            formatTime(timeMs)
        }

        // Register listener for show changes
        PlaybackStateHelper.onShowChange(showChangeListener)

        // Handle back navigation using the modern OnBackPressedDispatcher
        onBackPressedDispatcher.addCallback(this, object : androidx.activity.OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val hasPodcastContext = previewEpisodeProp != null
                        || !intent.getStringExtra("initial_podcast_id").isNullOrEmpty()
                        || PlaybackStateHelper.getCurrentStation()?.id?.startsWith("podcast_") == true

                if (hasPodcastContext) {
                    navigateBackToPodcastDetail()
                    return
                }

                if (isTaskRoot) {
                    val intent = Intent(this@NowPlayingActivity, MainActivity::class.java).apply {
                        addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                    }
                    startActivity(intent)
                    finish()
                } else {
                    // Fall through to default behavior
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })
        
        // If we're opened in preview mode for an episode (no playback), show that episode's details
        val previewEpisode: Episode? = intent.getParcelableExtraCompat<Episode>("preview_episode", Episode::class.java)
        if (previewEpisode != null) {
            isPreviewMode = true
            previewEpisodeProp = previewEpisode
            val previewPodcastTitle = intent.getStringExtra("preview_podcast_title")
            val previewPodcastImage = intent.getStringExtra("preview_podcast_image")
            showPreviewEpisode(previewEpisode, previewPodcastTitle, previewPodcastImage)
            // If caller asked us to present the preview using the same playing UI (but without autoplay),
            // make small adjustments so the screen matches the playing UI more closely.
            val usePlayUi = intent.getBooleanExtra("preview_use_play_ui", false)
            if (usePlayUi) {
                // Ensure play button shows play icon (not autoplay)
                playPauseButton.icon = ContextCompat.getDrawable(this, R.drawable.ic_play_arrow)
                // Keep progress controls visible if duration present (already handled in showPreviewEpisode)
                // Ensure action bar title is set from provided podcast title
                val initialTitle = intent.getStringExtra("initial_podcast_title")
                if (!initialTitle.isNullOrEmpty()) supportActionBar?.title = initialTitle
            }
        }

        // If an initial podcast image/title is provided (launched immediately after starting playback),
        // show it so artwork is visible while playback state initializes.
        val initialImage: String? = intent.getStringExtra("initial_podcast_image")
        val initialTitle: String? = intent.getStringExtra("initial_podcast_title")
        if (!initialImage.isNullOrEmpty()) {
            Glide.with(this)
                .load(initialImage)
                .listener(object : RequestListener<Drawable> {
                    override fun onLoadFailed(e: GlideException?, model: Any?, target: Target<Drawable>?, isFirstResource: Boolean): Boolean {
                        return false
                    }
                    override fun onResourceReady(resource: Drawable?, model: Any?, target: Target<Drawable>?, dataSource: DataSource?, isFirstResource: Boolean): Boolean {
                        if (resource is BitmapDrawable) {
                            extractAndApplyDominantColor(resource.bitmap)
                        }
                        return false
                    }
                })
                .into(stationArtwork)
            lastArtworkUrl = initialImage
        }
        if (!initialTitle.isNullOrEmpty()) {
            supportActionBar?.title = initialTitle
        }

        // If opened in preview for a specific episode with a podcast id, show the open podcast button only when a radio station is playing
        val openPodcastButtonInit: MaterialButton? = findViewById(R.id.now_playing_open_podcast)
        val previewPodcastId = previewEpisodeProp?.podcastId ?: intent.getStringExtra("initial_podcast_id")
        if (!previewPodcastId.isNullOrEmpty()) {
            // Try to find podcast in cache quickly
            lifecycleScope.launch {
                val repo = PodcastRepository(this@NowPlayingActivity)
                val pods = withContext(Dispatchers.IO) { repo.fetchPodcasts(false) }
                val found = pods.find { it.id == previewPodcastId }
                if (found != null) {
                    val currentStation = PlaybackStateHelper.getCurrentStation()
                    val currentShowTitle = PlaybackStateHelper.getCurrentShow().title
                    // Only show the button when there is an active radio station (not a podcast) playing
                    // AND the currently playing show's title exactly matches the podcast series title.
                    if (currentStation != null && !currentStation.id.startsWith("podcast_")
                        && currentShowTitle.equals(found.title, ignoreCase = true)
                    ) {
                        matchedPodcast = found
                        openPodcastButtonInit?.visibility = View.VISIBLE
                    } else {
                        matchedPodcast = null
                        openPodcastButtonInit?.visibility = View.GONE
                    }

                    // If preview artwork is missing or is the generic placeholder, prefer the series image
                    try {
                        val previewArtworkMissing = lastArtworkUrl.isNullOrEmpty() || lastArtworkUrl!!.contains("icon-apple-podcast.png")
                        if (previewArtworkMissing && !found.imageUrl.isNullOrEmpty()) {
                            lastArtworkUrl = found.imageUrl
                            runOnUiThread {
                                Glide.with(this@NowPlayingActivity)
                                    .load(lastArtworkUrl)
                                    .listener(object : RequestListener<Drawable> {
                                        override fun onLoadFailed(e: GlideException?, model: Any?, target: Target<Drawable>?, isFirstResource: Boolean): Boolean {
                                            return false
                                        }
                                        override fun onResourceReady(resource: Drawable?, model: Any?, target: Target<Drawable>?, dataSource: DataSource?, isFirstResource: Boolean): Boolean {
                                            if (resource is BitmapDrawable) {
                                                extractAndApplyDominantColor(resource.bitmap)
                                            }
                                            return false
                                        }
                                    })
                                    .into(stationArtwork)
                            }
                        }
                    } catch (e: Exception) {
                        android.util.Log.w("NowPlayingActivity", "Failed to apply series artwork: ${e.message}")
                    }
                }
            }
        }

        // Ensure mark button reflects current episode if preview provided
        previewEpisodeProp?.let { currentShownEpisodeId = it.id }
        updateMarkPlayedButtonState()

        // Initial update only when not in preview mode
        if (!isPreviewMode) updateUI()
        
        // Start polling for playback state updates
        startPlaybackStateUpdates()
    }

    override fun onSupportNavigateUp(): Boolean {
        // If we were opened for a specific podcast (preview or provided initial id) or the current
        // playback station is a podcast, prefer navigating back to the podcast detail screen.
        val hasPodcastContext = previewEpisodeProp != null
                || !intent.getStringExtra("initial_podcast_id").isNullOrEmpty()
                || PlaybackStateHelper.getCurrentStation()?.id?.startsWith("podcast_") == true

        if (hasPodcastContext) {
            navigateBackToPodcastDetail()
            return true
        }

        if (isTaskRoot) {
            // No previous activity in the task — go to MainActivity without forcing a specific podcast
            val intent = Intent(this, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            }
            startActivity(intent)
            finish()
            return true
        } else {
            // Let the system handle navigation when there is a previous activity
            finish()
            return true
        }
    }

    // Back navigation handled by OnBackPressedDispatcher callback (added in onCreate).

    private fun navigateBackToPodcastDetail() {
        // If opened from the saved-episodes or history list, return to that list rather than the podcast root
        val backSource = intent.getStringExtra("back_source")
        if (backSource == "search_results") {
            // Opened from search results — just return to the calling screen (search-context PodcastsFragment)
            finish()
            return
        }
        if (backSource == "saved_episodes" || backSource == "history") {
            val favTab = if (backSource == "saved_episodes") "saved" else "history"
            val returnIntent = Intent(this, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                putExtra("open_mode", "favorites")
                putExtra("open_fav_tab", favTab)
            }
            startActivity(returnIntent)
            finish()
            return
        }

        // Prefer the explicit preview episode's podcastId when available, otherwise derive from current station
        val podcastId = previewEpisodeProp?.podcastId ?: PlaybackStateHelper.getCurrentStation()?.id?.removePrefix("podcast_")
        if (!podcastId.isNullOrEmpty()) {
            // Relay the back context so MainActivity can restore Favourites or Schedule navigation on back
            val backContext = this@NowPlayingActivity.intent.getStringExtra("back_context")
            val mainIntent = Intent(this, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                putExtra("open_podcast_id", podcastId)
                if (!backContext.isNullOrEmpty()) {
                    putExtra("back_source", backContext)
                    if (backContext == "schedule") {
                        putExtra("schedule_station_id", this@NowPlayingActivity.intent.getStringExtra("back_context_station_id") ?: "")
                        putExtra("schedule_station_title", this@NowPlayingActivity.intent.getStringExtra("back_context_station_title") ?: "")
                    }
                }
            }
            startActivity(mainIntent)
            finish()
            return
        }

        // If we're showing a radio station (not a podcast), return to the list where the station was opened from
        val station = PlaybackStateHelper.getCurrentStation()
        if (station != null && !station.id.startsWith("podcast_")) {
            val origin = intent.getStringExtra("origin_mode") ?: "list"
            val intent = Intent(this, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                putExtra("open_mode", if (origin == "favorites") "favorites" else "list")
            }
            startActivity(intent)
            finish()
            return
        }

        // Fallback to default behaviour
        finish()
    }

    override fun onResume() {
        super.onResume()
        startPlaybackStateUpdates()
        updateUI()
        
        // Register download complete receiver
        try {
            registerReceiver(
                downloadCompleteReceiver,
                android.content.IntentFilter(EpisodeDownloadManager.ACTION_DOWNLOAD_COMPLETE),
                android.content.Context.RECEIVER_NOT_EXPORTED
            )
        } catch (_: Exception) {}
    }

    override fun onPause() {
        super.onPause()
        stopPlaybackStateUpdates()
        
        // Unregister download complete receiver
        try {
            unregisterReceiver(downloadCompleteReceiver)
        } catch (_: Exception) {}
    }

    override fun onDestroy() {
        super.onDestroy()
        PlaybackStateHelper.removeShowChangeListener(showChangeListener)
        stopPlaybackStateUpdates()
    }

    private fun updateUI() {
        if (isFinishing || isDestroyed) return
        // Don't overwrite preview UI when in preview mode
        if (isPreviewMode) return
        val station = PlaybackStateHelper.getCurrentStation()
        val isPlaying = PlaybackStateHelper.getIsPlaying()
        val show = PlaybackStateHelper.getCurrentShow()
        val isPodcast = station?.id?.startsWith("podcast_") == true

        // Hide the open-podcast button while playing a podcast
        if (isPodcast) {
            matchedPodcast = null
            findViewById<MaterialButton?>(R.id.now_playing_open_podcast)?.visibility = View.GONE
            lastOpenPodcastStationId = null
        }

        val currentStationId = station?.id
        if (lastOpenPodcastStationId != currentStationId) {
            // Station changed, clear previous match and hide button
            matchedPodcast = null
            findViewById<MaterialButton?>(R.id.now_playing_open_podcast)?.visibility = View.GONE
            lastOpenPodcastStationId = null
            // Clear stored episode if we've switched stations
            if (playingEpisode?.podcastId != station?.id?.removePrefix("podcast_")) {
                playingEpisode = null
            }
        }

        // Only update the main UI when we have a valid station; otherwise hide controls
        if (station != null) {
            // Only attempt to find matches for radio stations (not podcasts) and when there's a show title
            if (!isPodcast && show.title.isNotBlank()) {
                val now = System.currentTimeMillis()
                val stationId = station.id
                val showTitle = show.title
                val shouldMatch = stationId != lastMatchStationId ||
                    !showTitle.equals(lastMatchShowTitle, ignoreCase = true) ||
                    (now - lastMatchAttemptMs) > MATCH_MIN_INTERVAL_MS
                if (shouldMatch) {
                    lastMatchStationId = stationId
                    lastMatchShowTitle = showTitle
                    lastMatchAttemptMs = now
                    openPodcastGeneration += 1
                    findMatchingPodcastAsync(station, show, openPodcastGeneration)
                }
            }
            if (isPodcast) {
                // Podcasts: action bar already shows podcast name; hide duplicate header
                showName.visibility = android.view.View.GONE
                nextShowView.visibility = android.view.View.GONE

                val episodeHeading = show.episodeTitle?.takeIf { it.isNotEmpty() } ?: show.title
                if (!episodeHeading.isNullOrEmpty()) {
                    episodeTitle.text = episodeHeading
                    episodeTitle.visibility = android.view.View.VISIBLE
                } else {
                    episodeTitle.visibility = android.view.View.GONE
                }

                val rawDesc = show.description ?: ""
                if (rawDesc.isNotEmpty()) {
                    // Keep raw HTML for the full screen dialog
                    fullDescriptionHtml = rawDesc
                    // Render a spanned preview in the small area so formatting is preserved
                    val spanned = androidx.core.text.HtmlCompat.fromHtml(rawDesc, androidx.core.text.HtmlCompat.FROM_HTML_MODE_LEGACY)

                    // Avoid showing the same text twice: hide `artistTrack` when the description
                    // is effectively identical to the episode heading/title shown above.
                    val episodeHeadingText = show.episodeTitle?.takeIf { it.isNotEmpty() } ?: show.title
                    val descPlain = spanned.toString().trim()
                    if (descPlain.isNotEmpty() && !episodeHeadingText.isNullOrEmpty() && !descPlain.equals(episodeHeadingText.trim(), ignoreCase = true)) {
                        artistTrack.text = spanned
                        artistTrack.maxLines = 4
                        artistTrack.ellipsize = android.text.TextUtils.TruncateAt.END
                        artistTrack.visibility = android.view.View.VISIBLE
                        // Check if description exceeds 4 lines
                        artistTrack.post {
                            if (artistTrack.lineCount > 4) {
                                showMoreLink.visibility = android.view.View.VISIBLE
                            } else {
                                showMoreLink.visibility = android.view.View.GONE
                            }
                        }
                    } else {
                        artistTrack.visibility = android.view.View.GONE
                        showMoreLink.visibility = android.view.View.GONE
                    }
                } else {
                    artistTrack.visibility = android.view.View.GONE
                    showMoreLink.visibility = android.view.View.GONE
                }
            } else {
                // Radio: show name plus subtitle/song metadata
                // Clear stored episode since we're not playing a podcast
                playingEpisode = null
                showName.visibility = android.view.View.VISIBLE
                showName.text = show.title.ifEmpty { station.title }
                // Ensure the action bar shows the radio station name
                supportActionBar?.title = station.title

                // Prefer showing the show's "subtitle" (secondary/tertiary) in the large headline
                val subtitle = listOfNotNull(show.secondary?.takeIf { it.isNotBlank() }, show.tertiary?.takeIf { it.isNotBlank() }).joinToString(" - ").takeIf { it.isNotBlank() }
                val songTitle = show.episodeTitle?.takeIf { it.isNotBlank() }

                if (!subtitle.isNullOrEmpty()) {
                    episodeTitle.text = subtitle
                    episodeTitle.visibility = android.view.View.VISIBLE
                } else if (!songTitle.isNullOrEmpty()) {
                    // Fallback: use the episode title if no subtitle is available
                    episodeTitle.text = songTitle
                    episodeTitle.visibility = android.view.View.VISIBLE
                } else {
                    episodeTitle.visibility = android.view.View.GONE
                }

                // Display next show information if available
                if (!show.nextShowTitle.isNullOrBlank() && show.nextShowStartTimeMs != null) {
                    val nextShowTime = java.text.SimpleDateFormat("HH:mm", java.util.Locale.getDefault()).apply {
                        timeZone = java.util.TimeZone.getDefault()
                    }.format(java.util.Date(show.nextShowStartTimeMs))
                    nextShowView.text = "Next: ${show.nextShowTitle} at $nextShowTime"
                    nextShowView.visibility = android.view.View.VISIBLE
                } else {
                    nextShowView.visibility = android.view.View.GONE
                }

                // Per product request: never show the smaller subtitle line for live radio —
                // keep the full-screen surface clean. (Music segments will still surface
                // Artist - Track in the large headline when available.)
                artistTrack.visibility = android.view.View.GONE
                showMoreLink.visibility = android.view.View.GONE
            }
            
            // Load artwork:
            // - Podcasts: use episode/podcast image URL
            // - Radio with song playing (artist/track data present): use song artwork from RMS feed
            // - Radio with no song playing: show generic station artwork (no BBC branding)
            if (isPodcast) {
                val podArtworkUrl = show.imageUrl?.takeIf { it.startsWith("http") }
                if (podArtworkUrl != null && podArtworkUrl != lastArtworkUrl && !isFinishing && !isDestroyed) {
                    lastArtworkUrl = podArtworkUrl
                    Glide.with(this)
                        .load(podArtworkUrl)
                        .placeholder(android.R.color.transparent)
                        .listener(object : RequestListener<Drawable> {
                            override fun onLoadFailed(e: GlideException?, model: Any?, target: Target<Drawable>?, isFirstResource: Boolean): Boolean = false
                            override fun onResourceReady(resource: Drawable?, model: Any?, target: Target<Drawable>?, dataSource: DataSource?, isFirstResource: Boolean): Boolean {
                                if (resource is BitmapDrawable) extractAndApplyDominantColor(resource.bitmap)
                                return false
                            }
                        })
                        .into(stationArtwork)
                }
            } else {
                val hasSongArtwork = (!show.secondary.isNullOrEmpty() || !show.tertiary.isNullOrEmpty()) &&
                    !show.imageUrl.isNullOrEmpty() && show.imageUrl.startsWith("http")
                if (hasSongArtwork) {
                    val songArtworkUrl = show.imageUrl
                    if (songArtworkUrl != lastArtworkUrl && !isFinishing && !isDestroyed) {
                        lastArtworkUrl = songArtworkUrl
                        Glide.with(this)
                            .load(songArtworkUrl)
                            .placeholder(StationArtwork.createDrawable(station.id))
                            .error(StationArtwork.createDrawable(station.id))
                            .listener(object : RequestListener<Drawable> {
                                override fun onLoadFailed(e: GlideException?, model: Any?, target: Target<Drawable>?, isFirstResource: Boolean): Boolean {
                                    showGenericStationArtwork(station.id)
                                    return true
                                }
                                override fun onResourceReady(resource: Drawable?, model: Any?, target: Target<Drawable>?, dataSource: DataSource?, isFirstResource: Boolean): Boolean {
                                    if (resource is BitmapDrawable) {
                                        if (isPlaceholderImage(resource.bitmap)) {
                                            showGenericStationArtwork(station.id)
                                            return true
                                        }
                                        extractAndApplyDominantColor(resource.bitmap)
                                    }
                                    return false
                                }
                            })
                            .into(stationArtwork)
                    }
                } else {
                    val genericKey = "generic:${station.id}"
                    if (genericKey != lastArtworkUrl && !isFinishing && !isDestroyed) {
                        lastArtworkUrl = genericKey
                        showGenericStationArtwork(station.id)
                    }
                }
            }
            
            updateProgressUi()

            // Update play/pause button
            playPauseButton.icon = ContextCompat.getDrawable(this, if (isPlaying) R.drawable.ic_pause else R.drawable.ic_play_arrow)
            
            val podcastId = station.id.removePrefix("podcast_")
            // If we're playing a podcast episode, show bookmark (episode save). Otherwise keep existing star semantics
            val currentEpisodeId = PlaybackStateHelper.getCurrentEpisodeId()

            // Show release date for podcast episodes (cache-first, background fetch if necessary)
            if (isPodcast) {
                fetchAndShowEpisodePubDate(podcastId, currentEpisodeId)
            } else {
                releaseDateView.visibility = View.GONE
            }

            if (isPodcast && !currentEpisodeId.isNullOrEmpty()) {
                val saved = SavedEpisodes.isSaved(this, currentEpisodeId)
                favoriteButton.icon = ContextCompat.getDrawable(this, if (saved) R.drawable.ic_bookmark else getUnsavedBookmarkIconRes())
            } else {
                val isFavorited = if (isPodcast) {
                    PodcastSubscriptions.isSubscribed(this, podcastId)
                } else {
                    FavoritesPreference.isFavorite(this, station.id)
                }
                favoriteButton.icon = ContextCompat.getDrawable(this, if (isFavorited) R.drawable.ic_star_filled else R.drawable.ic_star_outline)
                // Note: background color is applied in extractAndApplyDominantColor() to avoid flashing with hardcoded theme colors
            }
        } else {
            progressGroup.visibility = android.view.View.GONE
            seekBar.visibility = android.view.View.GONE
            // Clear stored episode when not playing a podcast
            playingEpisode = null
        }
    }

    private fun showPreviewEpisode(episode: Episode, podcastTitle: String?, podcastImage: String?) {
        // Clear any stored episode when showing a new preview
        playingEpisode = null
        // Ensure action bar shows the podcast name while previewing
        supportActionBar?.title = podcastTitle ?: supportActionBar?.title
        // Display podcast title or provided podcastTitle
        showName.visibility = android.view.View.GONE

        val episodeHeading = episode.title
        episodeTitle.text = episodeHeading
        episodeTitle.visibility = android.view.View.VISIBLE

        val rawDesc = episode.description
        if (rawDesc.isNotEmpty()) {
            fullDescriptionHtml = rawDesc
            val spanned = androidx.core.text.HtmlCompat.fromHtml(rawDesc, androidx.core.text.HtmlCompat.FROM_HTML_MODE_LEGACY)
            // Avoid showing the same text twice when the description is just the episode title
            val descPlain = spanned.toString().trim()
            if (!descPlain.equals(episode.title.trim(), ignoreCase = true)) {
                artistTrack.text = spanned
                artistTrack.maxLines = 4
                artistTrack.ellipsize = android.text.TextUtils.TruncateAt.END
                artistTrack.visibility = android.view.View.VISIBLE
                artistTrack.post {
                    if (artistTrack.lineCount > 4) {
                        showMoreLink.visibility = android.view.View.VISIBLE
                    } else {
                        showMoreLink.visibility = android.view.View.GONE
                    }
                }
            } else {
                artistTrack.visibility = android.view.View.GONE
                showMoreLink.visibility = android.view.View.GONE
            }
        } else {
            artistTrack.visibility = android.view.View.GONE
            showMoreLink.visibility = android.view.View.GONE
        }

        // Load artwork from episode or podcast image if provided
        val artworkUrl = episode.imageUrl.takeIf { it.isNotEmpty() } ?: podcastImage
        if (!artworkUrl.isNullOrEmpty()) {
            Glide.with(this)
                .load(artworkUrl)
                .listener(object : RequestListener<Drawable> {
                    override fun onLoadFailed(e: GlideException?, model: Any?, target: Target<Drawable>?, isFirstResource: Boolean): Boolean {
                        return false
                    }
                    override fun onResourceReady(resource: Drawable?, model: Any?, target: Target<Drawable>?, dataSource: DataSource?, isFirstResource: Boolean): Boolean {
                        if (resource is BitmapDrawable) {
                            extractAndApplyDominantColor(resource.bitmap)
                        }
                        return false
                    }
                })
                .into(stationArtwork)
            lastArtworkUrl = artworkUrl
        }

        // Store preview episode so play button can start it
        previewEpisodeProp = episode
        currentShownEpisodeId = episode.id

        // Show release date when available (preview contains full Episode)
        if (!episode.pubDate.isNullOrEmpty()) {
            releaseDateView.text = formatEpisodeDate(episode.pubDate)
            releaseDateView.visibility = View.VISIBLE
        } else {
            releaseDateView.visibility = View.GONE
        }

        updateMarkPlayedButtonState()

        // Update favorite button to reflect saved-episode state for the previewed episode (separate from podcast subscriptions)
        try {
            val saved = SavedEpisodes.isSaved(this, episode.id)
            favoriteButton.icon = ContextCompat.getDrawable(this, if (saved) R.drawable.ic_bookmark else getUnsavedBookmarkIconRes())
        } catch (_: Exception) {}

        // Show scrubber controls if episode has a duration so user can see progress
        val durMs = (episode.durationMins.takeIf { it >= 0 } ?: 0) * 60_000L
        if (durMs > 0) {
            progressGroup.visibility = android.view.View.VISIBLE
            seekBar.visibility = android.view.View.VISIBLE
            // Initialize scrubber to start (not playing)
            seekBar.value = 0f
            seekBar.isEnabled = false
            elapsedView.text = "0:00"
            remainingView.text = "-${formatTime(durMs)}"
        } else {
            progressGroup.visibility = android.view.View.GONE
            seekBar.visibility = android.view.View.GONE
        }
    }

    private fun playEpisodePreview(episode: Episode) {
        // Do not clear lastArtworkUrl here — keep the preview artwork visible until the service
        // provides the official station artwork to avoid visual disappearance on play.

        val intent = Intent(this, RadioService::class.java).apply {
            action = RadioService.ACTION_PLAY_PODCAST_EPISODE
            putExtra(RadioService.EXTRA_EPISODE, episode)
            putExtra(RadioService.EXTRA_PODCAST_ID, episode.podcastId)
            // Pass the currently displayed artwork and title (if available) so the service can
            // set a synthetic station logo immediately and avoid flashing a missing image.
            if (!lastArtworkUrl.isNullOrEmpty()) putExtra(RadioService.EXTRA_PODCAST_IMAGE, lastArtworkUrl)
            supportActionBar?.title?.let { putExtra(RadioService.EXTRA_PODCAST_TITLE, it.toString()) }
        }
        startService(intent)
        // Store the episode being played so updateProgressUi() can use its duration immediately
        // before the service updates the playback state (avoids scrubber flicker)
        playingEpisode = episode
        // Exit preview mode and allow normal updates to take over
        isPreviewMode = false
        previewEpisodeProp = null
        // Do NOT call updateUI() immediately — let the 500ms polling timer update the UI once
        // the service has provided the episode duration. Calling updateUI() now would hide the
        // scrubber because the service hasn't updated the playback state yet.
    }

    private fun updateProgressUi() {
        val station = PlaybackStateHelper.getCurrentStation()
        val isPodcast = station?.id?.startsWith("podcast_") == true
        val showProgress = PlaybackStateHelper.getCurrentShow()
        val pos = showProgress.segmentStartMs ?: 0L
        var dur = showProgress.segmentDurationMs ?: 0L

        // If the service hasn't updated the duration yet but we just started playing an episode,
        // use the stored episode's duration to prevent scrubber flicker
        if (dur <= 0 && isPodcast && playingEpisode != null && playingEpisode?.podcastId == station?.id?.removePrefix("podcast_")) {
            dur = (playingEpisode?.durationMins ?: 0) * 60_000L
        } else if (dur > 0 && playingEpisode != null) {
            // Service has now provided the duration, clear the stored episode reference
            playingEpisode = null
        }

        if (isPodcast && dur > 0) {
            progressGroup.visibility = android.view.View.VISIBLE
            seekBar.visibility = android.view.View.VISIBLE
            // Skip updating seek bar position when user is actively dragging, to prevent it jumping back
            if (!isSeekBarDragging) {
                val ratio = (pos.toDouble() / dur.toDouble()).coerceIn(0.0, 1.0)
                seekBar.value = ratio.toFloat()
            }
            elapsedView.text = formatTime(pos)
            remainingView.text = "-${formatTime((dur - pos).coerceAtLeast(0))}"
            seekBar.isEnabled = true
        } else {
            progressGroup.visibility = android.view.View.GONE
            seekBar.visibility = android.view.View.GONE
        }

        // Ensure mark-played button reflects current playback state
        updateMarkPlayedButtonState()
    }

    private fun sendSeekTo(positionMs: Long, positionFraction: Float? = null) {
        val intent = Intent(this, RadioService::class.java).apply {
            action = RadioService.ACTION_SEEK_TO
            putExtra(RadioService.EXTRA_SEEK_POSITION, positionMs)
            positionFraction?.let { putExtra(RadioService.EXTRA_SEEK_FRACTION, it.coerceIn(0f, 1f)) }
        }
        startService(intent)
    }

    private fun formatTime(ms: Long): String {
        val totalSeconds = ms / 1000
        val minutes = totalSeconds / 60
        val seconds = totalSeconds % 60
        return String.format("%d:%02d", minutes, seconds)
    }

    // Cache-first helper: try in-memory episodes, otherwise perform a short background fetch
    private fun fetchAndShowEpisodePubDate(podcastId: String, episodeId: String?) {
        if (episodeId.isNullOrEmpty()) {
            releaseDateView.visibility = View.GONE
            return
        }

        val repo = PodcastRepository(this)
        // Try fast in-memory cache first
        try {
            val cached = repo.getEpisodesFromCache(podcastId)
            val found = cached?.firstOrNull { it.id == episodeId }
            if (found != null && !found.pubDate.isNullOrEmpty()) {
                releaseDateView.text = formatEpisodeDate(found.pubDate)
                releaseDateView.visibility = View.VISIBLE
                return
            }
        } catch (_: Exception) {
            // ignore and fall back to lightweight fetch
        }

        // Background fetch (best-effort, short timeout) — do not block the UI
        lifecycleScope.launch {
            try {
                val pods = withContext(Dispatchers.IO) { repo.fetchPodcasts(false) }
                val pod = pods.firstOrNull { it.id == podcastId }
                if (pod == null) {
                    releaseDateView.visibility = View.GONE
                    return@launch
                }

                val eps = try { withContext(Dispatchers.IO) { repo.fetchEpisodesIfNeeded(pod) } } catch (_: Exception) { emptyList<Episode>() }
                val found = eps.firstOrNull { it.id == episodeId }
                if (found != null && !found.pubDate.isNullOrEmpty()) {
                    runOnUiThread {
                        releaseDateView.text = formatEpisodeDate(found.pubDate)
                        releaseDateView.visibility = View.VISIBLE
                    }
                    return@launch
                }
            } catch (_: Exception) {
                // best-effort only
            }
            runOnUiThread { releaseDateView.visibility = View.GONE }
        }
    }

    // Duplicate of PodcastAdapter.formatEpisodeDate — keep local to avoid touching adapter visibility
    private fun formatEpisodeDate(raw: String): String {
        val epoch = EpisodeDateParser.parsePubDateToEpoch(raw)
        return if (epoch > 0L) {
            java.text.SimpleDateFormat("EEE, dd MMM yyyy", java.util.Locale.US).format(java.util.Date(epoch))
        } else {
            if (raw.contains(":")) raw.substringBefore(":").substringBeforeLast(" ").trim() else raw.trim()
        }
    }
    
    private fun updateFromShow(show: CurrentShow) {
        if (isFinishing || isDestroyed) return
        // If we're in preview mode do not override the preview. If playback actually starts (station non-null)
        // we'll clear preview mode and continue handling updates.
        if (isPreviewMode && PlaybackStateHelper.getCurrentStation() == null) return

        val station = PlaybackStateHelper.getCurrentStation()
        val isPodcast = station?.id?.startsWith("podcast_") == true
        
        // Hide the open-podcast button when playback is a podcast
        if (isPodcast) {
            matchedPodcast = null
            findViewById<MaterialButton?>(R.id.now_playing_open_podcast)?.visibility = View.GONE
            lastOpenPodcastStationId = null
        }
        
        if (isPodcast) {
            showName.visibility = android.view.View.GONE

            val episodeHeading = show.episodeTitle?.takeIf { it.isNotEmpty() } ?: show.title
            if (!episodeHeading.isNullOrEmpty()) {
                episodeTitle.text = episodeHeading
                episodeTitle.visibility = android.view.View.VISIBLE
            } else {
                episodeTitle.visibility = android.view.View.GONE
            }

            // Try to surface episode release date when available
            val podcastId = PlaybackStateHelper.getCurrentStation()?.id?.removePrefix("podcast_")
            val currentEpisodeId = PlaybackStateHelper.getCurrentEpisodeId()
            if (!podcastId.isNullOrEmpty()) {
                fetchAndShowEpisodePubDate(podcastId, currentEpisodeId)
            } else {
                releaseDateView.visibility = View.GONE
            }

            val rawDesc = show.description ?: ""
            if (rawDesc.isNotEmpty()) {
                fullDescriptionHtml = rawDesc
                val spanned = androidx.core.text.HtmlCompat.fromHtml(rawDesc, androidx.core.text.HtmlCompat.FROM_HTML_MODE_LEGACY)

                // Hide the small-line if it merely repeats the large episode heading (case-insensitive,
                // trimmed). This prevents the duplicated subtitle seen in the screenshot.
                val smallText = spanned.toString().trim()
                val largeText = episodeHeading.trim()
                if (smallText.isNotEmpty() && smallText.equals(largeText, ignoreCase = true)) {
                    artistTrack.visibility = android.view.View.GONE
                    showMoreLink.visibility = android.view.View.GONE
                } else {
                    artistTrack.text = spanned
                    artistTrack.maxLines = 4
                    artistTrack.ellipsize = android.text.TextUtils.TruncateAt.END
                    artistTrack.visibility = android.view.View.VISIBLE
                    // Check if description exceeds 4 lines
                    artistTrack.post {
                        if (artistTrack.lineCount > 4) {
                            showMoreLink.visibility = android.view.View.VISIBLE
                        } else {
                            showMoreLink.visibility = android.view.View.GONE
                        }
                    }
                }
            } else {
                artistTrack.visibility = android.view.View.GONE
                showMoreLink.visibility = android.view.View.GONE
            }
        } else {
            showName.visibility = android.view.View.VISIBLE
            // Update show name
            showName.text = show.title.ifEmpty { station?.title ?: "" }
            // Ensure the action bar shows the radio station name when not a podcast
            supportActionBar?.title = station?.title ?: ""

            // Prefer subtitle (secondary/tertiary) in the large headline and show the
            // song/episode title in the smaller line — avoid duplicates.
            val subtitle = listOfNotNull(show.secondary?.takeIf { it.isNotBlank() }, show.tertiary?.takeIf { it.isNotBlank() }).joinToString(" - ").takeIf { it.isNotBlank() }
            val songTitle = show.episodeTitle?.takeIf { it.isNotBlank() }

            if (!subtitle.isNullOrEmpty()) {
                episodeTitle.text = subtitle
                episodeTitle.visibility = android.view.View.VISIBLE
            } else if (!songTitle.isNullOrEmpty()) {
                episodeTitle.text = songTitle
                episodeTitle.visibility = android.view.View.VISIBLE
            } else {
                episodeTitle.visibility = android.view.View.GONE
            }

            // Display next show information if available
            if (!show.nextShowTitle.isNullOrBlank() && show.nextShowStartTimeMs != null) {
                val nextShowTime = java.text.SimpleDateFormat("HH:mm", java.util.Locale.getDefault()).apply {
                    timeZone = java.util.TimeZone.getDefault()
                }.format(java.util.Date(show.nextShowStartTimeMs))
                nextShowView.text = "Next: ${show.nextShowTitle} at $nextShowTime"
                nextShowView.visibility = android.view.View.VISIBLE
            } else {
                nextShowView.visibility = android.view.View.GONE
            }

            // Per product request: do not show the smaller subtitle line for live radio
            // (keep full-screen surface clean). Always hide the small `artistTrack` and
            // the 'show more' affordance for non-podcast/live playback.
            artistTrack.visibility = android.view.View.GONE
            showMoreLink.visibility = android.view.View.GONE
        }
        
        // Load artwork:
        // - Podcasts: use episode/podcast image URL
        // - Radio with song playing (artist/track data present): use song artwork from RMS feed
        // - Radio with no song playing: show generic station artwork (no BBC branding)
        if (isPodcast) {
            val podArtworkUrl = show.imageUrl?.takeIf { it.startsWith("http") }
            if (podArtworkUrl != null && podArtworkUrl != lastArtworkUrl && !isFinishing && !isDestroyed) {
                lastArtworkUrl = podArtworkUrl
                Glide.with(this)
                    .load(podArtworkUrl)
                    .placeholder(android.R.color.transparent)
                    .listener(object : RequestListener<Drawable> {
                        override fun onLoadFailed(e: GlideException?, model: Any?, target: Target<Drawable>?, isFirstResource: Boolean): Boolean = false
                        override fun onResourceReady(resource: Drawable?, model: Any?, target: Target<Drawable>?, dataSource: DataSource?, isFirstResource: Boolean): Boolean {
                            if (resource is BitmapDrawable) extractAndApplyDominantColor(resource.bitmap)
                            return false
                        }
                    })
                    .into(stationArtwork)
            }
        } else if (station != null) {
            val hasSongArtwork = (!show.secondary.isNullOrEmpty() || !show.tertiary.isNullOrEmpty()) &&
                !show.imageUrl.isNullOrEmpty() && show.imageUrl.startsWith("http")
            if (hasSongArtwork) {
                val songArtworkUrl = show.imageUrl
                if (songArtworkUrl != lastArtworkUrl && !isFinishing && !isDestroyed) {
                    lastArtworkUrl = songArtworkUrl
                    Glide.with(this)
                        .load(songArtworkUrl)
                        .placeholder(StationArtwork.createDrawable(station.id))
                        .error(StationArtwork.createDrawable(station.id))
                        .listener(object : RequestListener<Drawable> {
                            override fun onLoadFailed(e: GlideException?, model: Any?, target: Target<Drawable>?, isFirstResource: Boolean): Boolean {
                                showGenericStationArtwork(station.id)
                                return true
                            }
                            override fun onResourceReady(resource: Drawable?, model: Any?, target: Target<Drawable>?, dataSource: DataSource?, isFirstResource: Boolean): Boolean {
                                if (resource is BitmapDrawable) {
                                    if (isPlaceholderImage(resource.bitmap)) {
                                        showGenericStationArtwork(station.id)
                                        return true
                                    }
                                    extractAndApplyDominantColor(resource.bitmap)
                                }
                                return false
                            }
                        })
                        .into(stationArtwork)
                }
            } else {
                val genericKey = "generic:${station.id}"
                if (genericKey != lastArtworkUrl && !isFinishing && !isDestroyed) {
                    lastArtworkUrl = genericKey
                    showGenericStationArtwork(station.id)
                }
            }
        }

            updateProgressUi()
            // Ensure the app-bar overflow menu reflects current podcast / episode state
            invalidateOptionsMenu()
        }

        override fun onCreateOptionsMenu(menu: android.view.Menu): Boolean {
            menuInflater.inflate(R.menu.now_playing_menu, menu)
            return true
        }

        override fun onPrepareOptionsMenu(menu: android.view.Menu): Boolean {
            try {
                val station = PlaybackStateHelper.getCurrentStation()
                val isPodcastStation = station?.id?.startsWith("podcast_") == true

                // Determine podcast id (support preview mode too)
                val podcastId: String? = when {
                    isPodcastStation -> station?.id?.removePrefix("podcast_")
                    previewEpisodeProp != null -> previewEpisodeProp?.podcastId
                    else -> null
                }

                // View all episodes: only show when we have a podcast context
                val viewAllItem = menu.findItem(R.id.action_view_all_episodes)
                viewAllItem.isVisible = podcastId != null

                // Share: only show when we have an episode
                val episodeId = previewEpisodeProp?.id ?: PlaybackStateHelper.getCurrentEpisodeId() ?: currentShownEpisodeId
                val shareItem = menu.findItem(R.id.action_share)
                shareItem.isVisible = !episodeId.isNullOrEmpty()

                // Subscribe / Unsubscribe: only show for podcast context
                val subscribeItem = menu.findItem(R.id.action_subscribe)
                if (podcastId != null) {
                    subscribeItem.isVisible = true
                    val subscribed = PodcastSubscriptions.isSubscribed(this, podcastId)
                    subscribeItem.title = if (subscribed) "Unsubscribe" else "Subscribe"
                } else {
                    subscribeItem.isVisible = false
                }

                // Mark as played / unplayed: show only when we have an episode id (preview or playing)
                val markItem = menu.findItem(R.id.action_mark_played)
                if (!episodeId.isNullOrEmpty()) {
                    markItem.isVisible = true
                    val played = PlayedEpisodesPreference.isPlayed(this, episodeId)
                    markItem.title = if (played) "Mark as unplayed" else "Mark as played"
                } else {
                    markItem.isVisible = false
                }

                // Download / Delete download: show only when we have an episode
                val downloadItem = menu.findItem(R.id.action_download)
                if (!episodeId.isNullOrEmpty()) {
                    downloadItem.isVisible = true
                    val downloaded = DownloadedEpisodes.isDownloaded(this, episodeId)
                    downloadItem.title = if (downloaded) "Delete download" else "Download episode"
                } else {
                    downloadItem.isVisible = false
                }
            } catch (e: Exception) {
                android.util.Log.w("NowPlayingActivity", "onPrepareOptionsMenu failed: ${'$'}{e.message}")
            }
            return super.onPrepareOptionsMenu(menu)
        }

        override fun onOptionsItemSelected(item: android.view.MenuItem): Boolean {
            try {
                when (item.itemId) {
                    android.R.id.home -> {
                        onSupportNavigateUp()
                        return true
                    }

                    R.id.action_view_all_episodes -> {
                        val station = PlaybackStateHelper.getCurrentStation()
                        val podcastId = when {
                            station != null && station.id.startsWith("podcast_") -> station.id.removePrefix("podcast_")
                            previewEpisodeProp != null -> previewEpisodeProp!!.podcastId
                            else -> null
                        }
                        if (!podcastId.isNullOrEmpty()) {
                            val intent = Intent(this, MainActivity::class.java).apply {
                                addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                                putExtra("open_podcast_id", podcastId)
                            }
                            startActivity(intent)
                            finish()
                        }
                        return true
                    }

                    R.id.action_share -> {
                        // Get current episode and podcast info
                        val episode = previewEpisodeProp ?: run {
                            // Build episode from current playback state
                            val episodeId = PlaybackStateHelper.getCurrentEpisodeId() ?: currentShownEpisodeId
                            if (episodeId.isNullOrEmpty()) return true
                            
                            Episode(
                                id = episodeId,
                                title = episodeTitle.text?.toString() ?: "Episode",
                                description = fullDescriptionHtml.ifEmpty { showName.text?.toString() ?: "" },
                                audioUrl = "",
                                imageUrl = lastArtworkUrl ?: "",
                                pubDate = releaseDateView.text?.toString() ?: "",
                                durationMins = 0,
                                podcastId = ""
                            )
                        }
                        
                        val podcastTitle = supportActionBar?.title?.toString() 
                            ?: showName.text?.toString() 
                            ?: "British Radio Player"
                        
                        ShareUtil.shareEpisode(this, episode, podcastTitle)
                        return true
                    }

                    R.id.action_subscribe -> {
                        // Determine podcast id (preview or playing)
                        val station = PlaybackStateHelper.getCurrentStation()
                        val podcastId = when {
                            station != null && station.id.startsWith("podcast_") -> station.id.removePrefix("podcast_")
                            previewEpisodeProp != null -> previewEpisodeProp?.podcastId
                            else -> null
                        }
                        podcastId?.let { pid ->
                            PodcastSubscriptions.toggleSubscription(this, pid)
                            val now = PodcastSubscriptions.isSubscribed(this, pid)
                            // Prefer explicit station/podcast sources for the display name; fall back safely
                            var podcastName = PlaybackStateHelper.getCurrentStation()?.title
                                ?: supportActionBar?.title?.toString()
                                ?: "Podcast"
                            podcastName = podcastName.takeIf { it.isNotBlank() } ?: "Podcast"
                            // Guard against accidental template literals appearing in the title
                            if (podcastName.contains("${'$'}{")) podcastName = "Podcast"
                            val msg = if (now) "Subscribed to $podcastName" else "Unsubscribed from $podcastName"
                            com.google.android.material.snackbar.Snackbar.make(findViewById(android.R.id.content), msg, com.google.android.material.snackbar.Snackbar.LENGTH_SHORT)
                                .setAnchorView(findViewById(R.id.playback_controls))
                                .show()
                            updateUI()
                            invalidateOptionsMenu()
                        }
                        return true
                    }

                    R.id.action_mark_played -> {
                        // Fall back to playingEpisode so metadata is available even when
                        // the user marks an episode as played while it is actively playing
                        // (at which point previewEpisodeProp is null).
                        val episodeForMeta = previewEpisodeProp ?: playingEpisode
                        val episodeId = episodeForMeta?.id ?: PlaybackStateHelper.getCurrentEpisodeId() ?: currentShownEpisodeId
                        if (!episodeId.isNullOrEmpty()) {
                            val nowPlayed = PlayedEpisodesPreference.isPlayed(this, episodeId)
                            if (nowPlayed) {
                                PlayedEpisodesPreference.markUnplayed(this, episodeId)
                                com.google.android.material.snackbar.Snackbar.make(findViewById(android.R.id.content), "Marked as unplayed", com.google.android.material.snackbar.Snackbar.LENGTH_SHORT)
                                    .setAnchorView(findViewById(R.id.playback_controls))
                                    .show()
                            } else {
                                // Use markPlayedWithMeta so lastPlayedEpoch is updated for the podcast.
                                // This ensures the new-episode dot clears correctly when manually marking
                                // the newest episode as played (not just via 95% playback completion).
                                val pubDateEpoch = episodeForMeta?.pubDate
                                    ?.let { EpisodeDateParser.parsePubDateToEpoch(it).takeIf { parsedEpoch -> parsedEpoch > 0L } }
                                if (pubDateEpoch == null && episodeForMeta?.pubDate?.isNotBlank() == true) {
                                    android.util.Log.w("NowPlayingActivity", "Could not parse pubDate for epoch: ${episodeForMeta.pubDate}")
                                }
                                PlayedEpisodesPreference.markPlayedWithMeta(
                                    this, episodeId, episodeForMeta?.podcastId, pubDateEpoch
                                )
                                // Auto-delete downloaded episode if setting is enabled
                                if (DownloadPreferences.isDeleteOnPlayed(this) && DownloadedEpisodes.isDownloaded(this, episodeId)) {
                                    EpisodeDownloadManager.deleteDownload(this, episodeId)
                                }
                                com.google.android.material.snackbar.Snackbar.make(findViewById(android.R.id.content), "Marked as played", com.google.android.material.snackbar.Snackbar.LENGTH_SHORT)
                                    .setAnchorView(findViewById(R.id.playback_controls))
                                    .show()
                            }
                            updateUI()
                            invalidateOptionsMenu()
                        }
                        return true
                    }

                    R.id.action_download -> {
                        val episodeId = previewEpisodeProp?.id ?: PlaybackStateHelper.getCurrentEpisodeId() ?: currentShownEpisodeId
                        if (!episodeId.isNullOrEmpty()) {
                            if (DownloadedEpisodes.isDownloaded(this, episodeId)) {
                                EpisodeDownloadManager.deleteDownload(this, episodeId)
                                invalidateOptionsMenu()
                            } else {
                                val stationPodcastId = PlaybackStateHelper.getCurrentStation()?.id?.removePrefix("podcast_")
                                val fallbackEpisode = previewEpisodeProp ?: run {
                                    Episode(
                                        id = episodeId,
                                        title = episodeTitle.text?.toString() ?: "Episode",
                                        description = fullDescriptionHtml.ifEmpty { showName.text?.toString() ?: "" },
                                        audioUrl = playingEpisode?.audioUrl ?: (PlaybackStateHelper.getCurrentMediaUri() ?: ""),
                                        imageUrl = lastArtworkUrl ?: "",
                                        pubDate = releaseDateView.text?.toString() ?: "",
                                        durationMins = 0,
                                        podcastId = stationPodcastId ?: ""
                                    )
                                }

                                val podcastTitle = supportActionBar?.title?.toString()
                                    ?: showName.text?.toString()
                                    ?: "Podcast"

                                Thread {
                                    var resolvedEpisode = fallbackEpisode
                                    try {
                                        val pid = resolvedEpisode.podcastId
                                        if (pid.isNotBlank()) {
                                            val repo = PodcastRepository(this)
                                            val podcast = kotlinx.coroutines.runBlocking { repo.fetchPodcasts(false) }
                                                .firstOrNull { it.id == pid }
                                            if (podcast != null) {
                                                val episodes = RSSParser.fetchAndParseRSS(podcast.rssUrl, podcast.id)
                                                val byId = episodes.firstOrNull { it.id == episodeId }
                                                if (byId != null) {
                                                    resolvedEpisode = byId
                                                } else {
                                                    val title = fallbackEpisode.title.trim()
                                                    if (title.isNotBlank()) {
                                                        episodes.firstOrNull { it.title.equals(title, ignoreCase = true) }?.let { matched ->
                                                            resolvedEpisode = matched
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    } catch (_: Exception) { }

                                    runOnUiThread {
                                        EpisodeDownloadManager.downloadEpisode(this, resolvedEpisode, podcastTitle)
                                        invalidateOptionsMenu()
                                    }
                                }.start()
                            }
                        }
                        return true
                    }
                }
            } catch (e: Exception) {
                android.util.Log.w("NowPlayingActivity", "onOptionsItemSelected error: ${'$'}{e.message}")
            }
            return super.onOptionsItemSelected(item)
        }

    
    private fun isPlaceholderImage(bitmap: Bitmap): Boolean {
        val width = bitmap.width
        val height = bitmap.height
        
        // Check for 1x1 placeholder
        if (width == 1 && height == 1) return true
        
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

    private fun stopPlayback() {
        val intent = Intent(this, RadioService::class.java).apply {
            action = RadioService.ACTION_STOP
        }
        startService(intent)
        finish()
    }

    private fun skipToPrevious() {
        val station = PlaybackStateHelper.getCurrentStation()
        if (station?.id?.startsWith("podcast_") == true) {
            val intent = Intent(this, RadioService::class.java).apply {
                action = RadioService.ACTION_SEEK_DELTA
                putExtra(RadioService.EXTRA_SEEK_DELTA, -10_000L)
            }
            startService(intent)
        } else {
            val intent = Intent(this, RadioService::class.java).apply {
                action = RadioService.ACTION_SKIP_TO_PREVIOUS
            }
            startService(intent)
        }
    }

    private fun skipToNext() {
        val station = PlaybackStateHelper.getCurrentStation()
        if (station?.id?.startsWith("podcast_") == true) {
            val intent = Intent(this, RadioService::class.java).apply {
                action = RadioService.ACTION_SEEK_DELTA
                putExtra(RadioService.EXTRA_SEEK_DELTA, 30_000L)
            }
            startService(intent)
        } else {
            val intent = Intent(this, RadioService::class.java).apply {
                action = RadioService.ACTION_SKIP_TO_NEXT
            }
            startService(intent)
        }
    }

    private fun togglePlayPause() {
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
        updateUI()
    }

    private fun getUnsavedBookmarkIconRes(): Int {
        return if (currentIsLightBackground) R.drawable.ic_bookmark_outline_stroked else R.drawable.ic_bookmark_outline
    }

    private fun updateFavoriteButtonBackground() {
        val station = PlaybackStateHelper.getCurrentStation()
        val isPodcast = station?.id?.startsWith("podcast_") == true
        val episodeIdInPlayback = PlaybackStateHelper.getCurrentEpisodeId()
        val episodeId = previewEpisodeProp?.id ?: episodeIdInPlayback ?: currentShownEpisodeId
        
        val playPauseColorStateList = android.content.res.ColorStateList.valueOf(currentPlayPauseButtonColor)
        val selectedIconTint = android.content.res.ColorStateList.valueOf(android.graphics.Color.WHITE)
        val currentIconColorStateList = android.content.res.ColorStateList.valueOf(currentIconColor)
        
        // For episodes being played/previewed, show bookmark styling
        if (!episodeId.isNullOrEmpty()) {
            val isSaved = SavedEpisodes.isSaved(this, episodeId)
            if (isSaved) {
                // Saved: use same filled circle style as play/pause button
                favoriteButton.backgroundTintList = playPauseColorStateList
                favoriteButton.iconTint = selectedIconTint
            } else {
                // Not saved: transparent background with colored icon
                favoriteButton.backgroundTintList = android.content.res.ColorStateList.valueOf(android.graphics.Color.TRANSPARENT)
                favoriteButton.iconTint = currentIconColorStateList
            }
        } else if (!isPodcast && station != null) {
            // Radio station favorite styling - match bookmark button behavior
            val isFavorited = FavoritesPreference.isFavorite(this, station.id)
            if (isFavorited) {
                // Favorited: use same filled circle style as play/pause button
                favoriteButton.backgroundTintList = playPauseColorStateList
                favoriteButton.iconTint = selectedIconTint
            } else {
                // Not favorited: transparent background with colored icon
                favoriteButton.backgroundTintList = android.content.res.ColorStateList.valueOf(android.graphics.Color.TRANSPARENT)
                favoriteButton.iconTint = currentIconColorStateList
            }
        }
    }

    private fun toggleFavorite() {
        // Prefer episode-save (bookmark) whenever an episode is in context (playing or preview).
        val station = PlaybackStateHelper.getCurrentStation()
        val episodeIdInPlayback = PlaybackStateHelper.getCurrentEpisodeId()
        val episodeId = previewEpisodeProp?.id ?: episodeIdInPlayback ?: currentShownEpisodeId

        if (!episodeId.isNullOrEmpty()) {
            // Construct Episode object when necessary (previewEpisodeProp may already be available)
            val baseTitle = PlaybackStateHelper.getCurrentShow().episodeTitle ?: PlaybackStateHelper.getCurrentShow().title
            val episode = previewEpisodeProp ?: Episode(
                id = episodeId,
                title = baseTitle.takeIf { it.isNotBlank() } ?: "Saved episode",
                description = PlaybackStateHelper.getCurrentShow().description ?: "",
                audioUrl = "",
                imageUrl = PlaybackStateHelper.getCurrentShow().imageUrl ?: "",
                pubDate = "",
                durationMins = 0,
                podcastId = (station?.id?.removePrefix("podcast_") ?: previewEpisodeProp?.podcastId).orEmpty()
            )
            val podcastTitle = PlaybackStateHelper.getCurrentStation()?.title ?: supportActionBar?.title?.toString() ?: "Podcast"
            val nowSaved = SavedEpisodes.toggleSaved(this, episode, podcastTitle)
            val msg = if (nowSaved) "Saved episode: ${episode.title}" else "Removed saved episode: ${episode.title}"
            com.google.android.material.snackbar.Snackbar.make(findViewById(android.R.id.content), msg, com.google.android.material.snackbar.Snackbar.LENGTH_SHORT)
                .setAnchorView(findViewById(R.id.playback_controls))
                .show()
            // Immediately reflect saved state in the UI (bookmark icon)
            favoriteButton.icon = ContextCompat.getDrawable(this, if (nowSaved) R.drawable.ic_bookmark else getUnsavedBookmarkIconRes())
            updateFavoriteButtonBackground()
            updateUI()
            return
        }

        // No episode in context — fall back to station/podcast favorite/subscription behavior
        if (station != null) {
            if (station.id.startsWith("podcast_")) {
                val podcastId = station.id.removePrefix("podcast_")
                PodcastSubscriptions.toggleSubscription(this, podcastId)
                val now = PodcastSubscriptions.isSubscribed(this, podcastId)
                val podcastName = station.title
                val msg = if (now) "Subscribed to ${podcastName}" else "Unsubscribed from ${podcastName}"
                com.google.android.material.snackbar.Snackbar.make(findViewById(android.R.id.content), msg, com.google.android.material.snackbar.Snackbar.LENGTH_SHORT)
                    .setAnchorView(findViewById(R.id.playback_controls))
                    .show()
            } else {
                FavoritesPreference.toggleFavorite(this, station.id)
                // Update the favorite button background styling immediately
                updateFavoriteButtonBackground()
            }
            updateUI()
            return
        }

        // If we reach here and previewEpisodeProp exists (defensive), handle it as episode-save
        val preview = previewEpisodeProp
        if (preview != null) {
            val nowSaved = SavedEpisodes.toggleSaved(this, preview, supportActionBar?.title?.toString().orEmpty())
            val msg = if (nowSaved) "Saved episode: ${preview.title}" else "Removed saved episode: ${preview.title}"
            com.google.android.material.snackbar.Snackbar.make(findViewById(android.R.id.content), msg, com.google.android.material.snackbar.Snackbar.LENGTH_SHORT)
                .setAnchorView(findViewById(R.id.playback_controls))
                .show()
            favoriteButton.icon = ContextCompat.getDrawable(this, if (nowSaved) R.drawable.ic_bookmark else getUnsavedBookmarkIconRes())
            updateFavoriteButtonBackground()
        }
    }

    private fun startPlaybackStateUpdates() {
        stopPlaybackStateUpdates()
        updateTimer = Thread {
            while (!Thread.currentThread().isInterrupted) {
                try {
                    Thread.sleep(500) // Update every 500ms
                    if (!isFinishing && !isDestroyed) {
                        runOnUiThread { updateUI() }
                    }
                } catch (e: InterruptedException) {
                    break
                }
            }
        }
        updateTimer?.start()
    }

    private fun stopPlaybackStateUpdates() {
        updateTimer?.interrupt()
        updateTimer = null
    }

    private fun showFullDescription() {
        val title = episodeTitle.text?.toString()?.takeIf { it.isNotEmpty() } ?: "Episode Description"
        val dialog = EpisodeDescriptionDialogFragment.newInstance(fullDescriptionHtml, title, lastArtworkUrl)
        dialog.show(supportFragmentManager, "episode_description")
    }

    private fun updateMarkPlayedButtonState() {
        // The mark-as-played control is intentionally hidden from the app bar to avoid duplication with
        // the main star subscription action. Keep it GONE so it does not display in the app bar.
        markPlayedButton.visibility = android.view.View.GONE
    }

    private fun showGenericStationArtwork(stationId: String) {
        stationArtwork.setImageDrawable(StationArtwork.createDrawable(stationId))
        applyDominantColor(StationArtwork.getTintColor(stationId))
    }

    private fun extractAndApplyDominantColor(bitmap: Bitmap) {
        Palette.from(bitmap).generate { palette ->
            if (palette != null && !isFinishing && !isDestroyed) {
                val isDarkMode = (resources.configuration.uiMode and
                    android.content.res.Configuration.UI_MODE_NIGHT_MASK) ==
                    android.content.res.Configuration.UI_MODE_NIGHT_YES

                val dominantColor = if (isDarkMode) {
                    palette.darkMutedSwatch?.rgb
                        ?: palette.darkVibrantSwatch?.rgb
                        ?: palette.mutedSwatch?.rgb
                        ?: palette.dominantSwatch?.rgb
                } else {
                    palette.lightMutedSwatch?.rgb
                        ?: palette.lightVibrantSwatch?.rgb
                        ?: palette.mutedSwatch?.rgb
                        ?: palette.dominantSwatch?.rgb
                }

                if (dominantColor != null) {
                    applyDominantColor(dominantColor)
                }
            }
        }
    }

    private fun applyDominantColor(dominantColor: Int) {
        val isDarkMode = (resources.configuration.uiMode and
            android.content.res.Configuration.UI_MODE_NIGHT_MASK) ==
            android.content.res.Configuration.UI_MODE_NIGHT_YES

        val subtleColor = if (isDarkMode) {
            val darkenFactor = 0.4f
            val red = ((dominantColor shr 16) and 0xFF) * darkenFactor
            val green = ((dominantColor shr 8) and 0xFF) * darkenFactor
            val blue = (dominantColor and 0xFF) * darkenFactor
            android.graphics.Color.rgb(red.toInt(), green.toInt(), blue.toInt())
        } else {
            val lightenFactor = 0.7f
            val red = 255 - ((255 - ((dominantColor shr 16) and 0xFF)) * (1 - lightenFactor)).toInt()
            val green = 255 - ((255 - ((dominantColor shr 8) and 0xFF)) * (1 - lightenFactor)).toInt()
            val blue = 255 - ((255 - (dominantColor and 0xFF)) * (1 - lightenFactor)).toInt()
            android.graphics.Color.rgb(red, green, blue)
        }

        val r = ((subtleColor shr 16) and 0xFF) / 255f
        val g = ((subtleColor shr 8) and 0xFF) / 255f
        val b = (subtleColor and 0xFF) / 255f
        val luminance = 0.299 * r + 0.587 * g + 0.114 * b
        val isLightBackground = luminance > 0.5f

        val buttonOutlineColor = if (isLightBackground) {
            val buttonRed = ((dominantColor shr 16) and 0xFF) * 0.7f
            val buttonGreen = ((dominantColor shr 8) and 0xFF) * 0.7f
            val buttonBlue = (dominantColor and 0xFF) * 0.7f
            android.graphics.Color.rgb(buttonRed.toInt(), buttonGreen.toInt(), buttonBlue.toInt())
        } else {
            val buttonRed = (((dominantColor shr 16) and 0xFF) + 255) / 2
            val buttonGreen = (((dominantColor shr 8) and 0xFF) + 255) / 2
            val buttonBlue = ((dominantColor and 0xFF) + 255) / 2
            android.graphics.Color.rgb(buttonRed, buttonGreen, buttonBlue)
        }

        val playPauseButtonColor = if (isLightBackground) {
            val buttonRed = ((dominantColor shr 16) and 0xFF) * 0.8f
            val buttonGreen = ((dominantColor shr 8) and 0xFF) * 0.8f
            val buttonBlue = (dominantColor and 0xFF) * 0.8f
            android.graphics.Color.rgb(buttonRed.toInt(), buttonGreen.toInt(), buttonBlue.toInt())
        } else {
            val buttonRed = (((dominantColor shr 16) and 0xFF) * 0.5f + 255 * 0.5f).toInt()
            val buttonGreen = (((dominantColor shr 8) and 0xFF) * 0.5f + 255 * 0.5f).toInt()
            val buttonBlue = ((dominantColor and 0xFF) * 0.5f + 255 * 0.5f).toInt()
            android.graphics.Color.rgb(buttonRed, buttonGreen, buttonBlue)
        }

        val iconColor = if (isLightBackground) {
            android.graphics.Color.rgb(
                (dominantColor shr 16) and 0xFF,
                (dominantColor shr 8) and 0xFF,
                dominantColor and 0xFF
            )
        } else {
            android.graphics.Color.WHITE
        }

        currentButtonOutlineColor = buttonOutlineColor
        currentPlayPauseButtonColor = playPauseButtonColor
        currentIconColor = iconColor
        currentIsLightBackground = isLightBackground

        runOnUiThread {
            rootLayout.setBackgroundColor(subtleColor)
            toolbar.setBackgroundColor(subtleColor)

            val outlineButtonColorStateList = ColorStateList.valueOf(buttonOutlineColor)
            val playPauseButtonColorStateList = ColorStateList.valueOf(playPauseButtonColor)
            val iconColorStateList = ColorStateList.valueOf(iconColor)

            stopButton.backgroundTintList = outlineButtonColorStateList
            stopButton.iconTint = iconColorStateList
            previousButton.backgroundTintList = outlineButtonColorStateList
            previousButton.iconTint = iconColorStateList
            nextButton.backgroundTintList = outlineButtonColorStateList
            nextButton.iconTint = iconColorStateList
            favoriteButton.backgroundTintList = outlineButtonColorStateList
            favoriteButton.iconTint = iconColorStateList
            openPodcastButton.backgroundTintList = outlineButtonColorStateList

            val station = PlaybackStateHelper.getCurrentStation()
            val isPodcast = station?.id?.startsWith("podcast_") == true
            val episodeIdInPlayback = PlaybackStateHelper.getCurrentEpisodeId()
            val episodeId = previewEpisodeProp?.id ?: episodeIdInPlayback ?: currentShownEpisodeId

            if (!episodeId.isNullOrEmpty()) {
                val isSaved = SavedEpisodes.isSaved(this@NowPlayingActivity, episodeId)
                if (isSaved) {
                    favoriteButton.backgroundTintList = playPauseButtonColorStateList
                    favoriteButton.iconTint = ColorStateList.valueOf(android.graphics.Color.WHITE)
                } else {
                    favoriteButton.backgroundTintList = ColorStateList.valueOf(android.graphics.Color.TRANSPARENT)
                    favoriteButton.iconTint = iconColorStateList
                }
            } else if (!isPodcast && station != null) {
                val isFavorited = FavoritesPreference.isFavorite(this@NowPlayingActivity, station.id)
                if (isFavorited) {
                    favoriteButton.backgroundTintList = playPauseButtonColorStateList
                    favoriteButton.iconTint = ColorStateList.valueOf(android.graphics.Color.WHITE)
                } else {
                    favoriteButton.backgroundTintList = ColorStateList.valueOf(android.graphics.Color.TRANSPARENT)
                    favoriteButton.iconTint = iconColorStateList
                }
            }

            playPauseButton.backgroundTintList = playPauseButtonColorStateList
            playPauseButton.iconTint = ColorStateList.valueOf(android.graphics.Color.WHITE)

            seekBar.trackActiveTintList = iconColorStateList
            seekBar.thumbTintList = iconColorStateList

            val inactiveColor = android.graphics.Color.argb(
                76,
                android.graphics.Color.red(iconColor),
                android.graphics.Color.green(iconColor),
                android.graphics.Color.blue(iconColor)
            )
            seekBar.trackInactiveTintList = ColorStateList.valueOf(inactiveColor)
            seekBar.haloTintList = ColorStateList.valueOf(inactiveColor)

            WindowInsetsControllerCompat(window, window.decorView).apply {
                isAppearanceLightStatusBars = !isDarkMode
                isAppearanceLightNavigationBars = !isDarkMode
            }
        }
    }
}