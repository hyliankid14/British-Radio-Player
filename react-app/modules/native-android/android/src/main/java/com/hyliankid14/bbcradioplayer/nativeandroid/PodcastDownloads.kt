package com.hyliankid14.bbcradioplayer.nativeandroid

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.DocumentsContract
import android.provider.MediaStore
import java.io.File

/**
 * Stores downloaded podcast episodes in the public Podcasts folder so they are visible in the
 * device file manager and can be opened, played and removed. Files are published through
 * MediaStore, which keeps them owned by the app (so delete works under scoped storage).
 */
object PodcastDownloads {

  private const val FOLDER_NAME = "British Radio Player"
  private const val RELATIVE_PATH = "Podcasts/$FOLDER_NAME"

  fun folderPath(): String =
    File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PODCASTS), FOLDER_NAME)
      .absolutePath

  private fun collection(): Uri =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
    } else {
      MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
    }

  private fun mimeType(fileName: String): String =
    when (fileName.substringAfterLast('.', "").lowercase()) {
      "m4a", "m4b", "mp4", "aac" -> "audio/mp4"
      "ogg", "oga", "opus" -> "audio/ogg"
      else -> "audio/mpeg"
    }

  private fun safeName(fileName: String): String =
    fileName.replace('/', '_').replace('\\', '_').trim().ifEmpty { "episode.mp3" }

  /** Copies a locally downloaded temp file into the public Podcasts folder. Returns the URI. */
  fun publish(context: Context, sourceUri: String, fileName: String, title: String): String? {
    val resolver = context.contentResolver
    val name = safeName(fileName)
    val values = ContentValues().apply {
      put(MediaStore.Audio.Media.DISPLAY_NAME, name)
      put(MediaStore.Audio.Media.TITLE, title)
      put(MediaStore.Audio.Media.MIME_TYPE, mimeType(name))
      put(MediaStore.Audio.Media.IS_MUSIC, 0)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        put(MediaStore.Audio.Media.RELATIVE_PATH, RELATIVE_PATH)
        put(MediaStore.Audio.Media.IS_PENDING, 1)
      }
    }
    val uri = resolver.insert(collection(), values) ?: return null
    return try {
      resolver.openInputStream(Uri.parse(sourceUri))?.use { input ->
        resolver.openOutputStream(uri)?.use { output -> input.copyTo(output) }
      } ?: return null
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val done = ContentValues().apply { put(MediaStore.Audio.Media.IS_PENDING, 0) }
        resolver.update(uri, done, null, null)
      }
      uri.toString()
    } catch (_: Exception) {
      try {
        resolver.delete(uri, null, null)
      } catch (_: Exception) {
      }
      null
    }
  }

  /** Deletes a published episode by its URI. */
  fun delete(context: Context, uriString: String): Boolean {
    return try {
      if (uriString.startsWith("content://")) {
        context.contentResolver.delete(Uri.parse(uriString), null, null) > 0
      } else {
        val path = Uri.parse(uriString).path
        if (path == null) false else File(path).delete()
      }
    } catch (_: Exception) {
      false
    }
  }

  /** Deletes every episode in the app's public Podcasts folder. Returns the count removed. */
  fun clearAll(context: Context): Int {
    var removed = 0
    try {
      val cursor = context.contentResolver.query(
        collection(),
        arrayOf(MediaStore.Audio.Media._ID),
        "${MediaStore.Audio.Media.RELATIVE_PATH} LIKE ?",
        arrayOf("$RELATIVE_PATH%"),
        null
      )
      cursor?.use {
        while (it.moveToNext()) {
          val id = it.getLong(it.getColumnIndexOrThrow(MediaStore.Audio.Media._ID))
          val uri = Uri.withAppendedPath(collection(), id.toString())
          try {
            if (context.contentResolver.delete(uri, null, null) > 0) removed++
          } catch (_: Exception) {
          }
        }
      }
    } catch (_: Exception) {
      // Fall back to a direct file sweep when MediaStore is unavailable.
    }
    if (removed == 0) {
      try {
        File(folderPath()).listFiles()?.forEach { file -> if (file.delete()) removed++ }
      } catch (_: Exception) {
      }
    }
    return removed
  }

  /** Opens the public Podcasts folder in the system file manager. */
  fun openFolder(context: Context): Boolean {
    try {
      File(folderPath()).mkdirs()
    } catch (_: Exception) {
    }
    val docId = "primary:$RELATIVE_PATH"
    val uri = DocumentsContract.buildDocumentUri("com.android.externalstorage.documents", docId)
    return try {
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, "vnd.android.document/directory")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      context.startActivity(Intent.createChooser(intent, "Open downloads").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      true
    } catch (_: Exception) {
      false
    }
  }
}
