package com.hyliankid14.bbcradioplayer.nativeandroid

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat

/**
 * Plays the selected radio station for a scheduled alarm using the platform MediaPlayer.
 *
 * This runs independently of the JS runtime so the alarm still plays the station when the
 * app is not in the foreground (mirroring the legacy Kotlin `RadioService` alarm path).
 */
class AlarmPlaybackService : Service() {

  companion object {
    const val CHANNEL_ID = "radio_alarm_playback"
    const val NOTIFICATION_ID = 9002
    const val ACTION_STOP = "com.hyliankid14.bbcradioplayer.action.ALARM_STOP"
    const val EXTRA_STREAM_URL = "alarm_stream_url"
    const val EXTRA_STATION_NAME = "alarm_station_name"
    const val EXTRA_RAMP = "alarm_ramp"
    const val EXTRA_VOLUME = "alarm_volume"

    fun start(context: Context, streamUrl: String, stationName: String?, ramp: Boolean, volume: Int) {
      val intent = Intent(context, AlarmPlaybackService::class.java).apply {
        putExtra(EXTRA_STREAM_URL, streamUrl)
        putExtra(EXTRA_STATION_NAME, stationName)
        putExtra(EXTRA_RAMP, ramp)
        putExtra(EXTRA_VOLUME, volume)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    fun stop(context: Context) {
      try {
        context.stopService(Intent(context, AlarmPlaybackService::class.java))
      } catch (_: Exception) {
      }
    }
  }

  private var player: MediaPlayer? = null
  private var rampHandler: Handler? = null
  private var targetVolume = 1f

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopSelf()
      return START_NOT_STICKY
    }

    val url = intent?.getStringExtra(EXTRA_STREAM_URL).orEmpty()
    val name = intent?.getStringExtra(EXTRA_STATION_NAME) ?: "Radio Alarm"
    val ramp = intent?.getBooleanExtra(EXTRA_RAMP, true) ?: true
    val volume = intent?.getIntExtra(EXTRA_VOLUME, 5) ?: 5
    if (url.isEmpty()) {
      stopSelf()
      return START_NOT_STICKY
    }

    startForegroundNotification(name)
    targetVolume = (volume.coerceIn(1, 10) / 10f).coerceIn(0.05f, 1f)
    android.util.Log.i("RadioAlarm", "AlarmPlaybackService starting: url=$url ramp=$ramp volume=$volume")
    play(url, ramp)
    return START_STICKY
  }

  private fun play(url: String, ramp: Boolean) {
    releasePlayer()
    val mp = MediaPlayer()
    player = mp
    val attributes = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_ALARM)
      .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
      .build()
    mp.setAudioAttributes(attributes)
    mp.setWakeMode(applicationContext, PowerManager.PARTIAL_WAKE_LOCK)
    mp.setOnPreparedListener {
      val startVolume = if (ramp) 0.05f else targetVolume
      it.setVolume(startVolume, startVolume)
      it.start()
      android.util.Log.i("RadioAlarm", "AlarmPlaybackService playing (volume=$startVolume)")
      if (ramp) startRamp()
    }
    mp.setOnErrorListener { _, what, extra ->
      android.util.Log.e("RadioAlarm", "AlarmPlaybackService MediaPlayer error what=$what extra=$extra")
      stopSelf()
      true
    }
    try {
      mp.setDataSource(url)
      mp.prepareAsync()
    } catch (error: Exception) {
      android.util.Log.e("RadioAlarm", "AlarmPlaybackService failed to set data source", error)
      stopSelf()
    }
  }

  private fun startRamp() {
    rampHandler = Handler(Looper.getMainLooper())
    val steps = 15
    var step = 0
    val runnable = object : Runnable {
      override fun run() {
        step++
        val value = (targetVolume * step) / steps
        try {
          player?.setVolume(value, value)
        } catch (_: Exception) {
        }
        if (step < steps) rampHandler?.postDelayed(this, 2000L)
      }
    }
    rampHandler?.postDelayed(runnable, 2000L)
  }

  private fun startForegroundNotification(name: String) {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager != null) {
      if (manager.getNotificationChannel(CHANNEL_ID) == null) {
        manager.createNotificationChannel(
          NotificationChannel(CHANNEL_ID, "Radio Alarm playback", NotificationManager.IMPORTANCE_LOW).apply {
            setSound(null, null)
            enableVibration(false)
          }
        )
      }
    }

    val openIntent = packageManager.getLaunchIntentForPackage(packageName)
    val contentIntent = PendingIntent.getActivity(
      this,
      9201,
      openIntent ?: Intent(),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    val stopIntent = PendingIntent.getService(
      this,
      9202,
      Intent(this, AlarmPlaybackService::class.java).setAction(ACTION_STOP),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    val notification = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
      .setContentTitle("Radio Alarm")
      .setContentText(name)
      .setContentIntent(contentIntent)
      .addAction(0, "Dismiss", stopIntent)
      .setOngoing(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun releasePlayer() {
    try {
      rampHandler?.removeCallbacksAndMessages(null)
    } catch (_: Exception) {
    }
    rampHandler = null
    try {
      player?.stop()
    } catch (_: Exception) {
    }
    try {
      player?.release()
    } catch (_: Exception) {
    }
    player = null
  }

  override fun onDestroy() {
    releasePlayer()
    super.onDestroy()
  }
}
