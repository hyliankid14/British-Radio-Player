package com.hyliankid14.bbcradioplayer

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class DownloadCompleteReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        EpisodeDownloadManager.handleSystemDownloadComplete(context, intent)
    }
}
