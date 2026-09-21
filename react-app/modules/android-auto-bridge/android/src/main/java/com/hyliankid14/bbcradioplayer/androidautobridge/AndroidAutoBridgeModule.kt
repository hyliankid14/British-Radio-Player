package com.hyliankid14.bbcradioplayer.androidautobridge

import android.content.Context
import android.os.Bundle
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

/**
 * Bridge between the React application and the native Android Auto media service.
 *
 * The JS layer owns all catalogue/preference state and pushes a JSON snapshot here with
 * [definition]-exposed `syncState`; [AutoState] persists it so the head unit can browse
 * without the JS runtime. Native side effects (favourite/subscribe toggles, played
 * markers, playback events) are queued as mutations that JS drains and reconciles.
 */
class AndroidAutoBridgeModule : Module() {

  private val context: Context?
    get() = appContext.reactContext?.applicationContext

  override fun definition() = ModuleDefinition {
    Name("AndroidAutoBridge")

    Events("onAutoEvent")

    /** Persists the catalogue/preference snapshot produced by the JS layer. */
    Function("syncState") { json: String ->
      val ctx = context ?: return@Function false
      AutoState.saveSnapshot(ctx, json)
      true
    }

    /** Returns the last snapshot written by the JS layer (empty object when none). */
    Function("getState") { ->
      val ctx = context ?: return@Function "{}"
      AutoState.snapshot(ctx).toString()
    }

    /** Returns and clears queued native mutations, as a JSON array string. */
    Function("drainMutations") { ->
      val ctx = context ?: return@Function "[]"
      AutoState.drainMutations(ctx).toString()
    }

    /** Clears all persisted Auto state (used when the user signs out or resets). */
    Function("clearState") { ->
      val ctx = context ?: return@Function false
      AutoState.clear(ctx)
      true
    }

    /** Tells the native Auto player to yield because phone playback has started. */
    Function("notifyPhonePlaybackStarted") { ->
      // Only the live service instance matters; avoid starting the service from the
      // background, which is restricted on Android 12+.
      AndroidAutoMediaService.instance?.onPhonePlaybackStarted()
      true
    }

    OnCreate {
      instance = this@AndroidAutoBridgeModule
    }

    OnDestroy {
      if (instance === this@AndroidAutoBridgeModule) instance = null
    }
  }

  companion object {
    @Volatile
    private var instance: AndroidAutoBridgeModule? = null

    /** Emits a native Auto event to JS. Safe to call when the JS runtime is not running. */
    fun emitEvent(type: String, payload: JSONObject) {
      val module = instance ?: return
      try {
        module.sendEvent(
          "onAutoEvent",
          Bundle().apply {
            putString("type", type)
            putString("payload", payload.toString())
          }
        )
      } catch (_: Exception) {
      }
    }
  }
}
