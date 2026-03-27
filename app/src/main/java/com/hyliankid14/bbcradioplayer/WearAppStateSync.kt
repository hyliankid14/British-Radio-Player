package com.hyliankid14.bbcradioplayer

import android.content.Context
import android.util.Log
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import org.json.JSONArray
import org.json.JSONObject

object WearAppStateSync {
    const val PATH_APP_STATE = "/bbcradioplayer/state"
    const val PATH_REQUEST_STATE = "/bbcradioplayer/request_state"
    const val PATH_STATE_PAYLOAD = "/bbcradioplayer/state_payload"

    private const val KEY_FAVOURITE_IDS = "favourite_ids"
    private const val KEY_FAVOURITE_ORDER = "favourite_order"
    private const val KEY_SUBSCRIBED_PODCAST_IDS = "subscribed_podcast_ids"
    private const val KEY_HAS_SUBSCRIPTION_SNAPSHOT = "has_subscription_snapshot"
    private const val KEY_PLAYED_EPISODE_IDS = "played_episode_ids"
    private const val KEY_HISTORY_EPISODE_IDS = "history_episode_ids"
    private const val KEY_EPISODE_PROGRESS_JSON = "episode_progress_json"
    private const val KEY_HAS_EPISODE_SNAPSHOT = "has_episode_snapshot"
    private const val KEY_UPDATED_AT = "updated_at"
    private const val TAG = "WearAppStateSync"

    fun pushCurrentState(context: Context) {
        val favouriteIds = FavoritesPreference.getFavoriteIds(context)
        val favouriteOrder = FavoritesPreference.getFavoritesOrder(context)
        val subscribedIds = PodcastSubscriptions.getSubscribedIds(context)
        val playedEpisodeIds = PlayedEpisodesPreference.getPlayedIds(context)
        val historyEpisodeIds = PlayedHistoryPreference.getHistory(context).map { it.id }
        val episodeProgress = PlayedEpisodesPreference.getAllProgresses(context)
        Log.d(
            TAG,
            "Pushing phone state favourites=${favouriteIds.size} order=${favouriteOrder.size} subscriptions=${subscribedIds.size} played=${playedEpisodeIds.size} history=${historyEpisodeIds.size} progress=${episodeProgress.size}"
        )
        val request = PutDataMapRequest.create(PATH_APP_STATE).apply {
            dataMap.putStringArrayList(KEY_FAVOURITE_IDS, ArrayList(favouriteIds))
            dataMap.putStringArrayList(KEY_FAVOURITE_ORDER, ArrayList(favouriteOrder))
            dataMap.putStringArrayList(KEY_SUBSCRIBED_PODCAST_IDS, ArrayList(subscribedIds))
            dataMap.putBoolean(KEY_HAS_SUBSCRIPTION_SNAPSHOT, true)
            dataMap.putStringArrayList(KEY_PLAYED_EPISODE_IDS, ArrayList(playedEpisodeIds))
            dataMap.putStringArrayList(KEY_HISTORY_EPISODE_IDS, ArrayList(historyEpisodeIds))
            dataMap.putBoolean(KEY_HAS_EPISODE_SNAPSHOT, true)
            val progressJson = JSONObject().apply {
                episodeProgress.forEach { (episodeId, positionMs) -> put(episodeId, positionMs) }
            }
            dataMap.putString(KEY_EPISODE_PROGRESS_JSON, progressJson.toString())
            dataMap.putLong(KEY_UPDATED_AT, System.currentTimeMillis())
        }.asPutDataRequest().setUrgent()

        Wearable.getDataClient(context).putDataItem(request)
            .addOnSuccessListener { item ->
                Log.d(TAG, "Phone state pushed path=${item.uri.path}")
            }
            .addOnFailureListener { error ->
                Log.w(TAG, "Failed to push app state to wearable", error)
            }
    }

    fun buildStatePayload(context: Context): ByteArray {
        val payload = JSONObject().apply {
            put(KEY_UPDATED_AT, System.currentTimeMillis())
            put(KEY_HAS_SUBSCRIPTION_SNAPSHOT, true)
            put(KEY_HAS_EPISODE_SNAPSHOT, true)
            put(KEY_FAVOURITE_IDS, JSONArray(FavoritesPreference.getFavoriteIds(context).toList()))
            put(KEY_FAVOURITE_ORDER, JSONArray(FavoritesPreference.getFavoritesOrder(context)))
            put(KEY_SUBSCRIBED_PODCAST_IDS, JSONArray(PodcastSubscriptions.getSubscribedIds(context).toList()))
            put(KEY_PLAYED_EPISODE_IDS, JSONArray(PlayedEpisodesPreference.getPlayedIds(context).toList()))
            put(KEY_HISTORY_EPISODE_IDS, JSONArray(PlayedHistoryPreference.getHistory(context).map { it.id }))
            val progressJson = JSONObject().apply {
                PlayedEpisodesPreference.getAllProgresses(context)
                    .forEach { (episodeId, positionMs) -> put(episodeId, positionMs) }
            }
            put(KEY_EPISODE_PROGRESS_JSON, progressJson.toString())
        }
        return payload.toString().toByteArray(Charsets.UTF_8)
    }

    fun applyStateFromDataItem(context: Context, item: DataMapItem) {
        val favouriteIds = item.dataMap.getStringArrayList(KEY_FAVOURITE_IDS)?.toSet() ?: emptySet()
        val favouriteOrder = item.dataMap.getStringArrayList(KEY_FAVOURITE_ORDER)?.filter { it.isNotBlank() } ?: emptyList()

        FavoritesPreference.setFavorites(context, favouriteOrder.ifEmpty { favouriteIds.toList() }, syncToWear = false)
        Log.d(TAG, "Applied watch state favourites=${favouriteIds.size} order=${favouriteOrder.size}")
        if (item.dataMap.getBoolean(KEY_HAS_SUBSCRIPTION_SNAPSHOT, true)) {
            val subscribedIds = item.dataMap.getStringArrayList(KEY_SUBSCRIBED_PODCAST_IDS)?.toSet() ?: emptySet()
            PodcastSubscriptions.setSubscribedIds(context, subscribedIds, syncToWear = false)
            Log.d(TAG, "Applied watch subscriptions count=${subscribedIds.size}")
        }
        if (item.dataMap.getBoolean(KEY_HAS_EPISODE_SNAPSHOT, true)) {
            val playedEpisodeIds = item.dataMap.getStringArrayList(KEY_PLAYED_EPISODE_IDS)?.toSet() ?: emptySet()
            val historyEpisodeIds = item.dataMap.getStringArrayList(KEY_HISTORY_EPISODE_IDS)?.toSet() ?: emptySet()
            val progressMap = parseProgressMap(item.dataMap.getString(KEY_EPISODE_PROGRESS_JSON).orEmpty())
            mergeEpisodeStateFromWatch(context, playedEpisodeIds + historyEpisodeIds, progressMap)
            Log.d(TAG, "Applied watch episode sync played=${playedEpisodeIds.size} history=${historyEpisodeIds.size} progress=${progressMap.size}")
        }
    }

    private fun mergeEpisodeStateFromWatch(
        context: Context,
        playedEpisodeIds: Set<String>,
        progressMap: Map<String, Long>
    ) {
        playedEpisodeIds.forEach { episodeId ->
            if (!PlayedEpisodesPreference.isPlayed(context, episodeId)) {
                PlayedEpisodesPreference.markPlayed(context, episodeId)
            }
        }

        progressMap.forEach { (episodeId, positionMs) ->
            if (positionMs > 0L && !PlayedEpisodesPreference.isPlayed(context, episodeId)) {
                PlayedEpisodesPreference.setProgress(context, episodeId, positionMs)
            }
        }
    }

    private fun parseProgressMap(progressJson: String): Map<String, Long> {
        if (progressJson.isBlank()) return emptyMap()
        return runCatching {
            val obj = JSONObject(progressJson)
            obj.keys().asSequence()
                .map { it.trim() }
                .filter { it.isNotBlank() }
                .associateWith { key -> obj.optLong(key, 0L) }
                .filterValues { it > 0L }
        }.getOrDefault(emptyMap())
    }
}
