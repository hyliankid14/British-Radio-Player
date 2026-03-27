package com.hyliankid14.bbcradioplayer.wear.storage

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class SubscriptionStore(context: Context) {
    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    init {
        syncStateFromPrefs()
    }

    fun getSubscribedIds(): Set<String> {
        syncStateFromPrefs()
        return subscribedIdsState.value
    }

    fun replaceAll(ids: Set<String>) {
        prefs.edit()
            .putStringSet(KEY_SUBSCRIPTIONS, ids)
            .putBoolean(KEY_REMOTE_SYNCED, true)
            .apply()
        subscribedIdsState.value = ids
    }

    fun hasRemoteSnapshot(): Boolean = prefs.getBoolean(KEY_REMOTE_SYNCED, false)

    private fun syncStateFromPrefs() {
        subscribedIdsState.value = prefs.getStringSet(KEY_SUBSCRIPTIONS, emptySet()) ?: emptySet()
    }

    companion object {
        private const val PREFS_NAME = "wear_podcast_subscriptions"
        private const val KEY_SUBSCRIPTIONS = "podcast_ids"
        private const val KEY_REMOTE_SYNCED = "remote_synced"

        private val subscribedIdsState = MutableStateFlow<Set<String>>(emptySet())

        fun subscribedIdsFlow(): StateFlow<Set<String>> = subscribedIdsState.asStateFlow()
    }
}
