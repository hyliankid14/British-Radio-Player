package com.hyliankid14.bbcradioplayer.workers

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.work.*
import com.hyliankid14.bbcradioplayer.R
import com.hyliankid14.bbcradioplayer.SavedSearchManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Background worker that runs indexing as a foreground service with a notification.
 * This allows indexing to continue even when the app is not in the foreground or is closed.
 */
class BackgroundIndexWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    companion object {
        private const val TAG = "BackgroundIndexWorker"
        private const val NOTIFICATION_CHANNEL_ID = "indexing_channel"
        private const val NOTIFICATION_ID = 1001
        const val WORK_NAME = "podcast_indexing"
        const val WORK_NAME_SCHEDULED = "podcast_indexing_scheduled"
        const val INPUT_MODE = "mode"
        const val MODE_FULL = "full"
        const val MODE_INCREMENTAL = "incremental"

        /**
         * Enqueue a one-time indexing work request that runs in the background
         */
        fun enqueueIndexing(context: Context, fullReindex: Boolean = true) {
            val mode = if (fullReindex) MODE_FULL else MODE_INCREMENTAL
            val inputData = workDataOf(INPUT_MODE to mode)
            val wifiOnly = com.hyliankid14.bbcradioplayer.IndexPreference.getWifiOnly(context)
            val networkType = if (wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED

            val workRequest = OneTimeWorkRequestBuilder<BackgroundIndexWorker>()
                .setInputData(inputData)
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(networkType)
                        .build()
                )
                .addTag(WORK_NAME)
                .setBackoffCriteria(
                    BackoffPolicy.EXPONENTIAL,
                    30,
                    java.util.concurrent.TimeUnit.SECONDS
                )
                .build()

            WorkManager.getInstance(context).enqueueUniqueWork(
                WORK_NAME,
                ExistingWorkPolicy.KEEP,
                workRequest
            )

            Log.d(TAG, "Enqueued indexing work (mode=$mode)")
        }

        /**
         * Schedule periodic indexing in the background
         */
        fun schedulePeriodicIndexing(
            context: Context,
            intervalDays: Int,
            policy: ExistingPeriodicWorkPolicy = ExistingPeriodicWorkPolicy.KEEP
        ) {
            if (intervalDays <= 0) {
                cancelPeriodicIndexing(context)
                return
            }

            val wifiOnly = com.hyliankid14.bbcradioplayer.IndexPreference.getWifiOnly(context)
            val networkType = if (wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED
            val inputData = workDataOf(INPUT_MODE to MODE_INCREMENTAL)
            val workRequest = PeriodicWorkRequestBuilder<BackgroundIndexWorker>(
                intervalDays.toLong(),
                java.util.concurrent.TimeUnit.DAYS
            )
                .setInputData(inputData)
                .setInitialDelay(15, java.util.concurrent.TimeUnit.MINUTES)
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(networkType)
                        .build()
                )
                .addTag(WORK_NAME_SCHEDULED)
                .build()

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME_SCHEDULED,
                policy,
                workRequest
            )

            Log.d(TAG, "Scheduled periodic indexing every $intervalDays days")
        }

        /**
         * Cancel periodic indexing
         */
        fun cancelPeriodicIndexing(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME_SCHEDULED)
            Log.d(TAG, "Cancelled periodic indexing")
        }

        /**
         * Cancel all indexing work
         */
        fun cancelAll(context: Context) {
            WorkManager.getInstance(context).cancelAllWorkByTag(WORK_NAME)
            WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME_SCHEDULED)
            Log.d(TAG, "Cancelled all indexing work")
        }

        /**
         * Cancel only one-time indexing work and keep periodic schedule intact.
         */
        fun cancelOneTimeIndexing(context: Context) {
            WorkManager.getInstance(context).cancelAllWorkByTag(WORK_NAME)
            Log.d(TAG, "Cancelled one-time indexing work")
        }
    }

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        Log.d(TAG, "Starting background indexing work")

        try {
            // Create notification channel if needed
            createNotificationChannel()

            // Set foreground with notification
            setForeground(createForegroundInfo("Initializing indexing..."))

            val mode = inputData.getString(INPUT_MODE) ?: MODE_FULL
            val isFullReindex = mode == MODE_FULL

            Log.d(TAG, "Running indexing (mode=$mode)")

            if (isFullReindex) {
                // Full reindex
                IndexWorker.reindexAll(applicationContext) { status, percent, _ ->
                    // Update notification with progress
                    val notification = createForegroundInfo(status, percent)
                    try {
                        setForegroundAsync(notification)
                    } catch (e: Exception) {
                        Log.w(TAG, "Failed to update foreground notification: ${e.message}")
                    }
                }
            } else {
                // Incremental indexing
                IndexWorker.reindexNewOnly(applicationContext) { status, percent, _ ->
                    // Update notification with progress
                    val notification = createForegroundInfo(status, percent)
                    try {
                        setForegroundAsync(notification)
                    } catch (e: Exception) {
                        Log.w(TAG, "Failed to update foreground notification: ${e.message}")
                    }
                }
            }

            try {
                SavedSearchManager.checkForUpdates(applicationContext)
            } catch (_: Exception) { }

            Log.d(TAG, "Indexing completed successfully")
            Result.success()

        } catch (e: Exception) {
            Log.e(TAG, "Indexing failed: ${e.message}", e)
            Result.failure()
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                "Podcast Indexing",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows progress of podcast indexing"
            }

            val notificationManager = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }

    private fun createForegroundInfo(status: String, percent: Int = -1): ForegroundInfo {
        val notification = NotificationCompat.Builder(applicationContext, NOTIFICATION_CHANNEL_ID)
            .setContentTitle("Indexing Podcasts")
            .setContentText(status)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)
            .apply {
                if (percent >= 0) {
                    setProgress(100, percent, false)
                } else {
                    setProgress(100, 0, true)
                }
            }
            .build()

        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ForegroundInfo(NOTIFICATION_ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            ForegroundInfo(NOTIFICATION_ID, notification)
        }
    }
}
