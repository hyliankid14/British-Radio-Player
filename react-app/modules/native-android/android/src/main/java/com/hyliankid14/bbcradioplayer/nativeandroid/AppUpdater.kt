package com.hyliankid14.bbcradioplayer.nativeandroid

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Environment
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Checks GitHub releases for a newer APK and installs it, mirroring the legacy
 * `GitHubAppUpdater` behaviour (canonical `british-radio-player.apk` asset first).
 */
object AppUpdater {

  private const val LATEST_RELEASE_API =
    "https://api.github.com/repos/hyliankid14/British-Radio-Player/releases/latest"
  private const val PHONE_RELEASE_APK_NAME = "british-radio-player.apk"

  private var receiver: BroadcastReceiver? = null
  private var pendingDownloadId: Long = -1L

  /** Returns `{available, version, apkUrl, apkName}` or "{}" on failure. */
  fun checkForUpdate(currentVersion: String): JSONObject {
    val connection = try {
      URL(LATEST_RELEASE_API).openConnection() as? HttpURLConnection
    } catch (_: Exception) {
      null
    } ?: return JSONObject()

    return try {
      connection.requestMethod = "GET"
      connection.connectTimeout = 10_000
      connection.readTimeout = 10_000
      connection.setRequestProperty("Accept", "application/vnd.github+json")
      if (connection.responseCode !in 200..299) return JSONObject()

      val response = connection.inputStream.bufferedReader().use { it.readText() }
      val json = JSONObject(response)
      val tagName = json.optString("tag_name", "").trim()
      val version = normaliseVersion(tagName)
      if (version.isBlank()) return JSONObject()

      val assets = json.optJSONArray("assets") ?: return JSONObject()

      fun findAsset(predicate: (String) -> Boolean): Pair<String, String>? {
        for (i in 0 until assets.length()) {
          val asset = assets.optJSONObject(i) ?: continue
          val name = asset.optString("name", "").trim()
          if (!predicate(name)) continue
          val url = asset.optString("browser_download_url", "")
          if (url.isNotBlank()) return name to url
        }
        return null
      }

      val match = findAsset { it.equals(PHONE_RELEASE_APK_NAME, ignoreCase = true) }
        ?: findAsset { it.endsWith(".apk", true) && !it.contains("wear", true) }
        ?: return JSONObject()

      JSONObject().apply {
        put("available", isUpdateAvailable(currentVersion, version))
        put("version", version)
        put("apkName", match.first)
        put("apkUrl", match.second)
      }
    } catch (_: Exception) {
      JSONObject()
    } finally {
      try {
        connection.disconnect()
      } catch (_: Exception) {
      }
    }
  }

  /** Enqueues the APK download and opens the system installer when it completes. */
  fun downloadAndInstall(context: Context, apkUrl: String, apkName: String) {
    registerReceiverIfNeeded(context)
    val manager = context.getSystemService(Context.DOWNLOAD_SERVICE) as? DownloadManager ?: return
    val request = DownloadManager.Request(Uri.parse(apkUrl))
      .setTitle("British Radio Player update")
      .setDescription("Downloading update")
      .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
      .setMimeType("application/vnd.android.package-archive")
      .setAllowedOverMetered(true)
      .setAllowedOverRoaming(true)
      .setDestinationInExternalPublicDir(
        Environment.DIRECTORY_DOWNLOADS,
        apkName.ifBlank { PHONE_RELEASE_APK_NAME }
      )
    pendingDownloadId = manager.enqueue(request)
  }

  private fun registerReceiverIfNeeded(context: Context) {
    if (receiver != null) return
    val newReceiver = object : BroadcastReceiver() {
      override fun onReceive(receiverContext: Context, intent: Intent) {
        val id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L)
        if (id != pendingDownloadId) return
        val manager = receiverContext.getSystemService(Context.DOWNLOAD_SERVICE) as? DownloadManager ?: return
        val uri = manager.getUriForDownloadedFile(id) ?: return
        try {
          val install = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
          }
          receiverContext.startActivity(install)
        } catch (_: Exception) {
        }
      }
    }
    try {
      context.registerReceiver(
        newReceiver,
        IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
        Context.RECEIVER_NOT_EXPORTED
      )
      receiver = newReceiver
    } catch (_: Exception) {
    }
  }

  private fun normaliseVersion(raw: String): String =
    raw.trim().removePrefix("v").removePrefix("V").trim()

  private fun parseSemVer(value: String): List<Int>? {
    val parts = value.split(".").mapNotNull { it.takeWhile(Char::isDigit).toIntOrNull() }
    return if (parts.isEmpty()) null else parts
  }

  fun isUpdateAvailable(currentVersion: String, latestVersion: String): Boolean {
    val current = parseSemVer(normaliseVersion(currentVersion)) ?: return false
    val latest = parseSemVer(normaliseVersion(latestVersion)) ?: return false
    for (i in 0 until maxOf(current.size, latest.size)) {
      val c = current.getOrElse(i) { 0 }
      val l = latest.getOrElse(i) { 0 }
      if (l != c) return l > c
    }
    return false
  }
}
