package com.hyliankid14.bbcradioplayer

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.net.Uri
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import androidx.core.app.NotificationCompat
import androidx.core.graphics.drawable.DrawableCompat
import androidx.appcompat.content.res.AppCompatResources
import androidx.media.app.NotificationCompat.MediaStyle
import androidx.media.MediaBrowserServiceCompat
import android.support.v4.media.MediaBrowserCompat
import android.support.v4.media.MediaBrowserCompat.MediaItem
import android.support.v4.media.MediaDescriptionCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.graphics.Bitmap
import android.graphics.Canvas
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import com.google.android.exoplayer2.ExoPlayer
import com.google.android.exoplayer2.Player
import com.google.android.exoplayer2.PlaybackException
import com.google.android.exoplayer2.MediaItem as ExoMediaItem
import com.google.android.exoplayer2.MediaMetadata
import com.google.android.exoplayer2.upstream.DefaultDataSource
import com.hyliankid14.bbcradioplayer.PodcastSubscriptions
import com.google.android.exoplayer2.audio.AudioAttributes as ExoAudioAttributes
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

class RadioService : MediaBrowserServiceCompat() {
    private lateinit var mediaSession: MediaSessionCompat
    private var player: ExoPlayer? = null
    private val audioManager by lazy { getSystemService(Context.AUDIO_SERVICE) as AudioManager }
    private var audioFocusRequest: AudioFocusRequest? = null
    
    // Audio focus listener — fully stops playback on permanent loss so that switching
    // to another audio app leaves no lingering notification or service.
    // Note: ExoPlayer also manages audio focus internally (handleAudioFocus = true),
    // so this listener receives AUDIOFOCUS_LOSS both from external apps AND from
    // ExoPlayer's own focus request during startup. The player?.isPlaying guard
    // prevents a false stopPlayback() during the startup window before playback begins.
    private val audioFocusChangeListener = AudioManager.OnAudioFocusChangeListener { focusChange ->
        if (focusChange == AudioManager.AUDIOFOCUS_LOSS) {
            Log.d(TAG, "Audio focus permanently lost — stopping playback")
            try {
                if (player?.isPlaying == true) {
                    stopPlayback()
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error stopping playback on focus loss: ${e.message}")
            }
        }
    }
    
    private var currentStationTitle: String = ""
    @Volatile private var currentStationId: String = ""
    private var currentStreamCandidateIndex: Int = 0
    private var currentStreamCandidates: List<String> = emptyList()
    private var currentPodcastId: String? = null
    private var matchedPodcast: Podcast? = null  // Podcast matching currently playing radio show for Android Auto
    private var matchPodcastJob: kotlinx.coroutines.Job? = null
    private var matchPodcastGeneration: Int = 0
    private var lastMatchKey: String? = null
    private val handler = android.os.Handler(android.os.Looper.getMainLooper())
    private var currentStationLogo: String = ""
    private var currentShowName: String = "" // Actual show name (not artist-track)
    private var currentShowTitle: String = "BBC Radio"
    private var currentEpisodeTitle: String = ""
    private var currentShowInfo: CurrentShow = CurrentShow("BBC Radio")
    private var lastSongSignature: String? = null
    // Tracks which song signature was actually saved to RecentSongsPreference; updated only when addSong is called
    private var lastSavedSongSignature: String? = null
    private val showInfoPollIntervalMs = 30_000L // Poll RMS at BBC's sweet spot (30s)
    private var alarmVolumeRampRunnable: Runnable? = null
    private var currentArtworkBitmap: android.graphics.Bitmap? = null
    private var currentArtworkUri: String? = null
    private var currentEpisodeArtworkUrl: String? = null
    private var currentPodcastArtworkUrl: String? = null
    private var showInfoRefreshRunnable: Runnable? = null
    // Pending show info scheduled to be applied after a short delay (to account for stream latency)
    private var pendingShowInfo: CurrentShow? = null
    private var applyShowInfoRunnable: Runnable? = null
    private var podcastProgressRunnable: Runnable? = null

    // Subtitle cycling for head‑units (slowly alternate show name <> show subtitle when no song metadata)
    private var subtitleCycleRunnable: Runnable? = null
    private var showSubtitleCycleState: Int = 0
    private var isSubtitleCycling: Boolean = false
    private val SUBTITLE_CYCLE_MS: Long = 6_000L // slow cycle (6s) — adjust if needed

    // Delayed analytics tracking for stations (only count after 10s of playback)
    private var stationAnalyticsRunnable: Runnable? = null
    private var stationAnalyticsPending: Boolean = false
    private var stationAnalyticsScheduled: Boolean = false
    // Delayed analytics tracking for episodes (only count after 10s of playback)
    private var episodeAnalyticsRunnable: Runnable? = null
    private var episodeAnalyticsPending: Boolean = false
    private var episodeAnalyticsScheduled: Boolean = false
    private var lastTrackedEpisodeAnalyticsId: String? = null

    private var notificationHadProgress: Boolean = false
    @Volatile private var isStopped: Boolean = false
    private var playerReconnectRunnable: Runnable? = null
    // Track last-saved progress per episode to avoid excessive writes
    private val lastSavedProgress = mutableMapOf<String, Long>()
    private val serviceScope = CoroutineScope(Dispatchers.Main)
    private var lastAndroidAutoClientUid: Int? = null
    private var lastAndroidAutoRefreshMs: Long = 0L
    private var lastAndroidAutoAutoplayMs: Long = 0L

    // Service-level episode cache for Android Auto pagination.
    // Keyed by podcast ID; populated on first episode load so subsequent page requests
    // (and non-paginated back-navigation) are served instantly without refetching the RSS feed.
    private val autoEpisodesCache: MutableMap<String, List<Episode>> = mutableMapOf()
    
    // Receiver to react to history/import changes so Android Auto clients can refresh
    private var historyChangeReceiver: android.content.BroadcastReceiver? = null

    private val placeholderBitmap by lazy {
        android.graphics.Bitmap.createBitmap(1, 1, android.graphics.Bitmap.Config.ARGB_8888)
    }
    private val autoEpisodeDateFormat = object : ThreadLocal<SimpleDateFormat>() {
        override fun initialValue(): SimpleDateFormat = SimpleDateFormat("EEE, dd MMM yyyy", Locale.US)
    }

    companion object {
        const val ACTION_PLAY_STATION = "com.hyliankid14.bbcradioplayer.ACTION_PLAY_STATION"
        const val ACTION_PLAY = "com.hyliankid14.bbcradioplayer.ACTION_PLAY"
        const val ACTION_PAUSE = "com.hyliankid14.bbcradioplayer.ACTION_PAUSE"
        const val ACTION_STOP = "com.hyliankid14.bbcradioplayer.ACTION_STOP"
        const val ACTION_SKIP_TO_NEXT = "com.hyliankid14.bbcradioplayer.ACTION_SKIP_TO_NEXT"
        const val ACTION_SKIP_TO_PREVIOUS = "com.hyliankid14.bbcradioplayer.ACTION_SKIP_TO_PREVIOUS"
        const val ACTION_TOGGLE_FAVORITE = "com.hyliankid14.bbcradioplayer.ACTION_TOGGLE_FAVORITE"
        const val ACTION_PLAY_PODCAST_EPISODE = "com.hyliankid14.bbcradioplayer.ACTION_PLAY_PODCAST_EPISODE"
        const val ACTION_REFRESH_PODCAST_ARTWORK = "com.hyliankid14.bbcradioplayer.ACTION_REFRESH_PODCAST_ARTWORK"
        const val ACTION_SEEK_TO = "com.hyliankid14.bbcradioplayer.ACTION_SEEK_TO"
        const val ACTION_SEEK_DELTA = "com.hyliankid14.bbcradioplayer.ACTION_SEEK_DELTA"
        const val EXTRA_STATION_ID = "com.hyliankid14.bbcradioplayer.EXTRA_STATION_ID"
        const val EXTRA_ALARM_VOLUME_RAMP = "com.hyliankid14.bbcradioplayer.EXTRA_ALARM_VOLUME_RAMP"
        const val EXTRA_ALARM_MANUAL_VOLUME = "com.hyliankid14.bbcradioplayer.EXTRA_ALARM_MANUAL_VOLUME"
        const val EXTRA_EPISODE = "com.hyliankid14.bbcradioplayer.EXTRA_EPISODE"
        const val EXTRA_PODCAST_ID = "com.hyliankid14.bbcradioplayer.EXTRA_PODCAST_ID"
        const val EXTRA_PODCAST_TITLE = "com.hyliankid14.bbcradioplayer.EXTRA_PODCAST_TITLE"
        const val EXTRA_PODCAST_IMAGE = "com.hyliankid14.bbcradioplayer.EXTRA_PODCAST_IMAGE"
        const val EXTRA_SEEK_POSITION = "com.hyliankid14.bbcradioplayer.EXTRA_SEEK_POSITION"
        const val EXTRA_SEEK_FRACTION = "com.hyliankid14.bbcradioplayer.EXTRA_SEEK_FRACTION"
        const val EXTRA_SEEK_DELTA = "com.hyliankid14.bbcradioplayer.EXTRA_SEEK_DELTA"
        private const val TAG = "RadioService"
        private const val ANALYTICS_MIN_PLAY_MS = 10_001L // strictly more than 10s
        private const val CHANNEL_ID = "radio_playback"
        private const val NOTIFICATION_ID = 1
        private const val CUSTOM_ACTION_TOGGLE_FAVORITE = "TOGGLE_FAVORITE"
        private const val CUSTOM_ACTION_SUBSCRIBE = "SUBSCRIBE_PODCAST"
        private const val CUSTOM_ACTION_SPACER = "SPACER"
        private const val CUSTOM_ACTION_STOP = "STOP"
        private const val CUSTOM_ACTION_SEEK_FORWARD = "SEEK_FORWARD_30"
        private const val CUSTOM_ACTION_SEEK_BACK = "SEEK_BACK_10"

        // Delay Now Playing updates for live streams by this amount to match the stream latency
        private const val NOW_PLAYING_UPDATE_DELAY_MS = 15_000L
        
        private const val MEDIA_ID_ROOT = "root"
        private const val MEDIA_ID_FAVORITES = "favorites"
        private const val MEDIA_ID_ALL_STATIONS = "all_stations"
        private const val MEDIA_ID_PODCASTS = "podcasts"
        private const val MEDIA_ID_PODCASTS_DOWNLOADED = "podcasts_downloaded"
        private const val MEDIA_ID_PODCASTS_RANDOM = "podcasts_random"
        private const val ANDROID_AUTO_CLIENT_HINT = "gearhead"
        // Number of episodes returned per page when Android Auto requests paginated episode lists.
        private const val EPISODE_PAGE_SIZE = 20
        // Maximum number of episodes fetched from an RSS feed for Android Auto display.
        // Limits RSS download/parse time for podcasts with hundreds of episodes so that
        // onLoadChildren returns before Android Auto's internal timeout fires.
        private const val AUTO_MAX_EPISODES = 100
        private const val AUTO_RECONNECT_REFRESH_COOLDOWN_MS = 5_000L
        // Platform pagination keys used by MediaBrowserService; not present on MediaBrowserServiceCompat.
        private const val EXTRA_PAGE = "android.service.media.extra.PAGE"
        private const val EXTRA_PAGE_SIZE = "android.service.media.extra.PAGE_SIZE"
    }

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "onCreate - Service starting")
        createNotificationChannel()
        // Register receiver so external changes to played-history (import/clear) refresh Android Auto children
        try {
            historyChangeReceiver = object : android.content.BroadcastReceiver() {
                override fun onReceive(context: android.content.Context?, intent: android.content.Intent?) {
                    try { notifyChildrenChanged(MEDIA_ID_PODCASTS) } catch (_: Exception) { }
                }
            }
            registerReceiver(historyChangeReceiver, android.content.IntentFilter(PlayedHistoryPreference.ACTION_HISTORY_CHANGED))
        } catch (_: Exception) { }
        
        // Create and configure media session FIRST
        mediaSession = MediaSessionCompat(this, "RadioService")
        mediaSession.setCallback(object : MediaSessionCompat.Callback() {
            override fun onPlay() {
                Log.d(TAG, "onPlay called")
                handlePlayRequest("MediaSession.onPlay")
            }

            override fun onSkipToNext() {
                Log.d(TAG, "onSkipToNext")
                // If a podcast is playing, treat skip next as "Forward 30s"
                if (currentStationId.startsWith("podcast_")) {
                    seekBy(30_000L)
                } else {
                    skipStation(1)
                }
            }

            override fun onSkipToPrevious() {
                Log.d(TAG, "onSkipToPrevious")
                // If a podcast is playing, treat skip previous as "Back 10s"
                if (currentStationId.startsWith("podcast_")) {
                    seekBy(-10_000L)
                } else {
                    skipStation(-1)
                }
            }

            override fun onPause() {
                Log.d(TAG, "onPause called")
                handlePauseRequest("MediaSession.onPause")
            }

            override fun onStop() {
                Log.d(TAG, "onStop called")
                stopPlayback()
            }

            override fun onPlayFromMediaId(mediaId: String?, extras: Bundle?) {
                Log.d(TAG, "onPlayFromMediaId called with mediaId: $mediaId")
                mediaId?.let { id ->
                    if (id == MEDIA_ID_PODCASTS_RANDOM) {
                        playRandomPodcastMostRecentFromAuto()
                    } else if (id.startsWith("podcast_episode_")) {
                        val episodeId = id.removePrefix("podcast_episode_")
                        serviceScope.launch {
                            try {
                                val repo = PodcastRepository(this@RadioService)
                                val all = withContext(Dispatchers.IO) { repo.fetchPodcasts(false) }
                                val subscribed = PodcastSubscriptions.getSubscribedIds(this@RadioService)
                                var ep: Episode? = null
                                var parentPodcast: Podcast? = null
                                for (p in all) {
                                    if (!subscribed.contains(p.id)) continue
                                    try {
                                        val episodes = withContext(Dispatchers.IO) { repo.fetchEpisodes(p) }
                                        val found = episodes.find { it.id == episodeId }
                                        if (found != null) {
                                            ep = found
                                            parentPodcast = p
                                            break
                                        }
                                    } catch (e: Exception) {
                                        // ignore and continue
                                    }
                                }

                                if (ep != null) {
                                    val playIntent = android.content.Intent().apply {
                                        parentPodcast?.let { putExtra(EXTRA_PODCAST_TITLE, it.title) }
                                        parentPodcast?.let { putExtra(EXTRA_PODCAST_IMAGE, it.imageUrl) }
                                    }
                                    playPodcastEpisode(ep, playIntent)
                                } else {
                                    // Fallback: check saved episodes (may not be in subscriptions)
                                    try {
                                        val saved = SavedEpisodes.getSavedEntries(this@RadioService)
                                        val savedEntry = saved.find { it.id == episodeId }
                                        if (savedEntry != null) {
                                            val savedEp = Episode(
                                                id = savedEntry.id,
                                                title = savedEntry.title,
                                                description = savedEntry.description,
                                                audioUrl = savedEntry.audioUrl,
                                                imageUrl = savedEntry.imageUrl,
                                                pubDate = savedEntry.pubDate,
                                                durationMins = savedEntry.durationMins,
                                                podcastId = savedEntry.podcastId
                                            )
                                            val playIntent = android.content.Intent().apply {
                                                putExtra(EXTRA_PODCAST_TITLE, savedEntry.podcastTitle)
                                                putExtra(EXTRA_PODCAST_IMAGE, savedEntry.imageUrl)
                                            }
                                            playPodcastEpisode(savedEp, playIntent)
                                        } else {
                                            // Fallback: try downloaded episodes (supports offline playback)
                                            val d = DownloadedEpisodes.getDownloadedEntry(this@RadioService, episodeId)
                                            if (d != null) {
                                                val playIntent = android.content.Intent().apply {
                                                    putExtra(EXTRA_PODCAST_TITLE, d.podcastTitle)
                                                    putExtra(EXTRA_PODCAST_IMAGE, d.imageUrl)
                                                }
                                                playPodcastEpisode(downloadedEntryToEpisode(d), playIntent)
                                            } else {
                                                Log.w(TAG, "Episode not found for id: $episodeId")
                                            }
                                        }
                                    } catch (e: Exception) {
                                        Log.e(TAG, "Error searching saved episodes for id: $episodeId", e)
                                    }
                                }
                            } catch (e: Exception) {
                                Log.e(TAG, "Error playing episode from mediaId: $mediaId", e)
                            }
                        }
                    } else {
                        playStation(id)
                    }
                }
            }

            override fun onSeekTo(pos: Long) {
                Log.d(TAG, "onSeekTo called with pos: $pos")
                seekToPosition(pos)
            }

            override fun onCustomAction(action: String?, extras: Bundle?) {
                Log.d(TAG, "onCustomAction called with action: $action")
                when (action) {
                    CUSTOM_ACTION_STOP -> stopPlayback()
                    // legacy custom previous/next removed to avoid duplicates; onSkipToNext/onSkipToPrevious handle mapping
                    CUSTOM_ACTION_TOGGLE_FAVORITE -> {
                        if (currentStationId.isNotEmpty()) {
                            toggleFavoriteAndNotify(currentStationId)
                        }
                    }
                    CUSTOM_ACTION_SUBSCRIBE -> {
                        matchedPodcast?.let { podcast ->
                            PodcastSubscriptions.toggleSubscription(this@RadioService, podcast.id)
                            val nowSubscribed = PodcastSubscriptions.isSubscribed(this@RadioService, podcast.id)
                            Log.d(TAG, "Podcast subscription toggled via Android Auto: ${podcast.title} (subscribed=$nowSubscribed)")
                            
                            // Show toast feedback (may appear in Android Auto on some head units)
                            handler.post {
                                val message = if (nowSubscribed) {
                                    "Subscribed to ${podcast.title}"
                                } else {
                                    "Unsubscribed from ${podcast.title}"
                                }
                                android.widget.Toast.makeText(this@RadioService, message, android.widget.Toast.LENGTH_SHORT).show()
                            }
                            
                            // Refresh playback state to update button icon and label
                            updatePlaybackState(mediaSession.controller.playbackState?.state ?: PlaybackStateCompat.STATE_PLAYING)
                        }
                    }
                    CUSTOM_ACTION_SEEK_FORWARD -> {
                        seekBy(30_000L)
                    }
                    CUSTOM_ACTION_SEEK_BACK -> {
                        seekBy(-10_000L)
                    }
                }
            }
        })
        
        @Suppress("DEPRECATION")
        mediaSession.setFlags(
            MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
        )
        mediaSession.isActive = true
        
        // Set session activity for Android Auto
        val sessionIntent = Intent(this, MainActivity::class.java)
        val sessionPendingIntent = PendingIntent.getActivity(
            this, 0, sessionIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        mediaSession.setSessionActivity(sessionPendingIntent)
        
        // Set session token IMMEDIATELY
        sessionToken = mediaSession.sessionToken
        Log.d(TAG, "Session token set: $sessionToken")
        
        // Set initial playback state
        updatePlaybackState(PlaybackStateCompat.STATE_NONE)
        
        Log.d(TAG, "onCreate complete - Service ready")
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Radio Playback",
                NotificationManager.IMPORTANCE_DEFAULT
            )
            channel.setSound(null, null)
            channel.enableVibration(false)
            channel.enableLights(false)
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }
    }

    private fun updatePlaybackState(state: Int) {
        // Once stopPlayback() sets isStopped = true the MediaSession has already been
        // deactivated and cleared. Samsung One UI 8's "Live notifications" system monitors
        // setPlaybackState() calls on *any* MediaSession – active or not – and will rebuild
        // its media-player widget whenever it sees one.  Returning here prevents both the
        // ExoPlayer onPlaybackStateChanged(STATE_IDLE) callback (fired synchronously from
        // player?.stop()) and any subsequent explicit calls from posting new state to the
        // session after it has been cleared.
        if (isStopped) return
        val isPodcast = currentStationId.startsWith("podcast_")
        val podcastId = currentPodcastId
        // For podcasts with an active episode, treat the star as saved-episode state. Otherwise treat as subscription state.
        val currentEpisode = PlaybackStateHelper.getCurrentEpisodeId()
        val isFavorite = if (isPodcast && !currentEpisode.isNullOrEmpty()) {
            SavedEpisodes.isSaved(this, currentEpisode)
        } else if (isPodcast && podcastId != null) {
            PodcastSubscriptions.isSubscribed(this, podcastId)
        } else {
            currentStationId.isNotEmpty() && FavoritesPreference.isFavorite(this, currentStationId)
        }

        val favoriteLabel = when {
            isPodcast && !currentEpisode.isNullOrEmpty() && isFavorite -> "Remove saved episode"
            isPodcast && !currentEpisode.isNullOrEmpty() -> "Save episode"
            isPodcast && isFavorite -> "Unsubscribe"
            isPodcast -> "Subscribe"
            isFavorite -> "Remove from Favorites"
            else -> "Add to Favorites"
        }

        val favoriteIcon = when {
            isPodcast && !currentEpisode.isNullOrEmpty() && isFavorite -> R.drawable.ic_bookmark
            isPodcast && !currentEpisode.isNullOrEmpty() -> R.drawable.ic_bookmark_outline_stroked
            isFavorite -> R.drawable.ic_star_filled_yellow
            else -> R.drawable.ic_star_outline_stroked
        }

        // Determine allowed actions. For podcasts we avoid SKIP actions (replaced by seek custom actions)
        val pbBuilder = PlaybackStateCompat.Builder()

        val baseActions = PlaybackStateCompat.ACTION_PLAY or
                PlaybackStateCompat.ACTION_PAUSE or
                PlaybackStateCompat.ACTION_STOP or
                PlaybackStateCompat.ACTION_PLAY_FROM_MEDIA_ID or
                PlaybackStateCompat.ACTION_PLAY_PAUSE

        if (isPodcast) {
            // For podcasts expose skip next/previous as standard actions (they map to seekBy in our callbacks)
            pbBuilder.setActions(baseActions or PlaybackStateCompat.ACTION_SEEK_TO or PlaybackStateCompat.ACTION_SKIP_TO_NEXT or PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS)
            // Try to provide accurate position from the current show (updated by the podcast progress runnable)
            val show = PlaybackStateHelper.getCurrentShow()
            val pos = show.segmentStartMs ?: player?.currentPosition ?: PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN
            pbBuilder.setState(state, pos, 1.0f)
        } else {
            // For live streams include skip next/previous
            pbBuilder.setActions(baseActions or PlaybackStateCompat.ACTION_SEEK_TO or PlaybackStateCompat.ACTION_SKIP_TO_NEXT or PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS)
            pbBuilder.setState(state, PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN, 1.0f)
        }

        // Use the left custom-action slot for Stop (some Android media UIs don't show ACTION_STOP)
        // Order actions to prefer: Stop, Previous, Play/Pause, Next, Favorite
        pbBuilder.addCustomAction(
                CUSTOM_ACTION_STOP,
                "Stop",
                R.drawable.ic_stop
            )

        // For live radio stations with matching podcasts, show subscribe action in Android Auto
        if (!isPodcast && matchedPodcast != null) {
            val podcast = matchedPodcast!!
            val isSubscribed = PodcastSubscriptions.isSubscribed(this, podcast.id)
            val subscribeLabel = if (isSubscribed) "Unsubscribe" else "Subscribe to podcast"
            val subscribeIcon = if (isSubscribed) R.drawable.ic_podcast else R.drawable.ic_podcast_outline
            pbBuilder.addCustomAction(
                CUSTOM_ACTION_SUBSCRIBE,
                subscribeLabel,
                subscribeIcon
            )
        }

        // For podcasts we advertise standard skip prev/next via setActions above (mapped to seek in callbacks)

        // If a matching podcast is available, keep Favorite as a secondary custom action so
        // Android Auto can move it into the overflow alongside Subscribe.
        pbBuilder.addCustomAction(
                CUSTOM_ACTION_TOGGLE_FAVORITE,
                favoriteLabel,
                favoriteIcon
            )

        mediaSession.setPlaybackState(pbBuilder.build())
    }

    override fun onGetRoot(clientName: String, clientUid: Int, rootHints: Bundle?): BrowserRoot? {
        Log.d(TAG, "onGetRoot called for client: $clientName, uid: $clientUid")
        maybeHandleAndroidAutoReconnect(clientName, clientUid)

        // Opt out of Android 11+'s media resumption feature (and Samsung One UI 8's "Live
        // notifications / recently played" card) when the user has explicitly stopped playback.
        // The system sends EXTRA_RECENT = true to discover which apps have recently-played
        // content.  Returning null here prevents it from connecting and building a "resume"
        // notification in the shade.  Android Auto does NOT use this hint so returning null
        // here does not affect Android Auto browsing or playback.
        if (rootHints?.getBoolean(BrowserRoot.EXTRA_RECENT) == true && isStopped) {
            Log.d(TAG, "onGetRoot: returning null for EXTRA_RECENT request (playback stopped)")
            return null
        }

        val extras = Bundle().apply {
            putBoolean("android.media.browse.CONTENT_STYLE_SUPPORTED", true)
            putInt("android.media.browse.CONTENT_STYLE_PLAYABLE_HINT", 1) // 1 = LIST
            putInt("android.media.browse.CONTENT_STYLE_BROWSABLE_HINT", 1) // 1 = LIST
        }
        
        Log.d(TAG, "onGetRoot returning root with extras")
        return BrowserRoot("root", extras)
    }

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        // If an Android Auto client was tracked, treat unbind as an Auto disconnect signal.
        // Some head-units/OEM stacks can report a different calling UID here, so relying only
        // on Binder#getCallingUid can miss the disconnect and leave a paused podcast session
        // alive. That stale session keeps posting metadata/notification updates and can make the
        // media notification reappear after the phone disconnects from the car.
        try {
            val trackedAutoUid = lastAndroidAutoClientUid
            val uid = android.os.Binder.getCallingUid()
            if (trackedAutoUid != null) {
                val pkgs = packageManager.getPackagesForUid(uid) ?: emptyArray()
                val isAutoCaller = pkgs.any {
                    it.contains(ANDROID_AUTO_CLIENT_HINT, ignoreCase = true) ||
                        it.contains("com.google.android.projection") ||
                        it.contains("com.android.car")
                }
                val shouldTreatAsAutoDisconnect = uid == trackedAutoUid || isAutoCaller
                if (shouldTreatAsAutoDisconnect) {
                    Log.d(TAG, "Android Auto client disconnected (uid=$uid, trackedUid=$trackedAutoUid, pkgs=${'$'}{pkgs.joinToString()}) — stopping playback/session")
                } else {
                    Log.d(TAG, "onUnbind with tracked Android Auto client (caller uid=$uid, trackedUid=$trackedAutoUid) — forcing playback/session stop to avoid stale notification")
                }

                try {
                    // Stop even when paused: paused podcast sessions can still keep progress
                    // runnables alive and recreate notifications after disconnect.
                    if (currentStationId.isNotEmpty() || PlaybackStateHelper.getCurrentEpisodeId() != null || PlaybackStateHelper.getIsPlaying()) {
                        stopPlayback()
                    }
                } catch (t: Throwable) {
                    Log.w(TAG, "Error stopping playback on Auto disconnect: ${'$'}{t.message}")
                }

                // Clear cached client state
                lastAndroidAutoClientUid = null
                lastAndroidAutoRefreshMs = 0L
                lastAndroidAutoAutoplayMs = 0L
            }
        } catch (e: Exception) {
            Log.w(TAG, "onUnbind error: ${'$'}{e.message}")
        }

        return super.onUnbind(intent)
    }

    private fun maybeHandleAndroidAutoReconnect(clientName: String, clientUid: Int) {
        val isAndroidAutoClient = clientName.contains(ANDROID_AUTO_CLIENT_HINT, ignoreCase = true)
        if (!isAndroidAutoClient) return

        val now = System.currentTimeMillis()
        val isNewClient = lastAndroidAutoClientUid == null || lastAndroidAutoClientUid != clientUid
        val lastMediaId = PlaybackPreference.getLastMediaId(this)
        val canAutoResume = PlaybackPreference.isAutoResumeAndroidAutoEnabled(this) &&
            !PlaybackStateHelper.getIsPlaying() &&
            !lastMediaId.isNullOrEmpty() &&
            (isNewClient || now - lastAndroidAutoAutoplayMs >= AUTO_RECONNECT_REFRESH_COOLDOWN_MS)
        val canRefresh = PlaybackStateHelper.getIsPlaying() &&
            currentStationId.isNotEmpty() &&
            (isNewClient || now - lastAndroidAutoRefreshMs >= AUTO_RECONNECT_REFRESH_COOLDOWN_MS)

        if (canAutoResume) {
            Log.d(TAG, "Android Auto reconnect detected (client=$clientName, uid=$clientUid). Auto-playing last media: $lastMediaId")
            handler.post {
                lastMediaId?.let { id ->
                    when {
                        id.startsWith("podcast_episode_") -> {
                            val episodeId = id.removePrefix("podcast_episode_")
                            // Lookup the episode in subscriptions and play it if available (fallback to saved entries)
                            serviceScope.launch {
                                try {
                                    val repo = PodcastRepository(this@RadioService)
                                    val all = withContext(Dispatchers.IO) { repo.fetchPodcasts(false) }
                                    val subscribed = PodcastSubscriptions.getSubscribedIds(this@RadioService)
                                    var foundEp: Episode? = null
                                    var parentPodcast: Podcast? = null
                                    for (p in all) {
                                        if (!subscribed.contains(p.id)) continue
                                        try {
                                            val eps = withContext(Dispatchers.IO) { repo.fetchEpisodes(p) }
                                            val ep = eps.find { it.id == episodeId }
                                            if (ep != null) {
                                                foundEp = ep
                                                parentPodcast = p
                                                break
                                            }
                                        } catch (_: Exception) { /* ignore */ }
                                    }

                                    if (foundEp != null) {
                                        val playIntent = Intent().apply {
                                            parentPodcast?.let { putExtra(EXTRA_PODCAST_TITLE, it.title); putExtra(EXTRA_PODCAST_IMAGE, it.imageUrl) }
                                        }
                                        playPodcastEpisode(foundEp, playIntent)
                                    } else {
                                        // Fallback: try saved episodes (user may have saved an episode without subscribing)
                                        try {
                                            val saved = SavedEpisodes.getSavedEntries(this@RadioService)
                                            val s = saved.find { it.id == episodeId }
                                            if (s != null) {
                                                val savedEp = Episode(
                                                    id = s.id,
                                                    title = s.title,
                                                    description = s.description,
                                                    audioUrl = s.audioUrl,
                                                    imageUrl = s.imageUrl,
                                                    pubDate = s.pubDate,
                                                    durationMins = s.durationMins,
                                                    podcastId = s.podcastId
                                                )
                                                val playIntent = Intent().apply {
                                                    putExtra(EXTRA_PODCAST_TITLE, s.podcastTitle)
                                                    putExtra(EXTRA_PODCAST_IMAGE, s.imageUrl)
                                                }
                                                playPodcastEpisode(savedEp, playIntent)
                                            } else {
                                                // Fallback: try downloaded episodes (supports offline playback)
                                                val d = DownloadedEpisodes.getDownloadedEntry(this@RadioService, episodeId)
                                                if (d != null) {
                                                    val playIntent = Intent().apply {
                                                        putExtra(EXTRA_PODCAST_TITLE, d.podcastTitle)
                                                        putExtra(EXTRA_PODCAST_IMAGE, d.imageUrl)
                                                    }
                                                    playPodcastEpisode(downloadedEntryToEpisode(d), playIntent)
                                                } else {
                                                    // Final fallback: try the local FTS index to map episodeId -> podcastId,
                                                    // then fetch that podcast's episodes (covers episodes played via search/one-off plays)
                                                    try {
                                                        val ef = com.hyliankid14.bbcradioplayer.db.IndexStore.getInstance(this@RadioService).findEpisodeById(episodeId)
                                                        if (ef != null) {
                                                            Log.d(TAG, "Found episode in local index (podcast=${ef.podcastId}), attempting to fetch parent podcast episodes")
                                                            // Limit remote work to a short timeout to avoid blocking reconnect
                                                            val allPods = withContext(Dispatchers.IO) {
                                                                withTimeoutOrNull(5000L) { repo.fetchPodcasts(false) }
                                                            } ?: emptyList()
                                                            val parent = allPods.find { it.id == ef.podcastId }
                                                            if (parent != null) {
                                                                val eps = try { withContext(Dispatchers.IO) { repo.fetchEpisodes(parent) } } catch (_: Exception) { emptyList() }
                                                                val ep = eps.find { it.id == episodeId }
                                                                if (ep != null) {
                                                                    val playIntent = Intent().apply {
                                                                        putExtra(EXTRA_PODCAST_TITLE, parent.title)
                                                                        putExtra(EXTRA_PODCAST_IMAGE, parent.imageUrl)
                                                                    }
                                                                    playPodcastEpisode(ep, playIntent)
                                                                } else {
                                                                    Log.w(TAG, "Indexed episode found but remote fetch didn't return the audio URL for id: $episodeId")
                                                                }
                                                            } else {
                                                                Log.w(TAG, "Indexed episode references unknown podcast id: ${ef.podcastId}")
                                                            }
                                                        } else {
                                                            Log.w(TAG, "Episode not found for id: $episodeId")
                                                        }
                                                    } catch (e: Exception) {
                                                        Log.e(TAG, "Error resolving episode via index for id: $episodeId", e)
                                                    }
                                                }
                                            }
                                        } catch (e: Exception) {
                                            Log.e(TAG, "Error searching saved episodes for id: $episodeId", e)
                                        }
                                    }
                                } catch (e: Exception) {
                                    Log.e(TAG, "Error auto-playing podcast episode $episodeId", e)
                                }
                            }
                        }
                        id.startsWith("station_") -> {
                            val stationId = id.removePrefix("station_")
                            playStation(stationId)
                        }
                        else -> {
                            Log.w(TAG, "Unknown last media id: $id")
                        }
                    }
                }
            }
            lastAndroidAutoAutoplayMs = now
        }

        if (canRefresh) {
            Log.d(TAG, "Android Auto reconnect detected (client=$clientName, uid=$clientUid). Refreshing live stream.")
            handler.post { refreshCurrentStream("Android Auto reconnect") }
            lastAndroidAutoRefreshMs = now
        }

        lastAndroidAutoClientUid = clientUid
    }

    /**
     * Paginated version of onLoadChildren called by Android Auto (and other clients that support
     * the EXTRA_PAGE / EXTRA_PAGE_SIZE protocol).  For podcast episode lists we serve episodes
     * from an in-service cache so page 1+ are returned almost instantly after the RSS feed has
     * been fetched once for page 0.  Everything else is delegated to the non-paginated override.
     */
    override fun onLoadChildren(parentId: String, result: Result<List<MediaItem>>, options: Bundle) {
        val page = options.getInt(EXTRA_PAGE, -1)
        val pageSize = options.getInt(EXTRA_PAGE_SIZE, EPISODE_PAGE_SIZE)
            .coerceAtLeast(1)

        // Only apply custom pagination for individual podcast episode lists.
        val isPodcastEpisodeList = page >= 0
            && parentId.startsWith("podcast_")
            && parentId != "podcasts_subscribed"
            && parentId != "podcasts_saved_episodes"
            && parentId != "podcasts_history"
            && parentId != MEDIA_ID_PODCASTS_DOWNLOADED

        if (!isPodcastEpisodeList) {
            // Delegate to the standard (non-paginated) implementation.
            onLoadChildren(parentId, result)
            return
        }

        val podcastId = parentId.removePrefix("podcast_").substringBefore(':')
        Log.d(TAG, "onLoadChildren paginated - podcastId: $podcastId page: $page pageSize: $pageSize")

        result.detach()
        serviceScope.launch {
            try {
                // Use cached episodes when available so pages 1+ are returned without a network round-trip.
                val allEps = autoEpisodesCache[podcastId] ?: run {
                    val repo = PodcastRepository(this@RadioService)
                    val all = withContext(Dispatchers.IO) { repo.fetchPodcasts(false) }
                    val podcast = all.find { it.id == podcastId }
                    if (podcast != null) {
                        val fetched = withContext(Dispatchers.IO) {
                            repo.fetchEpisodesPaged(podcast, 0, AUTO_MAX_EPISODES)
                        }
                        if (fetched.isNotEmpty()) {
                            autoEpisodesCache[podcastId] = fetched
                        }
                        fetched
                    } else {
                        emptyList()
                    }
                }

                val items = mutableListOf<MediaItem>()
                val sortedVisibleEpisodes = filterAndSortEpisodesForAuto(allEps, podcastId)
                val startIndex = page * pageSize
                val episodeCount = pageSize
                val pageEps = sortedVisibleEpisodes.drop(startIndex).take(episodeCount)
                if (pageEps.isNotEmpty()) {
                    val downloadedIds = DownloadedEpisodes.getDownloadedEntries(this@RadioService)
                        .map { it.id }.toSet()
                    items.addAll(pageEps.map { ep -> episodeToMediaItem(ep, downloadedIds) })
                }
                result.sendResult(items)
            } catch (e: Exception) {
                Log.e(TAG, "Error loading paged episodes for podcast $podcastId page $page", e)
                try {
                    val downloadedEps = DownloadedEpisodes.getDownloadedEpisodesForPodcast(
                        this@RadioService, podcastId)
                    val sortedDownloaded = sortDownloadedEpisodesForPodcast(downloadedEps, podcastId)
                    val items = mutableListOf<MediaItem>()
                    val startIndex = page * pageSize
                    val episodeCount = pageSize
                    items.addAll(
                        sortedDownloaded.drop(startIndex).take(episodeCount)
                            .map { d -> downloadedEntryToMediaItem(d) }
                    )
                    result.sendResult(items)
                } catch (ex: Exception) {
                    result.sendResult(emptyList())
                }
            }
        }
    }

    override fun onLoadChildren(parentId: String, result: Result<List<MediaItem>>) {
        Log.d(TAG, "onLoadChildren - parentId: $parentId")
        
        result.detach()
        serviceScope.launch {
            val items = mutableListOf<MediaItem>()

            when (parentId) {
                MEDIA_ID_ROOT -> {
                    // Add "Favourites" folder (display text uses British spelling)
                    items.add(MediaItem(
                        MediaDescriptionCompat.Builder()
                            .setMediaId(MEDIA_ID_FAVORITES)
                            .setTitle("Favourites")
                            .setIconBitmap(loadDrawableAsBitmap(R.drawable.ic_star_outline))
                            .build(),
                        MediaItem.FLAG_BROWSABLE
                    ))
                    
                    // Add "All Stations" folder
                    items.add(MediaItem(
                        MediaDescriptionCompat.Builder()
                            .setMediaId(MEDIA_ID_ALL_STATIONS)
                            .setTitle("All Stations")
                            .setIconBitmap(loadDrawableAsBitmap(R.drawable.ic_list))
                            .build(),
                        MediaItem.FLAG_BROWSABLE
                    ))
                    // Add "Podcasts" folder
                    items.add(MediaItem(
                        MediaDescriptionCompat.Builder()
                            .setMediaId(MEDIA_ID_PODCASTS)
                            .setTitle("Podcasts")
                            .setIconBitmap(loadDrawableAsBitmap(R.drawable.ic_podcast))
                            .build(),
                        MediaItem.FLAG_BROWSABLE
                    ))
                    result.sendResult(items)
                }
                MEDIA_ID_FAVORITES -> {
                    val favorites = FavoritesPreference.getFavorites(this@RadioService)
                    val itemsWithShowInfo = favorites.map { station ->
                        async(Dispatchers.IO) {
                            val show = ShowInfoFetcher.getScheduleCurrentShow(station.id)
                            createMediaItem(station, show.title)
                        }
                    }.awaitAll()
                    result.sendResult(itemsWithShowInfo)
                }
                MEDIA_ID_ALL_STATIONS -> {
                    val stations = StationRepository.getStations()
                    val itemsWithShowInfo = stations.map { station ->
                        async(Dispatchers.IO) {
                            val show = ShowInfoFetcher.getScheduleCurrentShow(station.id)
                            createMediaItem(station, show.title)
                        }
                    }.awaitAll()
                    result.sendResult(itemsWithShowInfo)
                }
                MEDIA_ID_PODCASTS -> {
                    // Present four folders: Subscribed Podcasts, Saved Episodes, Downloaded Episodes, and History
                    val itemsPodcasts = mutableListOf<MediaItem>()
                    itemsPodcasts.add(MediaItem(MediaDescriptionCompat.Builder().setMediaId("podcasts_subscribed").setTitle("Subscribed Podcasts").build(), MediaItem.FLAG_BROWSABLE))
                    itemsPodcasts.add(MediaItem(MediaDescriptionCompat.Builder().setMediaId("podcasts_saved_episodes").setTitle("Saved Episodes").build(), MediaItem.FLAG_BROWSABLE))
                    itemsPodcasts.add(MediaItem(MediaDescriptionCompat.Builder().setMediaId(MEDIA_ID_PODCASTS_DOWNLOADED).setTitle("Downloaded Episodes").build(), MediaItem.FLAG_BROWSABLE))
                    itemsPodcasts.add(MediaItem(MediaDescriptionCompat.Builder().setMediaId("podcasts_history").setTitle("History").build(), MediaItem.FLAG_BROWSABLE))
                    itemsPodcasts.add(
                        MediaItem(
                            MediaDescriptionCompat.Builder()
                                .setMediaId(MEDIA_ID_PODCASTS_RANDOM)
                                .setTitle(getString(R.string.random_podcast_title))
                                .build(),
                            MediaItem.FLAG_PLAYABLE
                        )
                    )
                    result.sendResult(itemsPodcasts)
                }
                else -> {
                    if (parentId == "podcasts_subscribed") {
                        val subscribed = PodcastSubscriptions.getSubscribedIds(this@RadioService)
                        if (subscribed.isEmpty()) {
                            result.sendResult(emptyList())
                        } else {
                            try {
                                val repo = PodcastRepository(this@RadioService)
                                val all = withContext(Dispatchers.IO) { repo.fetchPodcasts(false) }
                                val podcasts = all.filter { subscribed.contains(it.id) }
                                if (podcasts.isNotEmpty()) {
                                    // Fetch cached latest update epochs and sort subscribed podcasts by newest update first
                                    val updates = withContext(Dispatchers.IO) { repo.fetchLatestUpdates(podcasts) }
                                    val sorted = podcasts.sortedByDescending { updates[it.id] ?: Long.MAX_VALUE }
                                    val itemsPodcasts = sorted.map { p ->
                                        val subtitle = if ((updates[p.id] ?: 0L) > PlayedEpisodesPreference.getLastPlayedEpoch(this@RadioService, p.id)) "New" else ""
                                        MediaItem(
                                            MediaDescriptionCompat.Builder()
                                                .setMediaId("podcast_${p.id}")
                                                .setTitle(p.title)
                                                .setSubtitle(subtitle)
                                                .setIconUri(android.net.Uri.parse(p.imageUrl))
                                                .build(),
                                            MediaItem.FLAG_BROWSABLE
                                        )
                                    }
                                    result.sendResult(itemsPodcasts)
                                } else {
                                    // Offline fallback: show subscribed podcasts that have downloaded episodes
                                    result.sendResult(buildOfflineSubscribedPodcastFallback(subscribed))
                                }
                            } catch (e: Exception) {
                                Log.e(TAG, "Error loading podcasts for Android Auto", e)
                                // Offline fallback: show subscribed podcasts derived from downloaded episodes
                                try {
                                    result.sendResult(buildOfflineSubscribedPodcastFallback(subscribed))
                                } catch (ex: Exception) {
                                    Log.e(TAG, "Error loading offline fallback for subscribed podcasts", ex)
                                    result.sendResult(emptyList())
                                }
                            }
                        }
                    } else if (parentId == MEDIA_ID_PODCASTS_DOWNLOADED) {
                        try {
                            val downloaded = DownloadedEpisodes.getDownloadedEntries(this@RadioService)
                            val downloadedItems = downloaded.map { d ->
                                val status = if (d.podcastTitle.isNotBlank()) d.podcastTitle else ""
                                MediaItem(
                                    MediaDescriptionCompat.Builder()
                                        .setMediaId("podcast_episode_${d.id}")
                                        .setTitle(d.title)
                                        .setSubtitle(buildAutoEpisodeSubtitle(d.pubDate, status))
                                        .setIconUri(android.net.Uri.parse(d.imageUrl))
                                        .build(),
                                    MediaItem.FLAG_PLAYABLE
                                )
                            }
                            result.sendResult(downloadedItems)
                        } catch (e: Exception) {
                            Log.e(TAG, "Error loading downloaded episodes for Android Auto", e)
                            result.sendResult(emptyList())
                        }
                    } else if (parentId == "podcasts_history") {
                        try {
                            val history = PlayedHistoryPreference.getHistory(this@RadioService)
                            val downloadedIds = DownloadedEpisodes.getDownloadedEntries(this@RadioService)
                                .map { it.id }.toSet()
                            val historyItems = history.map { h ->
                                val played = PlayedEpisodesPreference.isPlayed(this@RadioService, h.id)
                                val progress = PlayedEpisodesPreference.getProgress(this@RadioService, h.id)
                                val isDownloaded = h.id in downloadedIds
                                val inProgress = !played && progress > 0L
                                MediaItem(
                                    MediaDescriptionCompat.Builder()
                                        .setMediaId("podcast_episode_${h.id}")
                                        .setTitle(h.title)
                                        .setSubtitle(buildAutoEpisodeIconSubtitle(h.pubDate, played, inProgress, isDownloaded, h.podcastTitle))
                                        .setIconUri(android.net.Uri.parse(h.imageUrl))
                                        .build(),
                                    MediaItem.FLAG_PLAYABLE
                                )
                            }
                            result.sendResult(historyItems)
                        } catch (e: Exception) {
                            Log.e(TAG, "Error loading history for Android Auto", e)
                            result.sendResult(emptyList())
                        }
                    } else if (parentId == "podcasts_saved_episodes") {
                        try {
                            val saved = SavedEpisodes.getSavedEntries(this@RadioService)
                            val savedDownloadedIds = DownloadedEpisodes.getDownloadedEntries(this@RadioService)
                                .map { it.id }.toSet()
                            val itemsSaved = saved.map { s ->
                                val played = PlayedEpisodesPreference.isPlayed(this@RadioService, s.id)
                                val progress = PlayedEpisodesPreference.getProgress(this@RadioService, s.id)
                                val isDownloaded = s.id in savedDownloadedIds
                                val inProgress = !played && progress > 0L
                                MediaItem(
                                    MediaDescriptionCompat.Builder()
                                        .setMediaId("podcast_episode_${s.id}")
                                        .setTitle(s.title)
                                        .setSubtitle(buildAutoEpisodeIconSubtitle(s.pubDate, played, inProgress, isDownloaded, s.podcastTitle))
                                        .setIconUri(android.net.Uri.parse(s.imageUrl))
                                        .build(),
                                    MediaItem.FLAG_PLAYABLE
                                )
                            }
                            result.sendResult(itemsSaved)
                        } catch (e: Exception) {
                            Log.e(TAG, "Error loading saved episodes for Android Auto", e)
                            result.sendResult(emptyList())
                        }
                    } else if (parentId.startsWith("podcast_")) {
                        // Extract the plain podcast ID (strip any legacy ":start=<n>:count=<m>" suffix).
                        val podcastId = parentId.removePrefix("podcast_").substringBefore(':')
                        result.sendResult(loadPodcastItemsForAuto(podcastId))
                    } else {
                        Log.d(TAG, "Unknown parentId: $parentId")
                        result.sendResult(null)
                    }
                }
            }
        }
    }

    /**
     * Convert a vector drawable resource to a bitmap for use in Android Auto navigation icons.
     * Android Auto's Media Browser API requires bitmap icons rather than vector drawables.
     */
    private fun loadDrawableAsBitmap(drawableResId: Int, sizePixels: Int = 128): Bitmap? {
        return try {
            val drawable = AppCompatResources.getDrawable(this, drawableResId) ?: return null
            val bitmap = Bitmap.createBitmap(sizePixels, sizePixels, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bitmap)
            drawable.setBounds(0, 0, sizePixels, sizePixels)
            drawable.draw(canvas)
            bitmap
        } catch (e: Exception) {
            Log.e(TAG, "Failed to load drawable as bitmap: ${e.message}")
            null
        }
    }

    private fun createMediaItem(station: Station, subtitle: String = ""): MediaItem {
        // If subtitle is "BBC Radio", treat it as empty to avoid redundancy
        val displaySubtitle = if (subtitle == "BBC Radio") "" else subtitle
        return MediaItem(
            MediaDescriptionCompat.Builder()
                .setMediaId(station.id)
                .setTitle(station.title)
                .setSubtitle(displaySubtitle)
                .setIconUri(android.net.Uri.parse(station.logoUrl))
                .setIconBitmap(StationArtwork.createBitmap(station.id))
                .build(),
            MediaItem.FLAG_PLAYABLE
        )
    }

    private fun downloadedEntryToEpisode(d: DownloadedEpisodes.Entry): Episode = Episode(
        id = d.id,
        title = d.title,
        description = d.description,
        audioUrl = d.audioUrl,
        imageUrl = d.imageUrl,
        pubDate = d.pubDate,
        durationMins = d.durationMins,
        podcastId = d.podcastId
    )

    /**
     * Re-play a podcast episode by its ID, using offline stores first (saved/downloaded/history)
     * and falling back to a network fetch when needed. Used by onPlay() and onPlayerError()
     * to reliably resume podcast playback after the player has been stopped or has errored.
     */
    private fun replayEpisodeById(episodeId: String) {
        serviceScope.launch {
            try {
                // 1. Try saved episodes (no network required)
                val saved = SavedEpisodes.getSavedEntries(this@RadioService)
                val s = saved.find { it.id == episodeId }
                if (s != null) {
                    val ep = Episode(
                        id = s.id,
                        title = s.title,
                        description = s.description,
                        audioUrl = s.audioUrl,
                        imageUrl = s.imageUrl,
                        pubDate = s.pubDate,
                        durationMins = s.durationMins,
                        podcastId = s.podcastId
                    )
                    val playIntent = Intent().apply {
                        putExtra(EXTRA_PODCAST_TITLE, s.podcastTitle)
                        putExtra(EXTRA_PODCAST_IMAGE, s.imageUrl)
                    }
                    playPodcastEpisode(ep, playIntent)
                    return@launch
                }

                // 2. Try downloaded episodes (supports offline playback)
                val d = DownloadedEpisodes.getDownloadedEntry(this@RadioService, episodeId)
                if (d != null) {
                    val playIntent = Intent().apply {
                        putExtra(EXTRA_PODCAST_TITLE, d.podcastTitle)
                        putExtra(EXTRA_PODCAST_IMAGE, d.imageUrl)
                    }
                    playPodcastEpisode(downloadedEntryToEpisode(d), playIntent)
                    return@launch
                }

                // 3. Try played history (covers episodes played from browse/search)
                val history = PlayedHistoryPreference.getHistory(this@RadioService)
                val h = history.find { it.id == episodeId }
                if (h != null && h.audioUrl.isNotBlank()) {
                    val ep = Episode(
                        id = h.id,
                        title = h.title,
                        description = h.description,
                        audioUrl = h.audioUrl,
                        imageUrl = h.imageUrl,
                        pubDate = h.pubDate,
                        durationMins = h.durationMins,
                        podcastId = h.podcastId
                    )
                    val playIntent = Intent().apply {
                        putExtra(EXTRA_PODCAST_TITLE, h.podcastTitle)
                        putExtra(EXTRA_PODCAST_IMAGE, h.imageUrl)
                    }
                    playPodcastEpisode(ep, playIntent)
                    return@launch
                }

                // 4. Fall back to network lookup — first try the local FTS index to narrow the
                //    search to a single podcast, then scan all subscribed podcasts as a last resort.
                try {
                    val repo = PodcastRepository(this@RadioService)
                    var foundEp: Episode? = null
                    var parentPodcast: Podcast? = null

                    // Try local index first (no full subscription scan needed)
                    val indexed = try {
                        com.hyliankid14.bbcradioplayer.db.IndexStore
                            .getInstance(this@RadioService).findEpisodeById(episodeId)
                    } catch (_: Exception) { null }
                    if (indexed != null) {
                        val allPods = withContext(Dispatchers.IO) {
                            withTimeoutOrNull(5000L) { repo.fetchPodcasts(false) }
                        } ?: emptyList()
                        val parent = allPods.find { it.id == indexed.podcastId }
                        if (parent != null) {
                            val eps = try { withContext(Dispatchers.IO) { repo.fetchEpisodes(parent) } } catch (_: Exception) { emptyList() }
                            val ep = eps.find { it.id == episodeId }
                            if (ep != null) {
                                foundEp = ep
                                parentPodcast = parent
                            }
                        }
                    }

                    // If index lookup didn't find it, scan all subscribed podcasts
                    if (foundEp == null) {
                        val all = withContext(Dispatchers.IO) { repo.fetchPodcasts(false) }
                        val subscribed = PodcastSubscriptions.getSubscribedIds(this@RadioService)
                        for (p in all) {
                            if (!subscribed.contains(p.id)) continue
                            try {
                                val eps = withContext(Dispatchers.IO) { repo.fetchEpisodes(p) }
                                val ep = eps.find { it.id == episodeId }
                                if (ep != null) {
                                    foundEp = ep
                                    parentPodcast = p
                                    break
                                }
                            } catch (e: Exception) {
                                Log.d(TAG, "replayEpisodeById: skipping podcast ${p.id} due to error: ${e.message}")
                            }
                        }
                    }

                    if (foundEp != null) {
                        val playIntent = Intent().apply {
                            parentPodcast?.let { putExtra(EXTRA_PODCAST_TITLE, it.title); putExtra(EXTRA_PODCAST_IMAGE, it.imageUrl) }
                        }
                        playPodcastEpisode(foundEp, playIntent)
                    } else {
                        Log.w(TAG, "replayEpisodeById: episode not found for id: $episodeId")
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "replayEpisodeById: network lookup failed for id: $episodeId", e)
                }
            } catch (e: Exception) {
                Log.e(TAG, "replayEpisodeById: unexpected error for id: $episodeId", e)
            }
        }
    }

    private fun downloadedEntryToMediaItem(d: DownloadedEpisodes.Entry): MediaItem {
        val played = PlayedEpisodesPreference.isPlayed(this, d.id)
        val progress = PlayedEpisodesPreference.getProgress(this, d.id)
        val inProgress = !played && progress > 0L
        val isNew = !played && progress == 0L
        val formattedDate = formatAutoEpisodeDate(d.pubDate)
        val subtitle = buildString {
            when {
                played -> append("✅ ")
                inProgress -> append("~ ")
                isNew -> append("● ")
            }
            append("⬇ ") // always downloaded since this entry comes from DownloadedEpisodes
            append(formattedDate)
        }.trim()
        return MediaItem(
            MediaDescriptionCompat.Builder()
                .setMediaId("podcast_episode_${d.id}")
                .setTitle(d.title)
                .setSubtitle(subtitle)
                .setIconUri(android.net.Uri.parse(d.imageUrl))
                .build(),
            MediaItem.FLAG_PLAYABLE
        )
    }

    private fun buildAutoEpisodeSubtitle(pubDate: String?, status: String): String {
        val formattedDate = formatAutoEpisodeDate(pubDate)
        return when {
            formattedDate.isNotBlank() && status.isNotBlank() -> "$formattedDate • $status"
            formattedDate.isNotBlank() -> formattedDate
            else -> status
        }
    }

    /**
     * Build an icon-based subtitle for Android Auto episode rows in history and saved episode
     * lists. Mirrors the format used by [episodeToMediaItem] for subscribed podcast lists, but
     * also appends the [podcastTitle] so the source podcast is clear without opening the item.
     *
     * Examples:
     *  - `✅ ⬇ Jan 2025 • BBC Radio 4`  (played + downloaded)
     *  - `~ Jan 2025 • Desert Island Discs`  (in-progress)
     *  - `● Jan 2025`  (new, no podcast title available)
     */
    private fun buildAutoEpisodeIconSubtitle(
        pubDate: String?,
        played: Boolean,
        inProgress: Boolean,
        isDownloaded: Boolean,
        podcastTitle: String
    ): String {
        val formattedDate = formatAutoEpisodeDate(pubDate)
        return buildString {
            when {
                played -> append("✅ ")
                inProgress -> append("~ ")
                else -> append("● ")
            }
            if (isDownloaded) append("⬇ ")
            append(formattedDate)
            if (podcastTitle.isNotBlank()) {
                if (formattedDate.isNotBlank()) append(" • ")
                append(podcastTitle)
            }
        }.trim()
    }

    private fun formatAutoEpisodeDate(raw: String?): String {
        val epoch = EpisodeDateParser.parsePubDateToEpoch(raw)
        if (epoch > 0L) {
            return autoEpisodeDateFormat.get()?.format(Date(epoch)) ?: ""
        }
        return raw?.trim().orEmpty()
    }

    private fun playRandomPodcastMostRecentFromAuto() {
        serviceScope.launch {
            try {
                val repo = PodcastRepository(this@RadioService)
                val allPodcasts = withContext(Dispatchers.IO) { repo.fetchPodcasts(false) }

                for (podcast in allPodcasts.shuffled()) {
                    val episodes = withContext(Dispatchers.IO) {
                        repo.fetchEpisodesPaged(podcast, 0, AUTO_MAX_EPISODES)
                    }
                    if (episodes.isEmpty()) continue

                    autoEpisodesCache[podcast.id] = episodes

                    val mostRecent = episodes.maxWithOrNull(
                        compareBy<Episode> { EpisodeDateParser.parsePubDateToEpoch(it.pubDate) }
                            .thenBy { it.title }
                    ) ?: episodes.first()

                    playPodcastEpisode(
                        mostRecent,
                        Intent().apply {
                            putExtra(EXTRA_PODCAST_ID, podcast.id)
                            putExtra(EXTRA_PODCAST_TITLE, podcast.title)
                            putExtra(EXTRA_PODCAST_IMAGE, podcast.imageUrl)
                        }
                    )
                    return@launch
                }

                handler.post {
                    android.widget.Toast.makeText(
                        this@RadioService,
                        getString(R.string.no_podcasts_shuffle),
                        android.widget.Toast.LENGTH_SHORT
                    ).show()
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error playing random podcast for Android Auto", e)
                handler.post {
                    android.widget.Toast.makeText(
                        this@RadioService,
                        getString(R.string.no_podcasts_shuffle),
                        android.widget.Toast.LENGTH_SHORT
                    ).show()
                }
            }
        }
    }

    private suspend fun loadPodcastItemsForAuto(
        podcastId: String
    ): List<MediaItem> {
        val itemsForPodcast = mutableListOf<MediaItem>()

        return try {
            // Use the service-level cache when available so re-visiting a podcast is instant.
            val eps = autoEpisodesCache[podcastId] ?: run {
                val repo = PodcastRepository(this@RadioService)
                val all = withContext(Dispatchers.IO) { repo.fetchPodcasts(false) }
                val podcast = all.find { it.id == podcastId }
                if (podcast != null) {
                    val fetched = withContext(Dispatchers.IO) {
                        repo.fetchEpisodesPaged(podcast, 0, AUTO_MAX_EPISODES)
                    }
                    if (fetched.isNotEmpty()) {
                        autoEpisodesCache[podcastId] = fetched
                    }
                    fetched
                } else {
                    emptyList()
                }
            }

            if (eps.isNotEmpty()) {
                val sortedVisibleEpisodes = filterAndSortEpisodesForAuto(eps, podcastId)
                val downloadedIds = DownloadedEpisodes.getDownloadedEntries(this@RadioService)
                    .map { it.id }.toSet()
                itemsForPodcast.addAll(sortedVisibleEpisodes.map { ep -> episodeToMediaItem(ep, downloadedIds) })
            } else {
                val downloadedEps = DownloadedEpisodes.getDownloadedEpisodesForPodcast(this@RadioService, podcastId)
                if (downloadedEps.isNotEmpty()) {
                    val sortedDownloaded = sortDownloadedEpisodesForPodcast(downloadedEps, podcastId)
                    itemsForPodcast.addAll(sortedDownloaded.map { d -> downloadedEntryToMediaItem(d) })
                }
            }
            itemsForPodcast
        } catch (e: Exception) {
            Log.e(TAG, "Error loading episodes for podcast $podcastId", e)
            try {
                val downloadedEps = DownloadedEpisodes.getDownloadedEpisodesForPodcast(this@RadioService, podcastId)
                val sortedDownloaded = sortDownloadedEpisodesForPodcast(downloadedEps, podcastId)
                itemsForPodcast.addAll(sortedDownloaded.map { d -> downloadedEntryToMediaItem(d) })
            } catch (ex: Exception) {
                Log.e(TAG, "Error loading offline fallback for podcast $podcastId", ex)
            }
            itemsForPodcast
        }
    }

    private fun sortDownloadedEpisodesForPodcast(
        entries: List<DownloadedEpisodes.Entry>,
        podcastId: String
    ): List<DownloadedEpisodes.Entry> {
        val hidePlayed = PlaybackPreference.isHidePlayedEpisodesInAndroidAutoEnabled(this)
        val visibleEntries = if (hidePlayed) {
            entries.filterNot { PlayedEpisodesPreference.isPlayed(this, it.id) }
        } else {
            entries
        }

        val indexedEntries = visibleEntries.mapIndexed { index, entry ->
            IndexedDownloadedEpisode(
                entry = entry,
                epochMs = EpisodeDateParser.parsePubDateToEpochOrNull(entry.pubDate),
                originalIndex = index
            )
        }

        val sorted = if (PodcastEpisodeSortPreference.isOldestFirst(this, podcastId)) {
            indexedEntries.sortedWith(
                compareByDescending<IndexedDownloadedEpisode> { it.epochMs != null }
                    .thenBy { it.epochMs ?: Long.MAX_VALUE }
                    .thenBy { it.originalIndex }
            )
        } else {
            indexedEntries.sortedWith(
                compareByDescending<IndexedDownloadedEpisode> { it.epochMs != null }
                    .thenByDescending { it.epochMs ?: Long.MIN_VALUE }
                    .thenBy { it.originalIndex }
            )
        }

        return sorted.map { it.entry }
    }

    private fun filterAndSortEpisodesForAuto(entries: List<Episode>, podcastId: String): List<Episode> {
        val hidePlayed = PlaybackPreference.isHidePlayedEpisodesInAndroidAutoEnabled(this)
        val visibleEntries = if (hidePlayed) {
            entries.filterNot { PlayedEpisodesPreference.isPlayed(this, it.id) }
        } else {
            entries
        }

        val indexedEntries = visibleEntries.mapIndexed { index, entry ->
            IndexedEpisode(
                episode = entry,
                epochMs = EpisodeDateParser.parsePubDateToEpochOrNull(entry.pubDate),
                originalIndex = index
            )
        }

        val sorted = if (PodcastEpisodeSortPreference.isOldestFirst(this, podcastId)) {
            indexedEntries.sortedWith(
                compareByDescending<IndexedEpisode> { it.epochMs != null }
                    .thenBy { it.epochMs ?: Long.MAX_VALUE }
                    .thenBy { it.originalIndex }
            )
        } else {
            indexedEntries.sortedWith(
                compareByDescending<IndexedEpisode> { it.epochMs != null }
                    .thenByDescending { it.epochMs ?: Long.MIN_VALUE }
                    .thenBy { it.originalIndex }
            )
        }

        return sorted.map { it.episode }
    }

    private data class IndexedDownloadedEpisode(
        val entry: DownloadedEpisodes.Entry,
        val epochMs: Long?,
        val originalIndex: Int
    )

    private data class IndexedEpisode(
        val episode: Episode,
        val epochMs: Long?,
        val originalIndex: Int
    )

    /**
     * Convert a [Episode] to a [MediaItem] for Android Auto, annotating the subtitle with
     * playback status (played, in-progress, downloaded).
     *
     * @param ep           The episode to convert.
     * @param downloadedIds Set of episode IDs that have been downloaded locally.
     */
    private fun episodeToMediaItem(ep: Episode, downloadedIds: Set<String>): MediaItem {
        val played = PlayedEpisodesPreference.isPlayed(this, ep.id)
        val progress = PlayedEpisodesPreference.getProgress(this, ep.id)
        val isDownloaded = ep.id in downloadedIds
        val inProgress = !played && progress > 0L
        val isNew = !played && progress == 0L
        val formattedDate = formatAutoEpisodeDate(ep.pubDate)
        val subtitle = buildString {
            when {
                played -> append("✅ ")
                inProgress -> append("~ ")
                isNew -> append("● ")
            }
            if (isDownloaded) append("⬇ ")
            append(formattedDate)
        }.trim()
        return MediaItem(
            MediaDescriptionCompat.Builder()
                .setMediaId("podcast_episode_${ep.id}")
                .setTitle(ep.title)
                .setSubtitle(subtitle)
                .setIconUri(android.net.Uri.parse(ep.imageUrl))
                .build(),
            MediaItem.FLAG_PLAYABLE
        )
    }

    private fun buildOfflineSubscribedPodcastFallback(subscribed: Set<String>): List<MediaItem> {
        val downloaded = DownloadedEpisodes.getDownloadedEntries(this)
        val downloadedPodcastIds = downloaded.map { it.podcastId }.distinct()
            .filter { subscribed.contains(it) }
        return downloadedPodcastIds.map { podcastId ->
            val sample = downloaded.first { it.podcastId == podcastId }
            MediaItem(
                MediaDescriptionCompat.Builder()
                    .setMediaId("podcast_${podcastId}")
                    .setTitle(sample.podcastTitle.ifBlank { podcastId })
                    .setSubtitle("Available offline")
                    .setIconUri(android.net.Uri.parse(sample.imageUrl))
                    .build(),
                MediaItem.FLAG_BROWSABLE
            )
        }
    }

    private fun ensurePlayer() {
        if (player == null) {
            // Route local/content URIs through DefaultDataSource and keep secure HTTP handling for network streams.
            val secureDataSourceFactory = SecureHttpDataSource()
            val appDataSourceFactory = DefaultDataSource.Factory(this, secureDataSourceFactory)
            val mediaSourceFactory = com.google.android.exoplayer2.source.DefaultMediaSourceFactory(this)
                .setDataSourceFactory(appDataSourceFactory)
            
            player = ExoPlayer.Builder(this)
                .setMediaSourceFactory(mediaSourceFactory)
                .build().apply {
                // Configure audio attributes for music playback
                setAudioAttributes(
                    ExoAudioAttributes.Builder()
                        .setUsage(com.google.android.exoplayer2.C.USAGE_MEDIA)
                        .setContentType(com.google.android.exoplayer2.C.AUDIO_CONTENT_TYPE_MUSIC)
                        .build(),
                    true
                )
                
                addListener(object : Player.Listener {
                    override fun onPlaybackStateChanged(playbackState: Int) {
                        val state = when (playbackState) {
                            Player.STATE_READY -> if (playWhenReady) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED
                            Player.STATE_BUFFERING -> PlaybackStateCompat.STATE_BUFFERING
                            Player.STATE_ENDED -> PlaybackStateCompat.STATE_STOPPED
                            Player.STATE_IDLE -> if (playWhenReady) PlaybackStateCompat.STATE_BUFFERING else PlaybackStateCompat.STATE_STOPPED
                            else -> PlaybackStateCompat.STATE_NONE
                        }
                        updatePlaybackState(state)
                        
                        // Update helper for mini player
                        when (state) {
                            PlaybackStateCompat.STATE_PLAYING -> PlaybackStateHelper.setIsPlaying(true)
                            PlaybackStateCompat.STATE_PAUSED, PlaybackStateCompat.STATE_STOPPED -> PlaybackStateHelper.setIsPlaying(false)
                            else -> {}
                        }

                        if (state == PlaybackStateCompat.STATE_PLAYING) {
                            if (stationAnalyticsPending && !stationAnalyticsScheduled && stationAnalyticsRunnable != null) {
                                handler.postDelayed(stationAnalyticsRunnable!!, ANALYTICS_MIN_PLAY_MS)
                                stationAnalyticsScheduled = true
                            }
                            if (episodeAnalyticsPending && !episodeAnalyticsScheduled && episodeAnalyticsRunnable != null) {
                                handler.postDelayed(episodeAnalyticsRunnable!!, ANALYTICS_MIN_PLAY_MS)
                                episodeAnalyticsScheduled = true
                            }
                        } else if (state == PlaybackStateCompat.STATE_PAUSED || state == PlaybackStateCompat.STATE_STOPPED) {
                            if (stationAnalyticsScheduled) {
                                stationAnalyticsRunnable?.let { handler.removeCallbacks(it) }
                                stationAnalyticsScheduled = false
                            }
                            if (episodeAnalyticsScheduled) {
                                episodeAnalyticsRunnable?.let { handler.removeCallbacks(it) }
                                episodeAnalyticsScheduled = false
                            }
                        }

                        // If playback ended for a podcast episode, attempt to autoplay next episode in the same podcast
                        if (playbackState == Player.STATE_ENDED && currentStationId.startsWith("podcast_")) {
                            val currentEpisode = PlaybackStateHelper.getCurrentEpisodeId()
                            val podcastId = currentPodcastId
                            if (!podcastId.isNullOrEmpty() && !currentEpisode.isNullOrEmpty()) {
                                serviceScope.launch {
                                    try {
                                        val repo = PodcastRepository(this@RadioService)
                                        val allPods = withContext(Dispatchers.IO) { repo.fetchPodcasts(false) }
                                        val podcast = allPods.find { it.id == podcastId }
                                        if (podcast != null) {
                                            val allEpisodes = withContext(Dispatchers.IO) { repo.fetchEpisodes(podcast) }

                                            val currentEp = allEpisodes.find { it.id == currentEpisode }
                                            if (currentEp == null) {
                                                Log.w(TAG, "Current episode not found in feed for autoplay: $currentEpisode")
                                            } else {
                                                val currentEpoch = EpisodeDateParser.parsePubDateToEpoch(currentEp.pubDate)
                                                // Build list of episodes with valid epoch greater than currentEpoch
                                                val candidates = allEpisodes.mapNotNull { ep ->
                                                    val epEpoch = EpisodeDateParser.parsePubDateToEpoch(ep.pubDate)
                                                    if (epEpoch > 0L && currentEpoch > 0L && epEpoch > currentEpoch) Pair(ep, epEpoch) else null
                                                }
                                                val next = candidates.minByOrNull { it.second }?.first
                                                if (next != null) {
                                                    Log.d(TAG, "Autoplaying next episode chronologically: ${next.title} (id=${next.id})")
                                                    // Check isStopped here: the user may have pressed Stop while we were
                                                    // fetching episodes in the background. playPodcastEpisode() resets
                                                    // isStopped = false, which would restart playback the user explicitly stopped.
                                                    if (isStopped) {
                                                        Log.d(TAG, "Autoplay aborted: user stopped playback while fetching next episode")
                                                        return@launch
                                                    }
                                                    val playIntent = Intent().apply {
                                                        putExtra(EXTRA_PODCAST_TITLE, podcast.title)
                                                        putExtra(EXTRA_PODCAST_IMAGE, podcast.imageUrl)
                                                    }
                                                    playPodcastEpisode(next, playIntent)
                                                } else {
                                                    Log.d(TAG, "No newer episode found to autoplay for podcast: $podcastId")
                                                }
                                            }
                                        } else {
                                            Log.w(TAG, "Podcast not found while attempting to autoplay: $podcastId")
                                        }
                                    } catch (e: Exception) {
                                        Log.w(TAG, "Failed to autoplay next episode: ${e.message}")
                                    }
                                }
                            }
                        }
                    }
                    
                    override fun onPlayerError(error: PlaybackException) {
                        Log.e(TAG, "Playback error: ${error.message}", error)
                        // Auto-reconnect after a delay
                        playerReconnectRunnable?.let { handler.removeCallbacks(it) }
                        playerReconnectRunnable = Runnable {
                            if (isStopped || currentStationId.isBlank()) {
                                return@Runnable
                            }
                            if (currentStationId.startsWith("podcast_")) {
                                // For podcast episodes, re-play the current episode
                                val episodeId = PlaybackStateHelper.getCurrentEpisodeId()
                                if (!episodeId.isNullOrEmpty()) {
                                    Log.d(TAG, "Attempting to reconnect to podcast episode: $episodeId")
                                    replayEpisodeById(episodeId)
                                }
                            } else if (currentStationId.isNotEmpty()) {
                                val stationId = currentStationId
                                if (!tryFallbackStationStream(stationId, "player_error")) {
                                    Log.d(TAG, "Attempting to reconnect to station: $stationId")
                                    playStation(stationId)
                                }
                            }
                        }
                        handler.postDelayed(playerReconnectRunnable!!, 3000) // Wait 3 seconds before reconnecting
                    }
                })
            }
        }
    }

    private fun requestAudioFocus() {
        // ExoPlayer already requests and manages audio focus when configured with
        // setAudioAttributes(..., handleAudioFocus = true). A second manual request
        // here can race and trigger immediate focus-loss callbacks on resume.
        // Keep this method as a no-op so existing call sites remain simple.
        return
    }

    private fun persistCurrentPodcastProgress() {
        if (!currentStationId.startsWith("podcast_")) return
        val episodeId = PlaybackStateHelper.getCurrentEpisodeId() ?: return
        val pos = player?.currentPosition ?: 0L
        if (pos <= 0L) return
        try {
            PlayedEpisodesPreference.setProgress(this, episodeId, pos)
            lastSavedProgress[episodeId] = pos
        } catch (e: Exception) {
            Log.w(TAG, "Failed to persist podcast progress for $episodeId on pause: ${e.message}")
        }
    }

    private fun handlePauseRequest(source: String) {
        Log.d(TAG, "handlePauseRequest from $source")
        player?.pause()
        persistCurrentPodcastProgress()
        updatePlaybackState(PlaybackStateCompat.STATE_PAUSED)
        PlaybackStateHelper.setIsPlaying(false)
        startForegroundNotification()
    }

    private fun handlePlayRequest(source: String) {
        if (!mediaSession.isActive) mediaSession.isActive = true
        requestAudioFocus()

        val currentPlayer = player
        val playerState = currentPlayer?.playbackState ?: Player.STATE_IDLE
        val hasCurrentMediaItem = currentPlayer?.currentMediaItem != null
        val canResume = currentPlayer != null && !isStopped &&
            (playerState == Player.STATE_READY || playerState == Player.STATE_BUFFERING)

        if (canResume) {
            currentPlayer?.playWhenReady = true
            currentPlayer?.play()
            updatePlaybackState(PlaybackStateCompat.STATE_PLAYING)
            PlaybackStateHelper.setIsPlaying(true)
            if (!currentStationId.startsWith("podcast_")) scheduleShowInfoRefresh()
            startForegroundNotification()
            return
        }

        // Reliability path: if the player still has media attached, recover directly from
        // local ExoPlayer state before doing an episode/station lookup restart.
        if (currentPlayer != null && !isStopped && hasCurrentMediaItem) {
            when (playerState) {
                Player.STATE_IDLE -> {
                    Log.d(TAG, "handlePlayRequest: recovering from IDLE using current media item (source=$source)")
                    currentPlayer.playWhenReady = true
                    currentPlayer.prepare()
                    currentPlayer.play()
                    updatePlaybackState(PlaybackStateCompat.STATE_PLAYING)
                    PlaybackStateHelper.setIsPlaying(true)
                    if (!currentStationId.startsWith("podcast_")) scheduleShowInfoRefresh()
                    startForegroundNotification()
                    return
                }
                Player.STATE_ENDED -> {
                    Log.d(TAG, "handlePlayRequest: restarting ENDED media item from start (source=$source)")
                    currentPlayer.seekTo(0L)
                    currentPlayer.playWhenReady = true
                    currentPlayer.play()
                    updatePlaybackState(PlaybackStateCompat.STATE_PLAYING)
                    PlaybackStateHelper.setIsPlaying(true)
                    if (!currentStationId.startsWith("podcast_")) scheduleShowInfoRefresh()
                    startForegroundNotification()
                    return
                }
            }
        }

        val lastMediaId = PlaybackPreference.getLastMediaId(this)
        val currentEpisodeId = PlaybackStateHelper.getCurrentEpisodeId()
        Log.d(TAG, "handlePlayRequest: player not resumable (source=$source, isStopped=$isStopped, state=$playerState), restarting from current/last media")
        when {
            !currentEpisodeId.isNullOrEmpty() -> replayEpisodeById(currentEpisodeId)
            lastMediaId?.startsWith("podcast_episode_") == true ->
                replayEpisodeById(lastMediaId.removePrefix("podcast_episode_"))
            lastMediaId?.startsWith("station_") == true ->
                playStation(lastMediaId.removePrefix("station_"))
            currentStationId.isNotEmpty() && !currentStationId.startsWith("podcast_") ->
                playStation(currentStationId)
            else -> Log.w(TAG, "handlePlayRequest: no media to restart")
        }
    }

    private fun startForegroundNotification() {
        if (isStopped || currentStationId.isBlank()) {
            try {
                val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                nm.cancel(NOTIFICATION_ID)
            } catch (_: Exception) { }
            return
        }

        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Create previous/next actions. When a podcast is playing, use seek labels (Back 10s / Forward 30s)
        val isPodcast = currentStationId.startsWith("podcast_")
        val previousLabel = if (isPodcast) "Back 10s" else "Previous"
        val nextLabel = if (isPodcast) "Forward 30s" else "Next"
        val previousIcon = if (isPodcast) R.drawable.ic_skip_previous else android.R.drawable.ic_media_previous
        val nextIcon = if (isPodcast) R.drawable.ic_skip_next else android.R.drawable.ic_media_next

        val previousAction = NotificationCompat.Action(
            previousIcon,
            previousLabel,
            createPendingIntent(ACTION_SKIP_TO_PREVIOUS, "previous_action")
        )

        val nextAction = NotificationCompat.Action(
            nextIcon,
            nextLabel,
            createPendingIntent(ACTION_SKIP_TO_NEXT, "next_action")
        )

        // Create play/pause action
        val playPauseAction = if (PlaybackStateHelper.getIsPlaying()) {
            NotificationCompat.Action(
                android.R.drawable.ic_media_pause,
                "Pause",
                createPendingIntent(ACTION_PAUSE, "pause_action")
            )
        } else {
            NotificationCompat.Action(
                android.R.drawable.ic_media_play,
                "Play",
                createPendingIntent(ACTION_PLAY, "play_action")
            )
        }

        // Create stop action using custom stop icon
        val stopAction = NotificationCompat.Action(
            R.drawable.ic_stop,
            "Stop",
            createPendingIntent(ACTION_STOP, "stop_action")
        )

        // Create favorite action. For podcast *episodes* this represents saved-episode (bookmark).
        val favoriteAction = if (currentStationId.startsWith("podcast_") && !PlaybackStateHelper.getCurrentEpisodeId().isNullOrEmpty()) {
            val epId = PlaybackStateHelper.getCurrentEpisodeId() ?: ""
            val saved = SavedEpisodes.isSaved(this, epId)
            NotificationCompat.Action(
                if (saved) R.drawable.ic_bookmark else R.drawable.ic_bookmark_outline,
                if (saved) "Remove saved episode" else "Save episode",
                createPendingIntent(ACTION_TOGGLE_FAVORITE, "favorite_action")
            )
        } else {
            val isFavorite = currentStationId.isNotEmpty() && FavoritesPreference.isFavorite(this, currentStationId)
            NotificationCompat.Action(
                if (isFavorite) R.drawable.ic_star_filled else R.drawable.ic_star_outline,
                if (isFavorite) "Remove from Favorites" else "Add to Favorites",
                createPendingIntent(ACTION_TOGGLE_FAVORITE, "favorite_action")
            )
        }

            // For podcasts we want: Notification Title = podcast name, ContentText/SubText = episode title.
            val pbShow = PlaybackStateHelper.getCurrentShow()

            val notificationTitle = when {
                // Podcasts: podcast name as title
                isPodcast -> currentStationTitle.ifEmpty { "British Radio Player" }
                // Music segments: Artist - Track preferred
                !currentShowInfo.secondary.isNullOrEmpty() || !currentShowInfo.tertiary.isNullOrEmpty() -> {
                    val artist = currentShowInfo.secondary ?: ""
                    val track = currentShowInfo.tertiary ?: ""
                    if (artist.isNotEmpty() && track.isNotEmpty()) "$artist - $track" else currentShowInfo.getFormattedTitle()
                }
                else -> currentStationTitle.ifEmpty { "British Radio Player" }
            }

            // Prefer episode title for podcasts only when it is present and distinct from the
            // podcast/station title; otherwise leave the content/subText empty to avoid
            // duplicate strings in OEM notification UIs.
            val candidateEpisode = (pbShow.episodeTitle ?: currentShowInfo.episodeTitle ?: "").orEmpty()
            val notificationContentText = if (isPodcast) {
                candidateEpisode.takeIf { it.isNotBlank() && !it.equals(notificationTitle, ignoreCase = true) } ?: ""
            } else {
                computeUiSubtitle().let { sub ->
                    val showName = currentShowName.ifEmpty { currentShowInfo.title }
                    if (!showName.isNullOrEmpty() && sub.isNotEmpty() && sub != showName) "$showName — $sub" else sub
                }
            }

            val showDesc = if (isPodcast) {
                candidateEpisode.takeIf { it.isNotBlank() && !it.equals(notificationTitle, ignoreCase = true) } ?: ""
            } else if (!pbShow.secondary.isNullOrEmpty() || !pbShow.tertiary.isNullOrEmpty()) {
                val artist = pbShow.secondary ?: ""
                val track = pbShow.tertiary ?: ""
                if (artist.isNotEmpty() && track.isNotEmpty()) "$artist - $track" else pbShow.getFormattedTitle()
            } else {
                (pbShow.episodeTitle ?: currentShowTitle).orEmpty()
            }

            // Determine fallback artwork: prefer cached show/episode artwork bitmap,
            // otherwise use the station's generic logo as immediate placeholder
            val fallbackLargeIcon = if (currentStationId.isNotBlank()) {
                StationArtwork.createBitmap(currentStationId)
            } else {
                null
            }

            val notificationBuilder = NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(notificationTitle)
                .setContentText(notificationContentText)
                // Set subText to the descriptive piece (improves OEM rendering)
                .setSubText(showDesc)
            .setSmallIcon(R.drawable.ic_stat_notification)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setSound(null)
            .setVibrate(null)
            .addAction(stopAction)
            .addAction(previousAction)
            .addAction(playPauseAction)
            .addAction(nextAction)
            .addAction(favoriteAction)
            .setStyle(MediaStyle()
                .setMediaSession(mediaSession.sessionToken)
                // Compact view: show Previous, Play/Pause, Next (indices 1,2,3)
                .setShowActionsInCompactView(1, 2, 3)
            )
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            
            // Set fallback large icon immediately so notification doesn't show a grey square
            // whilst artwork is loading. This will be replaced with actual show/episode artwork
            // once loadStationLogoAndUpdateNotification() completes.
            if (fallbackLargeIcon != null) {
                notificationBuilder.setLargeIcon(fallbackLargeIcon)
            }

        val notification = notificationBuilder.build()
        startForeground(NOTIFICATION_ID, notification)

        // Load station logo asynchronously and update notification
        if (currentStationLogo.isNotEmpty()) {
            loadStationLogoAndUpdateNotification()
        }

        WidgetUpdateHelper.updateAllWidgets(this)
    }

    private fun loadStationLogoAndUpdateNotification() {
        // Snapshot play state on the main thread; ExoPlayer is not thread-safe.
        val isPlayingSnapshot = PlaybackStateHelper.getIsPlaying()
        Thread {
            try {
                if (isStopped || currentStationId.isBlank()) {
                    return@Thread
                }

                // Capture the station ID at thread-start so we can discard results if the user
                // switches stations while the image is loading (race condition guard).
                val capturedStationId = currentStationId

                // Use image_url from API if available and valid, otherwise fall back to station logo
                var imageUrl: String = when {
                    !currentShowInfo.imageUrl.isNullOrEmpty() && currentShowInfo.imageUrl?.startsWith("http") == true -> currentShowInfo.imageUrl!!
                    else -> currentStationLogo
                }
                
                if (imageUrl.isEmpty()) {
                    Log.d(TAG, "No image URL available for notification")
                    return@Thread
                }
                
                Log.d(TAG, "Loading notification artwork from: $imageUrl")
                
                var bitmap: android.graphics.Bitmap? = null
                var finalUrl = imageUrl
                
                try {
                    bitmap = com.bumptech.glide.Glide.with(this)
                        .asBitmap()
                        .load(imageUrl)
                        .submit(256, 256) // Request 256x256 bitmap
                        .get() // Block until loaded
                        
                    // Check if the loaded bitmap is actually a placeholder (grey box)
                    if (bitmap != null && isPlaceholderImage(bitmap)) {
                        Log.d(TAG, "Detected placeholder image from $imageUrl, forcing fallback")
                        bitmap = null // Discard it
                        throw Exception("Detected placeholder image")
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Failed to load artwork from $imageUrl: ${e.message}")
                    // Fallback to station logo if we weren't already using it
                    if (imageUrl != currentStationLogo && currentStationLogo.isNotEmpty()) {
                        Log.d(TAG, "Falling back to station logo: $currentStationLogo")
                        finalUrl = currentStationLogo
                        try {
                            bitmap = com.bumptech.glide.Glide.with(this)
                                .asBitmap()
                                .load(finalUrl)
                                .submit(256, 256)
                                .get()
                        } catch (e2: Exception) {
                            Log.w(TAG, "Failed to load fallback station logo: ${e2.message}")
                        }
                    }
                }

                // Guard: discard if the station changed while the image was loading.
                // Without this, a podcast artwork fetch that completes after playStation() has
                // already switched to a radio station would overwrite currentArtworkUri /
                // currentArtworkBitmap with stale podcast data and post a notification with
                // the wrong image — causing podcast artwork to persist in the notification shade.
                if (capturedStationId != currentStationId) {
                    Log.d(TAG, "Station changed during artwork load (was: $capturedStationId, now: $currentStationId), discarding result")
                    return@Thread
                }

                if (bitmap != null) {
                    // Cache artwork so later metadata refreshes don't wipe it
                    currentArtworkBitmap = bitmap
                    currentArtworkUri = finalUrl

                    // Update notification with the artwork
                    // Recreate all actions to maintain functionality
                    val isPodcastAction = currentStationId.startsWith("podcast_")
                    val prevLabel = if (isPodcastAction) "Back 10s" else "Previous"
                    val nextLabel = if (isPodcastAction) "Forward 30s" else "Next"
                    val prevIcon = if (isPodcastAction) R.drawable.ic_skip_previous else android.R.drawable.ic_media_previous
                    val nextIcon = if (isPodcastAction) R.drawable.ic_skip_next else android.R.drawable.ic_media_next

                    val previousAction = NotificationCompat.Action(
                        prevIcon,
                        prevLabel,
                        createPendingIntent(ACTION_SKIP_TO_PREVIOUS, "previous_action")
                    )
                    val nextAction = NotificationCompat.Action(
                        nextIcon,
                        nextLabel,
                        createPendingIntent(ACTION_SKIP_TO_NEXT, "next_action")
                    )
                    val playPauseAction = if (isPlayingSnapshot) {
                        NotificationCompat.Action(
                            android.R.drawable.ic_media_pause,
                            "Pause",
                            createPendingIntent(ACTION_PAUSE, "pause_action")
                        )
                    } else {
                        NotificationCompat.Action(
                            android.R.drawable.ic_media_play,
                            "Play",
                            createPendingIntent(ACTION_PLAY, "play_action")
                        )
                    }
                    val stopAction = NotificationCompat.Action(
                        R.drawable.ic_stop,
                        "Stop",
                        createPendingIntent(ACTION_STOP, "stop_action")
                    )
                    val favoriteAction = if (currentStationId.startsWith("podcast_") && !PlaybackStateHelper.getCurrentEpisodeId().isNullOrEmpty()) {
                        val epId = PlaybackStateHelper.getCurrentEpisodeId() ?: ""
                        val saved = SavedEpisodes.isSaved(this, epId)
                        NotificationCompat.Action(
                            if (saved) R.drawable.ic_bookmark else R.drawable.ic_bookmark_outline,
                            if (saved) "Remove saved episode" else "Save episode",
                            createPendingIntent(ACTION_TOGGLE_FAVORITE, "favorite_action")
                        )
                    } else {
                        val isFavorite = currentStationId.isNotEmpty() && FavoritesPreference.isFavorite(this, currentStationId)
                        NotificationCompat.Action(
                            if (isFavorite) R.drawable.ic_star_filled else R.drawable.ic_star_outline,
                            if (isFavorite) "Remove from Favorites" else "Add to Favorites",
                            createPendingIntent(ACTION_TOGGLE_FAVORITE, "favorite_action")
                        )
                    }

                    // Create intent to launch app when notification is tapped
                    val intent = Intent(this, MainActivity::class.java).apply {
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
                    }
                    val pendingIntent = PendingIntent.getActivity(
                        this, 0, intent,
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                    )

val pbShow = PlaybackStateHelper.getCurrentShow()
                    val isPodcast = currentStationId.startsWith("podcast_")
                    val candidateEpisode = (pbShow.episodeTitle ?: currentShowInfo.episodeTitle ?: "").orEmpty()

                    // Notification title should be Artist - Track for music, otherwise station name
                    val notificationTitle = if (!currentShowInfo.secondary.isNullOrEmpty() || !currentShowInfo.tertiary.isNullOrEmpty()) {
                        val artist = currentShowInfo.secondary ?: ""
                        val track = currentShowInfo.tertiary ?: ""
                        if (artist.isNotEmpty() && track.isNotEmpty()) "$artist - $track" else currentShowInfo.getFormattedTitle()
                    } else {
                        currentStationTitle.ifEmpty { "British Radio Player" }
                    }

                    // Show episode title for podcasts only when present and distinct from the podcast title;
                    // otherwise leave the small lines empty to avoid OEM duplication.
                    val notificationContentText = if (isPodcast) {
                        candidateEpisode.takeIf { it.isNotBlank() && !it.equals(notificationTitle, ignoreCase = true) } ?: ""
                    } else {
                        computeUiSubtitle()
                    }

                    // Compute descriptive piece from the PlaybackStateHelper (authoritative runtime state)
                    val showDesc = if (isPodcast) {
                        candidateEpisode.takeIf { it.isNotBlank() && !it.equals(notificationTitle, ignoreCase = true) } ?: ""
                    } else if (!pbShow.secondary.isNullOrEmpty() || !pbShow.tertiary.isNullOrEmpty()) {
                        val artist = pbShow.secondary ?: ""
                        val track = pbShow.tertiary ?: ""
                        if (artist.isNotEmpty() && track.isNotEmpty()) "$artist - $track" else pbShow.getFormattedTitle()
                    } else {
                        (pbShow.episodeTitle ?: currentShowTitle).orEmpty()
                    }

                    // Build the NotificationCompat.Builder first so we can clear any lingering
                    // progress only when necessary (avoids triggering OEM bugs).
                    val nb = NotificationCompat.Builder(this, CHANNEL_ID)
                        .setContentTitle(notificationTitle)
                        .setContentText(notificationContentText)
                        .setSubText(showDesc)
                        .setSmallIcon(R.drawable.ic_stat_notification)
                        .setLargeIcon(bitmap)
                        .setContentIntent(pendingIntent)
                        .setOngoing(true)
                        .setSound(null)
                        .setVibrate(null)
                        .addAction(stopAction)
                        .addAction(previousAction)
                        .addAction(playPauseAction)
                        .addAction(nextAction)
                        .addAction(favoriteAction)
                        .setStyle(MediaStyle()
                            .setMediaSession(mediaSession.sessionToken)
                            .setShowActionsInCompactView(1, 2, 3)
                        )
                        .setPriority(NotificationCompat.PRIORITY_DEFAULT)

                    if (!currentStationId.startsWith("podcast_") && notificationHadProgress) {
                        nb.setProgress(0, 0, false)
                        notificationHadProgress = false
                    }

                    val updatedNotification = nb.build()

                    // Guard: stop may have been called while the image was loading
                    if (isStopped || currentStationId.isBlank()) {
                        return@Thread
                    }

                    // Post the notification update to the main thread so it is serialised with
                    // stopPlayback().  Without this, a race between the background image-load
                    // completing and stopPlayback() cancelling the notification causes the
                    // notification to reappear in the shade even after the user taps Stop.
                    handler.post {
                        if (isStopped || currentStationId.isBlank() || capturedStationId != currentStationId) {
                            // stopPlayback() ran while we were loading, or station changed – discard the result
                            return@post
                        }
                        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                        notificationManager.notify(NOTIFICATION_ID, updatedNotification)
                        Log.d(TAG, "Updated notification with artwork from: $finalUrl")
                        WidgetUpdateHelper.updateAllWidgets(this)
                        updateMediaMetadata(bitmap, finalUrl)
                    }
                } else {
                    // If bitmap load failed completely, still update metadata with the fallback URI
                    // This ensures AA at least has a valid URI to try, rather than the broken one or the placeholder
                    if (finalUrl.isNotEmpty() && capturedStationId == currentStationId) {
                         Log.d(TAG, "Bitmap load failed, updating metadata with URI only: $finalUrl")
                         currentArtworkBitmap = null
                         currentArtworkUri = finalUrl
                         updateMediaMetadata(null, finalUrl)
                         WidgetUpdateHelper.updateAllWidgets(this)
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "Failed to load artwork for notification: ${e.message}")
            }
        }.start()
    }
    
    private fun isPlaceholderImage(bitmap: android.graphics.Bitmap): Boolean {
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

    private fun createPendingIntent(action: String, tag: String): PendingIntent {
        val intent = Intent(this, RadioService::class.java).apply {
            this.action = action
        }
        return PendingIntent.getService(
            this,
            tag.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun tryFallbackStationStream(stationId: String, reason: String): Boolean {
        val station = StationRepository.getStationById(stationId) ?: return false
        if (currentStreamCandidateIndex >= currentStreamCandidates.lastIndex) return false

        currentStreamCandidateIndex += 1
        val streamUri = currentStreamCandidates[currentStreamCandidateIndex]
        Log.w(
            TAG,
            "Retrying ${station.title} via fallback stream (${currentStreamCandidateIndex + 1}/${currentStreamCandidates.size}): $streamUri ($reason)"
        )

        lastSongSignature = null
        lastSavedSongSignature = null

        player?.release()
        player = null
        ensurePlayer()
        requestAudioFocus()

        updatePlaybackState(PlaybackStateCompat.STATE_BUFFERING)
        player?.apply {
            playWhenReady = true
            setMediaItem(ExoMediaItem.fromUri(streamUri))
            prepare()
        }

        fetchAndUpdateShowInfo(stationId)
        scheduleShowInfoRefresh()
        startForegroundNotification()
        return true
    }

    private fun playStation(stationId: String) {
        isStopped = false
        playerReconnectRunnable?.let { handler.removeCallbacks(it); playerReconnectRunnable = null }
        if (!mediaSession.isActive) mediaSession.isActive = true
        val station = StationRepository.getStations().firstOrNull { it.id == stationId }
        if (station == null) {
            Log.w(TAG, "Unknown station: $stationId")
            return
        }

        // Cancel any pending analytics from previous playback
        stationAnalyticsRunnable?.let { handler.removeCallbacks(it); stationAnalyticsRunnable = null }
        episodeAnalyticsRunnable?.let { handler.removeCallbacks(it); episodeAnalyticsRunnable = null }
        stationAnalyticsPending = false
        stationAnalyticsScheduled = false
        episodeAnalyticsPending = false
        episodeAnalyticsScheduled = false

        // Prepare station analytics to fire after 10 seconds of continuous playback
        stationAnalyticsRunnable = Runnable {
            serviceScope.launch(Dispatchers.IO) {
                PrivacyAnalytics(this@RadioService).trackStationPlay(station.id, station.title)
            }
            stationAnalyticsPending = false
            stationAnalyticsScheduled = false
            stationAnalyticsRunnable = null
        }
        stationAnalyticsPending = true
        stationAnalyticsScheduled = false

        PlaybackPreference.setLastStationId(this, station.id)
        
        val audioQuality = ThemePreference.getEffectiveAudioQuality(this)
        currentStreamCandidates = station.getStreamCandidates(audioQuality)
        if (currentStreamCandidates.isEmpty()) {
            Log.w(TAG, "No stream candidates available for station: ${station.id}")
            return
        }
        currentStreamCandidateIndex = 0
        val streamUri = currentStreamCandidates[currentStreamCandidateIndex]

        Log.d(
            TAG,
            "Playing station: ${station.title} - $streamUri (candidate ${currentStreamCandidateIndex + 1}/${currentStreamCandidates.size}, quality: ${audioQuality.storageValue})"
        )
        
        currentStationTitle = station.title
        currentStationId = station.id
        currentPodcastId = null
        matchedPodcast = null
        matchPodcastJob?.cancel()
        matchPodcastJob = null
        lastMatchKey = null
        currentStationLogo = station.logoUrl
        currentShowInfo = CurrentShow("") // Reset to empty to avoid "BBC Radio" flash
        currentShowName = ""
        currentShowTitle = ""
        currentEpisodeTitle = ""
        currentEpisodeArtworkUrl = null
        currentPodcastArtworkUrl = null
        currentArtworkBitmap = null
        currentArtworkUri = currentStationLogo
        lastSongSignature = null // Reset last song signature for new station
        lastSavedSongSignature = null

        // If switching from a podcast, stop its progress updates and clear episode id so UI stops showing episode/progress
        podcastProgressRunnable?.let { handler.removeCallbacks(it); podcastProgressRunnable = null }
        // Stop subtitle cycler (if running) when changing station
        subtitleCycleRunnable?.let { handler.removeCallbacks(it); subtitleCycleRunnable = null; isSubtitleCycling = false }
        PlaybackStateHelper.setCurrentEpisodeId(null)

        // Cancel existing show refresh
        showInfoRefreshRunnable?.let { handler.removeCallbacks(it) }
        // Cancel any pending delayed Now Playing update from previous station
        applyShowInfoRunnable?.let { handler.removeCallbacks(it); applyShowInfoRunnable = null }
        pendingShowInfo = null
        
        // Fetch current show information
        fetchAndUpdateShowInfo(station.id)
        
        // Attempt initial matching using the station title (show title will update later)
        updateMatchingPodcastForShow(station, currentShowInfo)
        
        // Update global playback state - SET STATION FIRST before notifying listeners
        PlaybackStateHelper.setCurrentStation(station)
        PlaybackStateHelper.setCurrentShow(currentShowInfo) // Clear show info in helper to prevent flashing old metadata
        PlaybackStateHelper.setIsPlaying(true)
        
        // Release existing player to ensure clean state
        player?.release()
        player = null
        
        ensurePlayer()
        requestAudioFocus()
        
        // Set metadata immediately with station logo URI (lets the system show artwork ASAP)
        updateMediaMetadata(artworkBitmap = null, artworkUri = currentStationLogo)

        // Some OEMs persist a previously-displayed notification progress bar until the
        // notification is fully replaced. Force-replace the foreground notification here
        // when switching to a live station so any lingering progress is cleared.
        try {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.cancel(NOTIFICATION_ID)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to cancel existing notification: ${e.message}")
        }
        // Rebuild & re-post the foreground notification (will not include progress for live streams)
        startForegroundNotification()
        
        // Indicate buffering immediately to prevent UI from showing "Stopped"
        updatePlaybackState(PlaybackStateCompat.STATE_BUFFERING)

        player?.apply {
            playWhenReady = true
            setMediaItem(ExoMediaItem.fromUri(streamUri))
            prepare()
        }
        
        // Schedule periodic show info refresh (every 30 seconds)
        scheduleShowInfoRefresh()
    }

    private fun refreshCurrentStream(reason: String) {
        val stationId = currentStationId
        if (stationId.isEmpty()) {
            Log.d(TAG, "refreshCurrentStream skipped ($reason): no active station")
            return
        }

        val station = StationRepository.getStationById(stationId)
        if (station == null) {
            Log.w(TAG, "refreshCurrentStream skipped ($reason): station not found for id=$stationId")
            return
        }

        val audioQuality = ThemePreference.getEffectiveAudioQuality(this)
        val refreshedCandidates = station.getStreamCandidates(audioQuality)
        if (refreshedCandidates.isEmpty()) {
            Log.w(TAG, "refreshCurrentStream skipped ($reason): no stream candidates for ${station.id}")
            return
        }
        currentStreamCandidates = refreshedCandidates
        currentStreamCandidateIndex = currentStreamCandidateIndex.coerceIn(0, currentStreamCandidates.lastIndex)
        val streamUri = currentStreamCandidates[currentStreamCandidateIndex]

        Log.d(
            TAG,
            "Refreshing stream due to $reason. Station=${station.title}, candidate ${currentStreamCandidateIndex + 1}/${currentStreamCandidates.size}, quality=${audioQuality.storageValue}"
        )
        lastSongSignature = null
        lastSavedSongSignature = null

        // Ensure any podcast progress runnable is cancelled (prevents stale episode/progress persisting in UI)
        podcastProgressRunnable?.let { handler.removeCallbacks(it); podcastProgressRunnable = null }
        PlaybackStateHelper.setCurrentEpisodeId(null)

        player?.release()
        player = null
        ensurePlayer()
        requestAudioFocus()

        updatePlaybackState(PlaybackStateCompat.STATE_BUFFERING)
        player?.apply {
            playWhenReady = true
            setMediaItem(ExoMediaItem.fromUri(streamUri))
            prepare()
        }

        fetchAndUpdateShowInfo(stationId)
        scheduleShowInfoRefresh()
        startForegroundNotification()
    }

    private fun fetchAndUpdateShowInfo(stationId: String) {
        Log.d(TAG, "fetchAndUpdateShowInfo called for station: $stationId")
        Thread {
            try {
                Log.d(TAG, "Fetching show info in background thread for station: $stationId")
                var show = runBlocking { ShowInfoFetcher.getCurrentShow(stationId) }
                
                // Check if we are still playing the requested station
                if (stationId != currentStationId) {
                    Log.d(TAG, "Station changed during fetch (requested: $stationId, current: $currentStationId), ignoring result")
                    return@Thread
                }

                Log.d(TAG, "ShowInfoFetcher returned: ${show.title}")

                // Track RMS server cache TTL for smarter polling
                Log.d(TAG, "RMS Cache-Control max-age: ${ShowInfoFetcher.lastRmsCacheMaxAgeMs}ms")
                
                // Only update song data when RMS explicitly returns it
                // If RMS returns empty secondary/tertiary, clear song data immediately
                val songSignature = listOf(show.secondary, show.tertiary)
                    .filter { !it.isNullOrEmpty() }
                    .joinToString("|")
                    .ifEmpty { null }

                var finalShow = show
                if (songSignature != null) {
                    if (songSignature != lastSongSignature) {
                        lastSongSignature = songSignature
                        Log.d(TAG, "New song detected: $songSignature")
                        // addSong is called in the apply paths below so it is saved at the same
                        // time the mini player displays the song (avoiding premature list entries)
                    }
                } else {
                    // RMS returned no song data - clear immediately
                    if (lastSongSignature != null) {
                        Log.d(TAG, "RMS stopped returning song data. Reverting to show name.")
                        finalShow = show.copy(secondary = null, tertiary = null)
                        lastSongSignature = null
                        lastSavedSongSignature = null
                    }
                }
                
                // Prepare to update show info but delay applying it for live streams to account for stream latency
                val formattedTitle = finalShow.getFormattedTitle()

                // Always update the playback helper's idea of current show so listeners get the new value immediately
                // (but don't update UI/metadata for streams until the delay passes)
                // Use the immutable fetch parameter (not the mutable service field) so classification
                // is stable even if playStation() switches away while this thread was fetching.
                val isPodcast = stationId.startsWith("podcast_")

                if (isPodcast) {
                    // For podcasts, guard against overwriting authoritative podcast series metadata
                    // with ShowInfoFetcher defaults (e.g. "BBC Radio"). Treat placeholder/empty
                    // responses as non-authoritative and do not replace the series title.
                    val titleIsPlaceholder = finalShow.title == "BBC Radio"

                    // Detect meaningful changes (ignore placeholder/empty fields from fetcher)
                    val titleChanged = !titleIsPlaceholder && finalShow.title != currentShowInfo.title
                    val episodeChanged = !finalShow.episodeTitle.isNullOrEmpty() && finalShow.episodeTitle != currentShowInfo.episodeTitle
                    val imageChanged = !finalShow.imageUrl.isNullOrEmpty() && finalShow.imageUrl != currentShowInfo.imageUrl
                    val songDataChanged = (!finalShow.secondary.isNullOrEmpty() && finalShow.secondary != currentShowInfo.secondary) || (!finalShow.tertiary.isNullOrEmpty() && finalShow.tertiary != currentShowInfo.tertiary)

                    // Merge fetched data into current show state but preserve an existing, non-placeholder
                    // series title when the fetcher returns the generic "BBC Radio" placeholder.
                    val mergedTitle = if (titleIsPlaceholder && !currentShowInfo.title.isNullOrEmpty() && currentShowInfo.title != "BBC Radio") currentShowInfo.title else finalShow.title
                    val mergedImage = finalShow.imageUrl ?: currentShowInfo.imageUrl
                    val mergedEpisode = finalShow.episodeTitle ?: currentShowInfo.episodeTitle

                    val mergedShow = finalShow.copy(title = mergedTitle, imageUrl = mergedImage, episodeTitle = mergedEpisode)

                    // Update PlaybackStateHelper with the merged, authoritative show so other consumers
                    // never see the placeholder value unexpectedly.
                    // Guard: discard if the station changed while we were fetching (race condition).
                    if (stationId != currentStationId) return@Thread
                    PlaybackStateHelper.setCurrentShow(mergedShow)

                    if (titleChanged || episodeChanged || imageChanged || songDataChanged) {
                        // Commit authoritative changes locally
                        currentShowInfo = mergedShow
                        currentShowName = mergedShow.title // Store the actual show name
                        currentShowTitle = if (formattedTitle == "BBC Radio") "" else formattedTitle
                        currentEpisodeTitle = mergedShow.episodeTitle ?: ""

                        Log.d(TAG, "Podcast metadata changed (titleChanged=$titleChanged, episodeChanged=$episodeChanged, imageChanged=$imageChanged, songDataChanged=$songDataChanged) — updating UI")

                        // Switch to main thread to update UI immediately for podcasts
                        handler.post {
                            Log.d(TAG, "Updating UI with show title: $currentShowTitle (podcast immediate)")
                            // Save song to history at the same time the mini player shows it
                            saveCurrentSongIfNew(stationId)
                            val nowPlayingImageUrl = mergedShow.imageUrl
                            if (nowPlayingImageUrl?.startsWith("http") == true) {
                                currentArtworkUri = nowPlayingImageUrl
                            } else {
                                currentArtworkUri = null
                            }
                            updateMediaMetadata()
                            startForegroundNotification()
                        }
                    } else {
                        Log.d(TAG, "No podcast metadata change detected; skipping UI refresh")
                    }
                } else {
                    // For live streams, apply immediately if this is the first fetch after switching stations.
                    val isInitialApply = currentShowInfo.title.isNullOrEmpty() && currentShowName.isEmpty()
                    if (isInitialApply) {
                        // Guard: discard if the station changed while we were fetching.
                        // Without this, a podcast fetch that completes after playStation() has
                        // already switched to a radio station would write podcast show data into
                        // currentShowInfo/currentShowName and PlaybackStateHelper, causing the
                        // mini player subtitle and artwork to show stale podcast details.
                        if (stationId != currentStationId) return@Thread
                        // Apply immediately so the now playing field isn't blank on first play/switch
                        currentShowInfo = finalShow
                        currentShowName = finalShow.title
                        currentShowTitle = if (formattedTitle == "BBC Radio") "" else formattedTitle
                        currentEpisodeTitle = finalShow.episodeTitle ?: ""
                        PlaybackStateHelper.setCurrentShow(finalShow)
                        Log.d(TAG, "Applying initial show info immediately for station: $stationId")

                        // Update matching podcast based on the current show title
                        updateMatchingPodcastForShow(StationRepository.getStationById(stationId), currentShowInfo)

                        // Update UI right away
                        handler.post {
                            Log.d(TAG, "Updating UI with show title: $currentShowTitle (initial immediate)")
                            // Save song to history at the same time the mini player shows it
                            saveCurrentSongIfNew(stationId)
                            // Reset currentArtworkUri so displayUri won't include an unverified
                            // URL. loadStationLogoAndUpdateNotification() will set it to the
                            // confirmed value once the bitmap has been loaded and checked.
                            currentArtworkUri = null
                            updateMediaMetadata()
                            startForegroundNotification()
                        }
                    } else {
                        // For subsequent updates, schedule a delayed apply to match ~30s stream latency
                        pendingShowInfo = finalShow
                        // Clear any previously scheduled apply
                        applyShowInfoRunnable?.let { handler.removeCallbacks(it) }
                        applyShowInfoRunnable = Runnable {
                            // Ensure the station hasn't changed since scheduling
                            if (stationId == currentStationId && pendingShowInfo != null) {
                                currentShowInfo = pendingShowInfo!!
                                currentShowName = currentShowInfo.title
                                val fmt = currentShowInfo.getFormattedTitle()
                                currentShowTitle = if (fmt == "BBC Radio") "" else fmt
                                currentEpisodeTitle = currentShowInfo.episodeTitle ?: ""
                                PlaybackStateHelper.setCurrentShow(currentShowInfo)
                                Log.d(TAG, "Applying delayed show info after ${'$'}{NOW_PLAYING_UPDATE_DELAY_MS}ms for station: ${'$'}stationId")

                                // Update matching podcast based on the current show title
                                updateMatchingPodcastForShow(StationRepository.getStationById(stationId), currentShowInfo)

                                // Update UI on main thread
                                handler.post {
                                    Log.d(TAG, "Updating UI with show title: $currentShowTitle (delayed)")
                                    // Save song to history at the same time the mini player shows it (after the stream delay)
                                    saveCurrentSongIfNew(stationId)
                                    // Reset currentArtworkUri so displayUri won't include an unverified
                                    // URL. loadStationLogoAndUpdateNotification() will set it to the
                                    // confirmed value once the bitmap has been loaded and checked.
                                    currentArtworkUri = null
                                    updateMediaMetadata()
                                    startForegroundNotification()
                                }
                            } else {
                                Log.d(TAG, "Station changed before applying delayed show info (requested: $stationId, current: $currentStationId), ignoring")
                            }
                            // Clear pending references
                            pendingShowInfo = null
                            applyShowInfoRunnable = null
                        }
                        handler.postDelayed(applyShowInfoRunnable!!, NOW_PLAYING_UPDATE_DELAY_MS)
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "Error fetching show info: ${e.message}", e)
            }
        }.start()
    }
    
    private fun scheduleShowInfoRefresh() {
        // Cancel existing scheduled refresh
        showInfoRefreshRunnable?.let { handler.removeCallbacks(it) }
        
        // Create new refresh runnable - poll every 30 seconds (BBC's optimal cadence)
        showInfoRefreshRunnable = Runnable {
            if (currentStationId.isNotEmpty() && PlaybackStateHelper.getIsPlaying()) {
                fetchAndUpdateShowInfo(currentStationId)
                // Schedule next refresh
                handler.postDelayed(showInfoRefreshRunnable!!, showInfoPollIntervalMs)
            }
        }
        
        // Schedule first refresh
        handler.postDelayed(showInfoRefreshRunnable!!, showInfoPollIntervalMs)
    }

    private fun skipStation(step: Int) {
        val stations = getScrollableStations()
        if (stations.isEmpty()) return

        val currentIndex = stations.indexOfFirst { it.id == currentStationId }
        val targetIndex = if (currentIndex == -1) {
            0
        } else {
            (currentIndex + step + stations.size) % stations.size
        }

        playStation(stations[targetIndex].id)
    }

    private fun getScrollableStations(): List<Station> {
        val mode = ScrollingPreference.getScrollMode(this)
        val favorites = FavoritesPreference.getFavorites(this)
        return if (mode == ScrollingPreference.MODE_FAVORITES && favorites.isNotEmpty()) {
            favorites
        } else {
            StationRepository.getStations()
        }
    }
    
    /**
     * Saves the song currently in [currentShowInfo] to the recent songs history if it has not
     * already been saved (i.e. if the song signature has changed). Must be called on the main
     * thread so that [lastSavedSongSignature] is accessed safely.
     */
    private fun saveCurrentSongIfNew(stationId: String) {
        val songSig = listOf(currentShowInfo.secondary, currentShowInfo.tertiary)
            .filter { !it.isNullOrEmpty() }.joinToString("|").ifEmpty { null } ?: return
        if (songSig == lastSavedSongSignature) return
        lastSavedSongSignature = songSig
        try {
            RecentSongsPreference.addSong(
                this,
                currentShowInfo.secondary ?: "",
                currentShowInfo.tertiary ?: "",
                currentShowInfo.imageUrl ?: "",
                stationId,
                currentStationTitle
            )
        } catch (_: Exception) { }
    }

    private fun updateMediaMetadata(artworkBitmap: android.graphics.Bitmap? = null, artworkUri: String? = null) {
        // Return early if playback is stopped to prevent queued notification updates
        if (isStopped || currentStationId.isBlank()) {
            return
        }

        val hasSongData = !currentShowInfo.secondary.isNullOrEmpty() || !currentShowInfo.tertiary.isNullOrEmpty()
        val artistStr = if (!currentShowInfo.secondary.isNullOrEmpty()) currentShowInfo.secondary ?: "" else currentShowName
        val trackStr = if (!currentShowInfo.tertiary.isNullOrEmpty()) currentShowInfo.tertiary ?: "" else currentShowTitle
        // Combine artist and track when both are available so device UIs that show METADATA_KEY_ARTIST
        // will display "Artist - Track" (matching the mini player)
        val artistTrackStr = if (hasSongData && artistStr.isNotEmpty() && trackStr.isNotEmpty()) "$artistStr - $trackStr" else artistStr

        // Defensive null-safety: treat station id/title fields as possibly-empty and avoid calling
        // String methods on nullable receivers in case older branches declare them nullable.
        val isPodcast = currentStationId.startsWith("podcast_")

        // Keep artwork sticky across metadata refreshes. Some OEM media UIs only show art
        // if a bitmap is present in the MediaSession metadata.
        val preferredPodcastArtwork = resolvePreferredPodcastArtworkUrl(currentEpisodeArtworkUrl, currentPodcastArtworkUrl)
        val displayUri: String = if (isPodcast) {
            (artworkUri ?: preferredPodcastArtwork.takeIf { it.isNotBlank() } ?: currentArtworkUri ?: currentStationLogo).orEmpty()
        } else {
            // For radio stations, only use artwork that has been verified (loaded and not a grey
            // placeholder) by loadStationLogoAndUpdateNotification(). currentShowInfo.imageUrl is
            // excluded here because it is unverified and may point to a grey placeholder; once the
            // bitmap has been loaded and checked, currentArtworkUri (or the passed artworkUri) will
            // contain the confirmed URL. Never fall back to the BBC station logo so that Android
            // Auto's now-playing screen shows the generic station icon instead.
            listOfNotNull(artworkUri, currentArtworkUri)
                .firstOrNull { it.isNotEmpty() && it != currentStationLogo }
                .orEmpty()
        }

        val displayBitmap = if (!isPodcast) {
            // For radio stations, only trust bitmaps that were loaded alongside show artwork
            // (i.e. the accompanying URI is not the BBC station logo).  Everything else falls
            // back to the generic StationArtwork so the BBC logo never appears on the Android
            // Auto now-playing screen.
            val passedBitmapIsShowArt = artworkBitmap != null && artworkUri != null && artworkUri != currentStationLogo
            val cachedBitmapIsShowArt = currentArtworkBitmap != null && currentArtworkUri != null && currentArtworkUri != currentStationLogo
            when {
                passedBitmapIsShowArt -> artworkBitmap
                cachedBitmapIsShowArt -> currentArtworkBitmap
                currentStationId.isNotBlank() -> StationArtwork.createBitmap(currentStationId)
                else -> null
            }
        } else {
            // For podcasts, do not publish a stale bitmap from a previous episode/source.
            // Many full-screen surfaces and Android Auto prioritise bitmap keys over URI keys.
            val passedBitmapMatchesDisplay = artworkBitmap != null && !artworkUri.isNullOrBlank() && artworkUri == displayUri
            val cachedBitmapMatchesDisplay = currentArtworkBitmap != null && !currentArtworkUri.isNullOrBlank() && currentArtworkUri == displayUri
            when {
                passedBitmapMatchesDisplay -> artworkBitmap
                cachedBitmapMatchesDisplay -> currentArtworkBitmap
                else -> null
            }
        }

        val mediaIdVal: String = if (isPodcast) {
            // Prefer currently-playing episode id; fall back to station id (never null at runtime, but coerce defensively)
            PlaybackStateHelper.getCurrentEpisodeId().orEmpty().ifEmpty { currentStationId.orEmpty() }
        } else {
            currentStationId.orEmpty()
        }

        // For podcasts we want the canonical mapping most head-units (including Android Auto)
        // expect: METADATA_KEY_TITLE = episode title, METADATA_KEY_ALBUM = podcast title.
        // Keep DISPLAY_* keys so modern UIs show podcast (top) + episode (subtitle).
        // For podcasts ensure METADATA_KEY_TITLE contains the episode title only when it is
        // present and distinct from the station/podcast title; otherwise leave it empty to
        // avoid OEMs showing the same string twice in notifications.
        val titleCandidate = (currentShowInfo.episodeTitle ?: currentShowTitle).orEmpty()
        val titleVal: String = if (isPodcast) {
            if (titleCandidate.isNotBlank() && !titleCandidate.equals(currentStationTitle, ignoreCase = true)) titleCandidate else ""
        } else if (hasSongData) {
            currentShowInfo.getFormattedTitle().ifEmpty { currentStationTitle.orEmpty() }
        } else {
            currentStationTitle.orEmpty()
        }

        val artistVal: String = if (isPodcast) {
            // artist field can carry author/host or show name for podcasts
            currentShowName.orEmpty()
        } else if (hasSongData) {
            artistTrackStr.orEmpty()
        } else {
            currentShowName.orEmpty()
        }

        // Compute the subtitle (centralized) and let computeUiSubtitle() keep PlaybackStateHelper in sync.
        val displaySubtitle = computeUiSubtitle()

        val metadataBuilder = android.support.v4.media.MediaMetadataCompat.Builder()
            // Use metadata keys that make Android Auto show correct fields for podcasts and streams
            .putString(android.support.v4.media.MediaMetadataCompat.METADATA_KEY_MEDIA_ID, mediaIdVal)
            // Podcast mapping: TITLE=episode, ALBUM=podcast; keep ARTIST/COMPOSER for compatibility
            .putString(android.support.v4.media.MediaMetadataCompat.METADATA_KEY_TITLE, titleVal)
            .putString(android.support.v4.media.MediaMetadataCompat.METADATA_KEY_ALBUM, if (isPodcast) currentStationTitle.orEmpty() else if (hasSongData) trackStr.orEmpty() else currentShowName.ifEmpty { "Live Stream" })
            .putString(android.support.v4.media.MediaMetadataCompat.METADATA_KEY_ARTIST, artistVal)
            .putString(android.support.v4.media.MediaMetadataCompat.METADATA_KEY_COMPOSER, currentEpisodeTitle.orEmpty())
            // Redundant artist fields for head-units that read alternate keys; set to combined string when possible
            .putString(android.support.v4.media.MediaMetadataCompat.METADATA_KEY_ALBUM_ARTIST, artistTrackStr.orEmpty())
            .putString(android.support.v4.media.MediaMetadataCompat.METADATA_KEY_AUTHOR, artistTrackStr.orEmpty())
            .putString(android.support.v4.media.MediaMetadataCompat.METADATA_KEY_WRITER, artistTrackStr.orEmpty())
            // Display title: prefer to expose the podcast/station title only when there is
            // a distinct episode title available. When the episode title is missing or
            // identical to the station title we intentionally leave DISPLAY_TITLE empty to
            // avoid duplicate lines in OEM notification UIs that render both notification
            // contentTitle and displayTitle.
            .putString(android.support.v4.media.MediaMetadataCompat.METADATA_KEY_DISPLAY_TITLE,
                // For podcasts leave the display title empty to avoid duplication in OEM
                // notification UIs that also display the notification content title.
                if (isPodcast) "" else currentStationTitle.orEmpty())
            // For head-units (Android Auto / OEM UIs) expose the combined compact subtitle
            // (e.g. "Show Name - Show Description" or "Artist - Track") so the subtitle
            // shown on the head-unit matches the mini/notification UI.
            .putString(android.support.v4.media.MediaMetadataCompat.METADATA_KEY_DISPLAY_SUBTITLE,
                displaySubtitle.takeIf { it.isNotBlank() && !it.equals(currentStationTitle, ignoreCase = true) } ?: "")
            .putString(android.support.v4.media.MediaMetadataCompat.METADATA_KEY_ALBUM_ART_URI, displayUri)
            .putString(android.support.v4.media.MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON_URI, displayUri)
            .putString(android.support.v4.media.MediaMetadataCompat.METADATA_KEY_ART_URI, displayUri)
            .putLong(android.support.v4.media.MediaMetadataCompat.METADATA_KEY_DURATION, 
                if (currentStationId.startsWith("podcast_")) (currentShowInfo.segmentDurationMs ?: (player?.duration ?: -1L)) else -1L)

        if (displayBitmap != null) {
            metadataBuilder.putBitmap(android.support.v4.media.MediaMetadataCompat.METADATA_KEY_ALBUM_ART, displayBitmap)
            metadataBuilder.putBitmap(android.support.v4.media.MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON, displayBitmap)
            metadataBuilder.putBitmap(android.support.v4.media.MediaMetadataCompat.METADATA_KEY_ART, displayBitmap)
        }

        val metadata = metadataBuilder.build()
        mediaSession.setMetadata(metadata)

        // If the subtitle cycler is active, push the cycled subtitle into PlaybackStateHelper
        // and refresh the notification/mini-player so they reflect the change.
        try {
            if (!isPodcast && isSubtitleCycling) {
                val cycledShow = currentShowInfo.copy(episodeTitle = displaySubtitle, segmentStartMs = currentShowInfo.segmentStartMs, segmentDurationMs = currentShowInfo.segmentDurationMs)
                PlaybackStateHelper.setCurrentShow(cycledShow)
                // Keep the service-local copy in sync so other code paths read the cycled subtitle
                currentShowInfo = cycledShow
                currentShowTitle = currentShowTitle // no-op but keeps intent explicit
                Log.d(TAG, "Cycled subtitle for UI: $displaySubtitle")

                // Refresh notification/mini-player on main thread
                try {
                    handler.post { startForegroundNotification() }
                } catch (t: Throwable) {
                    Log.w(TAG, "Failed to refresh notification during subtitle cycle: ${t.message}")
                }
            }
        } catch (t: Throwable) {
            Log.w(TAG, "Error while applying cycled subtitle to PlaybackStateHelper: ${t.message}")
        }

        // Debug log: ensure artist/track fields are present when song data is available
        try {
            val mTitle = metadata.getString(android.support.v4.media.MediaMetadataCompat.METADATA_KEY_TITLE)
            val mArtist = metadata.getString(android.support.v4.media.MediaMetadataCompat.METADATA_KEY_ARTIST)
            val mDisplayTitle = metadata.getString(android.support.v4.media.MediaMetadataCompat.METADATA_KEY_DISPLAY_TITLE)
            val mDisplaySubtitle = metadata.getString(android.support.v4.media.MediaMetadataCompat.METADATA_KEY_DISPLAY_SUBTITLE)
            Log.d(TAG, "MediaMetadata updated - title=$mTitle, artist=$mArtist, displayTitle=$mDisplayTitle, displaySubtitle=$mDisplaySubtitle")
        } catch (e: Exception) {
            Log.w(TAG, "Failed to log metadata: ${e.message}")
        }

    }

    // Centralized UI subtitle selection so notification / mini player / Android Auto remain consistent
    private fun computeUiSubtitle(): String {
        val isPodcast = currentStationId.startsWith("podcast_")
        val hasSongData = !currentShowInfo.secondary.isNullOrEmpty() || !currentShowInfo.tertiary.isNullOrEmpty()
        // Use the actual programme/show name (not the formatted title) as the left-hand part
        val showName = currentShowName.orEmpty()
        // Prefer episodeTitle/secondary as the descriptive right-hand part, fall back to formatted title
        val showDesc = currentShowInfo.episodeTitle ?: currentShowInfo.secondary ?: currentShowTitle

        // Simplified behaviour: do NOT cycle. For live streams without song metadata show
        // "Show name - Show description" when both are available.
        val rawSubtitle = when {
            isPodcast -> {
                // Prefer episode title for podcasts but DO NOT return the podcast/station
                // name as the subtitle (some sources populate episodeTitle with the
                // same string). If the episode title is missing or equals the station
                // title, return empty so callers won't display a duplicated subtitle.
                val ep = (PlaybackStateHelper.getCurrentShow().episodeTitle ?: currentShowInfo.episodeTitle ?: "").orEmpty()
                val station = currentStationTitle.orEmpty()
                if (ep.isNotBlank() && !ep.equals(station, ignoreCase = true)) ep else ""
            }
            hasSongData -> {
                val artist = currentShowInfo.secondary ?: ""
                val track = currentShowInfo.tertiary ?: ""
                if (artist.isNotEmpty() && track.isNotEmpty()) "$artist - $track" else currentShowInfo.getFormattedTitle()
            }
            showName.isNotEmpty() && showDesc.isNotEmpty() -> "$showName - $showDesc"
            else -> showDesc.ifEmpty { showName.ifEmpty { currentShowInfo.title.ifEmpty { "Live Stream" } } }
        }

        // Defensive: cancel any leftover cycler state
        if (isSubtitleCycling) {
            subtitleCycleRunnable?.let { handler.removeCallbacks(it) }
            subtitleCycleRunnable = null
            isSubtitleCycling = false
        }

        // Apply the subtitle into PlaybackStateHelper/currentShowInfo so all UI consumers read the same value.
        // For music segments we must store the full "Artist - Track" in episodeTitle so both
        // the compact and full-screen UIs present the correct right-hand descriptive text.
        val storedEpisodeTitle: String? = when {
            // Prefer explicit artist+track when available
            hasSongData -> {
                val artist = currentShowInfo.secondary ?: ""
                val track = currentShowInfo.tertiary ?: ""
                if (artist.isNotEmpty() && track.isNotEmpty()) "$artist - $track" else currentShowInfo.getFormattedTitle().ifEmpty { null }
            }
            // Non-music: store only the descriptive right-hand part (episodeTitle or secondary)
            else -> showDesc.ifEmpty { null }
        }

        try {
            val existing = PlaybackStateHelper.getCurrentShow()
            if ((existing.episodeTitle ?: "") != (storedEpisodeTitle ?: "")) {
                val applied = currentShowInfo.copy(episodeTitle = storedEpisodeTitle)
                PlaybackStateHelper.setCurrentShow(applied)
                currentShowInfo = applied
                // Refresh notification/mini-player asynchronously
                handler.post { startForegroundNotification() }
            }
        } catch (t: Throwable) {
            Log.w(TAG, "Failed to apply UI subtitle to PlaybackStateHelper: ${t.message}")
        }

        return rawSubtitle
    }

    private fun stopPlayback() {
        isStopped = true
        stopAlarmPlaybackVolumeRamp()
        playerReconnectRunnable?.let { handler.removeCallbacks(it); playerReconnectRunnable = null }

        // Shut down the MediaSession completely BEFORE player?.stop() so that neither
        // the ExoPlayer onPlaybackStateChanged(STATE_IDLE) callback nor any subsequent
        // updatePlaybackState() call can post new state to the session.
        // updatePlaybackState() now returns immediately when isStopped == true (see guard
        // at the top of that function), so the steps below are the last writes to the
        // session.  Sequence matters for Samsung One UI 8:
        //   1. Set STATE_NONE (no actions, position 0) — signals "no active playback" to
        //      Samsung's Live-notifications system which monitors setPlaybackState() on
        //      any MediaSession, active or not.
        //   2. Clear metadata (empty builder) — removes the episode/station title and
        //      artwork that Samsung's media-player card would otherwise cache.
        //   3. Deactivate the session — final signal that the session is dormant.
        try {
            mediaSession.setPlaybackState(
                PlaybackStateCompat.Builder()
                    .setState(PlaybackStateCompat.STATE_NONE, 0L, 0f)
                    .build()
            )
        } catch (e: Exception) {
            Log.w(TAG, "Failed to clear MediaSession playback state on stop: ${e.message}")
        }
        try {
            mediaSession.setMetadata(android.support.v4.media.MediaMetadataCompat.Builder().build())
        } catch (e: Exception) {
            Log.w(TAG, "Failed to clear MediaSession metadata on stop: ${e.message}")
        }
        try {
            mediaSession.isActive = false
        } catch (e: Exception) {
            Log.w(TAG, "Failed to deactivate MediaSession on stop: ${e.message}")
        }

        player?.stop()
        stopForeground(STOP_FOREGROUND_REMOVE)
        try {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.cancel(NOTIFICATION_ID)
        } catch (_: Exception) { }
        notificationHadProgress = false
        // updatePlaybackState(STATE_STOPPED) removed: the isStopped guard added to
        // updatePlaybackState() makes any call here a no-op, and the STATE_NONE already
        // set above is the correct terminal state for Samsung Live notifications.

        // Cancel show refresh
        showInfoRefreshRunnable?.let { handler.removeCallbacks(it) }
        podcastProgressRunnable?.let { handler.removeCallbacks(it) }
        // Cancel pending analytics (user stopped before 10s threshold)
        stationAnalyticsRunnable?.let { handler.removeCallbacks(it); stationAnalyticsRunnable = null }
        episodeAnalyticsRunnable?.let { handler.removeCallbacks(it); episodeAnalyticsRunnable = null }
        stationAnalyticsPending = false
        stationAnalyticsScheduled = false
        episodeAnalyticsPending = false
        episodeAnalyticsScheduled = false
        // Stop subtitle cycler
        subtitleCycleRunnable?.let { handler.removeCallbacks(it); subtitleCycleRunnable = null; isSubtitleCycling = false }
        // Cancel any pending delayed Now Playing update
        applyShowInfoRunnable?.let { handler.removeCallbacks(it); applyShowInfoRunnable = null }
        pendingShowInfo = null
        
        // Update global playback state
        PlaybackStateHelper.setCurrentStation(null)
        PlaybackStateHelper.setCurrentEpisodeId(null)
        PlaybackStateHelper.setCurrentMediaUri(null)
        PlaybackStateHelper.setIsPlaying(false)
        currentPodcastId = null
        matchedPodcast = null
        matchPodcastJob?.cancel()
        matchPodcastJob = null
        lastMatchKey = null
        matchedPodcast = null
        currentStationId = ""
        currentStationTitle = ""
        currentStationLogo = ""
        currentShowName = ""
        currentShowTitle = ""
        currentEpisodeTitle = ""
        currentShowInfo = CurrentShow("BBC Radio")
        currentArtworkBitmap = null
        currentArtworkUri = null
        lastSongSignature = null
        lastSavedSongSignature = null

        WidgetUpdateHelper.updateAllWidgets(this)

        Log.d(TAG, "Playback stopped")

        // Stop the service itself so it doesn't continue running as a background service
        // after playback ends. Samsung One UI 8 (and Android generally) may show a
        // "recently active" or background-service notification for a stopped foreground
        // service that is still running. stopSelf() terminates the service when no clients
        // (e.g. Android Auto) are bound. If a client IS bound, Android keeps the service
        // alive until the client unbinds, at which point it is destroyed automatically.
        // When the user plays again, the service is re-started via startForegroundService().
        stopSelf()
    }

    private fun startAlarmPlaybackVolumeRamp(targetVolume: Float = 1.0f) {
        stopAlarmPlaybackVolumeRamp()

        // Set system volume to maximum for progressive ramp
        val audioManager = getSystemService(Context.AUDIO_SERVICE) as android.media.AudioManager
        val maxVolume = audioManager.getStreamMaxVolume(android.media.AudioManager.STREAM_MUSIC)
        audioManager.setStreamVolume(
            android.media.AudioManager.STREAM_MUSIC,
            maxVolume,
            0 // No flags (silent change)
        )

        val totalSteps = 60
        val stepDelayMs = 1_000L
        var step = 0
        var waitAttempts = 0
        val maxWaitAttempts = 120

        player?.volume = 0.0f
        alarmVolumeRampRunnable = object : Runnable {
            override fun run() {
                val currentPlayer = player
                if (currentPlayer == null || !currentPlayer.isPlaying || currentStationId.isEmpty()) {
                    if (waitAttempts < maxWaitAttempts) {
                        waitAttempts += 1
                        handler.postDelayed(this, stepDelayMs)
                    } else {
                        stopAlarmPlaybackVolumeRamp()
                    }
                    return
                }

                val volume = (step.toFloat() / totalSteps.toFloat() * targetVolume).coerceIn(0.0f, 1.0f)
                currentPlayer.volume = volume
                waitAttempts = 0

                if (step < totalSteps) {
                    step += 1
                    handler.postDelayed(this, stepDelayMs)
                }
            }
        }

        handler.post(alarmVolumeRampRunnable!!)
    }

    private fun stopAlarmPlaybackVolumeRamp() {
        alarmVolumeRampRunnable?.let { handler.removeCallbacks(it) }
        alarmVolumeRampRunnable = null
        player?.volume = 1.0f
    }

    private fun setAlarmManualVolume(volumeLevel: Float) {
        stopAlarmPlaybackVolumeRamp()
        
        // Also set system volume based on the manual volume level
        val audioManager = getSystemService(Context.AUDIO_SERVICE) as android.media.AudioManager
        val maxVolume = audioManager.getStreamMaxVolume(android.media.AudioManager.STREAM_MUSIC)
        val targetSystemVolume = (maxVolume * volumeLevel).toInt().coerceIn(1, maxVolume)
        
        Log.d(TAG, "setAlarmManualVolume: volumeLevel=$volumeLevel, maxVolume=$maxVolume, targetSystemVolume=$targetSystemVolume")
        
        audioManager.setStreamVolume(
            android.media.AudioManager.STREAM_MUSIC,
            targetSystemVolume,
            0 // No flags (silent change)
        )
        
        var waitAttempts = 0
        val maxWaitAttempts = 120
        val checkDelayMs = 500L
        
        alarmVolumeRampRunnable = object : Runnable {
            override fun run() {
                val currentPlayer = player
                if (currentPlayer == null || !currentPlayer.isPlaying || currentStationId.isEmpty()) {
                    if (waitAttempts < maxWaitAttempts) {
                        waitAttempts += 1
                        handler.postDelayed(this, checkDelayMs)
                    } else {
                        stopAlarmPlaybackVolumeRamp()
                    }
                    return
                }
                
                // Player is ready, set the ExoPlayer volume to max since we're controlling via system volume
                currentPlayer.volume = 1.0f
                Log.d(TAG, "setAlarmManualVolume: ExoPlayer volume set to 1.0f")
                // Clear the runnable since we're done
                alarmVolumeRampRunnable = null
            }
        }
        
        handler.post(alarmVolumeRampRunnable!!)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent == null && currentStationId.isBlank() && !PlaybackStateHelper.getIsPlaying()) {
            Log.d(TAG, "onStartCommand - ignoring sticky restart with no active playback")
            stopSelf()
            return START_NOT_STICKY
        }

        Log.d(TAG, "onStartCommand - action: ${intent?.action}")
        intent?.let {
            when (it.action) {
                ACTION_PLAY_STATION -> {
                    val id = it.getStringExtra(EXTRA_STATION_ID)
                    val shouldRamp = it.getBooleanExtra(EXTRA_ALARM_VOLUME_RAMP, false)
                    val manualVolume = it.getIntExtra(EXTRA_ALARM_MANUAL_VOLUME, -1)
                    Log.d(TAG, "ACTION_PLAY_STATION: id=$id, shouldRamp=$shouldRamp, manualVolume=$manualVolume")
                    id?.let { stationId ->
                        playStation(stationId)
                        if (shouldRamp) {
                            Log.d(TAG, "Starting alarm volume ramp")
                            startAlarmPlaybackVolumeRamp(1.0f)
                        } else if (manualVolume > 0) {
                            // Set manual volume after player is ready
                            val volumeLevel = manualVolume / 10.0f
                            Log.d(TAG, "Setting manual alarm volume: $manualVolume -> $volumeLevel")
                            setAlarmManualVolume(volumeLevel)
                        } else {
                            stopAlarmPlaybackVolumeRamp()
                        }
                    }
                }
                ACTION_PLAY_PODCAST_EPISODE -> {
                    val episode: Episode? = it.getParcelableExtraCompat<Episode>(EXTRA_EPISODE, Episode::class.java)
                    android.util.Log.d(TAG, "onStartCommand: ACTION_PLAY_PODCAST_EPISODE received, episode=$episode")
                    episode?.let { ep -> playPodcastEpisode(ep, it) }
                }
                ACTION_REFRESH_PODCAST_ARTWORK -> {
                    refreshPodcastArtworkPreference()
                }
                ACTION_PLAY -> {
                    handlePlayRequest("onStartCommand.ACTION_PLAY")
                }
                ACTION_PAUSE -> {
                    handlePauseRequest("onStartCommand.ACTION_PAUSE")
                }
                ACTION_STOP -> {
                    stopPlayback()
                }
                ACTION_SKIP_TO_NEXT -> {
                    if (currentStationId.startsWith("podcast_")) {
                        seekBy(30_000L)
                    } else {
                        skipStation(1)
                    }
                }
                ACTION_SKIP_TO_PREVIOUS -> {
                    if (currentStationId.startsWith("podcast_")) {
                        seekBy(-10_000L)
                    } else {
                        skipStation(-1)
                    }
                }
                ACTION_TOGGLE_FAVORITE -> {
                    if (currentStationId.isNotEmpty()) {
                        toggleFavoriteAndNotify(currentStationId)
                    }
                    Unit
                }
                ACTION_SEEK_TO -> {
                    val requestedPos = it.getLongExtra(EXTRA_SEEK_POSITION, 0L)
                    val requestedFraction = it.getFloatExtra(EXTRA_SEEK_FRACTION, -1f)
                    val playerDuration = player?.duration ?: -1L
                    val pos = if (requestedFraction in 0f..1f && playerDuration > 0L) {
                        (playerDuration * requestedFraction).toLong()
                    } else {
                        requestedPos
                    }
                    seekToPosition(pos)
                }
                ACTION_SEEK_DELTA -> {
                    val delta = it.getLongExtra(EXTRA_SEEK_DELTA, 0L)
                    seekBy(delta)
                }
                else -> {
                    Log.w(TAG, "Unknown action: ${it.action}")
                }
            }
        }
        return if (currentStationId.isNotBlank() || PlaybackStateHelper.getIsPlaying()) {
            START_STICKY
        } else {
            START_NOT_STICKY
        }
    }

    private fun sanitiseArtworkUrl(url: String?): String? {
        val value = url?.trim()
        return if (value.isNullOrEmpty()) null else value
    }

    private fun resolvePreferredPodcastArtworkUrl(episodeImage: String?, podcastImage: String?): String {
        val episode = sanitiseArtworkUrl(episodeImage)
        val podcast = sanitiseArtworkUrl(podcastImage)
        return when (PlaybackPreference.getPodcastArtworkSource(this)) {
            PlaybackPreference.ARTWORK_SOURCE_PODCAST -> podcast ?: episode ?: ""
            else -> episode ?: podcast ?: ""
        }
    }

    private fun refreshPodcastArtworkPreference() {
        if (!currentStationId.startsWith("podcast_")) return

        val preferredArtwork = resolvePreferredPodcastArtworkUrl(currentEpisodeArtworkUrl, currentPodcastArtworkUrl)
        if (preferredArtwork == currentStationLogo && preferredArtwork == currentArtworkUri) return

        currentStationLogo = preferredArtwork
        currentArtworkBitmap = null
        currentArtworkUri = preferredArtwork
        currentShowInfo = currentShowInfo.copy(imageUrl = preferredArtwork)

        val currentStation = PlaybackStateHelper.getCurrentStation()
        if (currentStation != null) {
            PlaybackStateHelper.setCurrentStation(currentStation.copy(logoUrl = preferredArtwork))
        }
        PlaybackStateHelper.setCurrentShow(currentShowInfo)

        updateMediaMetadata(artworkBitmap = null, artworkUri = preferredArtwork)
        startForegroundNotification()
    }
    
    private fun playPodcastEpisode(episode: Episode, intent: Intent?) {
        try {
            isStopped = false
            playerReconnectRunnable?.let { handler.removeCallbacks(it); playerReconnectRunnable = null }
            if (!mediaSession.isActive) mediaSession.isActive = true

            // Cancel any pending analytics from previous playback
            stationAnalyticsRunnable?.let { handler.removeCallbacks(it); stationAnalyticsRunnable = null }
            episodeAnalyticsRunnable?.let { handler.removeCallbacks(it); episodeAnalyticsRunnable = null }
            stationAnalyticsPending = false
            stationAnalyticsScheduled = false
            episodeAnalyticsPending = false
            episodeAnalyticsScheduled = false

            // Create a synthetic station to drive the existing mini/full player UI
            val podcastTitle = intent?.getStringExtra(EXTRA_PODCAST_TITLE) ?: "Podcast"
            val podcastImage = intent?.getStringExtra(EXTRA_PODCAST_IMAGE) ?: episode.imageUrl
            currentEpisodeArtworkUrl = sanitiseArtworkUrl(episode.imageUrl)
            currentPodcastArtworkUrl = sanitiseArtworkUrl(podcastImage)
            val preferredArtwork = resolvePreferredPodcastArtworkUrl(currentEpisodeArtworkUrl, currentPodcastArtworkUrl)
            val syntheticStation = Station(
                id = "podcast_${episode.podcastId}",
                title = podcastTitle,
                serviceId = "podcast",
                logoUrl = preferredArtwork
            )

            // Update playback helper & state
            currentStationId = syntheticStation.id
            currentPodcastId = episode.podcastId
            matchedPodcast = null
            matchPodcastJob?.cancel()
            matchPodcastJob = null
            lastMatchKey = null
            // Ensure UI/metadata show podcast title, episode title and artwork
            currentStationTitle = syntheticStation.title
            currentStationLogo = syntheticStation.logoUrl
            currentEpisodeTitle = episode.title
            // Set show/name strings so notification and metadata show episode/podcast info immediately
            currentShowName = syntheticStation.title
            currentShowTitle = episode.title
            // Clear stale art from previous playback so metadata doesn't reuse the wrong bitmap.
            currentArtworkBitmap = null
            currentArtworkUri = syntheticStation.logoUrl
            currentShowInfo = CurrentShow(
                title = syntheticStation.title,
                episodeTitle = episode.title,
                description = episode.description,
                imageUrl = preferredArtwork,
                segmentStartMs = 0L,
                segmentDurationMs = null
            )
            PlaybackStateHelper.setCurrentStation(syntheticStation)
            PlaybackStateHelper.setCurrentEpisodeId(episode.id)
            PlaybackStateHelper.setIsPlaying(true)
            PlaybackStateHelper.setCurrentShow(currentShowInfo)

            // Cancel any scheduled station show-info refreshes — they are station-centric and return
            // a "BBC Radio" placeholder for podcasts which can incorrectly overwrite series metadata.
            showInfoRefreshRunnable?.let { handler.removeCallbacks(it); showInfoRefreshRunnable = null }
            applyShowInfoRunnable?.let { handler.removeCallbacks(it); applyShowInfoRunnable = null }
            pendingShowInfo = null

            // Remember this as the last played media so Android Auto can resume stations or podcasts
            PlaybackPreference.setLastMediaId(this, "podcast_episode_${episode.id}")

            // Record this episode in the recent-played history and notify UI
            try {
                PlayedHistoryPreference.addEntry(this, episode, podcastTitle)
                val histIntent = android.content.Intent(PlayedHistoryPreference.ACTION_HISTORY_CHANGED)
                sendBroadcast(histIntent)
                // Notify connected media browsers (e.g., Android Auto) that podcasts children changed
                try { notifyChildrenChanged(MEDIA_ID_PODCASTS) } catch (_: Exception) { }
            } catch (_: Exception) { }

            // Ensure player and focus
            player?.release()
            player = null
            ensurePlayer()
            requestAudioFocus()

            // Use downloaded URI/file reference when available, otherwise use remote URL.
            // If the audio URL is blank, attempt to resolve it from the episode cache first.
            val effectiveAudioUrl = if (episode.audioUrl.isNotBlank()) {
                episode.audioUrl
            } else {
                try {
                    val repo = PodcastRepository(this)
                    val cached = repo.getEpisodesFromCache(episode.podcastId)
                    val found = cached?.firstOrNull { it.id == episode.id }
                    if (found != null && found.audioUrl.isNotBlank()) {
                        Log.d(TAG, "Resolved blank audioUrl for episode ${episode.id} from cache: ${found.audioUrl}")
                        found.audioUrl
                    } else {
                        episode.audioUrl
                    }
                } catch (_: Exception) { episode.audioUrl }
            }
            val playbackUri = try {
                val downloadedEntry = DownloadedEpisodes.getDownloadedEntry(this, episode)
                val localRef = downloadedEntry?.localFilePath
                when {
                    localRef.isNullOrBlank() -> android.net.Uri.parse(effectiveAudioUrl)
                    localRef.startsWith("content://") -> android.net.Uri.parse(localRef)
                    localRef.startsWith("file://") -> android.net.Uri.parse(localRef)
                    localRef.startsWith("http://") || localRef.startsWith("https://") -> android.net.Uri.parse(localRef)
                    localRef.startsWith("/") -> {
                        // Absolute file path - create proper Uri with FileProvider
                        android.net.Uri.fromFile(java.io.File(localRef))
                    }
                    else -> {
                        // Try parsing as-is first
                        try {
                            android.net.Uri.fromFile(java.io.File(localRef))
                        } catch (_: Exception) {
                            android.net.Uri.parse(effectiveAudioUrl)
                        }
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "Error checking for downloaded episode, using remote URL: ${e.message}")
                android.net.Uri.parse(effectiveAudioUrl)
            }

            val mediaMetadataBuilder = MediaMetadata.Builder()
                .setTitle(episode.title)
            if (podcastTitle.isNotBlank()) {
                mediaMetadataBuilder.setAlbumTitle(podcastTitle)
            }
            if (preferredArtwork.isNotBlank()) {
                mediaMetadataBuilder.setArtworkUri(Uri.parse(preferredArtwork))
            }

            val mediaItem = ExoMediaItem.Builder()
                .setUri(playbackUri)
                .setMediaMetadata(mediaMetadataBuilder.build())
                .build()
            player?.apply {
                playWhenReady = true
                setMediaItem(mediaItem)
                prepare()
                // Record the actual playback URI so other components (save logic) can prefer it over any preview URL
                PlaybackStateHelper.setCurrentMediaUri(playbackUri.toString())

                // If we have a saved progress position, decide whether to resume or restart.
                // Requirement: replaying an episode that was already played to completion should start from 0.
                val savedPosRaw = PlayedEpisodesPreference.getProgress(this@RadioService, episode.id)

                // Consider an episode "completed" when either:
                //  - it's explicitly marked as played, or
                //  - saved progress is within COMPLETION_THRESHOLD of the known duration.
                val isMarkedPlayed = PlayedEpisodesPreference.isPlayed(this@RadioService, episode.id)
                val episodeDurationMs = (episode.durationMins.takeIf { it > 0 } ?: 0) * 60_000L
                val COMPLETION_THRESHOLD_FRACTION = 0.95f
                val isCompletedByProgress = if (episodeDurationMs > 0) savedPosRaw >= (episodeDurationMs * COMPLETION_THRESHOLD_FRACTION).toLong() else false

                // Policy change: when the user explicitly replays an episode that is already marked as
                // played, start playback from 0 but KEEP the "played" checkmark. Also reset the
                // persisted progress to 0 so subsequent partial replays will persist new progress and
                // resume from where the user stopped.
                val restartFromBeginning = isMarkedPlayed || isCompletedByProgress
                val resumePos = if (restartFromBeginning) {
                    Log.d(TAG, "Episode ${episode.id} considered completed (marked=$isMarkedPlayed, savedPos=${savedPosRaw}ms, dur=${episodeDurationMs}ms) — starting from 0 on replay (played flag kept)")

                    try {
                        // Reset persisted progress to 0 but do NOT clear the played flag.
                        PlayedEpisodesPreference.setProgress(this@RadioService, episode.id, 0L)
                        lastSavedProgress[episode.id] = 0L
                    } catch (t: Throwable) {
                        Log.w(TAG, "Failed to reset persisted progress for replayed episode ${episode.id}: ${t.message}")
                    }

                    0L
                } else {
                    savedPosRaw
                }

                if (resumePos > 0) {
                    seekTo(resumePos)
                    Log.d(TAG, "Resuming episode ${episode.id} at position ${resumePos}ms")
                } else {
                    // Ensure we seek to start explicitly when resumePos == 0 so playback origin is deterministic
                    seekTo(0L)

                    // Allow replayed completed episodes to be counted as a new play.
                    if (restartFromBeginning && lastTrackedEpisodeAnalyticsId == episode.id) {
                        lastTrackedEpisodeAnalyticsId = null
                    }

                    // Cancel any pending episode analytics before scheduling a new one
                    episodeAnalyticsRunnable?.let { handler.removeCallbacks(it); episodeAnalyticsRunnable = null }
                    episodeAnalyticsPending = false
                    episodeAnalyticsScheduled = false

                    // Track episode play analytics only once per episode start, and only after >10s.
                    // Resuming the same episode should not emit duplicate play events.
                    if (lastTrackedEpisodeAnalyticsId != episode.id) {
                        episodeAnalyticsRunnable = Runnable {
                            serviceScope.launch(Dispatchers.IO) {
                                val analytics = PrivacyAnalytics(this@RadioService)
                                if (analytics.isEnabled()) {
                                    analytics.trackEpisodePlay(episode.podcastId, episode.id, episode.title, podcastTitle)
                                    lastTrackedEpisodeAnalyticsId = episode.id
                                }
                            }
                            episodeAnalyticsPending = false
                            episodeAnalyticsScheduled = false
                            episodeAnalyticsRunnable = null
                        }
                        episodeAnalyticsPending = true
                        episodeAnalyticsScheduled = false
                    }
                }
            }
            // Ensure MediaSession metadata contains the podcast artwork URI immediately so UI/mini-player
            // can show the image before the progress runnable (which clears show.imageUrl) runs.
            updateMediaMetadata(artworkBitmap = null, artworkUri = preferredArtwork)

            // If we don't have enough artwork context yet (saved/history entries often lack episode
            // image URLs), or we only have an unlabeled "Podcast" title, resolve canonical series +
            // episode metadata in the background and update metadata/notification when available.
            if (syntheticStation.logoUrl.isEmpty() || syntheticStation.logoUrl.endsWith("icon-apple-podcast.png") || syntheticStation.title == "Podcast" || currentEpisodeArtworkUrl.isNullOrEmpty()) {
                serviceScope.launch {
                    try {
                        val repo = PodcastRepository(this@RadioService)
                        val all = withContext(Dispatchers.IO) { repo.fetchPodcasts(false) }
                        val found = all.firstOrNull { it.id == episode.podcastId }
                        val seriesImage = found?.imageUrl
                        if (found != null) {
                            if (currentEpisodeArtworkUrl.isNullOrEmpty()) {
                                val resolvedEpisodeImage = withContext(Dispatchers.IO) {
                                    repo.fetchEpisodesIfNeeded(found).firstOrNull { it.id == episode.id }?.imageUrl
                                }?.takeIf { it.isNotBlank() }
                                if (!resolvedEpisodeImage.isNullOrEmpty()) {
                                    currentEpisodeArtworkUrl = sanitiseArtworkUrl(resolvedEpisodeImage)
                                }
                            }
                            if (!seriesImage.isNullOrEmpty()) {
                                currentPodcastArtworkUrl = seriesImage
                            }
                            val resolvedArtwork = resolvePreferredPodcastArtworkUrl(currentEpisodeArtworkUrl, currentPodcastArtworkUrl)
                            // Prefer the resolved podcast title when available (fixes cases where we defaulted to "Podcast")
                            val resolvedTitle = if (!found.title.isNullOrEmpty()) found.title else syntheticStation.title
                            val updatedStation = Station(
                                id = syntheticStation.id,
                                title = resolvedTitle,
                                serviceId = syntheticStation.serviceId,
                                logoUrl = resolvedArtwork,
                                category = syntheticStation.category
                            )

                            Log.d(TAG, "Resolved podcast series metadata for ${episode.podcastId}: title=${resolvedTitle}, image=${seriesImage}")

                            // Update cached station/title/artwork and notify UI
                            currentStationTitle = updatedStation.title
                            currentStationLogo = updatedStation.logoUrl
                            currentArtworkUri = updatedStation.logoUrl
                            currentShowInfo = currentShowInfo.copy(imageUrl = updatedStation.logoUrl)
                            PlaybackStateHelper.setCurrentStation(updatedStation)
                            updateMediaMetadata(artworkBitmap = null, artworkUri = updatedStation.logoUrl)
                            // Update notification on main thread
                            handler.post { startForegroundNotification() }
                        }
                    } catch (e: Exception) {
                        Log.w(TAG, "Failed to resolve podcast series image: ${e.message}")
                    }
                }
            }

            updatePlaybackState(PlaybackStateCompat.STATE_BUFFERING)
            startForegroundNotification()
            Log.d(TAG, "Playing podcast episode: ${episode.title}")

            // Start progress updates for podcasts
            podcastProgressRunnable?.let { handler.removeCallbacks(it) }
            podcastProgressRunnable = object : Runnable {
                override fun run() {
                    if (isStopped) return
                    try {
                        val pos = player?.currentPosition ?: 0L
                        val dur = player?.duration ?: 0L
                        // Build the progress snapshot by copying the current show info so the podcast/station
                        // title and episode title are preserved. Only position and duration change each tick.
                        val show = currentShowInfo.copy(
                            segmentStartMs = pos,
                            segmentDurationMs = if (dur > 0) dur else null
                        )

                        // Keep the global PlaybackStateHelper up-to-date (for other components) and
                        // also keep the service-local `currentShowInfo` in sync so `updateMediaMetadata()`
                        // continues to surface the episode title reliably to Android Auto.
                        PlaybackStateHelper.setCurrentShow(show)
                        currentShowInfo = show

                        // Check if we should mark the episode as played (>=95%)
                        checkAndMarkEpisodePlayed(episode, pos, dur)

                        // Periodically persist playback position (every ~15s or near the end)
                        try {
                            val last = lastSavedProgress[episode.id] ?: 0L
                            if (pos - last >= 15_000L || (dur - pos <= 30_000L && pos > 0L)) {
                                PlayedEpisodesPreference.setProgress(this@RadioService, episode.id, pos)
                                lastSavedProgress[episode.id] = pos
                            }
                        } catch (e: Exception) {
                            Log.w(TAG, "Error saving episode progress: ${e.message}")
                        }

                        // Refresh metadata and playback state so Android Auto gets up-to-date position/duration
                        try {
                            updateMediaMetadata()
                            val playbackState = if (player?.isPlaying == true) {
                                PlaybackStateCompat.STATE_PLAYING
                            } else {
                                PlaybackStateCompat.STATE_PAUSED
                            }
                            updatePlaybackState(playbackState)
                            // Also refresh the notification progress so the shade shows the current position
                            try {
                                updateNotificationProgressOnly()
                            } catch (e: Exception) {
                                Log.w(TAG, "Error updating notification progress: ${e.message}")
                            }
                        } catch (e: Exception) {
                            Log.w(TAG, "Error updating media metadata/state during progress runnable: ${e.message}")
                        }
                    } finally {
                        // Only reschedule while playback is active.  The unconditional postDelayed
                        // here previously caused the runnable to re-queue itself indefinitely even
                        // after stopPlayback() set isStopped = true, because Kotlin's finally block
                        // runs even when an early `return` is hit inside the same try statement.
                        if (!isStopped) {
                            handler.postDelayed(this, 500)
                        }
                    }
                }
            }
            handler.post(podcastProgressRunnable!!)
        } catch (e: Exception) {
            Log.e(TAG, "Error playing podcast episode", e)
        }
    }

    // Update just the notification with the current podcast progress (no network fetch)
    private fun updateNotificationProgressOnly() {
        try {
            if (isStopped || currentStationId.isBlank()) {
                val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                nm.cancel(NOTIFICATION_ID)
                return
            }
            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val isPlayingSnapshot = PlaybackStateHelper.getIsPlaying()

            // Create actions (reuse current mapping: previous/next may be seek for podcasts)
            val isPodcast = currentStationId.startsWith("podcast_")
            val previousLabel = if (isPodcast) "Back 10s" else "Previous"
            val nextLabel = if (isPodcast) "Forward 30s" else "Next"
            val previousIcon = if (isPodcast) R.drawable.ic_skip_previous else android.R.drawable.ic_media_previous
            val nextIcon = if (isPodcast) R.drawable.ic_skip_next else android.R.drawable.ic_media_next

            val previousAction = NotificationCompat.Action(
                previousIcon,
                previousLabel,
                createPendingIntent(ACTION_SKIP_TO_PREVIOUS, "previous_action")
            )
            val nextAction = NotificationCompat.Action(
                nextIcon,
                nextLabel,
                createPendingIntent(ACTION_SKIP_TO_NEXT, "next_action")
            )

            val playPauseAction = if (isPlayingSnapshot) {
                NotificationCompat.Action(
                    android.R.drawable.ic_media_pause,
                    "Pause",
                    createPendingIntent(ACTION_PAUSE, "pause_action")
                )
            } else {
                NotificationCompat.Action(
                    android.R.drawable.ic_media_play,
                    "Play",
                    createPendingIntent(ACTION_PLAY, "play_action")
                )
            }

            val stopAction = NotificationCompat.Action(
                R.drawable.ic_stop,
                "Stop",
                createPendingIntent(ACTION_STOP, "stop_action")
            )

            val favoriteAction = if (currentStationId.startsWith("podcast_") && !PlaybackStateHelper.getCurrentEpisodeId().isNullOrEmpty()) {
                val epId = PlaybackStateHelper.getCurrentEpisodeId() ?: ""
                val saved = SavedEpisodes.isSaved(this, epId)
                NotificationCompat.Action(
                    if (saved) R.drawable.ic_bookmark else R.drawable.ic_bookmark_outline,
                    if (saved) "Remove saved episode" else "Save episode",
                    createPendingIntent(ACTION_TOGGLE_FAVORITE, "favorite_action")
                )
            } else {
                val isFavorite = currentStationId.isNotEmpty() && FavoritesPreference.isFavorite(this, currentStationId)
                NotificationCompat.Action(
                    if (isFavorite) R.drawable.ic_star_filled else R.drawable.ic_star_outline,
                    if (isFavorite) "Remove from Favorites" else "Add to Favorites",
                    createPendingIntent(ACTION_TOGGLE_FAVORITE, "favorite_action")
                )
            }

            val intent = Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            }
            val pendingIntent = PendingIntent.getActivity(
                this, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val titleText = if (currentStationId.startsWith("podcast_")) {
                // For podcasts show podcast name as the title
                currentStationTitle.ifEmpty { "British Radio Player" }
            } else if (!currentShowInfo.secondary.isNullOrEmpty() || !currentShowInfo.tertiary.isNullOrEmpty()) {
                val artist = currentShowInfo.secondary ?: ""
                val track = currentShowInfo.tertiary ?: ""
                if (artist.isNotEmpty() && track.isNotEmpty()) "$artist - $track" else currentShowInfo.getFormattedTitle()
            } else {
                currentStationTitle.ifEmpty { "British Radio Player" }
            }
            // Show episode title for podcasts only when it is present and distinct from
            // the podcast/station title; otherwise leave the small line empty to avoid
            // OEMs repeating the podcast name.
            val candidateEpisode = (PlaybackStateHelper.getCurrentShow().episodeTitle ?: currentShowInfo.episodeTitle ?: "").orEmpty()
            val contentText = if (currentStationId.startsWith("podcast_")) {
                candidateEpisode.takeIf { it.isNotBlank() && !it.equals(titleText, ignoreCase = true) } ?: ""
            } else {
                computeUiSubtitle()
            }

            val showDesc = if (currentStationId.startsWith("podcast_")) {
                candidateEpisode.takeIf { it.isNotBlank() && !it.equals(titleText, ignoreCase = true) } ?: ""
            } else if (!currentShowInfo.secondary.isNullOrEmpty() || !currentShowInfo.tertiary.isNullOrEmpty()) {
                val artist = currentShowInfo.secondary ?: ""
                val track = currentShowInfo.tertiary ?: ""
                if (artist.isNotEmpty() && track.isNotEmpty()) "$artist - $track" else currentShowInfo.getFormattedTitle()
            } else {
                (currentShowInfo.episodeTitle ?: currentShowTitle).orEmpty()
            }

            val builder = NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(titleText)
                .setContentText(contentText)
                .setSubText(showDesc)
                .setSmallIcon(R.drawable.ic_stat_notification)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .setSound(null)
                .setVibrate(null)
                .addAction(stopAction)
                .addAction(previousAction)
                .addAction(playPauseAction)
                .addAction(nextAction)
                .addAction(favoriteAction)
                .setStyle(MediaStyle()
                    .setMediaSession(mediaSession.sessionToken)
                    // Compact view: show Previous, Play/Pause, Next (indices 1,2,3)
                    .setShowActionsInCompactView(1, 2, 3)
                )
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)

            // Attach large icon if we have it cached
            currentArtworkBitmap?.let { builder.setLargeIcon(it) }
            // Clear any lingering progress when switching to a live stream (only if we previously showed one)
            if (!currentStationId.startsWith("podcast_") && notificationHadProgress) {
                builder.setProgress(0, 0, false)
                notificationHadProgress = false
            }

            // If podcast with known duration, display determinate progress.
            // Do NOT call setProgress for live streams — omitting the call prevents an empty progress bar
            // from appearing on some OEM/Android versions. When we do set a determinate progress we
            // remember that so we can clear it if the user switches to a live stream later.
            if (currentStationId.startsWith("podcast_")) {
                val dur = currentShowInfo.segmentDurationMs ?: player?.duration ?: -1L
                val pos = currentShowInfo.segmentStartMs ?: player?.currentPosition ?: 0L
                if (dur > 0 && pos >= 0L) {
                    val durInt = dur.coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
                    val posInt = pos.coerceIn(0L, dur).toInt()
                    builder.setProgress(durInt, posInt, false)
                    notificationHadProgress = true
                } else {
                    // No duration -> ensure we don't mistakenly think a progress bar exists
                    notificationHadProgress = false
                }
                // If duration is unknown, do not call setProgress — that keeps the notification clean.
            } else {
                // Live streams: intentionally do not set progress here. If a previous notification
                // showed a progress bar, clear it explicitly (only when necessary) so it doesn't
                // persist on some OEMs.
            }

            val notification = builder.build()
            notificationManager.notify(NOTIFICATION_ID, notification)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to update notification progress: ${e.message}")
        }
    }

            
    // Helper: mark episode as played when majority has been consumed
    private fun checkAndMarkEpisodePlayed(episode: Episode, pos: Long, dur: Long) {
        try {
            if (dur <= 0) return
            val ratio = pos.toDouble() / dur.toDouble()
            if (ratio >= 0.95) {
                // Parse pubDate to epoch using the shared parser so all date formats (including
                // named timezones like "GMT") are handled consistently across the app.
                val epoch = EpisodeDateParser.parsePubDateToEpoch(episode.pubDate).takeIf { it > 0L }
                PlayedEpisodesPreference.markPlayedWithMeta(this, episode.id, episode.podcastId, epoch)
                android.util.Log.d(TAG, "Marked episode as played (95% reached): ${episode.id}")
                
                // Auto-delete downloaded episode if setting is enabled
                try {
                    if (DownloadPreferences.isDeleteOnPlayed(this) && DownloadedEpisodes.isDownloaded(this, episode.id)) {
                        EpisodeDownloadManager.deleteDownload(this, episode.id)
                        android.util.Log.d(TAG, "Auto-deleted downloaded episode after completion: ${episode.id}")
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Failed to auto-delete downloaded episode: ${e.message}")
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error in checkAndMarkEpisodePlayed: ${e.message}")
        }
    }

    private fun seekToPosition(positionMs: Long) {
        if (!currentStationId.startsWith("podcast_")) return
        val duration = player?.duration ?: return
        val clamped = positionMs.coerceIn(0L, if (duration > 0) duration else Long.MAX_VALUE)
        player?.seekTo(clamped)
    }

    private fun seekBy(deltaMs: Long) {
        if (!currentStationId.startsWith("podcast_")) return
        val current = player?.currentPosition ?: return
        val duration = player?.duration ?: return
        val target = (current + deltaMs).coerceIn(0L, if (duration > 0) duration else Long.MAX_VALUE)
        player?.seekTo(target)
    }
    
    private fun toggleFavoriteAndNotify(stationId: String) {
        Log.d(TAG, "toggleFavoriteAndNotify - stationId: $stationId")
        if (stationId.startsWith("podcast_")) {
            // If an episode is playing, toggle saved-episode state. Otherwise toggle podcast subscription.
            val currentEpisodeId = PlaybackStateHelper.getCurrentEpisodeId()
            if (!currentEpisodeId.isNullOrEmpty()) {
                // Toggle saved entry using minimal current show metadata
                val episode = com.hyliankid14.bbcradioplayer.Episode(
                    id = currentEpisodeId,
                    title = PlaybackStateHelper.getCurrentShow().episodeTitle ?: "",
                    description = PlaybackStateHelper.getCurrentShow().description ?: "",
                    audioUrl = "",
                    imageUrl = PlaybackStateHelper.getCurrentShow().imageUrl ?: "",
                    pubDate = "",
                    durationMins = 0,
                    podcastId = stationId.removePrefix("podcast_")
                )
                SavedEpisodes.toggleSaved(this, episode, PlaybackStateHelper.getCurrentStation()?.title ?: "")
                // Saved episodes list changed — notify relevant media children and favorites UI
                notifyChildrenChanged(MEDIA_ID_FAVORITES)
                notifyChildrenChanged(MEDIA_ID_PODCASTS)
                notifyChildrenChanged("podcasts_saved_episodes")
            } else {
                val podcastId = stationId.removePrefix("podcast_")
                PodcastSubscriptions.toggleSubscription(this, podcastId)
                notifyChildrenChanged(MEDIA_ID_FAVORITES)
                notifyChildrenChanged(MEDIA_ID_PODCASTS)
            }
        } else {
            FavoritesPreference.toggleFavorite(this, stationId)
            notifyChildrenChanged(MEDIA_ID_FAVORITES)
            notifyChildrenChanged(MEDIA_ID_ALL_STATIONS)
        }
        
        // Update playback state to reflect new favorite/subscription status
        updatePlaybackState(mediaSession.controller.playbackState?.state ?: PlaybackStateCompat.STATE_PLAYING)
    }
    
    override fun onBind(intent: Intent?): android.os.IBinder? {
        Log.d(TAG, "onBind - action: ${intent?.action}")
        return super.onBind(intent)
    }

    private fun updateMatchingPodcastForShow(station: Station?, show: CurrentShow) {
        // Search for a podcast that matches the currently playing show/station title
        if (station == null || station.id.startsWith("podcast_")) return

        val queries = listOfNotNull(
            show.title.takeIf { it.isNotBlank() },
            show.episodeTitle?.takeIf { it.isNotBlank() },
            station.title.takeIf { it.isNotBlank() }
        )

        if (queries.isEmpty()) {
            if (currentStationId == station.id) {
                matchedPodcast = null
                updatePlaybackState(mediaSession.controller.playbackState?.state ?: PlaybackStateCompat.STATE_PLAYING)
            }
            return
        }

        val matchKey = station.id + "|" + queries.joinToString("|")
        if (matchKey == lastMatchKey) return
        lastMatchKey = matchKey

        matchPodcastJob?.cancel()
        val generation = ++matchPodcastGeneration
        matchPodcastJob = serviceScope.launch {
            try {
                val repo = PodcastRepository(this@RadioService)
                val podcasts = withContext(Dispatchers.IO) { repo.fetchPodcasts(false) }

                // Only accept exact title match (case-insensitive) across show/episode/station titles
                var found: Podcast? = null
                for (q in queries) {
                    found = podcasts.find { it.title.equals(q, ignoreCase = true) }
                    if (found != null) break
                }

                if (generation == matchPodcastGeneration && currentStationId == station.id && !station.id.startsWith("podcast_")) {
                    matchedPodcast = found
                    if (found != null) {
                        Log.d(TAG, "Found matching podcast for station '${station.title}': '${found.title}'")
                    }
                    // Refresh playback state to update the subscribe button visibility
                    updatePlaybackState(mediaSession.controller.playbackState?.state ?: PlaybackStateCompat.STATE_PLAYING)
                }
            } catch (e: Exception) {
                Log.w(TAG, "Error finding matching podcast: ${e.message}")
            }
        }
    }

    override fun onDestroy() {
        // Cancel any pending analytics
        stationAnalyticsRunnable?.let { handler.removeCallbacks(it); stationAnalyticsRunnable = null }
        episodeAnalyticsRunnable?.let { handler.removeCallbacks(it); episodeAnalyticsRunnable = null }
        playerReconnectRunnable?.let { handler.removeCallbacks(it); playerReconnectRunnable = null }
        stationAnalyticsPending = false
        stationAnalyticsScheduled = false
        episodeAnalyticsPending = false
        episodeAnalyticsScheduled = false
        
        player?.release()
        mediaSession.release()
        serviceScope.cancel()
        try {
            historyChangeReceiver?.let { unregisterReceiver(it) }
        } catch (_: Exception) { }
        
        // Abandon audio focus (only needed for Android O+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            audioFocusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
        }
        
        super.onDestroy()
    }
}
