package com.hyliankid14.bbcradioplayer.nativeandroid

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.graphics.Bitmap
import android.net.Uri
import android.os.ParcelFileDescriptor
import com.hyliankid14.bbcradioplayer.nativeandroid.widget.StationArtwork
import java.io.File
import java.io.FileNotFoundException
import java.io.FileOutputStream

/**
 * Serves custom station ident PNGs to external system components (e.g. SystemUI media player,
 * lock screen notification on Samsung One UI) via `content://<applicationId>.stationident/<stationId>.png`.
 *
 * SystemUI processes cannot access internal app storage (`file:///data/user/0/...`) due to Linux
 * file permissions (SecurityException / FileNotFoundException), which causes media notifications
 * to fall back to a black background. Providing a ContentProvider allows SystemUI to load
 * the artwork via ContentResolver.
 */
class StationIdentProvider : ContentProvider() {

  companion object {
    private val lock = Any()
  }

  override fun onCreate(): Boolean = true

  override fun getType(uri: Uri): String = "image/png"

  override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor? {
    val ctx = context ?: throw FileNotFoundException("Context is null")
    val segment = uri.lastPathSegment ?: throw FileNotFoundException("Invalid URI: $uri")
    val stationId = segment.removeSuffix(".png").replace(Regex("[^a-zA-Z0-9_-]"), "")

    if (stationId.isEmpty()) {
      throw FileNotFoundException("Empty station identifier in URI: $uri")
    }

    val dir = File(ctx.filesDir, "idents")
    if (!dir.exists()) {
      dir.mkdirs()
    }
    val file = File(dir, "$stationId.png")

    if (!file.exists()) {
      synchronized(lock) {
        if (!file.exists()) {
          try {
            val bitmap = StationArtwork.createBitmap(stationId, 512)
            val tempFile = File(dir, "$stationId.tmp")
            FileOutputStream(tempFile).use { out ->
              bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
            }
            if (!tempFile.renameTo(file)) {
              tempFile.copyTo(file, overwrite = true)
              tempFile.delete()
            }
          } catch (e: Exception) {
            throw FileNotFoundException("Failed to generate ident for $stationId: ${e.message}")
          }
        }
      }
    }

    return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
  }

  override fun query(
    uri: Uri,
    projection: Array<out String>?,
    selection: String?,
    selectionArgs: Array<out String>?,
    sortOrder: String?
  ): Cursor? = null

  override fun insert(uri: Uri, values: ContentValues?): Uri? = null

  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0

  override fun update(
    uri: Uri,
    values: ContentValues?,
    selection: String?,
    selectionArgs: Array<out String>?
  ): Int = 0
}
