package com.hyliankid14.bbcradioplayer.wear.playback

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.getSystemService
import androidx.media.MediaBrowserServiceCompat
import androidx.media.app.NotificationCompat.MediaStyle
import android.support.v4.media.MediaBrowserCompat
import android.support.v4.media.MediaDescriptionCompat
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import com.hyliankid14.bbcradioplayer.wear.MainActivity
import com.hyliankid14.bbcradioplayer.wear.R
import com.hyliankid14.bbcradioplayer.wear.WatchAppStateSync
import com.hyliankid14.bbcradioplayer.wear.analytics.PrivacyAnalytics
import com.hyliankid14.bbcradioplayer.wear.data.StationArtwork
import com.hyliankid14.bbcradioplayer.wear.storage.EpisodeSyncStore
import com.hyliankid14.bbcradioplayer.wear.storage.FavouritesStore
import com.hyliankid14.bbcradioplayer.wear.storage.SubscriptionStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

@OptIn(UnstableApi::class)
class WearPlaybackService : MediaBrowserServiceCompat() {
    private lateinit var player: ExoPlayer
    private lateinit var mediaSession: MediaSessionCompat
    private lateinit var favouritesStore: FavouritesStore
    private lateinit var subscriptionStore: SubscriptionStore
    private lateinit var episodeSyncStore: EpisodeSyncStore
    private lateinit var analytics: PrivacyAnalytics
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private var candidates: List<String> = emptyList()
    private var candidateIndex = 0
    private var currentTitle = ""
    private var currentSubtitle = ""
    private var currentArtwork: String? = null
    private var currentIsLive = false
    private var currentEpisodeId: String? = null
    private var currentPodcastId: String? = null
    private var currentEpisodeDescription: String = ""
    private var currentEpisodePubDate: String = ""
    private var currentEpisodeAudioUrl: String = ""
    private var currentEpisodeStartedAtMs: Long = 0L
    private var currentStationId: String? = null
    private var currentServiceId: String? = null
    private var lastProgressSyncAtMs = 0L
    private var lastSavedPositionMs = 0L
    private var lastFullNotificationUpdateMs = 0L
    private var liveMetadataJob: Job? = null
    private var stationAnalyticsJob: Job? = null
    private var episodeAnalyticsJob: Job? = null
    private var progressTickerJob: Job? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        favouritesStore = FavouritesStore(this)
        subscriptionStore = SubscriptionStore(this)
        episodeSyncStore = EpisodeSyncStore(this)
        analytics = PrivacyAnalytics(this)

        mediaSession = MediaSessionCompat(this, "WearPlaybackService").apply {
            setFlags(MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS)
            setSessionActivity(
                PendingIntent.getActivity(
                    this@WearPlaybackService,
                    2,
                    Intent(this@WearPlaybackService, MainActivity::class.java).apply {
                        flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                    },
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
            )
            setCallback(object : MediaSessionCompat.Callback() {
                override fun onPlay() {
                    if (player.playbackState == Player.STATE_IDLE && candidates.isNotEmpty()) {
                        playCurrentCandidate()
                    } else {
                        player.play()
                        refreshSessionAndNotification()
                    }
                }

                override fun onPause() {
                    player.pause()
                    refreshSessionAndNotification()
                }

                override fun onStop() {
                    stopPlayback()
                }

                override fun onSeekTo(pos: Long) {
                    if (!currentIsLive) {
                        player.seekTo(pos)
                        refreshSessionAndNotification()
                    }
                }

                override fun onSkipToNext() {
                    if (!currentIsLive) {
                        seekBy(30_000L)
                    }
                }

                override fun onSkipToPrevious() {
                    if (!currentIsLive) {
                        seekBy(-10_000L)
                    }
                }
            })
            isActive = true
        }
        sessionToken = mediaSession.sessionToken

        val httpDataSourceFactory = DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true)
            .setUserAgent("BBC Radio Player Wear/1.0")

        val mediaSourceFactory = DefaultMediaSourceFactory(
            DefaultDataSource.Factory(this, httpDataSourceFactory)
        )

        player = ExoPlayer.Builder(this)
            .setMediaSourceFactory(mediaSourceFactory)
            .build().apply {
            setAudioAttributes(
                AudioAttributes.Builder()
                    .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                    .setUsage(C.USAGE_MEDIA)
                    .build(),
                true
            )
            addListener(object : Player.Listener {
                override fun onPlaybackStateChanged(playbackState: Int) {
                    updateProgressTicker()
                    refreshSessionAndNotification()
                }

                override fun onIsPlayingChanged(isPlaying: Boolean) {
                    updateProgressTicker()
                    refreshSessionAndNotification()
                }

                override fun onPlayerError(error: PlaybackException) {
                    if (!tryNextCandidate()) {
                        refreshSessionAndNotification()
                    }
                }

                override fun onPositionDiscontinuity(
                    oldPosition: Player.PositionInfo,
                    newPosition: Player.PositionInfo,
                    reason: Int
                ) {
                    refreshSessionAndNotification()
                }

                override fun onMediaMetadataChanged(mediaMetadata: androidx.media3.common.MediaMetadata) {
                    if (!currentIsLive) return
                    val titleFromStream = mediaMetadata.title?.toString().orEmpty().trim()
                    if (titleFromStream.isNotBlank() && titleFromStream != currentTitle) {
                        currentTitle = titleFromStream
                        refreshSessionAndNotification()
                    }
                }
            })
        }
        refreshSessionAndNotification()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_PLAY_STATION -> {
                candidates = intent.getStringArrayListExtra(EXTRA_STREAM_CANDIDATES)?.toList().orEmpty()
                candidateIndex = 0
                currentStationId = intent.getStringExtra(EXTRA_STATION_ID)
                currentServiceId = intent.getStringExtra(EXTRA_SERVICE_ID)
                currentTitle = intent.getStringExtra(EXTRA_TITLE).orEmpty()
                currentSubtitle = intent.getStringExtra(EXTRA_SUBTITLE).orEmpty()
                currentArtwork = intent.getStringExtra(EXTRA_ARTWORK_URL)
                currentIsLive = intent.getBooleanExtra(EXTRA_IS_LIVE, true)
                currentEpisodeId = null
                currentPodcastId = null
                lastProgressSyncAtMs = 0L
                lastSavedPositionMs = 0L
                scheduleStationAnalytics(currentStationId.orEmpty(), currentTitle)
                startLiveMetadataPolling()
                if (candidates.isNotEmpty()) {
                    playCurrentCandidate()
                }
            }

            ACTION_PLAY_EPISODE -> {
                val candidateUrls = intent.getStringArrayListExtra(EXTRA_STREAM_CANDIDATES)?.toList().orEmpty()
                val url = intent.getStringExtra(EXTRA_EPISODE_URL)
                candidates = when {
                    candidateUrls.isNotEmpty() -> candidateUrls
                    !url.isNullOrBlank() -> listOf(url)
                    else -> emptyList()
                }
                if (candidates.isNotEmpty()) {
                    candidateIndex = 0
                    currentEpisodeStartedAtMs = System.currentTimeMillis()
                    currentTitle = intent.getStringExtra(EXTRA_TITLE).orEmpty()
                    currentSubtitle = intent.getStringExtra(EXTRA_SUBTITLE).orEmpty()
                    currentArtwork = intent.getStringExtra(EXTRA_ARTWORK_URL)
                    currentIsLive = intent.getBooleanExtra(EXTRA_IS_LIVE, false)
                    currentEpisodeId = intent.getStringExtra(EXTRA_EPISODE_ID)
                    currentPodcastId = intent.getStringExtra(EXTRA_PODCAST_ID)
                    currentEpisodeDescription = intent.getStringExtra(EXTRA_DESCRIPTION).orEmpty()
                    currentEpisodePubDate = intent.getStringExtra(EXTRA_PUB_DATE).orEmpty()
                    currentEpisodeAudioUrl = (url?.takeIf { it.isNotBlank() } ?: candidateUrls.firstOrNull()).orEmpty()
                    currentStationId = null
                    currentServiceId = null
                    lastProgressSyncAtMs = 0L
                    lastSavedPositionMs = 0L

                    // Mirror phone behaviour: episode should appear in history when playback starts,
                    // not only when completion threshold is reached.
                    episodeSyncStore.addHistoryWithMeta(
                        episodeId = currentEpisodeId.orEmpty(),
                        title = currentTitle,
                        description = currentEpisodeDescription,
                        imageUrl = currentArtwork.orEmpty(),
                        audioUrl = currentEpisodeAudioUrl,
                        pubDate = currentEpisodePubDate,
                        durationMins = 0,
                        podcastId = currentPodcastId.orEmpty(),
                        podcastTitle = currentSubtitle,
                        playedAtMs = currentEpisodeStartedAtMs
                    )
                    WatchAppStateSync.pushCurrentState(this, favouritesStore, subscriptionStore, episodeSyncStore)

                    stopLiveMetadataPolling()
                    scheduleEpisodeAnalytics(
                        podcastId = currentPodcastId.orEmpty(),
                        episodeId = currentEpisodeId.orEmpty(),
                        episodeTitle = currentTitle,
                        podcastTitle = currentSubtitle
                    )
                    playCurrentCandidate()
                    val resumePositionMs = intent.getLongExtra(EXTRA_START_POSITION_MS, 0L)
                    if (resumePositionMs > 0L) {
                        player.seekTo(resumePositionMs)
                        lastSavedPositionMs = resumePositionMs
                    }
                }
            }

            ACTION_TOGGLE_PLAY_PAUSE -> {
                if (player.isPlaying) {
                    player.pause()
                } else if (player.currentMediaItem != null) {
                    player.play()
                }
                refreshSessionAndNotification()
            }

            ACTION_SEEK_BY -> {
                seekBy(intent.getLongExtra(EXTRA_SEEK_DELTA_MS, 0L))
            }

            ACTION_ADJUST_VOLUME -> {
                adjustVolume(intent.getIntExtra(EXTRA_VOLUME_DIRECTION, 0))
            }

            ACTION_STOP -> stopPlayback()
        }
        return START_STICKY
    }

    override fun onGetRoot(
        clientPackageName: String,
        clientUid: Int,
        rootHints: Bundle?
    ): BrowserRoot {
        return BrowserRoot(MEDIA_ROOT_ID, null)
    }

    override fun onLoadChildren(
        parentId: String,
        result: Result<MutableList<MediaBrowserCompat.MediaItem>>
    ) {
        result.sendResult(mutableListOf())
    }

    override fun onDestroy() {
        persistEpisodeState(force = true)
        WearPlaybackStateStore.publish(null)
        stopLiveMetadataPolling()
        stationAnalyticsJob?.cancel()
        episodeAnalyticsJob?.cancel()
        progressTickerJob?.cancel()
        serviceScope.cancel()
        mediaSession.release()
        player.release()
        super.onDestroy()
    }

    private fun playCurrentCandidate() {
        val url = candidates.getOrNull(candidateIndex) ?: return
        player.setMediaItem(MediaItem.fromUri(url))
        player.prepare()
        player.playWhenReady = true
        refreshSessionAndNotification()
    }

    private fun tryNextCandidate(): Boolean {
        if (candidateIndex + 1 >= candidates.size) {
            return false
        }
        candidateIndex += 1
        playCurrentCandidate()
        return true
    }

    private fun seekBy(deltaMs: Long) {
        if (currentIsLive || player.currentMediaItem == null) {
            return
        }
        val duration = player.duration.takeIf { it > 0 } ?: Long.MAX_VALUE
        val targetPosition = (player.currentPosition + deltaMs).coerceIn(0L, duration)
        player.seekTo(targetPosition)
        refreshSessionAndNotification()
    }

    private fun stopPlayback() {
        persistEpisodeState(force = true)
        player.stop()
        candidates = emptyList()
        candidateIndex = 0
        currentTitle = ""
        currentSubtitle = ""
        currentArtwork = null
        currentIsLive = false
        currentEpisodeId = null
        currentPodcastId = null
        currentEpisodeDescription = ""
        currentEpisodePubDate = ""
        currentEpisodeAudioUrl = ""
        currentEpisodeStartedAtMs = 0L
        currentStationId = null
        currentServiceId = null
        lastProgressSyncAtMs = 0L
        lastSavedPositionMs = 0L
        lastFullNotificationUpdateMs = 0L
        stopLiveMetadataPolling()
        stationAnalyticsJob?.cancel()
        episodeAnalyticsJob?.cancel()
        progressTickerJob?.cancel()
        WearPlaybackStateStore.publish(null)
        mediaSession.setMetadata(null)
        mediaSession.setPlaybackState(
            PlaybackStateCompat.Builder()
                .setActions(basePlaybackActions())
                .setState(PlaybackStateCompat.STATE_STOPPED, 0L, 0f)
                .build()
        )
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun refreshSessionAndNotification() {
        val state = publishState()
        persistEpisodeState(force = false)
        mediaSession.setMetadata(buildMetadata())
        mediaSession.setPlaybackState(buildPlaybackState(state))
        startForeground(NOTIFICATION_ID, buildNotification(state))
        lastFullNotificationUpdateMs = System.currentTimeMillis()
    }

    private fun tickProgressLightly() {
        val state = publishState()
        mediaSession.setPlaybackState(buildPlaybackState(state))
        val now = System.currentTimeMillis()
        if (now - lastFullNotificationUpdateMs >= NOTIFICATION_UPDATE_INTERVAL_MS) {
            lastFullNotificationUpdateMs = now
            persistEpisodeState(force = false)
            mediaSession.setMetadata(buildMetadata())
            startForeground(NOTIFICATION_ID, buildNotification(state))
        }
    }

    private fun updateProgressTicker() {
        val shouldTick = !currentIsLive && player.currentMediaItem != null && player.isPlaying
        if (!shouldTick) {
            progressTickerJob?.cancel()
            progressTickerJob = null
            return
        }
        if (progressTickerJob?.isActive == true) {
            return
        }
        progressTickerJob = serviceScope.launch {
            while (isActive && !currentIsLive && player.currentMediaItem != null && player.isPlaying) {
                tickProgressLightly()
                delay(1_000L)
            }
        }
    }

    private fun adjustVolume(direction: Int) {
        val audioManager = getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
        val safeDirection = when {
            direction > 0 -> AudioManager.ADJUST_RAISE
            direction < 0 -> AudioManager.ADJUST_LOWER
            else -> AudioManager.ADJUST_SAME
        }
        audioManager.adjustStreamVolume(
            AudioManager.STREAM_MUSIC,
            safeDirection,
            AudioManager.FLAG_SHOW_UI
        )
    }

    private fun persistEpisodeState(force: Boolean) {
        if (currentIsLive) return
        val episodeId = currentEpisodeId?.takeIf { it.isNotBlank() } ?: return
        val positionMs = player.currentPosition.coerceAtLeast(0L)
        val durationMs = player.duration.takeIf { it > 0L } ?: 0L
        val durationMins = if (durationMs > 0L) {
            kotlin.math.max(1, ((durationMs + 59_999L) / 60_000L).toInt())
        } else {
            0
        }
        val now = System.currentTimeMillis()
        val progressedEnough = kotlin.math.abs(positionMs - lastSavedPositionMs) >= PROGRESS_SYNC_MIN_DELTA_MS
        val dueForSync = now - lastProgressSyncAtMs >= PROGRESS_SYNC_INTERVAL_MS
        val playedAtMs = currentEpisodeStartedAtMs.takeIf { it > 0L } ?: now

        if (durationMs > 0L && positionMs >= durationMs - PLAYED_COMPLETION_THRESHOLD_MS) {
            episodeSyncStore.markPlayedWithMeta(
                episodeId = episodeId,
                title = currentTitle,
                description = currentEpisodeDescription,
                imageUrl = currentArtwork.orEmpty(),
                audioUrl = currentEpisodeAudioUrl,
                pubDate = currentEpisodePubDate,
                durationMins = durationMins,
                podcastId = currentPodcastId.orEmpty(),
                podcastTitle = currentSubtitle,
                playedAtMs = playedAtMs
            )
        } else if (positionMs > 0L && (force || progressedEnough || dueForSync)) {
            episodeSyncStore.addHistoryWithMeta(
                episodeId = episodeId,
                title = currentTitle,
                description = currentEpisodeDescription,
                imageUrl = currentArtwork.orEmpty(),
                audioUrl = currentEpisodeAudioUrl,
                pubDate = currentEpisodePubDate,
                durationMins = durationMins,
                podcastId = currentPodcastId.orEmpty(),
                podcastTitle = currentSubtitle,
                playedAtMs = playedAtMs
            )
            episodeSyncStore.setProgress(episodeId, positionMs)
            lastSavedPositionMs = positionMs
        } else {
            return
        }

        lastProgressSyncAtMs = now
        WatchAppStateSync.pushCurrentState(this, favouritesStore, subscriptionStore, episodeSyncStore)
    }

    private fun publishState(): NowPlaying? {
        val state = if (currentTitle.isBlank() && player.currentMediaItem == null) {
            null
        } else {
            NowPlaying(
                title = currentTitle.ifBlank { getString(R.string.app_name) },
                subtitle = currentSubtitle,
                isLive = currentIsLive,
                isPlaying = player.isPlaying,
                positionMs = player.currentPosition.coerceAtLeast(0L),
                durationMs = player.duration.takeIf { it > 0 } ?: 0L,
                artworkUrl = currentArtwork,
                stationId = currentStationId
            )
        }
        WearPlaybackStateStore.publish(state)
        return state
    }

    private fun buildMetadata(): MediaMetadataCompat {
        val builder = MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, currentTitle)
            .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_TITLE, currentTitle)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, currentSubtitle)
            .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_SUBTITLE, currentSubtitle)
            .putLong(
                MediaMetadataCompat.METADATA_KEY_DURATION,
                if (currentIsLive) -1L else (player.duration.takeIf { it > 0 } ?: 0L)
            )
        if (!currentArtwork.isNullOrBlank()) {
            builder.putString(MediaMetadataCompat.METADATA_KEY_ALBUM_ART_URI, currentArtwork)
        } else {
            val fallbackStationId = currentStationId
            if (!fallbackStationId.isNullOrBlank()) {
                builder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, StationArtwork.createBitmap(fallbackStationId, 512))
            }
        }
        return builder.build()
    }

    private fun buildPlaybackState(state: NowPlaying?): PlaybackStateCompat {
        val playbackState = when {
            state == null -> PlaybackStateCompat.STATE_NONE
            player.playbackState == Player.STATE_BUFFERING -> PlaybackStateCompat.STATE_BUFFERING
            player.isPlaying -> PlaybackStateCompat.STATE_PLAYING
            player.currentMediaItem != null -> PlaybackStateCompat.STATE_PAUSED
            else -> PlaybackStateCompat.STATE_STOPPED
        }
        return PlaybackStateCompat.Builder()
            .setActions(basePlaybackActions())
            .setState(playbackState, player.currentPosition.coerceAtLeast(0L), if (player.isPlaying) 1f else 0f)
            .build()
    }

    private fun basePlaybackActions(): Long {
        var actions = PlaybackStateCompat.ACTION_PLAY or
            PlaybackStateCompat.ACTION_PAUSE or
            PlaybackStateCompat.ACTION_PLAY_PAUSE or
            PlaybackStateCompat.ACTION_STOP
        if (!currentIsLive) {
            actions = actions or
                PlaybackStateCompat.ACTION_SEEK_TO or
                PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
        }
        return actions
    }

    private fun scheduleStationAnalytics(stationId: String, stationTitle: String) {
        stationAnalyticsJob?.cancel()
        episodeAnalyticsJob?.cancel()
        if (stationId.isBlank()) return
        stationAnalyticsJob = serviceScope.launch {
            delay(ANALYTICS_MIN_PLAY_MS)
            if (isActive && currentIsLive && player.isPlaying && currentStationId == stationId) {
                analytics.trackStationPlay(stationId, stationTitle)
            }
        }
    }

    private fun scheduleEpisodeAnalytics(
        podcastId: String,
        episodeId: String,
        episodeTitle: String,
        podcastTitle: String
    ) {
        episodeAnalyticsJob?.cancel()
        stationAnalyticsJob?.cancel()
        if (podcastId.isBlank() || episodeId.isBlank()) return
        episodeAnalyticsJob = serviceScope.launch {
            delay(ANALYTICS_MIN_PLAY_MS)
            if (isActive && !currentIsLive && player.isPlaying && currentEpisodeId == episodeId) {
                analytics.trackEpisodePlay(
                    podcastId = podcastId,
                    episodeId = episodeId,
                    episodeTitle = episodeTitle,
                    podcastTitle = podcastTitle
                )
            }
        }
    }

    private fun startLiveMetadataPolling() {
        stopLiveMetadataPolling()
        val serviceId = currentServiceId?.takeIf { it.isNotBlank() } ?: return
        liveMetadataJob = serviceScope.launch {
            while (isActive && currentIsLive && currentServiceId == serviceId) {
                runCatching { withContext(Dispatchers.IO) { fetchLiveNowPlayingUpdate(serviceId) } }
                    .onSuccess { update ->
                        if (update != null && currentIsLive && currentServiceId == serviceId) {
                            var changed = false
                            if (update.title.isNotBlank() && update.title != currentTitle) {
                                currentTitle = update.title
                                changed = true
                            }
                            if (update.subtitle != currentSubtitle) {
                                currentSubtitle = update.subtitle
                                changed = true
                            }
                            if (update.artworkUrl != currentArtwork) {
                                currentArtwork = update.artworkUrl
                                changed = true
                            }
                            if (changed) {
                                refreshSessionAndNotification()
                            }
                        }
                    }
                    .onFailure { e -> Log.w(TAG, "Live metadata refresh failed: ${e.message}") }
                delay(LIVE_METADATA_POLL_MS)
            }
        }
    }

    private fun stopLiveMetadataPolling() {
        liveMetadataJob?.cancel()
        liveMetadataJob = null
    }

    private suspend fun fetchLiveNowPlayingUpdate(serviceId: String): LiveNowPlayingUpdate? = coroutineScope {
        val scheduleDeferred = async { fetchCurrentScheduleShow(serviceId) }
        val segmentDeferred = async { fetchCurrentSegment(serviceId) }
        val schedule = scheduleDeferred.await()
        val segment = segmentDeferred.await()

        val showName = schedule?.title.orEmpty().ifBlank { currentTitle }
        val showDetail = schedule?.detail.orEmpty()
        val songTitle = listOfNotNull(
            segment?.artist?.takeIf { it.isNotBlank() },
            segment?.track?.takeIf { it.isNotBlank() }
        ).joinToString(" - ")

        val title = if (songTitle.isNotBlank()) songTitle else showName.ifBlank { "Live radio" }
        val subtitle = if (songTitle.isNotBlank()) {
            showName.ifBlank { "On air now" }
        } else {
            showDetail.ifBlank { showName.ifBlank { "On air now" } }
        }
        val artwork = normaliseUrl(segment?.imageUrl ?: schedule?.imageUrl)
        LiveNowPlayingUpdate(title = title, subtitle = subtitle, artworkUrl = artwork)
    }

    private fun fetchCurrentScheduleShow(serviceId: String): ScheduleShow? {
        return runCatching {
            val url = "https://ess.api.bbci.co.uk/schedules?serviceId=$serviceId&t=${System.currentTimeMillis()}"
            val connection = (URL(url).openConnection() as HttpURLConnection).apply {
                connectTimeout = 5000
                readTimeout = 5000
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
            var fallback: ScheduleShow? = null
            for (index in 0 until items.length()) {
                val item = items.optJSONObject(index) ?: continue
                val published = item.optJSONObject("published_time")
                val start = parseIsoTimeMs(published?.optString("start").orEmpty())
                val end = parseIsoTimeMs(published?.optString("end").orEmpty())
                val brand = item.optJSONObject("brand")
                val episode = item.optJSONObject("episode")
                val brandTitle = brand?.optString("title").orEmpty().trim()
                val episodeTitle = episode?.optString("title").orEmpty().trim()
                val title = brandTitle.ifBlank { episodeTitle }
                val imageTemplate = episode?.optJSONObject("image")?.optString("template_url")
                    ?: brand?.optJSONObject("image")?.optString("template_url")
                val imageUrl = imageTemplate?.replace("{recipe}", "320x320")
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
                val candidate = ScheduleShow(title = title, imageUrl = normaliseUrl(imageUrl), detail = detail)
                if (fallback == null && title.isNotBlank()) {
                    fallback = candidate
                }
                if (start > 0L && end > 0L && now in start..end && title.isNotBlank()) {
                    return@runCatching candidate
                }
            }
            fallback
        }.getOrNull()
    }

    private fun fetchCurrentSegment(serviceId: String): SegmentNowPlaying? {
        return runCatching {
            val url = "https://rms.api.bbc.co.uk/v2/services/$serviceId/segments/latest?t=${System.currentTimeMillis()}"
            val connection = (URL(url).openConnection() as HttpURLConnection).apply {
                connectTimeout = 5000
                readTimeout = 5000
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
            val data = root.optJSONArray("data") ?: return@runCatching null
            if (data.length() == 0) return@runCatching null
            val latest = data.optJSONObject(0) ?: return@runCatching null
            val offset = latest.optJSONObject("offset")
            if (offset != null && !offset.optBoolean("now_playing", true)) {
                return@runCatching null
            }
            val titles = latest.optJSONObject("titles") ?: return@runCatching null
            val artist = titles.optString("primary").orEmpty().trim()
            val track = titles.optString("secondary").orEmpty().ifBlank {
                titles.optString("tertiary").orEmpty()
            }.trim()
            val rawImage = latest.optString("image_url").orEmpty()
            val imageUrl = rawImage
                .replace("\\/", "/")
                .replace("{recipe}", "320x320")
                .takeIf { it.startsWith("http") }
            if (artist.isBlank() && track.isBlank()) {
                return@runCatching null
            }
            SegmentNowPlaying(artist = artist, track = track, imageUrl = normaliseUrl(imageUrl))
        }.getOrNull()
    }

    private fun parseIsoTimeMs(raw: String): Long {
        if (raw.isBlank()) return 0L
        return runCatching { java.time.Instant.parse(raw).toEpochMilli() }.getOrDefault(0L)
    }

    private fun normaliseUrl(url: String?): String? {
        if (url.isNullOrBlank()) return null
        return url.trim().replace("http://", "https://")
    }

    private fun buildNotification(state: NowPlaying?): android.app.Notification {
        val contentIntent = PendingIntent.getActivity(
            this,
            1,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val compactActions = mutableListOf<Int>()
        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(state?.title ?: getString(R.string.app_name))
            .setContentText(state?.subtitle ?: if (currentIsLive) "Live radio" else "Podcast playback")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(contentIntent)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .setOngoing(state?.isPlaying == true)
            .setStyle(MediaStyle().setMediaSession(mediaSession.sessionToken))

        if (!currentIsLive && state != null) {
            builder.addAction(
                NotificationCompat.Action(
                    android.R.drawable.ic_media_rew,
                    "Back",
                    servicePendingIntent(ACTION_SEEK_BY, EXTRA_SEEK_DELTA_MS to -10_000L)
                )
            )
            compactActions += 0
        }

        builder.addAction(
            NotificationCompat.Action(
                if (state?.isPlaying == true) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
                if (state?.isPlaying == true) "Pause" else "Play",
                servicePendingIntent(ACTION_TOGGLE_PLAY_PAUSE)
            )
        )
        compactActions += builder.mActions.size - 1

        if (!currentIsLive && state != null) {
            builder.addAction(
                NotificationCompat.Action(
                    android.R.drawable.ic_media_ff,
                    "Forward",
                    servicePendingIntent(ACTION_SEEK_BY, EXTRA_SEEK_DELTA_MS to 30_000L)
                )
            )
            compactActions += builder.mActions.size - 1
        }

        builder.addAction(
            NotificationCompat.Action(
                android.R.drawable.ic_menu_close_clear_cancel,
                "Stop",
                servicePendingIntent(ACTION_STOP)
            )
        )

        builder.setStyle(
            MediaStyle()
                .setMediaSession(mediaSession.sessionToken)
                .setShowActionsInCompactView(*compactActions.toIntArray())
        )
        return builder.build()
    }

    private fun servicePendingIntent(action: String, extra: Pair<String, Long>? = null): PendingIntent {
        val intent = Intent(this, WearPlaybackService::class.java).setAction(action)
        if (extra != null) {
            intent.putExtra(extra.first, extra.second)
        }
        return PendingIntent.getService(
            this,
            action.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return
        }
        val manager = getSystemService<NotificationManager>() ?: return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Playback",
            NotificationManager.IMPORTANCE_LOW
        )
        manager.createNotificationChannel(channel)
    }

    companion object {
        const val ACTION_PLAY_STATION = "com.hyliankid14.bbcradioplayer.wear.action.PLAY_STATION"
        const val ACTION_PLAY_EPISODE = "com.hyliankid14.bbcradioplayer.wear.action.PLAY_EPISODE"
        const val ACTION_TOGGLE_PLAY_PAUSE = "com.hyliankid14.bbcradioplayer.wear.action.TOGGLE_PLAY_PAUSE"
        const val ACTION_SEEK_BY = "com.hyliankid14.bbcradioplayer.wear.action.SEEK_BY"
        const val ACTION_ADJUST_VOLUME = "com.hyliankid14.bbcradioplayer.wear.action.ADJUST_VOLUME"
        const val ACTION_STOP = "com.hyliankid14.bbcradioplayer.wear.action.STOP"

        const val EXTRA_STREAM_CANDIDATES = "extra_stream_candidates"
        const val EXTRA_EPISODE_URL = "extra_episode_url"
        const val EXTRA_EPISODE_ID = "extra_episode_id"
        const val EXTRA_PODCAST_ID = "extra_podcast_id"
        const val EXTRA_STATION_ID = "extra_station_id"
        const val EXTRA_SERVICE_ID = "extra_service_id"
        const val EXTRA_TITLE = "extra_title"
        const val EXTRA_SUBTITLE = "extra_subtitle"
        const val EXTRA_DESCRIPTION = "extra_description"
        const val EXTRA_PUB_DATE = "extra_pub_date"
        const val EXTRA_ARTWORK_URL = "extra_artwork_url"
        const val EXTRA_IS_LIVE = "extra_is_live"
        const val EXTRA_START_POSITION_MS = "extra_start_position_ms"
        const val EXTRA_SEEK_DELTA_MS = "extra_seek_delta_ms"
        const val EXTRA_VOLUME_DIRECTION = "extra_volume_direction"

        private const val CHANNEL_ID = "wear_playback"
        private const val NOTIFICATION_ID = 1001
        private const val MEDIA_ROOT_ID = "wear_root"
        private const val PROGRESS_SYNC_INTERVAL_MS = 15_000L
        private const val PROGRESS_SYNC_MIN_DELTA_MS = 10_000L
        private const val PLAYED_COMPLETION_THRESHOLD_MS = 15_000L
        private const val ANALYTICS_MIN_PLAY_MS = 10_001L
        private const val NOTIFICATION_UPDATE_INTERVAL_MS = 5_000L
        private const val LIVE_METADATA_POLL_MS = 45_000L
        private const val TAG = "WearPlaybackService"
    }

    private data class ScheduleShow(
        val title: String,
        val imageUrl: String?,
        val detail: String
    )

    private data class SegmentNowPlaying(
        val artist: String,
        val track: String,
        val imageUrl: String?
    )

    private data class LiveNowPlayingUpdate(
        val title: String,
        val subtitle: String,
        val artworkUrl: String?
    )
}