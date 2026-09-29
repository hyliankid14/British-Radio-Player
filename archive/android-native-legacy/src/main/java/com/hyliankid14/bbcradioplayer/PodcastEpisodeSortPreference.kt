package com.hyliankid14.bbcradioplayer

import android.content.Context

object PodcastEpisodeSortPreference {
    enum class Order {
        NEWEST_FIRST,
        OLDEST_FIRST
    }

    private const val PREFS_NAME = "podcast_episode_sort_prefs"
    private const val KEY_ORDER_PREFIX = "episode_sort_order_"
    private const val VALUE_NEWEST_FIRST = "newest_first"
    private const val VALUE_OLDEST_FIRST = "oldest_first"

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private fun key(podcastId: String): String = KEY_ORDER_PREFIX + podcastId

    fun getOrder(context: Context, podcastId: String): Order {
        return when (prefs(context).getString(key(podcastId), VALUE_NEWEST_FIRST)) {
            VALUE_OLDEST_FIRST -> Order.OLDEST_FIRST
            else -> Order.NEWEST_FIRST
        }
    }

    fun isOldestFirst(context: Context, podcastId: String): Boolean {
        return getOrder(context, podcastId) == Order.OLDEST_FIRST
    }

    fun setOrder(context: Context, podcastId: String, order: Order) {
        val value = when (order) {
            Order.NEWEST_FIRST -> VALUE_NEWEST_FIRST
            Order.OLDEST_FIRST -> VALUE_OLDEST_FIRST
        }
        prefs(context).edit().putString(key(podcastId), value).apply()
    }

    fun toggleOrder(context: Context, podcastId: String): Order {
        val next = when (getOrder(context, podcastId)) {
            Order.NEWEST_FIRST -> Order.OLDEST_FIRST
            Order.OLDEST_FIRST -> Order.NEWEST_FIRST
        }
        setOrder(context, podcastId, next)
        return next
    }
}