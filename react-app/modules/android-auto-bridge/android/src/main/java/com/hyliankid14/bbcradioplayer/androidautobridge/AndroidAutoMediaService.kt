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
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import java.net.HttpURLConnection
import java.net.URL
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

  private var stationAnalyticsRunnable: Runnable? = null
  private var stationAnalyticsPending = false
  private var stationAnalyticsScheduled = false

  private var episodeAnalyticsRunnable: Runnable? = null
  private var episodeAnalyticsPending = false
  private var episodeAnalyticsScheduled = false
  private var lastTrackedEpisodeAnalyticsId: String? = null
  private var lastTrackedSongSignature: String = ""

  private val progressTick = object : Runnable {
    override fun run() {
      updatePlaybackState()
      if (kind == Kind.EPISODE && player.isPlaying) persistProgress()
      if (kind == Kind.STATION) {
        val now = System.currentTimeMillis()
        if (now - lastShowRefreshMs > 5_000L) {
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
        if (isPlaying) {
          startProgressTicker()
          if (stationAnalyticsPending && !stationAnalyticsScheduled && stationAnalyticsRunnable != null) {
            handler.postDelayed(stationAnalyticsRunnable!!, 10_000L)
            stationAnalyticsScheduled = true
          }
          if (episodeAnalyticsPending && !episodeAnalyticsScheduled && episodeAnalyticsRunnable != null) {
            handler.postDelayed(episodeAnalyticsRunnable!!, 10_000L)
            episodeAnalyticsScheduled = true
          }
        } else {
          handler.removeCallbacks(progressTick)
          if (stationAnalyticsScheduled) {
            stationAnalyticsRunnable?.let { handler.removeCallbacks(it) }
            stationAnalyticsScheduled = false
          }
          if (episodeAnalyticsScheduled) {
            episodeAnalyticsRunnable?.let { handler.removeCallbacks(it) }
            episodeAnalyticsScheduled = false
          }
        }
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

  private fun cancelAnalyticsTimers() {
    stationAnalyticsRunnable?.let { handler.removeCallbacks(it) }
    stationAnalyticsRunnable = null
    stationAnalyticsPending = false
    stationAnalyticsScheduled = false

    episodeAnalyticsRunnable?.let { handler.removeCallbacks(it) }
    episodeAnalyticsRunnable = null
    episodeAnalyticsPending = false
    episodeAnalyticsScheduled = false
  }

  private fun playStation(stationId: String) {
    val station = findStation(stationId) ?: run {
      Log.w(TAG, "Station not found: $stationId")
      return
    }
    cancelAnalyticsTimers()
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
    val stationTitle = station.optString("title")
    stationAnalyticsRunnable = Runnable {
      io.execute {
        AutoAnalytics.trackStationPlay(this@AndroidAutoMediaService, stationId, stationTitle)
      }
      stationAnalyticsPending = false
      stationAnalyticsScheduled = false
      stationAnalyticsRunnable = null
    }
    stationAnalyticsPending = true
    stationAnalyticsScheduled = false

    emitMutation("playbackStarted", JSONObject().apply {
      put("kind", "station")
      put("id", stationId)
      put("title", stationTitle)
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
    cancelAnalyticsTimers()
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

    val epId = episode.optString("id")
    val podId = episode.optString("podcastId").ifEmpty {
      findEpisode(epId)?.optString("podcastId").orEmpty()
    }
    val epTitle = episode.optString("title")
    val podTitle = episode.optString("podcastTitle").ifEmpty {
      findPodcast(podId)?.optString("title").orEmpty()
    }

    if (lastTrackedEpisodeAnalyticsId != epId) {
      episodeAnalyticsRunnable = Runnable {
        io.execute {
          AutoAnalytics.trackEpisodePlay(this@AndroidAutoMediaService, podId, epId, epTitle, podTitle)
          lastTrackedEpisodeAnalyticsId = epId
        }
        episodeAnalyticsPending = false
        episodeAnalyticsScheduled = false
        episodeAnalyticsRunnable = null
      }
      episodeAnalyticsPending = true
      episodeAnalyticsScheduled = false
    }

    val epDesc = episode.optString("description")
    val epAudio = episode.optString("audioUrl")
    val epPubDate = episode.optString("pubDate")
    val epDuration = episode.optInt("durationMins", 0)
    val epImage = episode.optString("imageUrl").ifEmpty {
      findEpisode(epId)?.optString("imageUrl").orEmpty()
    }.ifEmpty {
      findPodcast(podId)?.optString("imageUrl").orEmpty()
    }

    val historyEntry = JSONObject().apply {
      put("id", epId)
      put("title", epTitle)
      put("description", epDesc)
      put("imageUrl", epImage)
      put("audioUrl", epAudio)
      put("pubDate", epPubDate)
      put("durationMins", epDuration)
      put("podcastId", podId)
      put("podcastTitle", podTitle)
      put("playedAtMs", System.currentTimeMillis())
    }
    AutoState.addHistory(this, historyEntry)

    emitMutation("playbackStarted", JSONObject().apply {
      put("kind", "episode")
      put("id", epId)
      put("podcastId", podId)
      put("title", epTitle)
      put("subtitle", podTitle.ifEmpty { podId })
      put("imageUrl", epImage)
      put("description", epDesc)
      put("audioUrl", epAudio)
      put("pubDate", epPubDate)
      put("durationMins", epDuration)
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
    cancelAnalyticsTimers()
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
    if (!showRefreshInFlight.add(serviceId)) return
    Thread {
      try {
        val before = AutoShowInfo.cachedShowInfo(serviceId)
        val info = AutoShowInfo.refreshShowInfo(serviceId)
        val changed = before.track != info.track || before.artist != info.artist || before.songArtworkUrl != info.songArtworkUrl || before.showTitle != info.showTitle || before.showSubtitle != info.showSubtitle
        if (changed && kind == Kind.STATION && stationJson?.optString("serviceId") == serviceId) {
          handler.post {
            if (kind == Kind.STATION && stationJson?.optString("serviceId") == serviceId) {
              updateSessionMetadata()
              updateNotification()
            }
          }
        }
        val sArtist = info.rawArtist.ifEmpty { info.artist }
        val sTrack = info.rawTrack.ifEmpty { info.track }
        if (sTrack.isNotEmpty() || sArtist.isNotEmpty()) {
          val songKey = "$sArtist|$sTrack"
          if (songKey != lastTrackedSongSignature) {
            lastTrackedSongSignature = songKey
            val songImage = info.rawArtworkUrl.ifEmpty { info.songArtworkUrl.ifEmpty { station.optString("logoUrl") } }
            emitMutation("recentSongAdded", JSONObject().apply {
              put("artist", sArtist)
              put("track", sTrack)
              put("imageUrl", songImage)
              put("stationId", station.optString("id"))
              put("stationName", station.optString("title"))
            })
          }
        }
      } finally {
        showRefreshInFlight.remove(serviceId)
      }
    }.start()
  }

  private fun findPodcast(podcastId: String): JSONObject? {
    if (podcastId.isEmpty()) return null
    return AutoState.findPodcast(this, podcastId)
  }

  private fun buildMediaMetadata(): MediaMetadata {
    if (kind == Kind.STATION) {
      val station = stationJson
      val serviceId = station?.optString("serviceId").orEmpty()
      val stationTitle = station?.optString("title") ?: "BBC Radio"
      val info = AutoShowInfo.cachedShowInfo(serviceId)
      val hasSong = info.track.isNotEmpty() || info.artist.isNotEmpty()

      val title = if (hasSong) {
        if (info.track.isNotEmpty() && info.artist.isNotEmpty()) info.track
        else info.track.ifEmpty { info.artist }
      } else {
        info.showTitle.ifEmpty { stationTitle }
      }
      val artistSubtitle = if (hasSong) {
        if (info.artist.isNotEmpty()) "${info.artist} · $stationTitle" else stationTitle
      } else {
        stationTitle
      }

      val builder = MediaMetadata.Builder()
        .setTitle(title)
        .setArtist(artistSubtitle)
        .setAlbumTitle(stationTitle)
        .setSubtitle(artistSubtitle)
        .setIsBrowsable(false)
        .setIsPlayable(true)

      if (info.songArtworkUrl.isNotEmpty()) {
        builder.setArtworkUri(Uri.parse(info.songArtworkUrl))
      }
      return builder.build()
    }
    val episode = episodeJson
    val podcastTitle = episode?.optString("podcastTitle").orEmpty().ifEmpty {
      val pid = episode?.optString("podcastId").orEmpty()
      findPodcast(pid)?.optString("title").orEmpty().ifEmpty { pid }
    }
    return MediaMetadata.Builder()
      .setTitle(episode?.optString("title") ?: "")
      .setArtist(podcastTitle)
      .setAlbumTitle(podcastTitle)
      .setSubtitle(podcastTitle)
      .setIsBrowsable(false)
      .setIsPlayable(true)
      .setArtworkUri(episode?.let { episodeArtwork(it) }?.takeIf { it.isNotEmpty() }?.let { Uri.parse(it) })
      .build()
  }

  private fun updateSessionMetadata() {
    val metadata = MediaMetadataCompat.Builder()
    if (kind == Kind.STATION) {
      val station = stationJson ?: return
      val stationId = station.optString("id")
      val serviceId = station.optString("serviceId")
      val stationTitle = station.optString("title")
      val info = AutoShowInfo.cachedShowInfo(serviceId)
      val hasSong = info.track.isNotEmpty() || info.artist.isNotEmpty()

      val title = stationTitle
      val subtitle = if (hasSong) {
        if (info.artist.isNotEmpty() && info.track.isNotEmpty()) "${info.artist} - ${info.track}"
        else info.track.ifEmpty { info.artist }
      } else {
        val show = info.showTitle.ifEmpty { stationTitle }
        if (info.showSubtitle.isNotEmpty() && !info.showSubtitle.equals(show, ignoreCase = true)) {
          "$show - ${info.showSubtitle}"
        } else {
          show
        }
      }

      metadata
        .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
        .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, subtitle)
        .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, stationTitle)
        .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_TITLE, title)
        .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_SUBTITLE, subtitle)
        .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_DESCRIPTION, if (hasSong) info.showTitle.ifEmpty { stationTitle } else stationTitle)

      val songArtworkBitmap = AutoShowInfo.cachedArtworkBitmap(serviceId)
      if (hasSong && info.songArtworkUrl.isNotEmpty()) {
        metadata
          .putString(MediaMetadataCompat.METADATA_KEY_ALBUM_ART_URI, info.songArtworkUrl)
          .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON_URI, info.songArtworkUrl)
          .putString(MediaMetadataCompat.METADATA_KEY_ART_URI, info.songArtworkUrl)
        if (songArtworkBitmap != null) {
          metadata.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, songArtworkBitmap)
          metadata.putBitmap(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON, songArtworkBitmap)
          metadata.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, songArtworkBitmap)
        }
      } else {
        // Without song art, display the custom station ident bitmap and pass NO art URI
        // so that Android Auto will never load the BBC station square logo.
        val identBitmap = AutoArtwork.createBitmap(stationId, 512)
        metadata
          .putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, identBitmap)
          .putBitmap(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON, identBitmap)
          .putBitmap(MediaMetadataCompat.METADATA_KEY_ART, identBitmap)
      }
    } else {
      val episode = episodeJson ?: return
      val podcastTitle = episode.optString("podcastTitle").ifEmpty {
        val pid = episode.optString("podcastId")
        findPodcast(pid)?.optString("title").orEmpty().ifEmpty { pid }
      }
      metadata
        .putString(MediaMetadataCompat.METADATA_KEY_TITLE, episode.optString("title"))
        .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, podcastTitle)
        .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, podcastTitle)
        .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_TITLE, episode.optString("title"))
        .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_SUBTITLE, podcastTitle)
        .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_DESCRIPTION, podcastTitle)
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
          CUSTOM_ACTION_STOP, "Stop", R.drawable.ic_stop
        ).build()
      )

    if (kind == Kind.EPISODE) {
      val podcastId = episodeJson?.optString("podcastId").orEmpty().ifEmpty {
        findEpisode(episodeJson?.optString("id").orEmpty())?.optString("podcastId").orEmpty()
      }
      if (podcastId.isNotEmpty()) {
        val subscribed = AutoState.isSubscribed(this, podcastId)
        builder.addCustomAction(
          PlaybackStateCompat.CustomAction.Builder(
            CUSTOM_ACTION_SUBSCRIBE,
            if (subscribed) "Unsubscribe" else "Subscribe",
            if (subscribed) R.drawable.ic_bookmark else R.drawable.ic_bookmark_outline
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
            if (favorite) R.drawable.ic_star_filled else R.drawable.ic_star_outline
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
    val largeIcon: Bitmap?
    if (kind == Kind.STATION) {
      val station = stationJson ?: return null
      val stationId = station.optString("id")
      val serviceId = station.optString("serviceId")
      val stationTitle = station.optString("title")
      val info = AutoShowInfo.cachedShowInfo(serviceId)
      val hasSong = info.track.isNotEmpty() || info.artist.isNotEmpty()
      title = stationTitle
      subtitle = if (hasSong) {
        if (info.artist.isNotEmpty() && info.track.isNotEmpty()) "${info.artist} - ${info.track}"
        else info.track.ifEmpty { info.artist }
      } else {
        val show = info.showTitle.ifEmpty { stationTitle }
        if (info.showSubtitle.isNotEmpty() && !info.showSubtitle.equals(show, ignoreCase = true)) {
          "$show - ${info.showSubtitle}"
        } else {
          show
        }
      }
      largeIcon = if (hasSong) {
        AutoShowInfo.cachedArtworkBitmap(serviceId) ?: AutoArtwork.createBitmap(stationId, 256)
      } else {
        AutoArtwork.createBitmap(stationId, 256)
      }
    } else {
      val episode = episodeJson ?: return null
      val podcastTitle = episode.optString("podcastTitle").ifEmpty {
        val pid = episode.optString("podcastId")
        findPodcast(pid)?.optString("title").orEmpty().ifEmpty { pid }
      }
      title = episode.optString("title")
      subtitle = podcastTitle
      largeIcon = null
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

    val smallIconRes = try {
      R.drawable.ic_stat_notification
    } catch (_: Throwable) {
      applicationInfo.icon
    }

    val builder = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(smallIconRes)
      .setContentTitle(title)
      .setContentText(subtitle)
      .setContentIntent(contentIntent)
      .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOnlyAlertOnce(true)
      .setOngoing(player.isPlaying)
    if (largeIcon != null) {
      builder.setLargeIcon(largeIcon)
    }
    builder
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
    val page = when {
      options.containsKey(MediaBrowserCompat.EXTRA_PAGE) -> options.getInt(MediaBrowserCompat.EXTRA_PAGE)
      options.containsKey(EXTRA_PAGE) -> options.getInt(EXTRA_PAGE)
      else -> -1
    }
    val pageSize = when {
      options.containsKey(MediaBrowserCompat.EXTRA_PAGE_SIZE) -> options.getInt(MediaBrowserCompat.EXTRA_PAGE_SIZE)
      options.containsKey(EXTRA_PAGE_SIZE) -> options.getInt(EXTRA_PAGE_SIZE)
      else -> EPISODE_PAGE_SIZE
    }.coerceIn(1, 100)

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
          val played = AutoState.isPlayed(this, entry.optString("id"))
          val inProgress = !played && AutoState.progress(this, entry.optString("id")) > 0L
          items.add(
            playable(
              "podcast_episode_${entry.optString("id")}",
              entry.optString("title"),
              episodeSubtitle(
                pubDate = entry.optString("pubDate"),
                podcastTitle = entry.optString("podcastTitle"),
                played = played,
                inProgress = inProgress,
                downloaded = true
              ),
              entry.optString("imageUrl")
            )
          )
        }
      }

      MEDIA_ID_PODCASTS_HISTORY -> {
        val downloadedIds = AutoState.downloads(this).map { it.optString("id") }.toSet()
        for (entry in AutoState.history(this)) {
          val played = AutoState.isPlayed(this, entry.optString("id"))
          val inProgress = !played && AutoState.progress(this, entry.optString("id")) > 0L
          items.add(
            playable(
              "podcast_episode_${entry.optString("id")}",
              entry.optString("title"),
              episodeSubtitle(
                pubDate = entry.optString("pubDate"),
                podcastTitle = entry.optString("podcastTitle"),
                played = played,
                inProgress = inProgress,
                downloaded = downloadedIds.contains(entry.optString("id"))
              ),
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
                episodeSubtitle(
                  pubDate = entry.optString("pubDate"),
                  podcastTitle = entry.optString("podcastTitle"),
                  played = played,
                  inProgress = inProgress,
                  downloaded = downloadedIds.contains(entry.optString("id"))
                ),
                entry.optString("imageUrl")
              )
            )
          }
        }

        parentId.startsWith("podcast_") -> {
          val podcastId = parentId.removePrefix("podcast_").substringBefore(':')
          var episodes = AutoState.episodes(this, podcastId)
          if (episodes.isEmpty()) {
            triggerPodcastEpisodeFetch(podcastId, parentId)
          }
          if (AutoState.settingBoolean(this, "carplayHidePlayed", false)) {
            episodes = episodes.filterNot { AutoState.isPlayed(this, it.optString("id")) }
          }
          if (page >= 0) {
            val from = page * pageSize
            episodes = if (from >= episodes.size) emptyList()
            else episodes.subList(from, (from + pageSize).coerceAtMost(episodes.size)).toList()
          } else {
            episodes = episodes.take(EPISODE_PAGE_SIZE.coerceAtLeast(50))
          }
          val downloadedIds = AutoState.downloads(this).map { it.optString("id") }.toSet()
          for (episode in episodes) {
            val played = AutoState.isPlayed(this, episode.optString("id"))
            val inProgress = !played && AutoState.progress(this, episode.optString("id")) > 0L
            items.add(
              playable(
                "podcast_episode_${episode.optString("id")}",
                episode.optString("title"),
                episodeSubtitle(
                  pubDate = episode.optString("pubDate"),
                  podcastTitle = "",
                  played = played,
                  inProgress = inProgress,
                  downloaded = downloadedIds.contains(episode.optString("id"))
                ),
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

  private fun loadDrawableAsBitmap(drawableResId: Int, sizePixels: Int = 128): Bitmap? {
    return try {
      val drawable = androidx.core.content.ContextCompat.getDrawable(this, drawableResId) ?: return null
      val bitmap = Bitmap.createBitmap(sizePixels, sizePixels, Bitmap.Config.ARGB_8888)
      val canvas = android.graphics.Canvas(bitmap)
      drawable.setBounds(0, 0, sizePixels, sizePixels)
      drawable.draw(canvas)
      bitmap
    } catch (e: Exception) {
      Log.e("AndroidAutoMediaService", "Failed to load drawable as bitmap: ${e.message}")
      null
    }
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
    iconRes?.let { resId ->
      loadDrawableAsBitmap(resId)?.let { description.setIconBitmap(it) }
    }
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
    return listOf(MEDIA_ID_FAVORITES, MEDIA_ID_ALL_STATIONS, MEDIA_ID_PODCASTS)
  }

  private val podcastFetchInFlight = java.util.Collections.synchronizedSet(mutableSetOf<String>())

  private fun triggerPodcastEpisodeFetch(podcastId: String, parentId: String) {
    if (!podcastFetchInFlight.add(podcastId)) return
    io.execute {
      try {
        val podcast = findPodcast(podcastId)
        val rssUrl = podcast?.optString("rssUrl").orEmpty().ifEmpty {
          "https://podcasts.files.bbci.co.uk/$podcastId.rss"
        }
        val parsedEpisodes = fetchAndParseRssEpisodes(podcastId, rssUrl, 50)
        if (parsedEpisodes.isNotEmpty()) {
          AutoState.saveEpisodes(this, podcastId, parsedEpisodes)
          handler.post {
            try { notifyChildrenChanged(parentId) } catch (_: Exception) { }
          }
        }
      } catch (e: Exception) {
        Log.w(TAG, "Failed to background-fetch episodes for $podcastId: ${e.message}")
      } finally {
        podcastFetchInFlight.remove(podcastId)
      }
    }
  }

  private fun fetchAndParseRssEpisodes(podcastId: String, rssUrl: String, limit: Int): List<JSONObject> {
    var currentUrl = rssUrl.replace("http://", "https://")
    var redirects = 0
    var xmlText = ""
    while (redirects < 5) {
      val conn = (URL(currentUrl).openConnection() as java.net.HttpURLConnection).apply {
        connectTimeout = 8000
        readTimeout = 8000
        instanceFollowRedirects = false
        setRequestProperty("User-Agent", "BritishRadioPlayer/1.0 (Android)")
        setRequestProperty("Accept", "application/rss+xml,application/xml,text/xml,*/*")
      }
      try {
        val code = conn.responseCode
        if (code in 300..399) {
          val location = conn.getHeaderField("Location") ?: break
          currentUrl = if (location.startsWith("/")) URL(URL(currentUrl), location).toString() else location
          redirects++
          continue
        }
        if (code != java.net.HttpURLConnection.HTTP_OK) return emptyList()
        xmlText = conn.inputStream.bufferedReader().use { it.readText() }
        break
      } finally {
        try { conn.disconnect() } catch (_: Exception) { }
      }
    }
    if (xmlText.isEmpty()) return emptyList()

    val chStart = xmlText.indexOf("<channel>")
    if (chStart != -1) {
      val tStart = xmlText.indexOf("<title>", chStart)
      if (tStart != -1) {
        val tEnd = xmlText.indexOf("</title>", tStart)
        if (tEnd != -1) {
          val channelTitle = xmlText.slice(tStart + 7 until tEnd).replace(Regex("<[^>]*>"), "").trim()
          if (channelTitle.isNotEmpty()) {
            AutoState.updatePodcastTitle(this, podcastId, channelTitle)
          }
        }
      }
    }

    val episodes = mutableListOf<JSONObject>()
    var itemStart = 0
    while (episodes.size < limit) {
      itemStart = xmlText.indexOf("<item", itemStart)
      if (itemStart == -1) break
      val tagClose = xmlText.indexOf(">", itemStart)
      if (tagClose == -1) break
      val itemEnd = xmlText.indexOf("</item>", tagClose)
      if (itemEnd == -1) break
      val content = xmlText.slice(tagClose + 1 until itemEnd)
      itemStart = itemEnd + 7

      val title = extractXmlTag(content, "title")
      val desc = extractXmlTag(content, "description").ifEmpty { extractXmlTag(content, "itunes:summary") }
      var audioUrl = ""
      val secIdx = content.indexOf("<ppg:enclosureSecure")
      if (secIdx != -1) {
        val uIdx = content.indexOf("url=\"", secIdx)
        if (uIdx != -1) {
          val uEnd = content.indexOf("\"", uIdx + 5)
          if (uEnd != -1) audioUrl = content.slice(uIdx + 5 until uEnd).trim()
        }
      }
      if (audioUrl.isEmpty()) {
        val encIdx = content.indexOf("<enclosure")
        if (encIdx != -1) {
          val uIdx = content.indexOf("url=\"", encIdx)
          if (uIdx != -1) {
            val uEnd = content.indexOf("\"", uIdx + 5)
            if (uEnd != -1) audioUrl = content.slice(uIdx + 5 until uEnd).trim().replace("http://", "https://")
          }
        }
      }

      val pubDate = extractXmlTag(content, "pubDate")
      val guid = extractXmlTag(content, "guid")
      val id = guid.substringAfterLast('/').substringAfterLast(':').ifEmpty { "$podcastId-${episodes.size}" }

      if (title.isNotEmpty() && audioUrl.isNotEmpty()) {
        episodes.add(JSONObject().apply {
          put("id", id)
          put("title", title)
          put("description", desc)
          put("audioUrl", audioUrl)
          put("imageUrl", "")
          put("pubDate", pubDate)
          put("pubDateEpochMs", parsePubDateEpoch(pubDate))
          put("durationMins", 0L)
          put("podcastId", podcastId)
          put("podcastTitle", "")
        })
      }
    }
    return episodes
  }

  private fun extractXmlTag(block: String, tag: String): String {
    val open = "<$tag"
    val s = block.indexOf(open)
    if (s == -1) return ""
    val cs = block.indexOf(">", s + open.length)
    if (cs == -1) return ""
    val close = "</$tag>"
    val e = block.indexOf(close, cs + 1)
    if (e == -1) return ""
    var v = block.slice(cs + 1 until e).trim()
    if (v.startsWith("<![CDATA[")) {
      v = v.removePrefix("<![CDATA[").substringBefore("]]>")
    }
    return v.replace(Regex("<[^>]*>"), "")
      .replace("&amp;", "&")
      .replace("&quot;", "\"")
      .replace("&lt;", "<")
      .replace("&gt;", ">")
      .replace("&#39;", "'")
      .replace("&apos;", "'")
      .trim()
  }

  private fun episodeSubtitle(
    pubDate: String,
    podcastTitle: String = "",
    played: Boolean,
    inProgress: Boolean,
    downloaded: Boolean
  ): String {
    val isNew = !played && !inProgress
    val formattedDate = formatEpisodeDate(pubDate)
    return buildString {
      when {
        played -> append("✅ ")
        inProgress -> append("~ ")
        isNew -> append("● ")
      }
      if (downloaded) append("⬇ ")
      append(formattedDate)
      if (podcastTitle.isNotBlank()) {
        if (formattedDate.isNotBlank()) append(" • ")
        append(podcastTitle)
      }
    }.trim()
  }

  private fun parsePubDateEpoch(raw: String): Long {
    if (raw.isBlank()) return 0L
    val formats = arrayOf(
      "EEE, dd MMM yyyy HH:mm:ss Z",
      "EEE, dd MMM yyyy HH:mm:ss z",
      "yyyy-MM-dd'T'HH:mm:ssZ"
    )
    for (pattern in formats) {
      try {
        val format = SimpleDateFormat(pattern, Locale.US).apply { isLenient = true }
        val parsed = format.parse(raw.trim().replace("UTC", "+0000"))
        if (parsed != null) return parsed.time
      } catch (_: Exception) {}
    }
    return 0L
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

  private fun fetchOpmlCatalog(): List<JSONObject> {
    val url = "https://www.bbc.co.uk/radio/opml/bbc_podcast_opml.xml"
    val list = mutableListOf<JSONObject>()
    try {
      var redirectUrl = url
      var redirects = 0
      var xml = ""
      while (redirects < 5) {
        val conn = (URL(redirectUrl).openConnection() as HttpURLConnection).apply {
          connectTimeout = 10000
          readTimeout = 10000
          instanceFollowRedirects = false
          setRequestProperty("User-Agent", "BritishRadioPlayer/1.0 (Android)")
        }
        val code = conn.responseCode
        if (code in 300..399) {
          redirectUrl = conn.getHeaderField("Location") ?: break
          redirects++
          continue
        }
        if (code != HttpURLConnection.HTTP_OK) break
        xml = conn.inputStream.bufferedReader().use { it.readText() }
        break
      }
      if (xml.isNotEmpty()) {
        val outlineRegex = Regex("<outline\\s+([^>]+?)/?>", RegexOption.IGNORE_CASE)
        for (m in outlineRegex.findAll(xml)) {
          val attrs = m.groupValues[1]
          val title = Regex("""text="([^"]*)"""").find(attrs)?.groupValues?.get(1)
            ?: Regex("""title="([^"]*)"""").find(attrs)?.groupValues?.get(1) ?: ""
          val xmlUrl = Regex("""xmlUrl="([^"]*)"""").find(attrs)?.groupValues?.get(1) ?: ""
          val imageHref = Regex("""imageHref="([^"]*)"""").find(attrs)?.groupValues?.get(1) ?: ""
          val key = Regex("""key="([^"]*)"""").find(attrs)?.groupValues?.get(1)
            ?: xmlUrl.substringAfterLast('/').removeSuffix(".rss")
          if (title.isNotEmpty() && key.isNotEmpty()) {
            list.add(JSONObject().apply {
              put("id", key)
              put("title", title)
              put("rssUrl", xmlUrl.ifEmpty { "https://podcasts.files.bbci.co.uk/$key.rss" })
              put("imageUrl", imageHref)
            })
          }
        }
      }
    } catch (e: Exception) {
      Log.w(TAG, "Failed to fetch OPML catalog: ${e.message}")
    }
    return list
  }

  private fun playRandomPodcast() {
    io.execute {
      try {
        var pool = AutoState.catalog(this)
        if (pool.isEmpty()) {
          pool = fetchOpmlCatalog()
        }
        if (pool.isEmpty()) {
          pool = AutoState.subscriptions(this)
        }
        if (pool.isEmpty()) return@execute

        val candidates = pool.shuffled()
        for (podcast in candidates.take(20)) {
          val podcastId = podcast.optString("id")
          if (podcastId.isEmpty()) continue
          val podTitle = podcast.optString("title")
          val podImage = podcast.optString("imageUrl")
          val rssUrl = podcast.optString("rssUrl").ifEmpty {
            "https://podcasts.files.bbci.co.uk/$podcastId.rss"
          }

          var episodes = AutoState.episodes(this, podcastId)
          if (episodes.isEmpty()) {
            episodes = fetchAndParseRssEpisodes(podcastId, rssUrl, 20)
            if (episodes.isNotEmpty()) {
              AutoState.saveEpisodes(this, podcastId, episodes)
            }
          }
          if (episodes.isEmpty()) continue

          // Pick the latest episode
          val latest = episodes.maxByOrNull { it.optLong("pubDateEpochMs", 0L) }
            ?: episodes.firstOrNull()
            ?: continue

          val enriched = enrichEpisode(latest, podcastId).apply {
            if (optString("podcastTitle").isEmpty()) put("podcastTitle", podTitle)
            if (optString("podcastImageUrl").isEmpty()) put("podcastImageUrl", podImage)
          }

          handler.post {
            playEpisode(enriched)
          }
          return@execute
        }
      } catch (e: Exception) {
        Log.e(TAG, "Error playing random podcast: ${e.message}", e)
      }
    }
  }

  private fun handlePlayFromSearch(query: String?) {
    if (query.isNullOrBlank()) {
      if (kind == Kind.NONE) resumeLastSession() else player.play()
      return
    }
    val terms = query.lowercase(Locale.US).trim().split(" ").filter { it.isNotBlank() }
    if (terms.isEmpty()) return

    if (terms.contains("random")) {
      playRandomPodcast()
      return
    }

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
