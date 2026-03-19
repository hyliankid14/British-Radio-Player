package com.hyliankid14.bbcradioplayer

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Environment
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

data class GitHubReleaseInfo(
    val version: String,
    val apkUrl: String,
    val apkName: String
)

object GitHubAppUpdater {
    private const val LATEST_RELEASE_API = "https://api.github.com/repos/hyliankid14/British-Radio-Player/releases/latest"

    suspend fun fetchLatestRelease(): GitHubReleaseInfo? = withContext(Dispatchers.IO) {
        val connection = (URL(LATEST_RELEASE_API).openConnection() as? HttpURLConnection) ?: return@withContext null
        try {
            connection.requestMethod = "GET"
            connection.connectTimeout = 10_000
            connection.readTimeout = 10_000
            connection.setRequestProperty("Accept", "application/vnd.github+json")

            if (connection.responseCode !in 200..299) return@withContext null

            val response = connection.inputStream.bufferedReader().use { it.readText() }
            val json = JSONObject(response)
            val tagName = json.optString("tag_name", "").trim()
            val normalisedVersion = normaliseVersion(tagName)
            if (normalisedVersion.isBlank()) return@withContext null

            val assets = json.optJSONArray("assets") ?: return@withContext null
            for (i in 0 until assets.length()) {
                val asset = assets.optJSONObject(i) ?: continue
                val name = asset.optString("name", "")
                if (!name.endsWith(".apk", ignoreCase = true)) continue

                val downloadUrl = asset.optString("browser_download_url", "")
                if (downloadUrl.isBlank()) continue

                return@withContext GitHubReleaseInfo(
                    version = normalisedVersion,
                    apkUrl = downloadUrl,
                    apkName = name
                )
            }

            null
        } catch (_: Exception) {
            null
        } finally {
            connection.disconnect()
        }
    }

    fun isUpdateAvailable(currentVersion: String, latestVersion: String): Boolean {
        val current = parseSemVer(normaliseVersion(currentVersion))
        val latest = parseSemVer(normaliseVersion(latestVersion))

        if (current == null || latest == null) return false
        return compareSemVer(latest, current) > 0
    }

    fun enqueueApkDownload(context: Context, info: GitHubReleaseInfo): Long {
        val request = DownloadManager.Request(Uri.parse(info.apkUrl))
            .setTitle("British Radio Player ${info.version}")
            .setDescription("Downloading update")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setMimeType("application/vnd.android.package-archive")
            .setAllowedOverMetered(true)
            .setAllowedOverRoaming(true)
            .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, info.apkName)

        val manager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        return manager.enqueue(request)
    }

    fun getDownloadedApkUri(context: Context, downloadId: Long): Uri? {
        val manager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        return manager.getUriForDownloadedFile(downloadId)
    }

    private fun normaliseVersion(raw: String): String {
        var value = raw.trim()
        if (value.startsWith("v", ignoreCase = true)) {
            value = value.substring(1)
        }

        return value.substringBefore('-')
    }

    private fun parseSemVer(value: String): Triple<Int, Int, Int>? {
        val parts = value.split('.')
        if (parts.size < 3) return null

        val major = parts.getOrNull(0)?.toIntOrNull() ?: return null
        val minor = parts.getOrNull(1)?.toIntOrNull() ?: return null
        val patch = parts.getOrNull(2)?.toIntOrNull() ?: return null
        return Triple(major, minor, patch)
    }

    private fun compareSemVer(left: Triple<Int, Int, Int>, right: Triple<Int, Int, Int>): Int {
        if (left.first != right.first) return left.first.compareTo(right.first)
        if (left.second != right.second) return left.second.compareTo(right.second)
        return left.third.compareTo(right.third)
    }
}
