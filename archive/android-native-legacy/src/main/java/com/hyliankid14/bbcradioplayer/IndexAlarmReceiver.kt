package com.hyliankid14.bbcradioplayer

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class IndexAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        // Defensive: ensure the preference still requests scheduling
        val days = IndexPreference.getIntervalDays(context)
        if (days <= 0) return

        // Launch incremental indexing off the main thread (scheduled runs should only add new content)
        CoroutineScope(Dispatchers.IO).launch {
            try {
                com.hyliankid14.bbcradioplayer.workers.IndexWorker.reindexNewOnly(context) { _, _, _ -> }
                SavedSearchManager.checkForUpdates(context)
            } catch (_: Exception) {
                // swallow - this is a best-effort background job
            }
        }
    }
}
