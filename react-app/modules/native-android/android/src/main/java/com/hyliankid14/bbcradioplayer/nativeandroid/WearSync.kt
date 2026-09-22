package com.hyliankid14.bbcradioplayer.nativeandroid

import android.content.Context
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import org.json.JSONObject

/**
 * Pushes phone state to the Wear OS companion using the same Data Layer paths and keys as the
 * legacy Kotlin `WearAppStateSync`, so the existing watch app keeps working unchanged.
 */
object WearSync {

  const val PATH_APP_STATE = "/bbcradioplayer/state"
  const val PATH_REQUEST_STATE = "/bbcradioplayer/request_state"
  const val PATH_STATE_PAYLOAD = "/bbcradioplayer/state_payload"

  private const val KEY_FAVOURITE_IDS = "favourite_ids"
  private const val KEY_FAVOURITE_ORDER = "favourite_order"
  private const val KEY_SUBSCRIBED_PODCAST_IDS = "subscribed_podcast_ids"
  private const val KEY_HAS_SUBSCRIPTION_SNAPSHOT = "has_subscription_snapshot"
  private const val KEY_PLAYED_EPISODE_IDS = "played_episode_ids"
  private const val KEY_HISTORY_EPISODE_IDS = "history_episode_ids"
  private const val KEY_HISTORY_META_JSON = "history_meta_json"
  private const val KEY_EPISODE_PROGRESS_JSON = "episode_progress_json"
  private const val KEY_HAS_EPISODE_SNAPSHOT = "has_episode_snapshot"
  private const val KEY_UPDATED_AT = "updated_at"
  private const val KEY_LASTFM_SESSION_KEY = "lastfm_session_key"
  private const val KEY_LASTFM_USERNAME = "lastfm_username"
  private const val KEY_LASTFM_DIRECT_ENABLED = "lastfm_direct_enabled"
  private const val KEY_LASTFM_BROADCAST_ENABLED = "lastfm_broadcast_enabled"
  private const val KEY_LASTFM_SCROBBLE_PODCASTS = "lastfm_scrobble_podcasts"

  /**
   * Pushes the given state (built by the JS layer) to the watch. [payloadJson] contains the
   * favourites, subscriptions, played ids, history, progress and Last.fm fields.
   */
  fun pushState(context: Context, payloadJson: String) {
    val payload = try {
      JSONObject(payloadJson)
    } catch (_: Exception) {
      return
    }

    val request = PutDataMapRequest.create(PATH_APP_STATE).apply {
      dataMap.putStringArrayList(KEY_FAVOURITE_IDS, payload.stringList(KEY_FAVOURITE_IDS))
      dataMap.putStringArrayList(KEY_FAVOURITE_ORDER, payload.stringList(KEY_FAVOURITE_ORDER))
      dataMap.putStringArrayList(KEY_SUBSCRIBED_PODCAST_IDS, payload.stringList(KEY_SUBSCRIBED_PODCAST_IDS))
      dataMap.putBoolean(KEY_HAS_SUBSCRIPTION_SNAPSHOT, true)
      dataMap.putStringArrayList(KEY_PLAYED_EPISODE_IDS, payload.stringList(KEY_PLAYED_EPISODE_IDS))
      dataMap.putStringArrayList(KEY_HISTORY_EPISODE_IDS, payload.stringList(KEY_HISTORY_EPISODE_IDS))
      dataMap.putBoolean(KEY_HAS_EPISODE_SNAPSHOT, true)
      dataMap.putString(KEY_EPISODE_PROGRESS_JSON, payload.optString(KEY_EPISODE_PROGRESS_JSON, "{}"))
      dataMap.putString(KEY_HISTORY_META_JSON, payload.optString(KEY_HISTORY_META_JSON, ""))
      dataMap.putString(KEY_LASTFM_SESSION_KEY, payload.optString(KEY_LASTFM_SESSION_KEY, ""))
      dataMap.putString(KEY_LASTFM_USERNAME, payload.optString(KEY_LASTFM_USERNAME, ""))
      dataMap.putBoolean(KEY_LASTFM_DIRECT_ENABLED, payload.optBoolean(KEY_LASTFM_DIRECT_ENABLED, false))
      dataMap.putBoolean(KEY_LASTFM_BROADCAST_ENABLED, payload.optBoolean(KEY_LASTFM_BROADCAST_ENABLED, true))
      dataMap.putBoolean(KEY_LASTFM_SCROBBLE_PODCASTS, payload.optBoolean(KEY_LASTFM_SCROBBLE_PODCASTS, false))
      dataMap.putLong(KEY_UPDATED_AT, System.currentTimeMillis())
    }.asPutDataRequest().setUrgent()

    try {
      Wearable.getDataClient(context).putDataItem(request)
    } catch (_: Exception) {
    }
  }

  /** Converts a received watch data item into a JSON string for the JS layer to merge. */
  fun readIncomingState(item: DataMapItem): String {
    val dataMap = item.dataMap
    val progressJson = dataMap.getString(KEY_EPISODE_PROGRESS_JSON).orEmpty()
    return JSONObject().apply {
      put(KEY_FAVOURITE_IDS, org.json.JSONArray(dataMap.getStringArrayList(KEY_FAVOURITE_IDS) ?: emptyList<String>()))
      put(KEY_FAVOURITE_ORDER, org.json.JSONArray(dataMap.getStringArrayList(KEY_FAVOURITE_ORDER) ?: emptyList<String>()))
      put(KEY_HAS_SUBSCRIPTION_SNAPSHOT, dataMap.getBoolean(KEY_HAS_SUBSCRIPTION_SNAPSHOT, true))
      put(KEY_SUBSCRIBED_PODCAST_IDS, org.json.JSONArray(dataMap.getStringArrayList(KEY_SUBSCRIBED_PODCAST_IDS) ?: emptyList<String>()))
      put(KEY_HAS_EPISODE_SNAPSHOT, dataMap.getBoolean(KEY_HAS_EPISODE_SNAPSHOT, true))
      put(KEY_PLAYED_EPISODE_IDS, org.json.JSONArray(dataMap.getStringArrayList(KEY_PLAYED_EPISODE_IDS) ?: emptyList<String>()))
      put(KEY_EPISODE_PROGRESS_JSON, progressJson)
      put(KEY_HISTORY_META_JSON, dataMap.getString(KEY_HISTORY_META_JSON).orEmpty())
      put(KEY_LASTFM_SESSION_KEY, dataMap.getString(KEY_LASTFM_SESSION_KEY).orEmpty())
      put(KEY_LASTFM_USERNAME, dataMap.getString(KEY_LASTFM_USERNAME).orEmpty())
      put(KEY_LASTFM_DIRECT_ENABLED, dataMap.getBoolean(KEY_LASTFM_DIRECT_ENABLED, false))
      put(KEY_LASTFM_BROADCAST_ENABLED, dataMap.getBoolean(KEY_LASTFM_BROADCAST_ENABLED, true))
      put(KEY_LASTFM_SCROBBLE_PODCASTS, dataMap.getBoolean(KEY_LASTFM_SCROBBLE_PODCASTS, false))
    }.toString()
  }

  private fun JSONObject.stringList(key: String): ArrayList<String> {
    val array = optJSONArray(key) ?: return ArrayList()
    val list = ArrayList<String>(array.length())
    for (i in 0 until array.length()) {
      val value = array.optString(i, "")
      if (value.isNotBlank()) list.add(value)
    }
    return list
  }
}
