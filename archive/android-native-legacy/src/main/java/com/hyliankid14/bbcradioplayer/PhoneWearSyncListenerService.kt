package com.hyliankid14.bbcradioplayer

import android.util.Log
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService

class PhoneWearSyncListenerService : WearableListenerService() {
    override fun onDataChanged(dataEvents: com.google.android.gms.wearable.DataEventBuffer) {
        super.onDataChanged(dataEvents)
        for (event in dataEvents) {
            if (event.type != DataEvent.TYPE_CHANGED) continue
            if (event.dataItem.uri.path != WearAppStateSync.PATH_APP_STATE) continue
            Log.d("PhoneWearSync", "onDataChanged path=${event.dataItem.uri.path}")
            try {
                WearAppStateSync.applyStateFromDataItem(this, DataMapItem.fromDataItem(event.dataItem))
            } catch (error: Exception) {
                Log.w("PhoneWearSync", "Failed to apply wearable state", error)
            }
        }
    }

    override fun onMessageReceived(messageEvent: MessageEvent) {
        super.onMessageReceived(messageEvent)
        Log.d("PhoneWearSync", "onMessageReceived path=${messageEvent.path} from=${messageEvent.sourceNodeId}")
        if (messageEvent.path == WearAppStateSync.PATH_REQUEST_STATE) {
            val payload = WearAppStateSync.buildStatePayload(this)
            Wearable.getMessageClient(this)
                .sendMessage(messageEvent.sourceNodeId, WearAppStateSync.PATH_STATE_PAYLOAD, payload)
                .addOnSuccessListener {
                    Log.d("PhoneWearSync", "Sent direct state payload bytes=${payload.size}")
                }
                .addOnFailureListener { error ->
                    Log.w("PhoneWearSync", "Failed to send direct state payload", error)
                }
            WearAppStateSync.pushCurrentState(this)
        }
    }
}
