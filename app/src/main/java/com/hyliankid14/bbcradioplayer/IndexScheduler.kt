package com.hyliankid14.bbcradioplayer

import android.content.Context
import androidx.work.ExistingPeriodicWorkPolicy

/**
 * Scheduler for periodic podcast indexing using WorkManager.
 * This ensures indexing can run in the background even when the app is closed.
 */
object IndexScheduler {
    
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

        IndexPreference.setLastScheduledDays(context, days)
    }

    fun cancel(context: Context) {
        // Cancel both periodic and one-time work
        com.hyliankid14.bbcradioplayer.workers.BackgroundIndexWorker.cancelAll(context)
    }
}

