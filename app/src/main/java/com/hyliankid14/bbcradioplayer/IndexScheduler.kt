package com.hyliankid14.bbcradioplayer

import android.content.Context
import android.util.Log

/**
 * Periodic local indexing is disabled.
 *
 * Search now relies on the cloud index, so local WorkManager scheduling is
 * intentionally kept off.
 */
object IndexScheduler {
    private const val TAG = "IndexScheduler"
    
    fun scheduleIndexing(context: Context) {
        val days = IndexPreference.getIntervalDays(context)
        if (days > 0) {
            Log.i(TAG, "Periodic local indexing is disabled; clearing saved schedule ($days days)")
            IndexPreference.setIntervalDays(context, 0)
        }
        cancel(context)
        IndexPreference.setLastScheduledDays(context, 0)
    }

    fun cancel(context: Context) {
        // Cancel both periodic and one-time work
        com.hyliankid14.bbcradioplayer.workers.BackgroundIndexWorker.cancelAll(context)
    }
}

