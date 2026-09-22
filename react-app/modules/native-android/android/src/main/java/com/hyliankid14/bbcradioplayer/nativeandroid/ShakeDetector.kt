package com.hyliankid14.bbcradioplayer.nativeandroid

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import kotlin.math.sqrt

/**
 * Accelerometer shake detector mirroring the legacy Kotlin `PodcastsFragment` implementation
 * (gravity threshold with debounce) so shake-to-shuffle behaves identically.
 */
class ShakeDetector(private val context: Context, private val onShake: () -> Unit) {

  private companion object {
    const val SHAKE_THRESHOLD_GRAVITY = 2.7f
    const val SHAKE_DEBOUNCE_MS = 1000L
    const val MIN_UPDATE_INTERVAL_MS = 100L
  }

  private var sensorManager: SensorManager? = null
  private var lastShakeTime = 0L
  private var lastUpdate = 0L

  private val listener = object : SensorEventListener {
    override fun onSensorChanged(event: SensorEvent) {
      val now = System.currentTimeMillis()
      if (now - lastUpdate < MIN_UPDATE_INTERVAL_MS) return
      lastUpdate = now
      val x = event.values[0]
      val y = event.values[1]
      val z = event.values[2]
      val gForce = sqrt((x * x + y * y + z * z).toDouble()).toFloat() / SensorManager.GRAVITY_EARTH
      if (gForce > SHAKE_THRESHOLD_GRAVITY && now - lastShakeTime > SHAKE_DEBOUNCE_MS) {
        lastShakeTime = now
        onShake()
      }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
  }

  fun start() {
    if (sensorManager != null) return
    val manager = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager ?: return
    val sensor = manager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) ?: return
    manager.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_UI)
    sensorManager = manager
  }

  fun stop() {
    sensorManager?.unregisterListener(listener)
    sensorManager = null
  }
}
