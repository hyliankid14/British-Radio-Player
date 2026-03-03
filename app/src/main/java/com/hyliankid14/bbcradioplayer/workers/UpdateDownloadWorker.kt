package com.hyliankid14.bbcradioplayer.workers

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.work.CoroutineWorker
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.Constraints
import androidx.work.NetworkType
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Background worker that downloads APK updates from GitHub releases.
 * Shows a notification with an install action when the download completes.
 */
class UpdateDownloadWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    companion object {
        private const val TAG = "UpdateDownloadWorker"
        private const val NOTIFICATION_CHANNEL_ID = "update_channel"
        private const val NOTIFICATION_ID = 2001
        const val WORK_NAME = "app_update_download"
        const val INPUT_DOWNLOAD_URL = "download_url"
        const val INPUT_VERSION_NAME = "version_name"

        fun enqueueDownload(context: Context, downloadUrl: String, versionName: String) {
            val inputData = workDataOf(
                INPUT_DOWNLOAD_URL to downloadUrl,
                INPUT_VERSION_NAME to versionName
            )

            val workRequest = OneTimeWorkRequestBuilder<UpdateDownloadWorker>()
                .setInputData(inputData)
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .addTag(WORK_NAME)
                .build()

            WorkManager.getInstance(context).enqueueUniqueWork(
                WORK_NAME,
                androidx.work.ExistingWorkPolicy.REPLACE,
                workRequest
            )
        }
    }

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        try {
            val downloadUrl = inputData.getString(INPUT_DOWNLOAD_URL) ?: return@withContext Result.retry()
            val versionName = inputData.getString(INPUT_VERSION_NAME) ?: "Unknown"

            Log.d(TAG, "Starting download from: $downloadUrl")

            // Create notification channel (Android 8+)
            createNotificationChannel()

            // Perform the download
            val apkFile = downloadApk(downloadUrl) ?: return@withContext Result.retry()
            
            Log.d(TAG, "Download completed: ${apkFile.absolutePath}")

            // Show notification with install action
            showDownloadCompleteNotification(apkFile, versionName)

            Result.success()
        } catch (e: Exception) {
            Log.w(TAG, "Download failed", e)
            Result.retry()
        }
    }

    private fun downloadApk(downloadUrl: String): File? {
        return try {
            val connection = (URL(downloadUrl).openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = true
                connectTimeout = 15000
                readTimeout = 15000
                requestMethod = "GET"
                setRequestProperty("User-Agent", "BBC Radio Player/1.0 (Android)")
            }

            if (connection.responseCode == HttpURLConnection.HTTP_OK) {
                val outputFile = File(
                    applicationContext.getExternalFilesDir(null),
                    "bbc-radio-player-update.apk"
                )

                connection.inputStream.use { input ->
                    outputFile.outputStream().use { output ->
                        val buffer = ByteArray(8192)
                        var bytesRead: Int
                        while (input.read(buffer).also { bytesRead = it } != -1) {
                            output.write(buffer, 0, bytesRead)
                        }
                    }
                }

                Log.d(TAG, "APK downloaded: ${outputFile.absolutePath}")
                outputFile
            } else {
                Log.w(TAG, "Download failed with code: ${connection.responseCode}")
                null
            }
        } catch (e: Exception) {
            Log.w(TAG, "Exception during download", e)
            null
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                "App Updates",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Notifications for app updates"
            }
            val notificationManager = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }

    private fun showDownloadCompleteNotification(apkFile: File, versionName: String) {
        val notificationManager = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        // Intent to install the APK using FileProvider
        val apkUri = androidx.core.content.FileProvider.getUriForFile(
            applicationContext,
            "${applicationContext.packageName}.fileprovider",
            apkFile
        )

        val installIntent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(apkUri, "application/vnd.android.package-archive")
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION
        }

        val installPendingIntent = PendingIntent.getActivity(
            applicationContext,
            0,
            installIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(applicationContext, NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("BBC Radio Player Update Ready")
            .setContentText("Version $versionName is ready to install")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .addAction(
                android.R.drawable.ic_menu_view,
                "Install",
                installPendingIntent
            )
            .build()

        notificationManager.notify(NOTIFICATION_ID, notification)
    }
}
