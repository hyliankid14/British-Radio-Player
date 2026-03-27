package com.hyliankid14.bbcradioplayer.wear

import android.content.Context
import android.util.Log
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.MessageClient
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import com.hyliankid14.bbcradioplayer.wear.storage.EpisodeSyncStore
import com.hyliankid14.bbcradioplayer.wear.storage.FavouritesStore
import com.hyliankid14.bbcradioplayer.wear.storage.SubscriptionStore
import org.json.JSONObject

object WatchAppStateSync {
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
    private const val TAG = "WatchAppStateSync"

    fun requestPhoneState(context: Context) {
        Log.d(TAG, "Requesting phone state")
        Wearable.getNodeClient(context).connectedNodes
            .addOnSuccessListener { nodes ->
                Log.d(TAG, "Connected nodes for request: ${nodes.size}")
                val messageClient = Wearable.getMessageClient(context)
                nodes.forEach { node ->
                    Log.d(TAG, "Sending state request to node=${node.id} name=${node.displayName}")
                    messageClient.sendMessage(node.id, PATH_REQUEST_STATE, ByteArray(0))
                        .addOnSuccessListener {
                            Log.d(TAG, "State request delivered to node=${node.id}")
                        }
                        .addOnFailureListener { error ->
                            Log.w(TAG, "Failed requesting state from phone node ${node.displayName}", error)
                        }
                }
            }
            .addOnFailureListener { error ->
                Log.w(TAG, "Failed to query connected phone nodes", error)
            }
    }

    fun pushCurrentState(
        context: Context,
        favouritesStore: FavouritesStore,
        subscriptionStore: SubscriptionStore,
        episodeSyncStore: EpisodeSyncStore = EpisodeSyncStore(context)
    ) {
        val favourites = favouritesStore.getFavouriteIds()
        val order = favouritesStore.getFavouriteOrder()
        val subscriptions = subscriptionStore.getSubscribedIds()
        val playedEpisodeIds = episodeSyncStore.getPlayedEpisodeIds()
        val historyEpisodeIds = episodeSyncStore.getHistoryEpisodeIds()
        val episodeProgress = episodeSyncStore.getProgressMap()
        val request = PutDataMapRequest.create(PATH_APP_STATE).apply {
            dataMap.putStringArrayList(KEY_FAVOURITE_IDS, ArrayList(favourites))
            dataMap.putStringArrayList(KEY_FAVOURITE_ORDER, ArrayList(order))
            val hasSubscriptionSnapshot = subscriptionStore.hasRemoteSnapshot()
            dataMap.putBoolean(KEY_HAS_SUBSCRIPTION_SNAPSHOT, hasSubscriptionSnapshot)
            if (hasSubscriptionSnapshot) {
                dataMap.putStringArrayList(KEY_SUBSCRIBED_PODCAST_IDS, ArrayList(subscriptions))
            }
            val hasEpisodeSnapshot = episodeSyncStore.hasRemoteSnapshot()
            dataMap.putBoolean(KEY_HAS_EPISODE_SNAPSHOT, hasEpisodeSnapshot)
            if (hasEpisodeSnapshot) {
                dataMap.putStringArrayList(KEY_PLAYED_EPISODE_IDS, ArrayList(playedEpisodeIds))
                dataMap.putStringArrayList(KEY_HISTORY_EPISODE_IDS, ArrayList(historyEpisodeIds))
                val progressJson = JSONObject().apply {
                    episodeProgress.forEach { (episodeId, positionMs) -> put(episodeId, positionMs) }
                }
                dataMap.putString(KEY_EPISODE_PROGRESS_JSON, progressJson.toString())
            }
            dataMap.putLong(KEY_UPDATED_AT, System.currentTimeMillis())
        }.asPutDataRequest().setUrgent()

        Log.d(
            TAG,
            "Pushing watch state favourites=${favourites.size} order=${order.size} subscriptions=${subscriptions.size} played=${playedEpisodeIds.size} history=${historyEpisodeIds.size} progress=${episodeProgress.size}"
        )

        Wearable.getDataClient(context).putDataItem(request)
            .addOnSuccessListener { item ->
                Log.d(TAG, "Watch state pushed path=${item.uri.path}")
            }
            .addOnFailureListener { error ->
                Log.w(TAG, "Failed to push wearable state", error)
            }
    }

    fun applyStateFromDataItem(
        favouritesStore: FavouritesStore,
        subscriptionStore: SubscriptionStore,
        episodeSyncStore: EpisodeSyncStore,
        item: DataMapItem
    ) {
        val favouriteIds = item.dataMap.getStringArrayList(KEY_FAVOURITE_IDS)?.toSet() ?: emptySet()
        val favouriteOrder = item.dataMap.getStringArrayList(KEY_FAVOURITE_ORDER)?.filter { it.isNotBlank() } ?: emptyList()

        favouritesStore.replaceAll(favouriteIds, favouriteOrder)
        Log.d(TAG, "Applied state from DataItem favourites=${favouriteIds.size} order=${favouriteOrder.size}")
        if (item.dataMap.getBoolean(KEY_HAS_SUBSCRIPTION_SNAPSHOT, true)) {
            val subscribedIds = item.dataMap.getStringArrayList(KEY_SUBSCRIBED_PODCAST_IDS)?.toSet() ?: emptySet()
            subscriptionStore.replaceAll(subscribedIds)
            Log.d(TAG, "Applied subscriptions from DataItem count=${subscribedIds.size}")
        }
        if (item.dataMap.getBoolean(KEY_HAS_EPISODE_SNAPSHOT, true)) {
            val playedEpisodeIds = item.dataMap.getStringArrayList(KEY_PLAYED_EPISODE_IDS)?.toSet() ?: emptySet()
            val historyEpisodeIds = item.dataMap.getStringArrayList(KEY_HISTORY_EPISODE_IDS)?.filter { it.isNotBlank() } ?: emptyList()
            val progressJson = item.dataMap.getString(KEY_EPISODE_PROGRESS_JSON).orEmpty()
            val progressMap = parseProgressMap(progressJson)
            episodeSyncStore.replaceAll(playedEpisodeIds, progressMap, historyEpisodeIds)
            Log.d(TAG, "Applied episode sync from DataItem played=${playedEpisodeIds.size} history=${historyEpisodeIds.size} progress=${progressMap.size}")
        }
    }

    fun applyStateFromPayload(
        favouritesStore: FavouritesStore,
        subscriptionStore: SubscriptionStore,
        episodeSyncStore: EpisodeSyncStore,
        payload: ByteArray
    ) {
        val json = JSONObject(payload.toString(Charsets.UTF_8))
        val favouriteIds = mutableSetOf<String>()
        val favouriteIdsArray = json.optJSONArray(KEY_FAVOURITE_IDS)
        if (favouriteIdsArray != null) {
            for (index in 0 until favouriteIdsArray.length()) {
                val value = favouriteIdsArray.optString(index).trim()
                if (value.isNotBlank()) {
                    favouriteIds += value
                }
            }
        }

        val favouriteOrder = mutableListOf<String>()
        val favouriteOrderArray = json.optJSONArray(KEY_FAVOURITE_ORDER)
        if (favouriteOrderArray != null) {
            for (index in 0 until favouriteOrderArray.length()) {
                val value = favouriteOrderArray.optString(index).trim()
                if (value.isNotBlank()) {
                    favouriteOrder += value
                }
            }
        }

        favouritesStore.replaceAll(favouriteIds, favouriteOrder)
        Log.d(TAG, "Applied state from payload favourites=${favouriteIds.size} order=${favouriteOrder.size}")

        if (json.optBoolean(KEY_HAS_SUBSCRIPTION_SNAPSHOT, true)) {
            val subscribedIds = mutableSetOf<String>()
            val subscribedArray = json.optJSONArray(KEY_SUBSCRIBED_PODCAST_IDS)
            if (subscribedArray != null) {
                for (index in 0 until subscribedArray.length()) {
                    val value = subscribedArray.optString(index).trim()
                    if (value.isNotBlank()) {
                        subscribedIds += value
                    }
                }
            }
            subscriptionStore.replaceAll(subscribedIds)
            Log.d(TAG, "Applied subscriptions from payload count=${subscribedIds.size}")
        }
        if (json.optBoolean(KEY_HAS_EPISODE_SNAPSHOT, true)) {
            val playedEpisodeIds = mutableSetOf<String>()
            val playedArray = json.optJSONArray(KEY_PLAYED_EPISODE_IDS)
            if (playedArray != null) {
                for (index in 0 until playedArray.length()) {
                    val value = playedArray.optString(index).trim()
                    if (value.isNotBlank()) {
                        playedEpisodeIds += value
                    }
                }
            }
            val progressMap = parseProgressMap(json.optString(KEY_EPISODE_PROGRESS_JSON))
            val historyEpisodeIds = mutableListOf<String>()
            val historyArray = json.optJSONArray(KEY_HISTORY_EPISODE_IDS)
            if (historyArray != null) {
                for (index in 0 until historyArray.length()) {
                    val value = historyArray.optString(index).trim()
                    if (value.isNotBlank()) {
                        historyEpisodeIds += value
                    }
                }
            }
            episodeSyncStore.replaceAll(playedEpisodeIds, progressMap, historyEpisodeIds)
            Log.d(TAG, "Applied episode sync from payload played=${playedEpisodeIds.size} history=${historyEpisodeIds.size} progress=${progressMap.size}")
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
