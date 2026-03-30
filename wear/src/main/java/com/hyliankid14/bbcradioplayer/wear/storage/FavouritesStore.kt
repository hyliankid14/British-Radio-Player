package com.hyliankid14.bbcradioplayer.wear.storage

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class FavouritesStore(context: Context) {
    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    init {
        syncStateFromPrefs()
    }

    fun getFavouriteIds(): Set<String> = favouriteIdsState.value

    fun getFavouriteOrder(): List<String> = favouriteOrderState.value

    fun toggle(stationId: String): Set<String> {
        val updated = getFavouriteIds().toMutableSet()
        val updatedOrder = getFavouriteOrder().toMutableList()
        if (!updated.add(stationId)) {
            updated.remove(stationId)
            updatedOrder.remove(stationId)
        } else if (!updatedOrder.contains(stationId)) {
            updatedOrder.add(stationId)
        }
        prefs.edit()
            .putStringSet(KEY_FAVOURITES, updated)
            .putString(KEY_FAVOURITES_ORDER, updatedOrder.joinToString(","))
            .apply()
        favouriteIdsState.value = updated
        favouriteOrderState.value = updatedOrder
        return updated
    }

    fun replaceAll(ids: Set<String>, orderedIds: List<String>) {
        val resolvedOrder = orderedIds.filter { it in ids }.distinct() + ids.filterNot { it in orderedIds }
        prefs.edit()
            .putStringSet(KEY_FAVOURITES, ids)
            .putString(KEY_FAVOURITES_ORDER, resolvedOrder.joinToString(","))
            .putBoolean(KEY_REMOTE_SYNCED, true)
            .apply()
        favouriteIdsState.value = ids
        favouriteOrderState.value = resolvedOrder
    }

    fun hasRemoteSnapshot(): Boolean = prefs.getBoolean(KEY_REMOTE_SYNCED, false)

    private fun syncStateFromPrefs() {
        favouriteIdsState.value = prefs.getStringSet(KEY_FAVOURITES, emptySet()) ?: emptySet()
        favouriteOrderState.value = prefs.getString(KEY_FAVOURITES_ORDER, "")
            ?.split(",")
            ?.filter { it.isNotBlank() }
            ?: emptyList()
    }

    companion object {
        private const val PREFS_NAME = "wear_station_favourites"
        private const val KEY_FAVOURITES = "station_ids"
        private const val KEY_FAVOURITES_ORDER = "station_order"
        private const val KEY_REMOTE_SYNCED = "remote_synced"

        private val favouriteIdsState = MutableStateFlow<Set<String>>(emptySet())
        private val favouriteOrderState = MutableStateFlow<List<String>>(emptyList())

        fun favouriteIdsFlow(): StateFlow<Set<String>> = favouriteIdsState.asStateFlow()
        fun favouriteOrderFlow(): StateFlow<List<String>> = favouriteOrderState.asStateFlow()
    }
}
