package com.hyliankid14.bbcradioplayer

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        // Reschedule any configured periodic indexing and subscription refreshes after device reboot
        CoroutineScope(Dispatchers.Default).launch {
            val days = IndexPreference.getIntervalDays(context)
            if (days > 0) {
                IndexScheduler.scheduleIndexing(context)
            } else {
                IndexScheduler.cancel(context)
            }

            val minutes = SubscriptionRefreshPreference.getIntervalMinutes(context)
            if (minutes > 0) {
                SubscriptionRefreshScheduler.scheduleRefresh(context)
            } else {
                SubscriptionRefreshScheduler.cancel(context)
            }

            // Reschedule alarm if enabled
            if (AlarmPreference.isEnabled(context)) {
                try {
                    AlarmScheduler.schedule(context)
                } catch (e: Exception) {
                    android.util.Log.e("BootReceiver", "Failed to reschedule alarm after boot", e)
                }
            }
        }
    }
}
