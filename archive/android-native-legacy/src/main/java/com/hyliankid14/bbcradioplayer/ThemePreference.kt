package com.hyliankid14.bbcradioplayer

import android.content.Context

object ThemePreference {
    private const val PREF_NAME = "theme_prefs"
    private const val THEME_KEY = "selected_theme"
    private const val QUALITY_KEY = "audio_quality"
    private const val AUTO_QUALITY_KEY = "auto_detect_quality"
    
    const val THEME_LIGHT = "light"
    const val THEME_DARK = "dark"
    const val THEME_SYSTEM = "system"

    enum class AudioQuality(val storageValue: String, val bitrate: String) {
        HIGH_320("320kbps", "320000"),
        STANDARD_128("128kbps", "128000"),
        DATA_SAVER_96("96kbps", "96000"),
        DATA_SAVER_48("48kbps", "48000");

        companion object {
            fun fromStorageValue(value: String?): AudioQuality {
                return entries.firstOrNull { it.storageValue == value } ?: HIGH_320
            }
        }
    }
    
    fun getTheme(context: Context): String {
        val prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        return prefs.getString(THEME_KEY, THEME_SYSTEM) ?: THEME_SYSTEM
    }
    
    fun setTheme(context: Context, theme: String) {
        val prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(THEME_KEY, theme).apply()
    }
    
    fun getAutoDetectQuality(context: Context): Boolean {
        val prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        return prefs.getBoolean(AUTO_QUALITY_KEY, true) // Default to auto-detect enabled
    }
    
    fun setAutoDetectQuality(context: Context, autoDetect: Boolean) {
        val prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        prefs.edit().putBoolean(AUTO_QUALITY_KEY, autoDetect).apply()
    }

    fun getManualAudioQuality(context: Context): AudioQuality {
        val prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        return AudioQuality.fromStorageValue(prefs.getString(QUALITY_KEY, AudioQuality.HIGH_320.storageValue))
    }

    fun setManualAudioQuality(context: Context, quality: AudioQuality) {
        val prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(QUALITY_KEY, quality.storageValue).apply()
    }

    fun getEffectiveAudioQuality(context: Context): AudioQuality {
        val autoDetect = getAutoDetectQuality(context)
        return if (autoDetect) {
            NetworkQualityDetector.getRecommendedAudioQuality(context)
        } else {
            getManualAudioQuality(context)
        }
    }
}
