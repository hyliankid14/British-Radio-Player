package com.hyliankid14.bbcradioplayer

import android.content.Context

object FavoritesPreference {
    private const val PREFS_NAME = "favorites_prefs"
    private const val KEY_FAVORITES = "favorite_stations"
    private const val KEY_FAVORITES_ORDER_STRING = "favorite_stations_order_string"

    fun isFavorite(context: Context, stationId: String): Boolean {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val favorites = prefs.getStringSet(KEY_FAVORITES, emptySet()) ?: emptySet()
        return favorites.contains(stationId)
    }

    fun toggleFavorite(context: Context, stationId: String, syncToWear: Boolean = true) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val favorites = prefs.getStringSet(KEY_FAVORITES, emptySet())?.toMutableSet() ?: mutableSetOf()
        
        // Get current order
        val currentOrder = getFavoritesOrder(context).toMutableList()

        if (favorites.contains(stationId)) {
            favorites.remove(stationId)
            currentOrder.remove(stationId)
        } else {
            favorites.add(stationId)
            if (!currentOrder.contains(stationId)) {
                currentOrder.add(stationId) // Add to bottom
            }
        }
        
        prefs.edit().putStringSet(KEY_FAVORITES, favorites).apply()
        saveFavoritesOrder(context, currentOrder)
        if (syncToWear) {
            WearAppStateSync.pushCurrentState(context)
        }
    }

    fun setFavorites(context: Context, orderedIds: List<String>, syncToWear: Boolean = true) {
        val normalisedOrder = orderedIds.filter { it.isNotBlank() }.distinct()
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
            .putStringSet(KEY_FAVORITES, normalisedOrder.toSet())
            .putString(KEY_FAVORITES_ORDER_STRING, normalisedOrder.joinToString(","))
            .apply()
        if (syncToWear) {
            WearAppStateSync.pushCurrentState(context)
        }
    }

    fun getFavoriteIds(context: Context): Set<String> {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getStringSet(KEY_FAVORITES, emptySet()) ?: emptySet()
    }

    fun saveFavoritesOrder(context: Context, orderedIds: List<String>) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val orderString = orderedIds.joinToString(",")
        prefs.edit().putString(KEY_FAVORITES_ORDER_STRING, orderString).apply()
    }

    fun getFavoritesOrder(context: Context): List<String> {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val orderString = prefs.getString(KEY_FAVORITES_ORDER_STRING, null)
        return orderString?.split(",")?.filter { it.isNotEmpty() } ?: emptyList()
    }

    fun getFavorites(context: Context): List<Station> {
        val favoriteIds = getFavoriteIds(context)
        val allStations = StationRepository.getStations().filter { favoriteIds.contains(it.id) }
        val savedOrder = getFavoritesOrder(context)
        
        // Sort by saved order, putting any unsorted ones at the end
        return allStations.sortedBy { station ->
            val index = savedOrder.indexOf(station.id)
            if (index != -1) index else Int.MAX_VALUE
        }
    }
}
