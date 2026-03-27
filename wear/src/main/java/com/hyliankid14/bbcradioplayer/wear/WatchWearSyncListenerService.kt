package com.hyliankid14.bbcradioplayer.wear

import android.util.Log
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import com.hyliankid14.bbcradioplayer.wear.storage.EpisodeSyncStore
import com.hyliankid14.bbcradioplayer.wear.storage.FavouritesStore
import com.hyliankid14.bbcradioplayer.wear.storage.SubscriptionStore

class WatchWearSyncListenerService : WearableListenerService() {
    override fun onDataChanged(dataEvents: com.google.android.gms.wearable.DataEventBuffer) {
        super.onDataChanged(dataEvents)
        val favouritesStore = FavouritesStore(this)
        val subscriptionStore = SubscriptionStore(this)
        val episodeSyncStore = EpisodeSyncStore(this)
        for (event in dataEvents) {
            if (event.type != DataEvent.TYPE_CHANGED) continue
            if (event.dataItem.uri.path != WatchAppStateSync.PATH_APP_STATE) continue
            Log.d("WatchWearSync", "onDataChanged path=${event.dataItem.uri.path}")
            try {
                WatchAppStateSync.applyStateFromDataItem(
                    favouritesStore = favouritesStore,
                    subscriptionStore = subscriptionStore,
                    episodeSyncStore = episodeSyncStore,
                    item = DataMapItem.fromDataItem(event.dataItem)
                )
            } catch (error: Exception) {
                Log.w("WatchWearSync", "Failed to apply phone state", error)
            }
        }
    }

    override fun onMessageReceived(messageEvent: MessageEvent) {
        super.onMessageReceived(messageEvent)
        val favouritesStore = FavouritesStore(this)
        val subscriptionStore = SubscriptionStore(this)
        val episodeSyncStore = EpisodeSyncStore(this)
        Log.d("WatchWearSync", "onMessageReceived path=${messageEvent.path} from=${messageEvent.sourceNodeId}")
        if (messageEvent.path == WatchAppStateSync.PATH_REQUEST_STATE) {
            WatchAppStateSync.pushCurrentState(this, favouritesStore, subscriptionStore, episodeSyncStore)
            return
        }
        if (messageEvent.path == WatchAppStateSync.PATH_STATE_PAYLOAD) {
            try {
                WatchAppStateSync.applyStateFromPayload(
                    favouritesStore = favouritesStore,
                    subscriptionStore = subscriptionStore,
                    episodeSyncStore = episodeSyncStore,
                    payload = messageEvent.data
                )
            } catch (error: Exception) {
                Log.w("WatchWearSync", "Failed to apply direct phone payload", error)
            }
        }
    }
}
