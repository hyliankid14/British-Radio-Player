package com.hyliankid14.bbcradioplayer.nativeandroid

import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService

/** Holds a reference to the active JS bridge so received watch data can be forwarded to JS. */
object WearSyncRelay {
  @Volatile
  var onStateReceived: ((String) -> Unit)? = null
}

/**
 * Receives state and requests from the Wear OS companion and forwards them to the JS layer,
 * mirroring the Kotlin `WearAppStateSync.applyStateFromDataItem` hand-off.
 */
class WearListenerService : WearableListenerService() {

  override fun onDataChanged(dataEvents: DataEventBuffer) {
    dataEvents.forEach { event ->
      if (event.dataItem.uri.path == WearSync.PATH_APP_STATE) {
        try {
          val item = DataMapItem.fromDataItem(event.dataItem)
          WearSyncRelay.onStateReceived?.invoke(WearSync.readIncomingState(item))
        } catch (_: Exception) {
        }
      }
    }
  }

  override fun onMessageReceived(messageEvent: MessageEvent) {
    if (messageEvent.path == WearSync.PATH_REQUEST_STATE) {
      try {
        WearSyncRelay.onStateReceived?.invoke("""{"request":true}""")
      } catch (_: Exception) {
      }
    }
  }
}
