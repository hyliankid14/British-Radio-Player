package com.hyliankid14.bbcradioplayer.androidautobridge

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.support.v4.media.MediaBrowserCompat
import android.support.v4.media.MediaDescriptionCompat
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.media.MediaBrowserServiceCompat
import androidx.media.app.NotificationCompat.MediaStyle
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem as ExoMediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.concurrent.Executors

/**
 * Android Auto media browser service for the React application.
 *
 * Provides the same browse hierarchy and playback semantics as the Kotlin app's
 * `RadioService`: favourite/all stations, podcasts (subscribed, by tag, playlists,
 * history, downloaded, random), voice search, seek/favourite/subscribe custom actions,
 * paginated episode lists, audio focus, notification controls and resume/autoplay.
 *
 * Catalogue data comes from [AutoState], which the JS layer keeps in sync via
 * `AndroidAutoBridgeModule`. Playback is performed by a local ExoPlayer so the head unit
 * works even when the JS runtime is not running; the JS layer is notified of native
 * playback and pauses its own player so two streams never play simultaneously.
 */
class AndroidAutoMediaService : MediaBrowserServiceCompat() {

  private enum class Kind { NONE, STATION, EPISODE }

  private lateinit var player: ExoPlayer
  private lateinit var session: MediaSessionCompat
  private val handler = Handler(Looper.getMainLooper())
  private val io = Executors.newSingleThreadExecutor()

  private var kind = Kind.NONE
  private var stationJson: JSONObject? = null
  private var episodeJson: JSONObject? = null
  private var currentPlaylistId: String? = null
  private var candidates: List<String> = emptyList()
  private var candidateIndex = 0
  private var retriedWithGeoFallback = false
  private var episodeEndedNoRestart = false
  private var isStopped = true
  private var lastNotificationKey = ""

  private val progressTick = object : Runnable {
    override fun run() {
      updatePlaybackState()
      if (kind == Kind.EPISODE && player.isPlaying) persistProgress()
      if (kind == Kind.STATION) {
        val now = System.currentTimeMillis()
        if (now - lastShowRefreshMs > 60_000L) {
          lastShowRefreshMs = now
          refreshStationShowTitleIfNeeded()
        }
      }
      if (player.isPlaying || player.playbackState == Player.STATE_BUFFERING) {
        handler.postDelayed(this, 1000L)
      }
    }
  }

  private val stateReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      if (intent?.action != AutoState.ACTION_STATE_CHANGED) return
      for (parent in listOf(
        MEDIA_ID_ROOT, MEDIA_ID_FAVORITES, MEDIA_ID_ALL_STATIONS, MEDIA_ID_PODCASTS,
        MEDIA_ID_PODCASTS_SUBSCRIBED, MEDIA_ID_PODCASTS_SUBSCRIBED_TAGS,
        MEDIA_ID_PODCASTS_PLAYLISTS, MEDIA_ID_PODCASTS_DOWNLOADED, MEDIA_ID_PODCASTS_HISTORY
      )) {
        try { notifyChildrenChanged(parent) } catch (_: Exception) { }
      }
    }
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  override fun onCreate() {
    super.onCreate()
    instance = this
    createNotificationChannel()
    buildPlayer()

    session = MediaSessionCompat(this, "BritishRadioPlayerAuto").apply {
      setFlags(
        MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS or
          MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
      )
      setCallback(object : MediaSessionCompat.Callback() {
        override fun onPlay() {
          if (kind == Kind.NONE) resumeLastSession() else player.play()
          startProgressTicker()
          updatePlaybackState()
        }

        override fun onPause() {
          player.pause()
          persistProgress()
          updatePlaybackState()
        }

        override fun onStop() = stopPlayback()

        override fun onSkipToNext() = skipToNext()

        override fun onSkipToPrevious() = skipToPrevious()

        override fun onSeekTo(pos: Long) {
          player.seekTo(pos)
          updatePlaybackState()
        }

        override fun onPlayFromMediaId(mediaId: String?, extras: Bundle?) {
          mediaId?.let { handlePlayFromMediaId(it) }
        }

        override fun onPlayFromSearch(query: String?, extras: Bundle?) {
          handlePlayFromSearch(query)
        }

        override fun onCustomAction(action: String?, extras: Bundle?) {
          when (action) {
            CUSTOM_ACTION_STOP -> stopPlayback()
            CUSTOM_ACTION_SEEK_FORWARD -> seekBy(SEEK_FORWARD_MS)
            CUSTOM_ACTION_SEEK_BACK -> seekBy(-SEEK_BACK_MS)
            CUSTOM_ACTION_TOGGLE_FAVORITE -> {
              val stationId = stationJson?.optString("id").orEmpty()
              if (stationId.isNotEmpty()) AutoState.toggleFavorite(this@AndroidAutoMediaService, stationId)
            }
            CUSTOM_ACTION_SUBSCRIBE -> {
              val podcastId = episodeJson?.optString("podcastId").orEmpty()
              if (podcastId.isNotEmpty()) {
                val subscribed = AutoState.isSubscribed(this@AndroidAutoMediaService, podcastId)
                AutoState.setSubscribed(this@AndroidAutoMediaService, podcastId, !subscribed)
              }
            }
            CUSTOM_ACTION_TOGGLE_SAVED -> {
              val episode = episodeJson
              val episodeId = episode?.optString("id").orEmpty()
              if (episodeId.isNotEmpty()) {
                val saved = AutoState.isEpisodeSaved(this@AndroidAutoMediaService, episodeId)
                AutoState.toggleEpisodeSaved(this@AndroidAutoMediaService, episode, !saved)
              }
            }
          }
          updatePlaybackState()
        }
      })
      isActive = true
    }
    sessionToken = session.sessionToken
    updatePlaybackState()

    val filter = IntentFilter(AutoState.ACTION_STATE_CHANGED)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      registerReceiver(stateReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      @Suppress("UnspecifiedRegisterReceiverFlag")
      registerReceiver(stateReceiver, filter)
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_PLAY -> if (kind == Kind.NONE) resumeLastSession() else player.play()
      ACTION_PAUSE -> {
        player.pause()
        persistProgress()
      }
      ACTION_STOP -> stopPlayback()
      ACTION_NEXT -> skipToNext()
      ACTION_PREVIOUS -> skipToPrevious()
      ACTION_SEEK_FORWARD -> seekBy(SEEK_FORWARD_MS)
      ACTION_SEEK_BACK -> seekBy(-SEEK_BACK_MS)
      ACTION_TOGGLE_FAVORITE -> stationJson?.optString("id")
        ?.takeIf { it.isNotEmpty() }
        ?.let { AutoState.toggleFavorite(this, it) }
      ACTION_PHONE_PLAYBACK_STARTED -> onPhonePlaybackStarted()
    }
    updatePlaybackState()
    return START_STICKY
  }

  override fun onDestroy() {
    instance = null
    handler.removeCallbacks(progressTick)
    try { unregisterReceiver(stateReceiver) } catch (_: Exception) { }
    persistProgress()
    session.isActive = false
    session.release()
    player.release()
    io.shutdownNow()
    super.onDestroy()
  }

  // ── Player ──────────────────────────────────────────────────────────────────

  private fun dataSourceFactory(): DefaultDataSource.Factory {
    val http = DefaultHttpDataSource.Factory()
      .setUserAgent(USER_AGENT)
      .setConnectTimeoutMs(15000)
      .setReadTimeoutMs(20000)
      .setAllowCrossProtocolRedirects(true)
    return DefaultDataSource.Factory(this, http)
  }

  private fun buildPlayer() {
    player = ExoPlayer.Builder(this)
      .setAudioAttributes(
        AudioAttributes.Builder()
          .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
          .setUsage(C.USAGE_MEDIA)
          .build(),
        /* handleAudioFocus = */ true
      )
      .setHandleAudioBecomingNoisy(true)
      .build()

    player.addListener(object : Player.Listener {
      override fun onPlaybackStateChanged(playbackState: Int) {
        if (playbackState == Player.STATE_BUFFERING) startProgressTicker()
        if (playbackState == Player.STATE_ENDED) onPlaybackEnded()
        updatePlaybackState()
      }

      override fun onIsPlayingChanged(isPlaying: Boolean) {
        if (isPlaying) startProgressTicker() else handler.removeCallbacks(progressTick)
        updatePlaybackState()
      }

      override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
        Log.w(TAG, "Playback error (candidate $candidateIndex/${candidates.size}): ${error.message}")
        if (tryNextCandidate()) return
        if (kind == Kind.STATION && !retriedWithGeoFallback) {
          retriedWithGeoFallback = true
          val station = stationJson
          if (station != null) {
            candidates = AutoState.streamCandidates(
              station,
              AutoState.settingString(this@AndroidAutoMediaService, "audioQuality", "HIGH"),
              geoBlocked = true
            )
            candidateIndex = 0
            if (startCandidate()) return
          }
        }
        emitMutation("playbackError", JSONObject().put("message", error.message ?: "Playback error"))
        stopPlayback()
      }
    })
  }

  private fun startProgressTicker() {
    handler.removeCallbacks(progressTick)
    handler.post(progressTick)
  }

  // ── Playback entry points ───────────────────────────────────────────────────

  private fun findStation(stationId: String): JSONObject? {
    val array = AutoState.snapshot(this).optJSONArray("stations") ?: return null
    for (i in 0 until array.length()) {
      val station = array.optJSONObject(i) ?: continue
      if (station.optString("id") == stationId) return station
    }
    return null
  }

  private fun playStation(stationId: String) {
    val station = findStation(stationId) ?: run {
      Log.w(TAG, "Station not found: $stationId")
      return
    }
    kind = Kind.STATION
    stationJson = station
    episodeJson = null
    currentPlaylistId = null
    episodeEndedNoRestart = false
    retriedWithGeoFallback = false
    candidates = AutoState.streamCandidates(
      station,
      AutoState.settingString(this, "audioQuality", "HIGH"),
      AutoState.settingBoolean(this, "geoBlocked", false)
    )
    candidateIndex = 0
    if (!startCandidate()) {
      stopPlayback()
      return
    }
    emitMutation("playbackStarted", JSONObject().apply {
      put("kind", "station")
      put("id", stationId)
      put("title", station.optString("title"))
      put("subtitle", "BBC Radio")
      put("imageUrl", station.optString("logoUrl"))
    })
  }

  private fun playEpisode(episode: JSONObject, playlistId: String? = null) {
    val audioUri = resolveAudioUri(episode)
    if (audioUri.isEmpty()) {
      Log.w(TAG, "Episode has no playable audio: ${episode.optString("id")}")
      return
    }
    kind = Kind.EPISODE
    episodeJson = episode
    stationJson = null
    currentPlaylistId = playlistId
    episodeEndedNoRestart = false
    retriedWithGeoFallback = false
    candidates = listOf(audioUri)
    candidateIndex = 0
    if (!startCandidate()) {
      stopPlayback()
      return
    }
    emitMutation("playbackStarted", JSONObject().apply {
      put("kind", "episode")
      put("id", episode.optString("id"))
      put("podcastId", episode.optString("podcastId"))
      put("title", episode.optString("title"))
      put("subtitle", episode.optString("podcastTitle").ifEmpty { episode.optString("podcastId") })
      put("imageUrl", episode.optString("imageUrl"))
    })
  }

  private fun resolveAudioUri(episode: JSONObject): String {
    val localPath = episode.optString("localFilePath", "")
    if (localPath.isNotEmpty()) {
      val file = File(localPath)
      if (file.exists() && file.canRead()) return file.toURI().toString()
    }
    return episode.optString("audioUrl", "")
  }

  /** Prepares the candidate at [candidateIndex]. Returns true when preparation was started. */
  private fun startCandidate(): Boolean {
    val url = candidates.getOrNull(candidateIndex) ?: return false
    isStopped = false
    val mediaItem = ExoMediaItem.Builder()
      .setMediaId(if (kind == Kind.STATION) stationJson?.optString("id").orEmpty() else episodeJson?.optString("id").orEmpty())
      .setUri(Uri.parse(url))
      .setMediaMetadata(buildMediaMetadata())
      .build()

    val source: MediaSource = if (url.contains(".m3u8", ignoreCase = true)) {
      HlsMediaSource.Factory(dataSourceFactory()).createMediaSource(mediaItem)
    } else {
      ProgressiveMediaSource.Factory(dataSourceFactory()).createMediaSource(mediaItem)
    }

    player.setMediaSource(source)
    player.prepare()
    player.playWhenReady = true
    player.play()

    startForegroundWithNotification()
    updateSessionMetadata()
    if (kind == Kind.STATION) refreshStationShowTitleIfNeeded()
    startProgressTicker()
    updatePlaybackState()

    if (kind == Kind.EPISODE) {
      val resumeMs = AutoState.progress(this, episodeJson?.optString("id").orEmpty())
      if (resumeMs > 5_000L) player.seekTo(resumeMs)
    }
    return true
  }

  private fun tryNextCandidate(): Boolean {
    if (candidateIndex + 1 >= candidates.size) return false
    candidateIndex += 1
    Log.d(TAG, "Falling back to stream candidate $candidateIndex: ${candidates[candidateIndex]}")
    return startCandidate()
  }

  private fun resumeLastSession() {
    val lastStationId = AutoState.settingString(this, "lastStationId", "")
    if (lastStationId.isNotEmpty() && findStation(lastStationId) != null) {
      playStation(lastStationId)
      return
    }
    val carplayStation = AutoState.settingString(this, "carplayStation", "")
    if (carplayStation.isNotEmpty() && findStation(carplayStation) != null) {
      playStation(carplayStation)
      return
    }
    val first = AutoState.snapshot(this).optJSONArray("stations")?.optJSONObject(0)
    if (first != null) playStation(first.optString("id"))
  }

  fun onPhonePlaybackStarted() {
    if (player.isPlaying) {
      player.pause()
      persistProgress()
      updatePlaybackState()
    }
  }

  private fun stopPlayback() {
    persistProgress()
    kind = Kind.NONE
    stationJson = null
    episodeJson = null
    currentPlaylistId = null
    candidates = emptyList()
    candidateIndex = 0
    episodeEndedNoRestart = false
    handler.removeCallbacks(progressTick)
    player.stop()
    player.clearMediaItems()
    isStopped = true
    session.setMetadata(MediaMetadataCompat.Builder().build())
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
    updatePlaybackState()
    emitMutation("playbackStopped", JSONObject())
  }

  private fun seekBy(deltaMs: Long) {
    if (kind != Kind.EPISODE) return
    player.seekTo((player.currentPosition + deltaMs).coerceAtLeast(0L))
    updatePlaybackState()
  }

  private fun onPlaybackEnded() {
    if (kind == Kind.EPISODE) {
      episodeJson?.let { episode ->
        AutoState.markPlayed(
          this,
          episode.optString("id"),
          episode.optString("podcastId").ifEmpty { null },
          episode.optLong("pubDateEpochMs", 0L).takeIf { it > 0L }
        )
      }
      if (maybeAutoplayNextEpisode()) return
      episodeEndedNoRestart = true
    }
    handler.removeCallbacks(progressTick)
    updatePlaybackState()
  }

  private fun maybeAutoplayNextEpisode(): Boolean {
    val autoplayNext = AutoState.settingString(this, "autoplayNext", "none")
    if (autoplayNext == "none") return false
    val next = nextEpisodeInContext() ?: return false
    if (autoplayNext == "subscriptions" && !AutoState.isSubscribed(this, next.optString("podcastId"))) {
      return false
    }
    playEpisode(next, currentPlaylistId)
    return true
  }

  /** The next unplayed episode after the current one, in the current context order. */
  private fun nextEpisodeInContext(): JSONObject? {
    val current = episodeJson ?: return null
    val currentId = current.optString("id")
    val playlistId = currentPlaylistId
    val pool: List<JSONObject> = if (!playlistId.isNullOrEmpty()) {
      AutoState.playlistEntries(this, playlistId)
    } else {
      AutoState.episodes(this, current.optString("podcastId"))
    }
    val index = pool.indexOfFirst { it.optString("id") == currentId }
    if (index < 0) return null
    return pool.drop(index + 1).firstOrNull { !AutoState.isPlayed(this, it.optString("id")) }
  }

  // ── Metadata / notification / state ─────────────────────────────────────────

  private fun episodeArtwork(episode: JSONObject): String {
    return if (AutoState.settingString(this, "podcastArtwork", "episode") == "podcast") {
      episode.optString("podcastImageUrl", "").ifEmpty { episode.optString("imageUrl") }
    } else {
      episode.optString("imageUrl")
    }
  }

  private val showRefreshInFlight = java.util.Collections.synchronizedSet(mutableSetOf<String>())
  private var lastShowRefreshMs = 0L

  /**
   * Fetches the current-show title in the background when it is missing/stale, then refreshes
   * the now-playing metadata so Android Auto shows the programme name instead of a static label.
   */
  private fun refreshStationShowTitleIfNeeded() {
    if (kind != Kind.STATION) return
    val station = stationJson ?: return
    val serviceId = station.optString("serviceId")
    if (serviceId.isEmpty()) return
    if (AutoShowInfo.cachedShowTitle(serviceId).isNotEmpty()) return
    if (!showRefreshInFlight.add(serviceId)) return
    Thread {
      try {
        val title = AutoShowInfo.refreshShowTitle(serviceId)
        if (title.isNotEmpty() && kind == Kind.STATION && stationJson?.optString("serviceId") == serviceId) {
          handler.post {
            if (kind == Kind.STATION && stationJson?.optString("serviceId") == serviceId) {
              updateSessionMetadata()
              updateNotification()
            }
          }
        }
      } finally {
        showRefreshInFlight.remove(serviceId)
      }
    }.start()
  }

  private fun buildMediaMetadata(): MediaMetadata {
    if (kind == Kind.STATION) {
      val station = stationJson
      val showTitle = AutoShowInfo.cachedShowTitle(station?.optString("serviceId").orEmpty())
      return MediaMetadata.Builder()
        .setTitle(station?.optString("title") ?: "BBC Radio")
        .setArtist(showTitle.ifEmpty { "BBC Radio" })
        .setSubtitle(showTitle)
        .setIsBrowsable(false)
        .setIsPlayable(true)
        .setArtworkUri(station?.optString("logoUrl")?.takeIf { it.isNotEmpty() }?.let { Uri.parse(it) })
        .build()
    }
    val episode = episodeJson
    return MediaMetadata.Builder()
      .setTitle(episode?.optString("title") ?: "")
      .setArtist(episode?.optString("podcastTitle").orEmpty().ifEmpty { episode?.optString("podcastId").orEmpty() })
      .setIsBrowsable(false)
      .setIsPlayable(true)
      .setArtworkUri(episode?.let { episodeArtwork(it) }?.takeIf { it.isNotEmpty() }?.let { Uri.parse(it) })
      .build()
  }

  private fun updateSessionMetadata() {
    val metadata = MediaMetadataCompat.Builder()
    if (kind == Kind.STATION) {
      val station = stationJson ?: return
      val showTitle = AutoShowInfo.cachedShowTitle(station.optString("serviceId"))
      val subtitle = showTitle.ifEmpty { "BBC Radio" }
      metadata
        .putString(MediaMetadataCompat.METADATA_KEY_TITLE, station.optString("title"))
        .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, subtitle)
        .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_TITLE, station.optString("title"))
        .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_SUBTITLE, subtitle)
        .putString(MediaMetadataCompat.METADATA_KEY_ALBUM_ART_URI, station.optString("logoUrl"))
        .putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, AutoArtwork.createBitmap(station.optString("id"), 256))
    } else {
      val episode = episodeJson ?: return
      metadata
        .putString(MediaMetadataCompat.METADATA_KEY_TITLE, episode.optString("title"))
        .putString(
          MediaMetadataCompat.METADATA_KEY_ARTIST,
          episode.optString("podcastTitle").ifEmpty { episode.optString("podcastId") }
        )
        .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_TITLE, episode.optString("title"))
        .putString(MediaMetadataCompat.METADATA_KEY_ALBUM_ART_URI, episodeArtwork(episode))
        .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, episode.optLong("durationMins", 0L) * 60_000L)
    }
    session.setMetadata(metadata.build())
  }

  private fun updatePlaybackState() {
    val state = when {
      kind == Kind.NONE -> PlaybackStateCompat.STATE_NONE
      player.isPlaying -> PlaybackStateCompat.STATE_PLAYING
      player.playbackState == Player.STATE_BUFFERING -> PlaybackStateCompat.STATE_BUFFERING
      player.playbackState == Player.STATE_ENDED -> PlaybackStateCompat.STATE_STOPPED
      else -> PlaybackStateCompat.STATE_PAUSED
    }

    val builder = PlaybackStateCompat.Builder()
      .setActions(
        PlaybackStateCompat.ACTION_PLAY or
          PlaybackStateCompat.ACTION_PAUSE or
          PlaybackStateCompat.ACTION_STOP or
          PlaybackStateCompat.ACTION_PLAY_FROM_MEDIA_ID or
          PlaybackStateCompat.ACTION_PLAY_FROM_SEARCH or
          PlaybackStateCompat.ACTION_SEEK_TO or
          PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
          PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
      )
      .setState(
        state,
        if (kind == Kind.EPISODE) player.currentPosition else PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN,
        if (player.isPlaying) 1f else 0f
      )
      .addCustomAction(
        PlaybackStateCompat.CustomAction.Builder(
          CUSTOM_ACTION_STOP, "Stop", android.R.drawable.ic_menu_close_clear_cancel
        ).build()
      )

    if (kind == Kind.EPISODE) {
      builder
        .addCustomAction(
          PlaybackStateCompat.CustomAction.Builder(
            CUSTOM_ACTION_SEEK_BACK, "Back 10s", android.R.drawable.ic_media_rew
          ).build()
        )
        .addCustomAction(
          PlaybackStateCompat.CustomAction.Builder(
            CUSTOM_ACTION_SEEK_FORWARD, "Forward 30s", android.R.drawable.ic_media_ff
          ).build()
        )
      val podcastId = episodeJson?.optString("podcastId").orEmpty()
      if (podcastId.isNotEmpty()) {
        val subscribed = AutoState.isSubscribed(this, podcastId)
        builder.addCustomAction(
          PlaybackStateCompat.CustomAction.Builder(
            CUSTOM_ACTION_SUBSCRIBE,
            if (subscribed) "Unsubscribe" else "Subscribe",
            android.R.drawable.ic_menu_add
          ).build()
        )
      }
      val episodeId = episodeJson?.optString("id").orEmpty()
      if (episodeId.isNotEmpty()) {
        val saved = AutoState.isEpisodeSaved(this, episodeId)
        builder.addCustomAction(
          PlaybackStateCompat.CustomAction.Builder(
            CUSTOM_ACTION_TOGGLE_SAVED,
            if (saved) "Remove saved episode" else "Save episode",
            android.R.drawable.btn_star
          ).build()
        )
      }
    } else if (kind == Kind.STATION) {
      val stationId = stationJson?.optString("id").orEmpty()
      if (stationId.isNotEmpty()) {
        val favorite = AutoState.favorites(this).contains(stationId)
        builder.addCustomAction(
          PlaybackStateCompat.CustomAction.Builder(
            CUSTOM_ACTION_TOGGLE_FAVORITE,
            if (favorite) "Remove favourite" else "Add favourite",
            android.R.drawable.btn_star
          ).build()
        )
      }
    }

    session.setPlaybackState(builder.build())
    if (kind != Kind.NONE && (player.isPlaying || player.playbackState == Player.STATE_BUFFERING || player.playbackState == Player.STATE_READY)) {
      updateNotification()
    }
  }

  private fun persistProgress() {
    if (kind != Kind.EPISODE) return
    val episodeId = episodeJson?.optString("id").orEmpty()
    val position = player.currentPosition
    if (episodeId.isEmpty() || position <= 0L) return
    AutoState.setProgress(this, episodeId, position)
    emitMutation("episodeProgress", JSONObject().apply {
      put("episodeId", episodeId)
      put("positionMs", position)
    })
  }

  private fun emitMutation(type: String, payload: JSONObject) {
    AutoState.addMutation(this, type, payload)
    AndroidAutoBridgeModule.emitEvent(type, payload)
  }

  // ── Notification ────────────────────────────────────────────────────────────

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL_ID) == null) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Radio playback", NotificationManager.IMPORTANCE_LOW).apply {
          description = "Live radio and podcast playback"
          setShowBadge(false)
        }
      )
    }
  }

  private fun pendingIntentFor(action: String, requestCode: Int): PendingIntent {
    val intent = Intent(this, AndroidAutoMediaService::class.java).setAction(action)
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or
      (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
    return PendingIntent.getService(this, requestCode, intent, flags)
  }

  private fun startForegroundWithNotification() {
    val notification = buildNotification() ?: return
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        ServiceCompat.startForeground(
          this,
          NOTIFICATION_ID,
          notification,
          ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
        )
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
    } catch (e: Exception) {
      // Foreground service start can be rejected when the app is backgrounded on
      // Android 12+. Playback still proceeds; the notification is posted best-effort.
      Log.w(TAG, "startForeground rejected: ${e.message}")
      updateNotification()
    }
  }

  private fun updateNotification() {
    val notification = buildNotification() ?: return
    // Avoid re-posting an identical notification on every progress tick.
    val duration = episodeJson?.optLong("durationMins", 0L) ?: 0L
    val progressBucket = if (kind == Kind.EPISODE && duration > 0L) {
      val totalMs = duration * 60_000L
      ((player.currentPosition.coerceIn(0L, totalMs) * 20) / totalMs).toInt()
    } else {
      -1
    }
    val key = "${kind.name}|${player.isPlaying}|${player.currentMediaItem?.mediaId}|$progressBucket"
    if (key == lastNotificationKey) return
    lastNotificationKey = key
    getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification)
  }

  private fun buildNotification(): Notification? {
    if (kind == Kind.NONE) return null
    val title: String
    val subtitle: String
    if (kind == Kind.STATION) {
      val station = stationJson ?: return null
      title = station.optString("title")
      subtitle = "BBC Radio"
    } else {
      val episode = episodeJson ?: return null
      title = episode.optString("title")
      subtitle = episode.optString("podcastTitle").ifEmpty { episode.optString("podcastId") }
    }

    val playPause = if (player.isPlaying) {
      NotificationCompat.Action(android.R.drawable.ic_media_pause, "Pause", pendingIntentFor(ACTION_PAUSE, 1))
    } else {
      NotificationCompat.Action(android.R.drawable.ic_media_play, "Play", pendingIntentFor(ACTION_PLAY, 1))
    }

    val contentIntent = packageManager.getLaunchIntentForPackage(packageName)?.let { launchIntent ->
      val flags = PendingIntent.FLAG_UPDATE_CURRENT or
        (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
      PendingIntent.getActivity(this, 0, launchIntent, flags)
    }

    val builder = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(applicationInfo.icon)
      .setContentTitle(title)
      .setContentText(subtitle)
      .setContentIntent(contentIntent)
      .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOnlyAlertOnce(true)
      .setOngoing(player.isPlaying)
      .addAction(android.R.drawable.ic_media_previous, "Previous", pendingIntentFor(ACTION_PREVIOUS, 2))
      .addAction(playPause)
      .addAction(android.R.drawable.ic_media_next, "Next", pendingIntentFor(ACTION_NEXT, 3))

    if (kind == Kind.STATION) {
      val stationId = stationJson?.optString("id").orEmpty()
      val favorite = stationId.isNotEmpty() && AutoState.favorites(this).contains(stationId)
      builder.addAction(
        android.R.drawable.btn_star,
        if (favorite) "Remove favourite" else "Add favourite",
        pendingIntentFor(ACTION_TOGGLE_FAVORITE, 4)
      )
    } else {
      builder.addAction(android.R.drawable.ic_media_rew, "Back 10s", pendingIntentFor(ACTION_SEEK_BACK, 5))
      builder.addAction(android.R.drawable.ic_media_ff, "Forward 30s", pendingIntentFor(ACTION_SEEK_FORWARD, 6))
    }

    builder.setStyle(
      MediaStyle().setMediaSession(session.sessionToken).setShowActionsInCompactView(0, 1, 2)
    )

    if (kind == Kind.EPISODE) {
      val duration = episodeJson?.optLong("durationMins", 0L) ?: 0L
      if (duration > 0L) {
        val totalMs = duration * 60_000L
        val position = player.currentPosition.coerceIn(0L, totalMs)
        builder.setProgress(1000, ((position * 1000) / totalMs).toInt(), false)
      }
    }

    return builder.build()
  }

  // ── Browse ──────────────────────────────────────────────────────────────────

  override fun onGetRoot(clientPackageName: String, clientUid: Int, rootHints: Bundle?): BrowserRoot? {
    val isAndroidAutoClient = clientPackageName.contains(ANDROID_AUTO_CLIENT_HINT, ignoreCase = true)
    if (!isAndroidAutoClient && rootHints?.getBoolean(EXTRA_RECENT) == true && isStopped) return null
    if (isAndroidAutoClient) {
      try { notifyChildrenChanged(MEDIA_ID_ROOT) } catch (_: Exception) { }
      maybeResumeOnAutoConnect()
    }
    val extras = Bundle().apply {
      putBoolean("android.media.browse.CONTENT_STYLE_SUPPORTED", true)
      putInt("android.media.browse.CONTENT_STYLE_PLAYABLE_HINT", 1)
      putInt("android.media.browse.CONTENT_STYLE_BROWSABLE_HINT", 1)
      putBoolean("android.media.browse.SEARCH_SUPPORTED", true)
    }
    return BrowserRoot(MEDIA_ID_ROOT, extras)
  }

  /**
   * Resumes the previous session when Android Auto connects, matching the Kotlin app's
   * "auto resume" setting. Skipped while the phone is already playing so the two players
   * never overlap.
   */
  private fun maybeResumeOnAutoConnect() {
    if (!AutoState.settingBoolean(this, "carplayAutoResume", true)) return
    if (!isStopped || kind != Kind.NONE) return
    if (AutoState.settingBoolean(this, "phonePlaybackActive", false)) return
    val lastStationId = AutoState.settingString(this, "lastStationId", "")
    if (lastStationId.isNotEmpty() && findStation(lastStationId) != null) {
      playStation(lastStationId)
    }
  }

  override fun onLoadChildren(parentId: String, result: Result<List<MediaBrowserCompat.MediaItem>>) {
    result.detach()
    val items = try {
      loadChildren(parentId, page = -1, pageSize = EPISODE_PAGE_SIZE)
    } catch (e: Exception) {
      Log.e(TAG, "onLoadChildren failed for $parentId", e)
      emptyList()
    }
    result.sendResult(items)
    if (parentId == MEDIA_ID_FAVORITES || parentId == MEDIA_ID_ALL_STATIONS) {
      refreshStationSubtitles(parentId)
    }
  }

  override fun onLoadChildren(
    parentId: String,
    result: Result<List<MediaBrowserCompat.MediaItem>>,
    options: Bundle
  ) {
    val page = options.getInt(EXTRA_PAGE, -1)
    val pageSize = options.getInt(EXTRA_PAGE_SIZE, EPISODE_PAGE_SIZE)
    if (page < 0 || !isPodcastEpisodeParent(parentId)) {
      onLoadChildren(parentId, result)
      return
    }
    result.detach()
    val items = try {
      loadChildren(parentId, page, pageSize)
    } catch (e: Exception) {
      Log.e(TAG, "onLoadChildren (paged) failed for $parentId", e)
      emptyList()
    }
    result.sendResult(items)
  }

  private fun isPodcastEpisodeParent(parentId: String): Boolean {
    if (!parentId.startsWith("podcast_")) return false
    return parentId != MEDIA_ID_PODCASTS &&
      parentId != MEDIA_ID_PODCASTS_SUBSCRIBED &&
      parentId != MEDIA_ID_PODCASTS_SUBSCRIBED_TAGS &&
      parentId != MEDIA_ID_PODCASTS_PLAYLISTS &&
      parentId != MEDIA_ID_PODCASTS_DOWNLOADED &&
      parentId != MEDIA_ID_PODCASTS_HISTORY &&
      parentId != MEDIA_ID_PODCASTS_RANDOM
  }

  private fun loadChildren(
    parentId: String,
    page: Int,
    pageSize: Int
  ): List<MediaBrowserCompat.MediaItem> {
    val items = mutableListOf<MediaBrowserCompat.MediaItem>()
    when (parentId) {
      MEDIA_ID_ROOT -> {
        for (id in rootItemOrder(AutoState.settingString(this, "startupPage", "all_stations"))) {
          when (id) {
            MEDIA_ID_FAVORITES -> items.add(browsable(MEDIA_ID_FAVORITES, "Favourites", iconRes = R.drawable.ic_star_outline))
            MEDIA_ID_ALL_STATIONS -> items.add(browsable(MEDIA_ID_ALL_STATIONS, "All Stations", iconRes = R.drawable.ic_list))
            MEDIA_ID_PODCASTS -> items.add(browsable(MEDIA_ID_PODCASTS, "Podcasts", iconRes = R.drawable.ic_podcast))
          }
        }
      }

      MEDIA_ID_FAVORITES -> {
        for (stationId in AutoState.favorites(this)) {
          findStation(stationId)?.let { items.add(stationItem(it)) }
        }
      }

      MEDIA_ID_ALL_STATIONS -> {
        allStations().forEach { items.add(stationItem(it)) }
      }

      MEDIA_ID_PODCASTS -> {
        items.add(browsable(MEDIA_ID_PODCASTS_SUBSCRIBED, "Subscribed Podcasts"))
        items.add(browsable(MEDIA_ID_PODCASTS_SUBSCRIBED_TAGS, "Browse by Tag"))
        items.add(browsable(MEDIA_ID_PODCASTS_PLAYLISTS, "Playlists"))
        items.add(browsable(MEDIA_ID_PODCASTS_HISTORY, "History"))
        items.add(browsable(MEDIA_ID_PODCASTS_DOWNLOADED, "Downloaded Episodes"))
        items.add(playable(MEDIA_ID_PODCASTS_RANDOM, "Random Podcast Episode", null, null))
      }

      MEDIA_ID_PODCASTS_SUBSCRIBED -> {
        for (podcast in sortedSubscriptions(subscribedPodcasts())) {
          items.add(podcastItem(podcast))
        }
      }

      MEDIA_ID_PODCASTS_SUBSCRIBED_TAGS -> {
        val tagMap = AutoState.snapshot(this).optJSONObject("podcastTags") ?: JSONObject()
        val subscriptions = subscribedPodcasts()
        val tags = sortedSetOf<String>()
        for (podcast in subscriptions) {
          val array = tagMap.optJSONArray(podcast.optString("id")) ?: continue
          for (i in 0 until array.length()) {
            array.optString(i).takeIf { it.isNotBlank() }?.let { tags.add(it) }
          }
        }
        for (tag in tags) {
          val podcasts = subscriptions.filter { hasTag(tagMap, it.optString("id"), tag) }
          val subtitle = podcasts.take(3).joinToString(", ") { it.optString("title") }
          items.add(
            MediaBrowserCompat.MediaItem(
              MediaDescriptionCompat.Builder()
                .setMediaId("$MEDIA_ID_PODCASTS_TAG_PREFIX$tag")
                .setTitle(tag)
                .setSubtitle(subtitle)
                .build(),
              MediaBrowserCompat.MediaItem.FLAG_BROWSABLE
            )
          )
        }
      }

      MEDIA_ID_PODCASTS_PLAYLISTS -> {
        for (playlist in AutoState.playlists(this)) {
          val count = playlist.optJSONArray("entries")?.length() ?: 0
          items.add(
            MediaBrowserCompat.MediaItem(
              MediaDescriptionCompat.Builder()
                .setMediaId("playlist_${playlist.optString("id")}")
                .setTitle(playlist.optString("name"))
                .setSubtitle(if (count == 1) "1 episode" else "$count episodes")
                .build(),
              MediaBrowserCompat.MediaItem.FLAG_BROWSABLE
            )
          )
        }
      }

      MEDIA_ID_PODCASTS_DOWNLOADED -> {
        for (entry in AutoState.downloads(this)) {
          items.add(
            playable(
              "podcast_episode_${entry.optString("id")}",
              entry.optString("title"),
              episodeSubtitle(entry.optString("pubDate"), entry.optString("podcastTitle"), false, false, true),
              entry.optString("imageUrl")
            )
          )
        }
      }

      MEDIA_ID_PODCASTS_HISTORY -> {
        for (entry in AutoState.history(this)) {
          val played = AutoState.isPlayed(this, entry.optString("id"))
          val inProgress = !played && AutoState.progress(this, entry.optString("id")) > 0L
          items.add(
            playable(
              "podcast_episode_${entry.optString("id")}",
              entry.optString("title"),
              episodeSubtitle(entry.optString("pubDate"), entry.optString("podcastTitle"), played, inProgress, false),
              entry.optString("imageUrl")
            )
          )
        }
      }

      else -> when {
        parentId.startsWith(MEDIA_ID_PODCASTS_TAG_PREFIX) -> {
          val tag = parentId.removePrefix(MEDIA_ID_PODCASTS_TAG_PREFIX)
          val tagMap = AutoState.snapshot(this).optJSONObject("podcastTags") ?: JSONObject()
          val tagged = subscribedPodcasts().filter { hasTag(tagMap, it.optString("id"), tag) }
          for (podcast in sortedSubscriptions(tagged)) items.add(podcastItem(podcast))
        }

        parentId.startsWith("playlist_") -> {
          val playlistId = parentId.removePrefix("playlist_")
          var entries = AutoState.playlistEntries(this, playlistId)
          if (hidePlayedEpisodes()) {
            entries = entries.filterNot { AutoState.isPlayed(this, it.optString("id")) }
          }
          val downloadedIds = AutoState.downloads(this).map { it.optString("id") }.toSet()
          for (entry in entries) {
            val played = AutoState.isPlayed(this, entry.optString("id"))
            val inProgress = !played && AutoState.progress(this, entry.optString("id")) > 0L
            items.add(
              playable(
                "playlistep_$playlistId|${entry.optString("id")}",
                entry.optString("title"),
                episodeSubtitle(entry.optString("pubDate"), entry.optString("podcastTitle"), played, inProgress, downloadedIds.contains(entry.optString("id"))),
                entry.optString("imageUrl")
              )
            )
          }
        }

        parentId.startsWith("podcast_") -> {
          val podcastId = parentId.removePrefix("podcast_").substringBefore(':')
          var episodes = AutoState.episodes(this, podcastId)
          if (AutoState.settingBoolean(this, "carplayHidePlayed", false)) {
            episodes = episodes.filterNot { AutoState.isPlayed(this, it.optString("id")) }
          }
          if (page >= 0) {
            val from = page * pageSize
            episodes = if (from >= episodes.size) emptyList()
            else episodes.subList(from, (from + pageSize).coerceAtMost(episodes.size)).toList()
          }
          val downloadedIds = AutoState.downloads(this).map { it.optString("id") }.toSet()
          for (episode in episodes) {
            val played = AutoState.isPlayed(this, episode.optString("id"))
            val inProgress = !played && AutoState.progress(this, episode.optString("id")) > 0L
            items.add(
              playable(
                "podcast_episode_${episode.optString("id")}",
                episode.optString("title"),
                episodeSubtitle(episode.optString("pubDate"), episode.optString("podcastTitle"), played, inProgress, downloadedIds.contains(episode.optString("id"))),
                episode.optString("imageUrl")
              )
            )
          }
        }
      }
    }
    return items
  }

  private fun allStations(): List<JSONObject> {
    val array = AutoState.snapshot(this).optJSONArray("stations") ?: return emptyList()
    return (0 until array.length()).mapNotNull { array.optJSONObject(it) }
  }

  private fun subscribedPodcasts(): List<JSONObject> {
    val subscribedIds = AutoState.effectiveSubscribedIds(this)
    val subscriptions = AutoState.subscriptions(this)
    if (subscribedIds.isEmpty()) return subscriptions
    return subscriptions.filter { subscribedIds.contains(it.optString("id")) }
  }

  private fun sortedSubscriptions(podcasts: List<JSONObject>): List<JSONObject> {
    val manualOrder = stringList("podcastManualOrder")
    return when (AutoState.settingString(this, "podcastSort", "most_recently_updated")) {
      "alphabetical" -> podcasts.sortedBy { it.optString("title").lowercase(Locale.US) }
      "least_recently_updated" -> podcasts.sortedBy { it.optLong("latestUpdateMs", Long.MAX_VALUE) }
      "manual" -> if (manualOrder.isEmpty()) {
        podcasts.sortedByDescending { it.optLong("latestUpdateMs", 0L) }
      } else {
        val index = manualOrder.withIndex().associate { it.value to it.index }
        podcasts.sortedBy { index[it.optString("id")] ?: Int.MAX_VALUE }
      }
      "tags" -> {
        val tagMap = AutoState.snapshot(this).optJSONObject("podcastTags") ?: JSONObject()
        podcasts.sortedBy { tagMap.optJSONArray(it.optString("id"))?.optString(0).orEmpty() }
      }
      else -> podcasts.sortedByDescending { it.optLong("latestUpdateMs", 0L) }
    }
  }

  /** Whether played episodes should be hidden from Auto lists. */
  private fun hidePlayedEpisodes(): Boolean =
    AutoState.settingBoolean(this, "hidePlayedInPlaylists", false) ||
      AutoState.settingBoolean(this, "carplayHidePlayed", false)

  private fun hasTag(tagMap: JSONObject, podcastId: String, tag: String): Boolean {    val array = tagMap.optJSONArray(podcastId) ?: return false
    for (i in 0 until array.length()) if (array.optString(i) == tag) return true
    return false
  }

  private fun podcastItem(podcast: JSONObject): MediaBrowserCompat.MediaItem {
    val podcastId = podcast.optString("id")
    val subtitle = if (podcast.optLong("latestUpdateMs", 0L) > AutoState.lastPlayedEpoch(this, podcastId)) "New" else ""
    return MediaBrowserCompat.MediaItem(
      MediaDescriptionCompat.Builder()
        .setMediaId("podcast_$podcastId")
        .setTitle(podcast.optString("title"))
        .setSubtitle(subtitle)
        .setIconUri(podcast.optString("imageUrl").takeIf { it.isNotEmpty() }?.let { Uri.parse(it) })
        .build(),
      MediaBrowserCompat.MediaItem.FLAG_BROWSABLE
    )
  }

  private fun stringList(key: String): List<String> {
    val array = AutoState.snapshot(this).optJSONArray(key) ?: return emptyList()
    val out = ArrayList<String>(array.length())
    for (i in 0 until array.length()) array.optString(i).takeIf { it.isNotEmpty() }?.let { out.add(it) }
    return out
  }

  private fun browsable(
    mediaId: String,
    title: String,
    subtitle: String = "",
    iconRes: Int? = null
  ): MediaBrowserCompat.MediaItem {
    val description = MediaDescriptionCompat.Builder()
      .setMediaId(mediaId)
      .setTitle(title)
      .setSubtitle(subtitle)
    iconRes?.let { description.setIconBitmap(BitmapFactory.decodeResource(resources, it)) }
    return MediaBrowserCompat.MediaItem(description.build(), MediaBrowserCompat.MediaItem.FLAG_BROWSABLE)
  }

  private fun playable(
    mediaId: String,
    title: String,
    subtitle: String?,
    iconUri: String?
  ): MediaBrowserCompat.MediaItem {
    val description = MediaDescriptionCompat.Builder()
      .setMediaId(mediaId)
      .setTitle(title)
      .setSubtitle(subtitle)
    iconUri?.takeIf { it.isNotEmpty() }?.let { description.setIconUri(Uri.parse(it)) }
    return MediaBrowserCompat.MediaItem(description.build(), MediaBrowserCompat.MediaItem.FLAG_PLAYABLE)
  }

  private fun stationItem(station: JSONObject): MediaBrowserCompat.MediaItem {
    val stationId = station.optString("id")
    val showTitle = AutoShowInfo.cachedShowTitle(station.optString("serviceId"))
    return MediaBrowserCompat.MediaItem(
      MediaDescriptionCompat.Builder()
        .setMediaId(stationId)
        .setTitle(station.optString("title"))
        .setSubtitle(if (showTitle == "BBC Radio") "" else showTitle)
        .setIconUri(station.optString("logoUrl").takeIf { it.isNotEmpty() }?.let { Uri.parse(it) })
        .setIconBitmap(AutoArtwork.createBitmap(stationId, 128))
        .build(),
      MediaBrowserCompat.MediaItem.FLAG_PLAYABLE
    )
  }

  /** Fetches current-show subtitles off the critical path, then refreshes browse rows. */
  private fun refreshStationSubtitles(parentId: String) {
    val favorites = if (parentId == MEDIA_ID_FAVORITES) AutoState.favorites(this) else null
    val stations = allStations().filter { favorites == null || favorites.contains(it.optString("id")) }
    if (stations.isEmpty()) return
    io.execute {
      var changed = false
      for (station in stations) {
        val serviceId = station.optString("serviceId")
        if (serviceId.isEmpty()) continue
        val before = AutoShowInfo.cachedShowTitle(serviceId)
        if (AutoShowInfo.refreshShowTitle(serviceId) != before) changed = true
      }
      if (changed) handler.post {
        try { notifyChildrenChanged(parentId) } catch (_: Exception) { }
      }
    }
  }

  private fun rootItemOrder(startupPage: String): List<String> {
    val first = when (startupPage) {
      "favourites" -> MEDIA_ID_FAVORITES
      "subscribed_podcasts", "playlists" -> MEDIA_ID_PODCASTS
      else -> MEDIA_ID_ALL_STATIONS
    }
    return listOf(first) + listOf(MEDIA_ID_FAVORITES, MEDIA_ID_ALL_STATIONS, MEDIA_ID_PODCASTS).filter { it != first }
  }

  private fun episodeSubtitle(
    pubDate: String,
    podcastTitle: String,
    played: Boolean,
    inProgress: Boolean,
    downloaded: Boolean
  ): String {
    val parts = mutableListOf<String>()
    formatEpisodeDate(pubDate).takeIf { it.isNotEmpty() }?.let { parts.add(it) }
    if (podcastTitle.isNotBlank()) parts.add(podcastTitle)
    val markers = mutableListOf<String>()
    if (played) markers.add("Played")
    if (inProgress) markers.add("In progress")
    if (downloaded) markers.add("Downloaded")
    if (markers.isNotEmpty()) parts.add(markers.joinToString(" · "))
    return parts.joinToString(" · ")
  }

  private fun formatEpisodeDate(raw: String): String {
    if (raw.isBlank()) return ""
    return try {
      val format = SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss Z", Locale.US).apply { isLenient = true }
      val parsed = format.parse(raw.trim().replace("UTC", "+0000"))
      if (parsed != null) DATE_FORMAT.get()?.format(parsed) ?: "" else raw.trim()
    } catch (_: Exception) {
      raw.trim()
    }
  }

  // ── Play routing ────────────────────────────────────────────────────────────

  private fun handlePlayFromMediaId(mediaId: String) {
    when {
      mediaId == MEDIA_ID_PODCASTS_RANDOM -> playRandomPodcast()

      mediaId.startsWith("playlistep_") -> {
        val rest = mediaId.removePrefix("playlistep_")
        val separator = rest.indexOf('|')
        if (separator < 0) return
        val playlistId = rest.substring(0, separator)
        val episodeId = rest.substring(separator + 1)
        if (episodeId == episodeJson?.optString("id") && episodeEndedNoRestart) return
        AutoState.playlistEntries(this, playlistId)
          .firstOrNull { it.optString("id") == episodeId }
          ?.let { playEpisode(it, playlistId) }
      }

      mediaId.startsWith("podcast_episode_") -> {
        val episodeId = mediaId.removePrefix("podcast_episode_")
        if (episodeId == episodeJson?.optString("id") && episodeEndedNoRestart) return
        findEpisode(episodeId)?.let { playEpisode(it) }
      }

      else -> playStation(mediaId)
    }
  }

  private fun findEpisode(episodeId: String): JSONObject? {
    val map = AutoState.snapshot(this).optJSONObject("episodes")
    if (map != null) {
      val keys = map.keys()
      while (keys.hasNext()) {
        val podcastId = keys.next()
        val array = map.optJSONArray(podcastId) ?: continue
        for (i in 0 until array.length()) {
          val episode = array.optJSONObject(i) ?: continue
          if (episode.optString("id") == episodeId) return enrichEpisode(episode, podcastId)
        }
      }
    }
    for (playlist in AutoState.playlists(this)) {
      AutoState.playlistEntries(this, playlist.optString("id"))
        .firstOrNull { it.optString("id") == episodeId }?.let { return it }
    }
    AutoState.downloads(this).firstOrNull { it.optString("id") == episodeId }?.let { return it }
    AutoState.history(this).firstOrNull { it.optString("id") == episodeId }?.let { return it }
    return null
  }

  private fun enrichEpisode(episode: JSONObject, podcastId: String): JSONObject {
    if (episode.has("podcastTitle")) return episode
    val podcast = AutoState.subscriptions(this).firstOrNull { it.optString("id") == podcastId }
    return JSONObject(episode.toString()).apply {
      put("podcastId", podcastId)
      podcast?.let {
        put("podcastTitle", it.optString("title"))
        put("podcastImageUrl", it.optString("imageUrl"))
      }
    }
  }

  private fun playRandomPodcast() {
    val subscriptions = AutoState.subscriptions(this)
    if (subscriptions.isEmpty()) return
    for (podcast in subscriptions.shuffled()) {
      val podcastId = podcast.optString("id")
      val unplayed = AutoState.episodes(this, podcastId)
        .filterNot { AutoState.isPlayed(this, it.optString("id")) }
      val episode = unplayed.firstOrNull() ?: continue
      playEpisode(enrichEpisode(episode, podcastId))
      return
    }
  }

  private fun handlePlayFromSearch(query: String?) {
    if (query.isNullOrBlank()) {
      if (kind == Kind.NONE) resumeLastSession() else player.play()
      return
    }
    val terms = query.lowercase(Locale.US).trim().split(" ").filter { it.isNotBlank() }
    if (terms.isEmpty()) return

    var bestStation: JSONObject? = null
    var bestScore = 0
    for (station in allStations()) {
      val score = matchScore(station.optString("title"), terms)
      if (score > bestScore) {
        bestScore = score
        bestStation = station
      }
    }
    if (bestStation != null) {
      playStation(bestStation.optString("id"))
      return
    }

    var bestPodcast: JSONObject? = null
    bestScore = 0
    for (podcast in AutoState.subscriptions(this)) {
      val score = maxOf(
        matchScore(podcast.optString("title"), terms),
        matchScore(podcast.optString("description"), terms) - 1
      )
      if (score > bestScore) {
        bestScore = score
        bestPodcast = podcast
      }
    }
    val podcast = bestPodcast ?: return
    val podcastId = podcast.optString("id")
    val episodes = AutoState.episodes(this, podcastId)
    val episode = episodes.firstOrNull { !AutoState.isPlayed(this, it.optString("id")) }
      ?: episodes.firstOrNull()
      ?: return
    playEpisode(enrichEpisode(episode, podcastId))
  }

  private fun matchScore(text: String, terms: List<String>): Int {
    if (text.isBlank()) return 0
    val haystack = text.lowercase(Locale.US)
    return terms.count { haystack.contains(it) }
  }

  private fun skipToNext() {
    when (kind) {
      Kind.STATION -> {
        val list = stationNavigationList()
        if (list.isEmpty()) return
        val currentIndex = list.indexOfFirst { it.optString("id") == stationJson?.optString("id") }
        playStation(list[(currentIndex + 1).mod(list.size)].optString("id"))
      }
      Kind.EPISODE -> {
        val pool = episodePool()
        if (pool.isEmpty()) return
        val index = pool.indexOfFirst { it.optString("id") == episodeJson?.optString("id") }
        val next = pool.getOrNull(index + 1) ?: pool.first()
        playEpisode(next, currentPlaylistId)
      }
      Kind.NONE -> resumeLastSession()
    }
  }

  private fun skipToPrevious() {
    when (kind) {
      Kind.STATION -> {
        val list = stationNavigationList()
        if (list.isEmpty()) return
        val currentIndex = list.indexOfFirst { it.optString("id") == stationJson?.optString("id") }
        val safeIndex = if (currentIndex < 0) 0 else currentIndex
        playStation(list[(safeIndex - 1 + list.size).mod(list.size)].optString("id"))
      }
      Kind.EPISODE -> {
        val pool = episodePool()
        val index = pool.indexOfFirst { it.optString("id") == episodeJson?.optString("id") }
        if (index > 0) {
          playEpisode(pool[index - 1], currentPlaylistId)
        } else {
          player.seekTo(0)
          updatePlaybackState()
        }
      }
      Kind.NONE -> resumeLastSession()
    }
  }

  private fun episodePool(): List<JSONObject> {
    val playlistId = currentPlaylistId
    return if (!playlistId.isNullOrEmpty()) {
      AutoState.playlistEntries(this, playlistId)
    } else {
      AutoState.episodes(this, episodeJson?.optString("podcastId").orEmpty())
    }
  }

  private fun stationNavigationList(): List<JSONObject> {
    val all = allStations()
    if (AutoState.settingString(this, "scrollMode", "all") != "favourites") return all
    val favorites = AutoState.favorites(this)
    return all.filter { favorites.contains(it.optString("id")) }
  }

  companion object {
    private const val TAG = "AndroidAutoMediaService"

    @Volatile
    var instance: AndroidAutoMediaService? = null
      private set

    const val ANDROID_AUTO_CLIENT_HINT = "gearhead"
    const val USER_AGENT = "BritishRadioPlayer/1.0 (Android)"

    const val MEDIA_ID_ROOT = "root"
    const val MEDIA_ID_FAVORITES = "favorites"
    const val MEDIA_ID_ALL_STATIONS = "all_stations"
    const val MEDIA_ID_PODCASTS = "podcasts"
    const val MEDIA_ID_PODCASTS_SUBSCRIBED = "podcasts_subscribed"
    const val MEDIA_ID_PODCASTS_SUBSCRIBED_TAGS = "podcasts_subscribed_tags"
    const val MEDIA_ID_PODCASTS_PLAYLISTS = "podcasts_playlists"
    const val MEDIA_ID_PODCASTS_HISTORY = "podcasts_history"
    const val MEDIA_ID_PODCASTS_DOWNLOADED = "podcasts_downloaded"
    const val MEDIA_ID_PODCASTS_RANDOM = "podcasts_random"
    const val MEDIA_ID_PODCASTS_TAG_PREFIX = "podcasts_tag_"

    const val EPISODE_PAGE_SIZE = 20
    const val EXTRA_PAGE = "android.service.media.extra.PAGE"
    const val EXTRA_PAGE_SIZE = "android.service.media.extra.PAGE_SIZE"
    const val EXTRA_RECENT = "android.service.media.extra.RECENT"

    const val CUSTOM_ACTION_STOP = "STOP"
    const val CUSTOM_ACTION_SEEK_FORWARD = "SEEK_FORWARD_30"
    const val CUSTOM_ACTION_SEEK_BACK = "SEEK_BACK_10"
    const val CUSTOM_ACTION_TOGGLE_FAVORITE = "TOGGLE_FAVORITE"
    const val CUSTOM_ACTION_SUBSCRIBE = "SUBSCRIBE_PODCAST"
    const val CUSTOM_ACTION_TOGGLE_SAVED = "TOGGLE_SAVED_EPISODE"

    const val ACTION_PLAY = "com.hyliankid14.bbcradioplayer.react.action.AUTO_PLAY"
    const val ACTION_PAUSE = "com.hyliankid14.bbcradioplayer.react.action.AUTO_PAUSE"
    const val ACTION_STOP = "com.hyliankid14.bbcradioplayer.react.action.AUTO_STOP"
    const val ACTION_NEXT = "com.hyliankid14.bbcradioplayer.react.action.AUTO_NEXT"
    const val ACTION_PREVIOUS = "com.hyliankid14.bbcradioplayer.react.action.AUTO_PREVIOUS"
    const val ACTION_SEEK_FORWARD = "com.hyliankid14.bbcradioplayer.react.action.AUTO_SEEK_FORWARD"
    const val ACTION_SEEK_BACK = "com.hyliankid14.bbcradioplayer.react.action.AUTO_SEEK_BACK"
    const val ACTION_TOGGLE_FAVORITE = "com.hyliankid14.bbcradioplayer.react.action.AUTO_TOGGLE_FAVORITE"
    const val ACTION_PHONE_PLAYBACK_STARTED =
      "com.hyliankid14.bbcradioplayer.react.action.AUTO_PHONE_PLAYBACK_STARTED"

    const val CHANNEL_ID = "android_auto_playback"
    const val NOTIFICATION_ID = 7001

    const val SEEK_FORWARD_MS = 30_000L
    const val SEEK_BACK_MS = 10_000L

    private val DATE_FORMAT = object : ThreadLocal<SimpleDateFormat>() {
      override fun initialValue(): SimpleDateFormat = SimpleDateFormat("EEE, dd MMM yyyy", Locale.US)
    }
  }
}
