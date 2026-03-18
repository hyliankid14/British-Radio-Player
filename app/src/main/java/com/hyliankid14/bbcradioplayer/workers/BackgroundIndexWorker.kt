package com.hyliankid14.bbcradioplayer.workers

import android.content.Context
import android.util.Log
import androidx.work.*
import com.hyliankid14.bbcradioplayer.SavedSearchManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.Calendar
import java.util.concurrent.TimeUnit

/**
 * Background worker that runs indexing tasks via WorkManager.
 */
class BackgroundIndexWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    companion object {
        private const val TAG = "BackgroundIndexWorker"
        const val WORK_NAME = "podcast_indexing"
        const val WORK_NAME_SCHEDULED = "podcast_indexing_scheduled"
        const val INPUT_MODE = "mode"
        const val MODE_FULL = "full"
        const val MODE_INCREMENTAL = "incremental"
        const val KEY_STATUS = "status"
        const val KEY_PERCENT = "percent"
        private const val TARGET_HOUR_LOCAL = 5
        private const val TARGET_MINUTE_LOCAL = 0

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
            val initialDelayMs = computeInitialDelayToNextTargetWindow()
            val workRequest = PeriodicWorkRequestBuilder<BackgroundIndexWorker>(
                intervalDays.toLong(),
                TimeUnit.DAYS
            )
                .setInputData(inputData)
                .setInitialDelay(initialDelayMs, TimeUnit.MILLISECONDS)
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

            Log.d(TAG, "Scheduled periodic indexing every $intervalDays days (next run in ${initialDelayMs / 60000} minutes)")
        }

        /**
         * Align periodic indexing with the next local 05:00 run window.
         * If current time is already past 05:00, schedule for tomorrow.
         */
        private fun computeInitialDelayToNextTargetWindow(nowMs: Long = System.currentTimeMillis()): Long {
            val now = Calendar.getInstance().apply { timeInMillis = nowMs }
            val target = Calendar.getInstance().apply {
                timeInMillis = nowMs
                set(Calendar.HOUR_OF_DAY, TARGET_HOUR_LOCAL)
                set(Calendar.MINUTE, TARGET_MINUTE_LOCAL)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
                if (!after(now)) {
                    add(Calendar.DAY_OF_YEAR, 1)
                }
            }
            return (target.timeInMillis - nowMs).coerceAtLeast(0L)
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
            val mode = inputData.getString(INPUT_MODE) ?: MODE_FULL
            val isFullReindex = mode == MODE_FULL

            Log.d(TAG, "Running indexing (mode=$mode)")

            val onProgress: (String, Int, Boolean) -> Unit = { status, percent, _ ->
                // Emit progress data so UI observers can show live status
                setProgressAsync(workDataOf(KEY_STATUS to status, KEY_PERCENT to percent))
            }

            if (isFullReindex) {
                // Full reindex
                IndexWorker.reindexAll(applicationContext) { status, percent, isEpisodePhase ->
                    onProgress(status, percent, isEpisodePhase)
                }
            } else {
                // Incremental indexing
                IndexWorker.reindexNewOnly(applicationContext) { status, percent, isEpisodePhase ->
                    onProgress(status, percent, isEpisodePhase)
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
}
