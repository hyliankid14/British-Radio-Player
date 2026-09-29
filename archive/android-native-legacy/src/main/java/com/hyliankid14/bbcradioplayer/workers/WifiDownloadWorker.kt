package com.hyliankid14.bbcradioplayer.workers

import android.content.Context
import android.util.Log
import androidx.work.*
import com.hyliankid14.bbcradioplayer.EpisodeDownloadManager

/**
 * Background worker that runs WiFi-queued episode downloads once an unmetered
 * (WiFi) connection is available.  WorkManager re-schedules this automatically
 * until the constraint is met, so episodes are downloaded as soon as WiFi
 * becomes available even if the user exits the app.
 */
class WifiDownloadWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    companion object {
        private const val TAG = "WifiDownloadWorker"
        const val WORK_NAME = "wifi_download_queue"

        /**
         * Enqueue the worker if it is not already scheduled.  Calling this
         * multiple times is safe — the [ExistingWorkPolicy.KEEP] policy means
         * only one instance runs at a time.
         */
        fun enqueue(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.UNMETERED)
                .build()

            val workRequest = OneTimeWorkRequestBuilder<WifiDownloadWorker>()
                .setConstraints(constraints)
                .addTag(WORK_NAME)
                .build()

            WorkManager.getInstance(context).enqueueUniqueWork(
                WORK_NAME,
                ExistingWorkPolicy.KEEP,
                workRequest
            )
        }
    }

    override suspend fun doWork(): Result {
        return try {
            Log.d(TAG, "Processing WiFi-queued downloads")
            EpisodeDownloadManager.processWifiQueue(applicationContext)
            Result.success()
        } catch (e: Exception) {
            Log.e(TAG, "WiFi download worker failed", e)
            Result.retry()
        }
    }
}
