package com.hyliankid14.bbcradioplayer

import android.content.Context
import android.util.Log
import androidx.work.ExistingPeriodicWorkPolicy

/**
 * Scheduler for periodic podcast indexing using WorkManager.
 * This ensures indexing can run in the background even when the app is closed.
 */
object IndexScheduler {
    private const val TAG = "IndexScheduler"
    
    fun scheduleIndexing(context: Context) {
        val days = IndexPreference.getIntervalDays(context)
        if (days <= 0) {
            cancel(context)
            IndexPreference.setLastScheduledDays(context, 0)
            return
        }

        // Always use UPDATE policy to ensure constraints are applied correctly.
        // This is important when internal scheduling logic changes (e.g., constraint modifications).
        // WorkManager is smart about not re-running work that hasn't expired, so this is safe.
        val policy = ExistingPeriodicWorkPolicy.UPDATE

        // Use WorkManager for reliable background scheduling
        com.hyliankid14.bbcradioplayer.workers.BackgroundIndexWorker.schedulePeriodicIndexing(
            context,
            days,
            policy
        )

        maybeEnqueueCatchUpIndexing(context, days)

        IndexPreference.setLastScheduledDays(context, days)
    }

    private fun maybeEnqueueCatchUpIndexing(context: Context, intervalDays: Int) {
        val lastReindex = try {
            com.hyliankid14.bbcradioplayer.db.IndexStore.getInstance(context).getLastReindexTime()
        } catch (_: Exception) {
            null
        }

        // First-time users or users without a known timestamp do not need catch-up logic.
        val lastRunTime = lastReindex ?: return

        val intervalMillis = intervalDays * 24L * 60L * 60L * 1000L
        val elapsed = System.currentTimeMillis() - lastRunTime
        if (elapsed >= intervalMillis) {
            com.hyliankid14.bbcradioplayer.workers.BackgroundIndexWorker.enqueueIndexing(
                context,
                fullReindex = false
            )
            Log.d(TAG, "Enqueued catch-up indexing (overdue by ${elapsed - intervalMillis} ms)")
        }
    }

    fun cancel(context: Context) {
        // Cancel both periodic and one-time work
        com.hyliankid14.bbcradioplayer.workers.BackgroundIndexWorker.cancelAll(context)
    }
}

