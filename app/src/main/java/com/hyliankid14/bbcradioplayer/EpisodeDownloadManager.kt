package com.hyliankid14.bbcradioplayer

import android.app.DownloadManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.widget.Toast
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * Manages episode downloads using Android's DownloadManager.
 */
object EpisodeDownloadManager {
    private const val TAG = "EpisodeDownloadManager"
    
    // Broadcast action sent when a download completes or fails
    const val ACTION_DOWNLOAD_COMPLETE = "com.hyliankid14.bbcradioplayer.DOWNLOAD_COMPLETE"
        // Broadcast action sent when a downloaded episode is deleted
        const val ACTION_DOWNLOAD_DELETED = "com.hyliankid14.bbcradioplayer.DOWNLOAD_DELETED"
    const val EXTRA_EPISODE_ID = "episode_id"
    const val EXTRA_SUCCESS = "success"
    const val EXTRA_FAILURE_REASON = "failure_reason"

    private const val PREFS_NAME = "download_manager_prefs"
    private const val KEY_PREFIX_DOWNLOAD_ID = "download_id_"
    private const val KEY_PREFIX_HTTP_RETRY = "http_retry_"
    private const val KEY_PREFIX_DIRECT_RETRY = "direct_retry_"
    private const val KEY_PREFIX_WIFI_QUEUE = "wifi_queue_"
    private const val DOWNLOAD_FAILURE_CHANNEL_ID = "episode_download_failures"
    private const val DOWNLOAD_SUCCESS_CHANNEL_ID = "episode_download_success"
    private const val DOWNLOAD_BULK_CHANNEL_ID = "episode_download_bulk"

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private fun showToast(context: Context, message: String) {
        Handler(Looper.getMainLooper()).post {
            Toast.makeText(context, message, Toast.LENGTH_SHORT).show()
        }
    }

    fun recoverStuckDownloads(context: Context, maxItems: Int = 12) {
        val prefs = prefs(context)
        val downloadManager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val pendingKeys = prefs.all.keys
            .filter { it.startsWith("pending_") }
            .take(maxItems.coerceAtLeast(1))

        var repairedCount = 0

        for (pendingKey in pendingKeys) {
            val episodeId = pendingKey.removePrefix("pending_")
            val pendingData = prefs.getString(pendingKey, null) ?: continue

            try {
                val jsonStr = String(android.util.Base64.decode(pendingData, android.util.Base64.DEFAULT))
                val json = org.json.JSONObject(jsonStr)
                val originalEpisode = jsonToEpisode(json.getJSONObject("episode"))
                val repairedEpisode = normaliseEpisodeAudioUrl(originalEpisode)
                val podcastTitle = json.optString("podcastTitle", "")
                val autoDownload = json.optBoolean("autoDownload", false)
                val suppressSuccessNotification = json.optBoolean("suppressSuccessNotification", false)
                val pendingPath = json.optString("localPath", "")
                val destinationFile = if (pendingPath.isNotBlank()) File(pendingPath) else buildDestinationFile(context, repairedEpisode)

                var shouldRequeue = repairedEpisode.audioUrl != originalEpisode.audioUrl
                val existingDownloadId = prefs.getLong(KEY_PREFIX_DOWNLOAD_ID + episodeId, -1L)

                if (existingDownloadId > 0) {
                    val query = DownloadManager.Query().setFilterById(existingDownloadId)
                    downloadManager.query(query).use { cursor ->
                        if (!cursor.moveToFirst()) {
                            shouldRequeue = true
                        } else {
                            val statusIndex = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS)
                            val reasonIndex = cursor.getColumnIndex(DownloadManager.COLUMN_REASON)
                            val status = if (statusIndex >= 0) cursor.getInt(statusIndex) else DownloadManager.STATUS_FAILED
                            val reason = if (reasonIndex >= 0) cursor.getInt(reasonIndex) else -1

                            if (status == DownloadManager.STATUS_FAILED) {
                                shouldRequeue = true
                            } else if (status == DownloadManager.STATUS_PAUSED && reason == DownloadManager.PAUSED_WAITING_TO_RETRY) {
                                shouldRequeue = true
                            }
                        }
                    }
                } else {
                    shouldRequeue = true
                }

                if (shouldRequeue) {
                    if (existingDownloadId > 0) {
                        try {
                            downloadManager.remove(existingDownloadId)
                        } catch (_: Exception) {
                            // Best effort: continue with re-enqueue.
                        }
                    }

                    val newDownloadId = enqueueDownload(downloadManager, context, repairedEpisode, podcastTitle, destinationFile)
                    prefs.edit().putLong(KEY_PREFIX_DOWNLOAD_ID + episodeId, newDownloadId).apply()

                    val updatedPending = android.util.Base64.encodeToString(
                        org.json.JSONObject().apply {
                            put("episode", episodeToJson(repairedEpisode))
                            put("podcastTitle", podcastTitle)
                            put("localPath", destinationFile.absolutePath)
                            put("autoDownload", autoDownload)
                            put("suppressSuccessNotification", suppressSuccessNotification)
                        }.toString().toByteArray(),
                        android.util.Base64.DEFAULT
                    )
                    prefs.edit().putString(pendingKey, updatedPending).apply()
                    repairedCount++
                }
            } catch (e: Exception) {
                Log.w(TAG, "Failed to repair pending download for $episodeId", e)
            }
        }

        if (repairedCount > 0) {
            Log.i(TAG, "Repaired $repairedCount pending downloads")
        }
    }

    fun handleSystemDownloadComplete(context: Context, intent: Intent) {
        if (intent.action != DownloadManager.ACTION_DOWNLOAD_COMPLETE) return

        val downloadId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1)
        if (downloadId == -1L) return

        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val allPrefs = prefs.all
        var episodeId: String? = null

        for ((key, value) in allPrefs) {
            if (key.startsWith(KEY_PREFIX_DOWNLOAD_ID) && value == downloadId) {
                episodeId = key.removePrefix(KEY_PREFIX_DOWNLOAD_ID)
                break
            }
        }

        if (episodeId == null) {
            Log.w(TAG, "Download completed but episode ID not found")
            return
        }

        val downloadManager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val query = DownloadManager.Query().setFilterById(downloadId)
        val cursor = downloadManager.query(query)

        if (cursor.moveToFirst()) {
            val statusIndex = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS)
            val status = cursor.getInt(statusIndex)

            if (status == DownloadManager.STATUS_SUCCESSFUL) {
                val uriIndex = cursor.getColumnIndex(DownloadManager.COLUMN_LOCAL_URI)
                val localUri = if (uriIndex >= 0) cursor.getString(uriIndex) else null
                val sizeIndex = cursor.getColumnIndex(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)
                val reportedSize = if (sizeIndex >= 0) cursor.getLong(sizeIndex) else 0L

                val pendingKey = "pending_$episodeId"
                val pendingData = prefs.getString(pendingKey, null)

                if (pendingData != null) {
                    try {
                        val jsonStr = String(android.util.Base64.decode(pendingData, android.util.Base64.DEFAULT))
                        val json = org.json.JSONObject(jsonStr)
                        val episode = jsonToEpisode(json.getJSONObject("episode"))
                        val podcastTitle = json.optString("podcastTitle", "")
                        val autoDownload = json.optBoolean("autoDownload", false)
                        val suppressSuccessNotification = json.optBoolean("suppressSuccessNotification", false)
                        val pendingPath = json.optString("localPath", "")

                        // Always use the path we specified, since we know it's a real file path
                        val localRef = if (pendingPath.isNotBlank() && File(pendingPath).exists()) {
                            pendingPath
                        } else {
                            // Fallback: try to extract file path from DownloadManager URI
                            when {
                                !localUri.isNullOrBlank() && localUri.startsWith("/") -> localUri
                                !localUri.isNullOrBlank() && localUri.startsWith("file://") -> Uri.parse(localUri).path ?: ""
                                else -> ""
                            }
                        }

                        if (localRef.isBlank()) {
                            throw IllegalStateException("Unable to resolve downloaded file location (pending: $pendingPath, uri: $localUri)")
                        }

                        val fileSize = when {
                            reportedSize > 0 -> reportedSize
                            localRef.startsWith("/") -> File(localRef).takeIf { it.exists() }?.length() ?: 0L
                            else -> 0L
                        }

                        DownloadedEpisodes.addDownloaded(context, episode, localRef, fileSize, podcastTitle, autoDownload)

                        if (autoDownload) {
                            val limit = DownloadPreferences.getAutoDownloadLimit(context).coerceAtLeast(1)
                            pruneDownloadsForPodcastToLimit(context, episode.podcastId, limit)
                        }

                        prefs.edit().remove(pendingKey).apply()
                        prefs.edit().remove(KEY_PREFIX_DOWNLOAD_ID + episodeId).apply()
                        prefs.edit().remove(KEY_PREFIX_HTTP_RETRY + episodeId).apply()
                        prefs.edit().remove(KEY_PREFIX_DIRECT_RETRY + episodeId).apply()

                        val broadcastIntent = Intent(ACTION_DOWNLOAD_COMPLETE).apply {
                            setPackage(context.packageName)
                            putExtra(EXTRA_EPISODE_ID, episodeId)
                            putExtra(EXTRA_SUCCESS, true)
                        }
                        context.sendBroadcast(broadcastIntent)

                        if (!autoDownload && !suppressSuccessNotification) {
                            showSuccessNotification(context, episode, podcastTitle)
                        }

                        Log.d(TAG, "Episode downloaded successfully: ${episode.title} to $localRef")
                    } catch (e: Exception) {
                        Log.e(TAG, "Failed to process completed download", e)
                    }
                }
            } else {
                val reasonIndex = cursor.getColumnIndex(DownloadManager.COLUMN_REASON)
                val reason = if (reasonIndex >= 0) cursor.getInt(reasonIndex) else -1
                val pendingKey = "pending_$episodeId"
                val pendingData = prefs.getString(pendingKey, null)
                val episodeTitle = extractEpisodeTitle(pendingData)

                if (tryHttpFallbackRetry(context, episodeId, pendingData, reason)) {
                    Log.w(TAG, "Retrying episode $episodeId download with HTTP fallback")
                    cursor.close()
                    return
                }

                if (tryDirectDownloadFallback(context, episodeId, pendingData, reason)) {
                    Log.w(TAG, "Retrying episode $episodeId with direct downloader fallback")
                    cursor.close()
                    return
                }

                val failureReason = buildFailureReason(reason)

                Log.e(TAG, "Download failed for episode $episodeId, reason: $reason ($failureReason)")
                showFailureNotification(context, episodeId, episodeTitle, failureReason)

                prefs.edit().remove(pendingKey).apply()
                prefs.edit().remove(KEY_PREFIX_DOWNLOAD_ID + episodeId).apply()
                prefs.edit().remove(KEY_PREFIX_DIRECT_RETRY + episodeId).apply()

                val broadcastIntent = Intent(ACTION_DOWNLOAD_COMPLETE).apply {
                    setPackage(context.packageName)
                    putExtra(EXTRA_EPISODE_ID, episodeId)
                    putExtra(EXTRA_SUCCESS, false)
                    putExtra(EXTRA_FAILURE_REASON, failureReason)
                }
                context.sendBroadcast(broadcastIntent)
            }
        }
        cursor.close()
    }

    /**
     * Start downloading an episode.
     * Returns true if download started successfully, false otherwise.
     */
    fun downloadEpisode(
        context: Context,
        episode: Episode,
        podcastTitle: String?,
        isAutoDownload: Boolean = false,
        suppressSuccessNotification: Boolean = false
    ): Boolean {
        if (episode.audioUrl.isBlank()) {
            showToast(context, "Episode audio URL not available")
            return false
        }

        val episodeForDownload = normaliseEpisodeAudioUrl(episode)

        // Check if already downloaded (checks SharedPreferences and the filesystem)
        if (DownloadedEpisodes.isDownloaded(context, episodeForDownload)) {
            showToast(context, "Episode already downloaded")
            return false
        }

        // Guard against reinstall-duplicates: the public file may already exist on disk even
        // though SharedPreferences was wiped.  If so, register it and skip the download.
        val publicFileName = buildDestinationFile(context, episodeForDownload).name
        val publicFile = File(
            File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PODCASTS), "British Radio Player"),
            publicFileName
        )
        if (publicFile.exists() && publicFile.length() > 0) {
            DownloadedEpisodes.addDownloaded(
                context, episode, publicFile.absolutePath, publicFile.length(), podcastTitle, isAutoDownload
            )
            if (isAutoDownload) {
                val limit = DownloadPreferences.getAutoDownloadLimit(context).coerceAtLeast(1)
                pruneDownloadsForPodcastToLimit(context, episode.podcastId, limit)
            } else {
                showToast(context, "Episode already downloaded")
            }
            return false
        }

        // Check WiFi requirement — queue for later if WiFi is unavailable
        if (DownloadPreferences.isDownloadOnWifiOnly(context) && !isWifiConnected(context)) {
            queueForWifiDownload(context, episodeForDownload, podcastTitle, isAutoDownload, suppressSuccessNotification)
            return true
        }

        try {
            val downloadManager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            val destinationFile = buildDestinationFile(context, episodeForDownload)
            val downloadId = enqueueDownload(downloadManager, context, episodeForDownload, podcastTitle, destinationFile)
            
            // Store download ID mapped to episode ID
            prefs(context).edit().putLong(KEY_PREFIX_DOWNLOAD_ID + episode.id, downloadId).apply()
            
            // Store episode info for later retrieval
            val pendingKey = "pending_" + episode.id
            val pendingData = android.util.Base64.encodeToString(
                org.json.JSONObject().apply {
                    put("episode", episodeToJson(episodeForDownload))
                    put("podcastTitle", podcastTitle ?: "")
                    put("localPath", destinationFile.absolutePath)
                    put("autoDownload", isAutoDownload)
                    put("suppressSuccessNotification", suppressSuccessNotification)
                }.toString().toByteArray(),
                android.util.Base64.DEFAULT
            )
            prefs(context).edit().putString(pendingKey, pendingData).apply()

            showToast(context, "Download started")
            return true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start download", e)
            showToast(context, "Failed to start download: ${e.message}")
            return false
        }
    }

    /**
     * Persist an episode to the WiFi download queue and schedule
     * [com.hyliankid14.bbcradioplayer.workers.WifiDownloadWorker] so the
     * download starts automatically once an unmetered (WiFi) connection is
     * available.
     */
    private fun queueForWifiDownload(
        context: Context,
        episode: Episode,
        podcastTitle: String?,
        isAutoDownload: Boolean,
        suppressSuccessNotification: Boolean
    ) {
        val queueKey = KEY_PREFIX_WIFI_QUEUE + episode.id
        val data = android.util.Base64.encodeToString(
            org.json.JSONObject().apply {
                put("episode", episodeToJson(episode))
                put("podcastTitle", podcastTitle ?: "")
                put("autoDownload", isAutoDownload)
                put("suppressSuccessNotification", suppressSuccessNotification)
            }.toString().toByteArray(),
            android.util.Base64.DEFAULT
        )
        prefs(context).edit().putString(queueKey, data).apply()
        showToast(context, "Queued – will download when WiFi is available")
        com.hyliankid14.bbcradioplayer.workers.WifiDownloadWorker.enqueue(context)
    }

    /**
     * Process all episodes queued for WiFi-only download.  Called by
     * [com.hyliankid14.bbcradioplayer.workers.WifiDownloadWorker] once an
     * unmetered network is available.
     */
    fun processWifiQueue(context: Context) {
        val prefs = prefs(context)
        @Suppress("UNCHECKED_CAST")
        val queuedEntries = prefs.all.filter { it.key.startsWith(KEY_PREFIX_WIFI_QUEUE) }
        for ((key, value) in queuedEntries) {
            if (value !is String) continue
            try {
                val jsonStr = String(android.util.Base64.decode(value, android.util.Base64.DEFAULT))
                val json = org.json.JSONObject(jsonStr)
                val episode = jsonToEpisode(json.getJSONObject("episode"))
                val podcastTitle = json.optString("podcastTitle", "").ifBlank { null }
                val isAutoDownload = json.optBoolean("autoDownload", false)
                val suppressSuccessNotification = json.optBoolean("suppressSuccessNotification", false)
                // Remove from queue before starting so a crash doesn't re-queue indefinitely
                prefs.edit().remove(key).apply()
                downloadEpisode(context, episode, podcastTitle, isAutoDownload, suppressSuccessNotification)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to process WiFi-queued download for key $key", e)
            }
        }
    }

    private fun startDirectDownloadForEpisode(
        context: Context,
        episode: Episode,
        podcastTitle: String?,
        isAutoDownload: Boolean
    ): Boolean {
        return try {
            val destinationFile = buildDestinationFile(context, episode)
            val appContext = context.applicationContext
            Thread {
                try {
                    if (destinationFile.exists()) destinationFile.delete()
                    destinationFile.parentFile?.mkdirs()
                    val result = directDownloadWithSchemeFallback(episode.audioUrl, destinationFile)
                    if (result.success && destinationFile.exists()) {
                        DownloadedEpisodes.addDownloaded(
                            appContext,
                            episode,
                            destinationFile.absolutePath,
                            destinationFile.length(),
                            podcastTitle ?: "",
                            isAutoDownload
                        )

                        if (isAutoDownload) {
                            val limit = DownloadPreferences.getAutoDownloadLimit(appContext).coerceAtLeast(1)
                            pruneDownloadsForPodcastToLimit(appContext, episode.podcastId, limit)
                        }

                        prefs(appContext).edit().remove(KEY_PREFIX_DOWNLOAD_ID + episode.id).apply()
                        prefs(appContext).edit().remove(KEY_PREFIX_HTTP_RETRY + episode.id).apply()
                        prefs(appContext).edit().remove(KEY_PREFIX_DIRECT_RETRY + episode.id).apply()
                        prefs(appContext).edit().remove("pending_${episode.id}").apply()

                        val okIntent = Intent(ACTION_DOWNLOAD_COMPLETE).apply {
                            setPackage(appContext.packageName)
                            putExtra(EXTRA_EPISODE_ID, episode.id)
                            putExtra(EXTRA_SUCCESS, true)
                        }
                        appContext.sendBroadcast(okIntent)
                        if (!isAutoDownload) {
                            showSuccessNotification(appContext, episode, podcastTitle)
                        }
                        Log.d(TAG, "Episode downloaded via primary direct path: ${episode.title}")
                    } else {
                        val code = result.httpCode ?: -1
                        if (code == -1 && enqueueDownloadManagerRetry(appContext, episode, podcastTitle, isAutoDownload, destinationFile)) {
                            Log.w(TAG, "Direct path failed without HTTP code, queued DownloadManager fallback for ${episode.id}")
                            return@Thread
                        }
                        val reason = buildFailureReason(code, result.errorMessage)
                        showFailureNotification(appContext, episode.id, if (episode.title.isBlank()) "Episode" else episode.title, reason)
                        val failIntent = Intent(ACTION_DOWNLOAD_COMPLETE).apply {
                            setPackage(appContext.packageName)
                            putExtra(EXTRA_EPISODE_ID, episode.id)
                            putExtra(EXTRA_SUCCESS, false)
                            putExtra(EXTRA_FAILURE_REASON, reason)
                        }
                        appContext.sendBroadcast(failIntent)
                    }
                } catch (e: Exception) {
                    val reason = "Download failed (${e.message ?: "unknown error"})"
                    showFailureNotification(appContext, episode.id, if (episode.title.isBlank()) "Episode" else episode.title, reason)
                    val failIntent = Intent(ACTION_DOWNLOAD_COMPLETE).apply {
                        setPackage(appContext.packageName)
                        putExtra(EXTRA_EPISODE_ID, episode.id)
                        putExtra(EXTRA_SUCCESS, false)
                        putExtra(EXTRA_FAILURE_REASON, reason)
                    }
                    appContext.sendBroadcast(failIntent)
                }
            }.start()
            true
        } catch (e: Exception) {
            Log.w(TAG, "Failed to start primary direct downloader, falling back to DownloadManager", e)
            false
        }
    }

    private fun enqueueDownloadManagerRetry(
        context: Context,
        episode: Episode,
        podcastTitle: String?,
        isAutoDownload: Boolean,
        destinationFile: File
    ): Boolean {
        return try {
            val downloadManager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            val downloadId = enqueueDownload(downloadManager, context, episode, podcastTitle, destinationFile)
            prefs(context).edit().putLong(KEY_PREFIX_DOWNLOAD_ID + episode.id, downloadId).apply()

            val pendingKey = "pending_${episode.id}"
            val pendingData = android.util.Base64.encodeToString(
                org.json.JSONObject().apply {
                    put("episode", episodeToJson(normaliseEpisodeAudioUrl(episode)))
                    put("podcastTitle", podcastTitle ?: "")
                    put("localPath", destinationFile.absolutePath)
                    put("autoDownload", isAutoDownload)
                }.toString().toByteArray(),
                android.util.Base64.DEFAULT
            )
            prefs(context).edit().putString(pendingKey, pendingData).apply()
            true
        } catch (e: Exception) {
            Log.w(TAG, "Failed to queue DownloadManager fallback", e)
            false
        }
    }

    private fun buildDestinationFile(context: Context, episode: Episode): File {
        // On Android 9 and below (API 28-), write directly to the public Podcasts directory.
        // On Android 10+ the DownloadManager handles writing to public storage; use the
        // app-scoped directory only for the direct-download fallback path on those versions.
        val downloadDir = if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PODCASTS), "British Radio Player")
        } else {
            File(context.getExternalFilesDir(Environment.DIRECTORY_PODCASTS), "episodes")
        }
        if (!downloadDir.exists()) {
            downloadDir.mkdirs()
        }
        val safeTitle = sanitizeFilename(episode.title).ifBlank { "episode" }
        val safeEpisodeId = sanitizeFilename(episode.id).ifBlank { episode.id.hashCode().toString() }
        val filename = "${safeTitle.take(70)}_${safeEpisodeId.take(40)}.mp3"
        return File(downloadDir, filename)
    }

    private fun enqueueDownload(
        downloadManager: DownloadManager,
        context: Context,
        episode: Episode,
        podcastTitle: String?,
        destinationFile: File
    ): Long {
        val downloadUrl = normaliseAudioUrl(episode.audioUrl)

        // Store in the public Podcasts directory so the files are accessible to file managers.
        // The DownloadManager system service has permission to write there on all API levels.
        val publicSubPath = "British Radio Player/${destinationFile.name}"
        val request = DownloadManager.Request(Uri.parse(downloadUrl)).apply {
            setTitle("${podcastTitle ?: "Podcast"}: ${episode.title}")
            setDescription("Downloading episode")
            setNotificationVisibility(DownloadManager.Request.VISIBILITY_HIDDEN)
            setDestinationInExternalPublicDir(Environment.DIRECTORY_PODCASTS, publicSubPath)
            setMimeType("audio/mpeg")
            addRequestHeader("User-Agent", "British Radio Player/1.0 (Android)")

            if (!DownloadPreferences.isDownloadOnWifiOnly(context)) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                    setRequiresCharging(false)
                    setRequiresDeviceIdle(false)
                }
            }
        }
        return downloadManager.enqueue(request)
    }

    /**
     * Delete a downloaded episode file and remove from downloaded list.
     */
    fun deleteDownload(context: Context, episodeId: String, showToast: Boolean = true): Boolean {
        val entry = DownloadedEpisodes.removeDownloaded(context, episodeId)
        if (entry != null) {
            try {
                val localRef = entry.localFilePath
                if (localRef.startsWith("content://") || localRef.startsWith("file://")) {
                    try {
                        val uri = Uri.parse(localRef)
                        context.contentResolver.delete(uri, null, null)
                    } catch (_: Exception) { }
                } else {
                    val file = File(localRef)
                    if (file.exists()) {
                        file.delete()
                    }
                }
                context.sendBroadcast(Intent(ACTION_DOWNLOAD_DELETED).apply {
                    setPackage(context.packageName)
                    putExtra(EXTRA_EPISODE_ID, episodeId)
                })
                if (showToast) showToast(context, "Download deleted")
                return true
            } catch (e: Exception) {
                Log.e(TAG, "Failed to delete download", e)
                if (showToast) showToast(context, "Failed to delete download")
            }
        }
        return false
    }

    /**
     * Delete all downloaded episodes.
     */
    fun deleteAllDownloads(context: Context) {
        val entries = DownloadedEpisodes.getDownloadedEntries(context)
        var deletedCount = 0
        
        for (entry in entries) {
            try {
                val file = File(entry.localFilePath)
                if (file.exists() && file.delete()) {
                    deletedCount++
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to delete file: ${entry.localFilePath}", e)
            }
        }
        
        DownloadedEpisodes.removeAll(context)
        showToast(context, "Deleted $deletedCount episode(s)")
    }

    fun pruneDownloadsForPodcastToLimit(context: Context, podcastId: String, limit: Int) {
        if (podcastId.isBlank()) return
        val max = limit.coerceAtLeast(1)
        val entries = DownloadedEpisodes.getDownloadedEpisodesForPodcast(context, podcastId)
        val autoEntries = entries.filter { it.isAutoDownloaded }
        if (autoEntries.size <= max) return
        // For oldest-first podcasts the user works through episodes in ascending date order,
        // so we should retain the oldest auto-downloads (they will be listened to next).
        // For newest-first podcasts we retain the most recently published ones.
        val oldestFirst = PodcastEpisodeSortPreference.isOldestFirst(context, podcastId)
        val sorted = if (oldestFirst) {
            autoEntries.sortedWith(
                compareBy<DownloadedEpisodes.Entry> { EpisodeDateParser.parsePubDateToEpoch(it.pubDate) }
                    .thenBy { it.downloadedAtMs }
            )
        } else {
            autoEntries.sortedWith(
                compareByDescending<DownloadedEpisodes.Entry> { EpisodeDateParser.parsePubDateToEpoch(it.pubDate) }
                    .thenByDescending { it.downloadedAtMs }
            )
        }
        val keepIds = sorted.take(max).map { it.id }.toSet()
        for (entry in autoEntries) {
            if (!keepIds.contains(entry.id)) {
                deleteDownload(context, entry.id, showToast = false)
            }
        }
    }

    /**
     * Check if device is connected to WiFi.
     */
    @Suppress("DEPRECATION")
    private fun isWifiConnected(context: Context): Boolean {
        val connectivityManager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val network = connectivityManager.activeNetwork ?: return false
            val capabilities = connectivityManager.getNetworkCapabilities(network) ?: return false
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
        } else {
            val networkInfo = connectivityManager.activeNetworkInfo
            networkInfo?.isConnected == true && networkInfo.type == ConnectivityManager.TYPE_WIFI
        }
    }

    private fun sanitizeFilename(name: String): String {
        return name.replace(Regex("[^a-zA-Z0-9._-]"), "_").take(100)
    }

    private fun normaliseAudioUrl(url: String): String {
        var normalised = url.trim()
        if (normalised.contains("/proto/http/", ignoreCase = true)) {
            normalised = normalised.replace("/proto/http/", "/proto/https/", ignoreCase = true)
        }
        if (normalised.startsWith("http://", ignoreCase = true)) {
            normalised = normalised.replaceFirst("http://", "https://", ignoreCase = true)
        }
        return normalised
    }

    private fun normaliseEpisodeAudioUrl(episode: Episode): Episode {
        val normalisedUrl = normaliseAudioUrl(episode.audioUrl)
        return if (normalisedUrl == episode.audioUrl) episode else episode.copy(audioUrl = normalisedUrl)
    }

    private fun episodeToJson(episode: Episode): org.json.JSONObject {
        return org.json.JSONObject().apply {
            put("id", episode.id)
            put("title", episode.title)
            put("description", episode.description)
            put("audioUrl", episode.audioUrl)
            put("imageUrl", episode.imageUrl)
            put("pubDate", episode.pubDate)
            put("durationMins", episode.durationMins)
            put("podcastId", episode.podcastId)
        }
    }

    private fun jsonToEpisode(json: org.json.JSONObject): Episode {
        return Episode(
            id = json.getString("id"),
            title = json.optString("title", ""),
            description = json.optString("description", ""),
            audioUrl = json.optString("audioUrl", ""),
            imageUrl = json.optString("imageUrl", ""),
            pubDate = json.optString("pubDate", ""),
            durationMins = json.optInt("durationMins", 0),
            podcastId = json.optString("podcastId", "")
        )
    }

    private fun extractEpisodeTitle(pendingData: String?): String {
        if (pendingData.isNullOrBlank()) return "Episode"
        return try {
            val jsonStr = String(android.util.Base64.decode(pendingData, android.util.Base64.DEFAULT))
            val json = org.json.JSONObject(jsonStr)
            val episode = json.optJSONObject("episode")
            episode?.optString("title", "Episode") ?: "Episode"
        } catch (_: Exception) {
            "Episode"
        }
    }

    private fun buildFailureReason(reason: Int, detail: String? = null): String {
        if (reason in 400..599) return "Server error (HTTP $reason)"
        if (reason == -1 && !detail.isNullOrBlank()) return "Network error: $detail"
        return when (reason) {
            DownloadManager.ERROR_FILE_ERROR -> "File system error whilst saving"
            DownloadManager.ERROR_UNHANDLED_HTTP_CODE -> "Unhandled HTTP response from server"
            DownloadManager.ERROR_HTTP_DATA_ERROR -> "Network data error during download"
            DownloadManager.ERROR_TOO_MANY_REDIRECTS -> "Too many redirects from server"
            DownloadManager.ERROR_INSUFFICIENT_SPACE -> "Insufficient device storage"
            DownloadManager.ERROR_DEVICE_NOT_FOUND -> "Download storage location unavailable"
            DownloadManager.ERROR_CANNOT_RESUME -> "Download interrupted and cannot resume"
            DownloadManager.ERROR_UNKNOWN -> "Unknown download error"
            else -> "Download failed (code $reason)"
        }
    }

    private fun tryHttpFallbackRetry(context: Context, episodeId: String, pendingData: String?, reason: Int): Boolean {
        if (reason !in 400..499) return false
        if (pendingData.isNullOrBlank()) return false

        val prefs = prefs(context)
        val retryKey = KEY_PREFIX_HTTP_RETRY + episodeId
        if (prefs.getBoolean(retryKey, false)) return false

        return try {
            val jsonStr = String(android.util.Base64.decode(pendingData, android.util.Base64.DEFAULT))
            val json = org.json.JSONObject(jsonStr)
            val episodeJson = json.getJSONObject("episode")
            val episode = jsonToEpisode(episodeJson)

            val preferredEpisode = normaliseEpisodeAudioUrl(episode)
            val fallbackEpisode = when {
                preferredEpisode.audioUrl != episode.audioUrl -> preferredEpisode
                preferredEpisode.audioUrl.startsWith("https://", ignoreCase = true) -> {
                    preferredEpisode.copy(
                        audioUrl = preferredEpisode.audioUrl
                            .replace("/proto/https/", "/proto/http/", ignoreCase = true)
                            .replaceFirst("https://", "http://", ignoreCase = true)
                    )
                }
                else -> return false
            }
            val podcastTitle = json.optString("podcastTitle", "")
            val autoDownload = json.optBoolean("autoDownload", false)
            val suppressSuccessNotification = json.optBoolean("suppressSuccessNotification", false)

            val pendingPath = json.optString("localPath", "")
            val destinationFile = if (pendingPath.isNotBlank()) File(pendingPath) else buildDestinationFile(context, fallbackEpisode)
            if (destinationFile.exists()) {
                destinationFile.delete()
            }

            val downloadManager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            val newDownloadId = enqueueDownload(downloadManager, context, fallbackEpisode, podcastTitle, destinationFile)

            prefs.edit().putLong(KEY_PREFIX_DOWNLOAD_ID + episodeId, newDownloadId).apply()
            prefs.edit().putBoolean(retryKey, true).apply()

            val updatedPendingData = android.util.Base64.encodeToString(
                org.json.JSONObject().apply {
                    put("episode", episodeToJson(fallbackEpisode))
                    put("podcastTitle", podcastTitle)
                    put("localPath", destinationFile.absolutePath)
                    put("autoDownload", autoDownload)
                    put("suppressSuccessNotification", suppressSuccessNotification)
                }.toString().toByteArray(),
                android.util.Base64.DEFAULT
            )
            prefs.edit().putString("pending_$episodeId", updatedPendingData).apply()
            true
        } catch (e: Exception) {
            Log.w(TAG, "HTTP fallback retry failed", e)
            false
        }
    }

    private fun shouldAttemptDirectFallback(reason: Int): Boolean {
        if (reason in 300..599) return true
        return when (reason) {
            DownloadManager.ERROR_CANNOT_RESUME,
            DownloadManager.ERROR_HTTP_DATA_ERROR,
            DownloadManager.ERROR_UNHANDLED_HTTP_CODE,
            DownloadManager.ERROR_TOO_MANY_REDIRECTS -> true
            else -> false
        }
    }

    private data class DirectDownloadResult(
        val success: Boolean,
        val httpCode: Int? = null,
        val errorMessage: String? = null
    )

    private fun tryDirectDownloadFallback(context: Context, episodeId: String, pendingData: String?, reason: Int): Boolean {
        if (!shouldAttemptDirectFallback(reason)) return false
        if (pendingData.isNullOrBlank()) return false

        val prefs = prefs(context)
        val retryKey = KEY_PREFIX_DIRECT_RETRY + episodeId
        if (prefs.getBoolean(retryKey, false)) return false

        return try {
            val jsonStr = String(android.util.Base64.decode(pendingData, android.util.Base64.DEFAULT))
            val json = org.json.JSONObject(jsonStr)
            val episode = jsonToEpisode(json.getJSONObject("episode"))
            val podcastTitle = json.optString("podcastTitle", "")
            val autoDownload = json.optBoolean("autoDownload", false)
            val pendingPath = json.optString("localPath", "")
            val destinationFile = if (pendingPath.isNotBlank()) File(pendingPath) else buildDestinationFile(context, episode)

            prefs.edit().putBoolean(retryKey, true).apply()

            Thread {
                val appContext = context.applicationContext
                try {
                    if (destinationFile.exists()) destinationFile.delete()
                    destinationFile.parentFile?.mkdirs()

                    val result = directDownloadWithSchemeFallback(episode.audioUrl, destinationFile)
                    if (result.success && destinationFile.exists()) {
                        val size = destinationFile.length()
                        DownloadedEpisodes.addDownloaded(
                            appContext,
                            episode,
                            destinationFile.absolutePath,
                            size,
                            podcastTitle,
                            autoDownload
                        )

                        if (autoDownload) {
                            val limit = DownloadPreferences.getAutoDownloadLimit(appContext).coerceAtLeast(1)
                            pruneDownloadsForPodcastToLimit(appContext, episode.podcastId, limit)
                        }

                        prefs(appContext).edit().remove("pending_$episodeId").apply()
                        prefs(appContext).edit().remove(KEY_PREFIX_DOWNLOAD_ID + episodeId).apply()
                        prefs(appContext).edit().remove(KEY_PREFIX_HTTP_RETRY + episodeId).apply()
                        prefs(appContext).edit().remove(KEY_PREFIX_DIRECT_RETRY + episodeId).apply()

                        val okIntent = Intent(ACTION_DOWNLOAD_COMPLETE).apply {
                            setPackage(appContext.packageName)
                            putExtra(EXTRA_EPISODE_ID, episodeId)
                            putExtra(EXTRA_SUCCESS, true)
                        }
                        appContext.sendBroadcast(okIntent)
                        Log.d(TAG, "Episode downloaded via direct fallback: ${episode.title}")
                    } else {
                        val code = result.httpCode ?: reason
                        val failureReason = buildFailureReason(code, result.errorMessage)
                        val title = if (episode.title.isBlank()) "Episode" else episode.title

                        prefs(appContext).edit().remove("pending_$episodeId").apply()
                        prefs(appContext).edit().remove(KEY_PREFIX_DOWNLOAD_ID + episodeId).apply()
                        prefs(appContext).edit().remove(KEY_PREFIX_DIRECT_RETRY + episodeId).apply()

                        showFailureNotification(appContext, episodeId, title, failureReason)
                        val failIntent = Intent(ACTION_DOWNLOAD_COMPLETE).apply {
                            setPackage(appContext.packageName)
                            putExtra(EXTRA_EPISODE_ID, episodeId)
                            putExtra(EXTRA_SUCCESS, false)
                            putExtra(EXTRA_FAILURE_REASON, failureReason)
                        }
                        appContext.sendBroadcast(failIntent)
                        Log.e(TAG, "Direct fallback failed for episode $episodeId, code: $code")
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Direct fallback crashed for episode $episodeId", e)
                    val failureReason = "Download failed (${e.message ?: "unknown error"})"
                    prefs(appContext).edit().remove("pending_$episodeId").apply()
                    prefs(appContext).edit().remove(KEY_PREFIX_DOWNLOAD_ID + episodeId).apply()
                    prefs(appContext).edit().remove(KEY_PREFIX_DIRECT_RETRY + episodeId).apply()
                    showFailureNotification(appContext, episodeId, extractEpisodeTitle(pendingData), failureReason)
                    val failIntent = Intent(ACTION_DOWNLOAD_COMPLETE).apply {
                        setPackage(appContext.packageName)
                        putExtra(EXTRA_EPISODE_ID, episodeId)
                        putExtra(EXTRA_SUCCESS, false)
                        putExtra(EXTRA_FAILURE_REASON, failureReason)
                    }
                    appContext.sendBroadcast(failIntent)
                }
            }.start()

            true
        } catch (e: Exception) {
            Log.w(TAG, "Failed to start direct fallback", e)
            false
        }
    }

    private fun directDownloadWithSchemeFallback(url: String, destinationFile: File): DirectDownloadResult {
        val preferredUrl = normaliseAudioUrl(url)
        val candidates = when {
            preferredUrl.startsWith("https://", ignoreCase = true) -> listOf(
                preferredUrl,
                preferredUrl.replace("/proto/https/", "/proto/http/", ignoreCase = true),
                preferredUrl
                    .replace("/proto/https/", "/proto/http/", ignoreCase = true)
                    .replaceFirst("https://", "http://", ignoreCase = true)
            )
            preferredUrl.startsWith("http://", ignoreCase = true) -> listOf(
                preferredUrl.replaceFirst("http://", "https://", ignoreCase = true),
                preferredUrl
            )
            else -> listOf(preferredUrl)
        }
        var lastCode: Int? = null
        var lastError: String? = null
        for (candidate in candidates.distinct()) {
            val result = performDirectDownload(candidate, destinationFile)
            if (result.success) return result
            lastCode = result.httpCode ?: lastCode
            lastError = result.errorMessage ?: lastError
        }
        return DirectDownloadResult(success = false, httpCode = lastCode, errorMessage = lastError)
    }

    private fun performDirectDownload(url: String, destinationFile: File): DirectDownloadResult {
        val headerCombos = listOf(
            emptyMap<String, String>(),
            mapOf("User-Agent" to "British Radio Player/1.0 (Android)"),
            mapOf("User-Agent" to "British Radio Player/1.0 (Android)", "Accept" to "*/*")
        )
        for (headers in headerCombos) {
            val result = directDownloadWithHeaders(url, destinationFile, headers)
            if (result.success) return result
            if (result.httpCode in 400..599) {
                continue
            }
            if (!result.success) return result
        }
        return DirectDownloadResult(success = false, httpCode = null, errorMessage = "Failed all header variations")
    }

    private fun directDownloadWithHeaders(startUrl: String, destinationFile: File, headers: Map<String, String>): DirectDownloadResult {
        var currentUrl = startUrl
        val originalHost = try { URL(startUrl).host.lowercase() } catch (_: Exception) { "" }
        var redirects = 0
        var lastCode: Int? = null

        while (redirects <= 8) {
            val connection = (URL(currentUrl).openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = false
                connectTimeout = 20000
                readTimeout = 30000
                requestMethod = "GET"
                for ((key, value) in headers) {
                    setRequestProperty(key, value)
                }
                doInput = true
            }

            try {
                val code = connection.responseCode
                lastCode = code
                if (code in 200..299) {
                    connection.inputStream.use { input ->
                        FileOutputStream(destinationFile, false).use { output ->
                            input.copyTo(output)
                        }
                    }
                    return DirectDownloadResult(success = true, httpCode = code)
                }

                if (code in 300..399) {
                    val location = connection.getHeaderField("Location") ?: return DirectDownloadResult(success = false, httpCode = code, errorMessage = "Redirect without Location header")
                    val redirectedUrl = URL(URL(currentUrl), location)
                    val redirectedHost = redirectedUrl.host.lowercase()
                    if (redirectedHost != originalHost && isLikelyLocalNetworkHost(redirectedHost)) {
                        return DirectDownloadResult(
                            success = false,
                            httpCode = code,
                            errorMessage = "Redirected to local network host"
                        )
                    }
                    currentUrl = redirectedUrl.toString()
                    redirects++
                    continue
                }

                return DirectDownloadResult(success = false, httpCode = code, errorMessage = "HTTP $code")
            } catch (e: Exception) {
                return DirectDownloadResult(
                    success = false,
                    httpCode = lastCode,
                    errorMessage = "${e.javaClass.simpleName}: ${e.message ?: "connection failure"}"
                )
            } finally {
                connection.disconnect()
            }
        }

        return DirectDownloadResult(success = false, httpCode = lastCode, errorMessage = "Too many redirects")
    }

    private fun isLikelyLocalNetworkHost(host: String): Boolean {
        if (host.isBlank()) return false
        if (host == "localhost" || host == "127.0.0.1") return true
        if (host.endsWith(".local") || host.endsWith(".lan") || host.endsWith(".home")) return true
        if (host.contains("router") || host.contains("gateway") || host.contains("myrouter")) return true

        if (Regex("^10\\.\\d+\\.\\d+\\.\\d+$").matches(host)) return true
        if (Regex("^192\\.168\\.\\d+\\.\\d+$").matches(host)) return true
        if (Regex("^172\\.(1[6-9]|2\\d|3[0-1])\\.\\d+\\.\\d+$").matches(host)) return true

        return false
    }

    private fun ensureSuccessChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val existing = manager.getNotificationChannel(DOWNLOAD_SUCCESS_CHANNEL_ID)
        if (existing != null) return
        val channel = NotificationChannel(
            DOWNLOAD_SUCCESS_CHANNEL_ID,
            "Episode downloads",
            NotificationManager.IMPORTANCE_DEFAULT
        )
        manager.createNotificationChannel(channel)
    }

    private fun showSuccessNotification(
        context: Context,
        episode: Episode,
        podcastTitle: String?
    ) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                val granted = ContextCompat.checkSelfPermission(
                    context,
                    android.Manifest.permission.POST_NOTIFICATIONS
                ) == android.content.pm.PackageManager.PERMISSION_GRANTED
                if (!granted) return
            }

            ensureSuccessChannel(context)
            val manager = NotificationManagerCompat.from(context)
            if (!manager.areNotificationsEnabled()) return

            val openEpisodeIntent = Intent(context, NowPlayingActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                putExtra("preview_episode", episode)
                putExtra("preview_use_play_ui", true)
                if (!podcastTitle.isNullOrBlank()) putExtra("preview_podcast_title", podcastTitle)
            }
            val contentIntent = PendingIntent.getActivity(
                context,
                "success_${episode.id}".hashCode(),
                openEpisodeIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val playEpisodePendingIntent = PendingIntent.getActivity(
                context,
                "play_episode_${episode.id}".hashCode(),
                openEpisodeIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val contentText = if (!podcastTitle.isNullOrBlank()) podcastTitle else episode.title
            val builder = NotificationCompat.Builder(context, DOWNLOAD_SUCCESS_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setContentTitle("Episode downloaded")
                .setContentText(contentText)
                .setStyle(NotificationCompat.BigTextStyle().bigText(episode.title))
                .setAutoCancel(true)
                .setContentIntent(contentIntent)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .addAction(
                    android.R.drawable.ic_media_play,
                    "Play episode",
                    playEpisodePendingIntent
                )

            manager.notify("success_${episode.id}".hashCode(), builder.build())
        } catch (e: Exception) {
            Log.w(TAG, "Failed to show download success notification", e)
        }
    }

    private fun ensureFailureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val existing = manager.getNotificationChannel(DOWNLOAD_FAILURE_CHANNEL_ID)
        if (existing != null) return
        val channel = NotificationChannel(
            DOWNLOAD_FAILURE_CHANNEL_ID,
            "Episode download failures",
            NotificationManager.IMPORTANCE_DEFAULT
        )
        manager.createNotificationChannel(channel)
    }

    private fun ensureBulkChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val existing = manager.getNotificationChannel(DOWNLOAD_BULK_CHANNEL_ID)
        if (existing != null) return
        val channel = NotificationChannel(
            DOWNLOAD_BULK_CHANNEL_ID,
            "Bulk episode downloads",
            NotificationManager.IMPORTANCE_DEFAULT
        )
        manager.createNotificationChannel(channel)
    }

    fun showBulkDownloadQueuedNotification(context: Context, queuedCount: Int, scopeLabel: String) {
        if (queuedCount <= 0) return
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                val granted = ContextCompat.checkSelfPermission(
                    context,
                    android.Manifest.permission.POST_NOTIFICATIONS
                ) == android.content.pm.PackageManager.PERMISSION_GRANTED
                if (!granted) return
            }

            ensureBulkChannel(context)
            val manager = NotificationManagerCompat.from(context)
            if (!manager.areNotificationsEnabled()) return

            val text = "$queuedCount episode(s) queued for $scopeLabel"
            val notification = NotificationCompat.Builder(context, DOWNLOAD_BULK_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_sys_download)
                .setContentTitle("Bulk download started")
                .setContentText(text)
                .setStyle(NotificationCompat.BigTextStyle().bigText(text))
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .build()

            manager.notify((System.currentTimeMillis() % Int.MAX_VALUE).toInt(), notification)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to show bulk download notification", e)
        }
    }

    private fun showFailureNotification(context: Context, episodeId: String, episodeTitle: String, reason: String) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                val granted = ContextCompat.checkSelfPermission(
                    context,
                    android.Manifest.permission.POST_NOTIFICATIONS
                ) == android.content.pm.PackageManager.PERMISSION_GRANTED
                if (!granted) return
            }

            ensureFailureChannel(context)
            val manager = NotificationManagerCompat.from(context)
            if (!manager.areNotificationsEnabled()) return

            val openAppIntent = Intent(context, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            }
            val pendingIntent = PendingIntent.getActivity(
                context,
                episodeId.hashCode(),
                openAppIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val notification = NotificationCompat.Builder(context, DOWNLOAD_FAILURE_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_notify_error)
                .setContentTitle("Episode download failed")
                .setContentText(reason)
                .setStyle(NotificationCompat.BigTextStyle().bigText("$episodeTitle\n$reason"))
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .build()

            manager.notify(episodeId.hashCode(), notification)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to show download failure notification", e)
        }
    }

    /**
     * BroadcastReceiver to handle download completion.
     * Register this in your Activity/Service to track download completion.
     */
    class DownloadCompleteReceiver : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            handleSystemDownloadComplete(context, intent)
        }
    }
}
