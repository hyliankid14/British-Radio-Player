package com.hyliankid14.bbcradioplayer.nativeandroid

import android.content.Context
import android.os.Environment
import java.io.File

/**
 * Persists the last 5 Last.fm scrobbled tracks across app uninstalls, reinstalls, and updates.
 *
 * Saves to public external storage directories (Podcasts and Documents) which remain on disk
 * even after an app uninstall, and to SharedPreferences which is backed up by Android Auto Backup.
 */
object PersistentScrobbleStore {

  private const val FILE_NAME = ".lastfm_recent_scrobbles.json"
  private const val FOLDER_NAME = "British Radio Player"
  private const val PREFS_NAME = "lastfm_prefs"
  private const val KEY_RECENT_SCROBBLES = "lastfm_recent_scrobbles"

  private fun getCandidateDirectories(): List<File> {
    val dirs = mutableListOf<File>()
    try {
      val podcastsDir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PODCASTS), FOLDER_NAME)
      dirs.add(podcastsDir)
    } catch (_: Exception) {}
    try {
      val docsDir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS), FOLDER_NAME)
      dirs.add(docsDir)
    } catch (_: Exception) {}
    try {
      val downloadsDir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), FOLDER_NAME)
      dirs.add(downloadsDir)
    } catch (_: Exception) {}
    return dirs
  }

  fun save(context: Context, json: String) {
    if (json.isBlank()) return
    // 1. Write to public storage folders (survives app uninstall)
    for (dir in getCandidateDirectories()) {
      try {
        if (!dir.exists()) dir.mkdirs()
        val file = File(dir, FILE_NAME)
        file.writeText(json)
      } catch (_: Exception) {}
    }
    // 2. Write to SharedPreferences so Android's AutoBackup/Cloud Backup preserves it
    try {
      context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .edit()
        .putString(KEY_RECENT_SCROBBLES, json)
        .apply()
    } catch (_: Exception) {}
  }

  fun read(context: Context): String? {
    // 1. Try public storage folders (preserved on uninstall)
    for (dir in getCandidateDirectories()) {
      try {
        val file = File(dir, FILE_NAME)
        if (file.exists() && file.canRead()) {
          val content = file.readText().trim()
          if (content.isNotBlank() && content != "[]") return content
        }
      } catch (_: Exception) {}
    }
    // 2. Try SharedPreferences (restored on cloud/Google Drive restore)
    try {
      val fromPrefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .getString(KEY_RECENT_SCROBBLES, null)
      if (!fromPrefs.isNullOrBlank() && fromPrefs != "[]") return fromPrefs
    } catch (_: Exception) {}
    return null
  }
}
