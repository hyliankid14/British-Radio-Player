package com.hyliankid14.bbcradioplayer.wear.playback

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.core.app.NotificationCompat
import androidx.core.content.getSystemService
import androidx.media.MediaBrowserServiceCompat
import androidx.media.app.NotificationCompat.MediaStyle
import android.support.v4.media.MediaBrowserCompat
import android.support.v4.media.MediaDescriptionCompat
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import com.google.android.exoplayer2.ExoPlayer
import com.google.android.exoplayer2.MediaItem
import com.google.android.exoplayer2.PlaybackException
import com.google.android.exoplayer2.Player
import com.google.android.exoplayer2.audio.AudioAttributes
import com.google.android.exoplayer2.source.DefaultMediaSourceFactory
import com.google.android.exoplayer2.upstream.DefaultDataSource
import com.google.android.exoplayer2.upstream.DefaultHttpDataSource
import com.hyliankid14.bbcradioplayer.wear.MainActivity
import com.hyliankid14.bbcradioplayer.wear.R
import com.hyliankid14.bbcradioplayer.wear.WatchAppStateSync
import com.hyliankid14.bbcradioplayer.wear.storage.EpisodeSyncStore
import com.hyliankid14.bbcradioplayer.wear.storage.FavouritesStore
import com.hyliankid14.bbcradioplayer.wear.storage.SubscriptionStore

class WearPlaybackService : MediaBrowserServiceCompat() {
    private lateinit var player: ExoPlayer
    private lateinit var mediaSession: MediaSessionCompat
    private lateinit var favouritesStore: FavouritesStore
    private lateinit var subscriptionStore: SubscriptionStore
    private lateinit var episodeSyncStore: EpisodeSyncStore

    private var candidates: List<String> = emptyList()
    private var candidateIndex = 0
    private var currentTitle = ""
    private var currentSubtitle = ""
    private var currentArtwork: String? = null
    private var currentIsLive = false
    private var currentEpisodeId: String? = null
    private var currentPodcastId: String? = null
    private var lastProgressSyncAtMs = 0L
    private var lastSavedPositionMs = 0L

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        favouritesStore = FavouritesStore(this)
        subscriptionStore = SubscriptionStore(this)
        episodeSyncStore = EpisodeSyncStore(this)

        mediaSession = MediaSessionCompat(this, "WearPlaybackService").apply {
            setFlags(MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS)
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
                    .setContentType(com.google.android.exoplayer2.C.AUDIO_CONTENT_TYPE_MUSIC)
                    .setUsage(com.google.android.exoplayer2.C.USAGE_MEDIA)
                    .build(),
                true
            )
            addListener(object : Player.Listener {
                override fun onPlaybackStateChanged(playbackState: Int) {
                    refreshSessionAndNotification()
                }

                override fun onIsPlayingChanged(isPlaying: Boolean) {
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
            })
        }
        refreshSessionAndNotification()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_PLAY_STATION -> {
                candidates = intent.getStringArrayListExtra(EXTRA_STREAM_CANDIDATES)?.toList().orEmpty()
                candidateIndex = 0
                currentTitle = intent.getStringExtra(EXTRA_TITLE).orEmpty()
                currentSubtitle = intent.getStringExtra(EXTRA_SUBTITLE).orEmpty()
                currentArtwork = intent.getStringExtra(EXTRA_ARTWORK_URL)
                currentIsLive = intent.getBooleanExtra(EXTRA_IS_LIVE, true)
                currentEpisodeId = null
                currentPodcastId = null
                lastProgressSyncAtMs = 0L
                lastSavedPositionMs = 0L
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
                    currentTitle = intent.getStringExtra(EXTRA_TITLE).orEmpty()
                    currentSubtitle = intent.getStringExtra(EXTRA_SUBTITLE).orEmpty()
                    currentArtwork = intent.getStringExtra(EXTRA_ARTWORK_URL)
                    currentIsLive = intent.getBooleanExtra(EXTRA_IS_LIVE, false)
                    currentEpisodeId = intent.getStringExtra(EXTRA_EPISODE_ID)
                    currentPodcastId = intent.getStringExtra(EXTRA_PODCAST_ID)
                    lastProgressSyncAtMs = 0L
                    lastSavedPositionMs = 0L
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
        lastProgressSyncAtMs = 0L
        lastSavedPositionMs = 0L
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
        val notification = buildNotification(state)
        startForeground(NOTIFICATION_ID, notification)
    }

    private fun persistEpisodeState(force: Boolean) {
        if (currentIsLive) return
        val episodeId = currentEpisodeId?.takeIf { it.isNotBlank() } ?: return
        val positionMs = player.currentPosition.coerceAtLeast(0L)
        val durationMs = player.duration.takeIf { it > 0L } ?: 0L
        val now = System.currentTimeMillis()
        val progressedEnough = kotlin.math.abs(positionMs - lastSavedPositionMs) >= PROGRESS_SYNC_MIN_DELTA_MS
        val dueForSync = now - lastProgressSyncAtMs >= PROGRESS_SYNC_INTERVAL_MS

        if (durationMs > 0L && positionMs >= durationMs - PLAYED_COMPLETION_THRESHOLD_MS) {
            episodeSyncStore.markPlayed(episodeId)
        } else if (positionMs > 0L && (force || progressedEnough || dueForSync)) {
            episodeSyncStore.setProgress(episodeId, positionMs)
            lastSavedPositionMs = positionMs
        } else if (!force) {
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
                artworkUrl = currentArtwork
            )
        }
        WearPlaybackStateStore.publish(state)
        return state
    }

    private fun buildMetadata(): MediaMetadataCompat {
        return MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, currentTitle)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, currentSubtitle)
            .putLong(
                MediaMetadataCompat.METADATA_KEY_DURATION,
                if (currentIsLive) -1L else (player.duration.takeIf { it > 0 } ?: 0L)
            )
            .build()
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
        const val ACTION_STOP = "com.hyliankid14.bbcradioplayer.wear.action.STOP"

        const val EXTRA_STREAM_CANDIDATES = "extra_stream_candidates"
        const val EXTRA_EPISODE_URL = "extra_episode_url"
        const val EXTRA_EPISODE_ID = "extra_episode_id"
        const val EXTRA_PODCAST_ID = "extra_podcast_id"
        const val EXTRA_TITLE = "extra_title"
        const val EXTRA_SUBTITLE = "extra_subtitle"
        const val EXTRA_ARTWORK_URL = "extra_artwork_url"
        const val EXTRA_IS_LIVE = "extra_is_live"
        const val EXTRA_START_POSITION_MS = "extra_start_position_ms"
        const val EXTRA_SEEK_DELTA_MS = "extra_seek_delta_ms"

        private const val CHANNEL_ID = "wear_playback"
        private const val NOTIFICATION_ID = 1001
        private const val MEDIA_ROOT_ID = "wear_root"
        private const val PROGRESS_SYNC_INTERVAL_MS = 15_000L
        private const val PROGRESS_SYNC_MIN_DELTA_MS = 10_000L
        private const val PLAYED_COMPLETION_THRESHOLD_MS = 15_000L
    }
}