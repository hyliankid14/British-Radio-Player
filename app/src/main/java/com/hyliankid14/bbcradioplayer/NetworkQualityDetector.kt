package com.hyliankid14.bbcradioplayer

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build

object NetworkQualityDetector {
    fun isVpnActive(context: Context): Boolean {
        val connectivityManager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val network = connectivityManager.activeNetwork ?: return false
            val capabilities = connectivityManager.getNetworkCapabilities(network) ?: return false
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)
        } else {
            @Suppress("DEPRECATION")
            connectivityManager.activeNetworkInfo?.type == ConnectivityManager.TYPE_VPN
        }
    }

    fun registerVpnStatusCallback(
        context: Context,
        onChanged: () -> Unit
    ): ConnectivityManager.NetworkCallback? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return null

        val connectivityManager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: android.net.Network) {
                onChanged()
            }

            override fun onLost(network: android.net.Network) {
                onChanged()
            }

            override fun onCapabilitiesChanged(
                network: android.net.Network,
                networkCapabilities: NetworkCapabilities
            ) {
                onChanged()
            }
        }

        connectivityManager.registerDefaultNetworkCallback(callback)
        return callback
    }

    fun unregisterVpnStatusCallback(
        context: Context,
        callback: ConnectivityManager.NetworkCallback
    ) {
        val connectivityManager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        try {
            connectivityManager.unregisterNetworkCallback(callback)
        } catch (_: Exception) {
        }
    }

    fun getRecommendedAudioQuality(context: Context): ThemePreference.AudioQuality {
        val connectivityManager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val network = connectivityManager.activeNetwork ?: return ThemePreference.AudioQuality.DATA_SAVER_48
            val capabilities = connectivityManager.getNetworkCapabilities(network)
                ?: return ThemePreference.AudioQuality.DATA_SAVER_48

            if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) {
                return ThemePreference.AudioQuality.HIGH_320
            }

            if (!capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) {
                return ThemePreference.AudioQuality.DATA_SAVER_48
            }

            if (connectivityManager.isActiveNetworkMetered) {
                val downstreamKbps = capabilities.linkDownstreamBandwidthKbps
                return when {
                    downstreamKbps >= 12_000 -> ThemePreference.AudioQuality.STANDARD_128
                    downstreamKbps >= 2_500 -> ThemePreference.AudioQuality.DATA_SAVER_96
                    else -> ThemePreference.AudioQuality.DATA_SAVER_48
                }
            }

            if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) {
                val downstreamKbps = capabilities.linkDownstreamBandwidthKbps
                return when {
                    downstreamKbps >= 30_000 -> ThemePreference.AudioQuality.HIGH_320
                    downstreamKbps >= 10_000 -> ThemePreference.AudioQuality.STANDARD_128
                    downstreamKbps >= 2_500 -> ThemePreference.AudioQuality.DATA_SAVER_96
                    else -> ThemePreference.AudioQuality.DATA_SAVER_48
                }
            }

            ThemePreference.AudioQuality.STANDARD_128
        } else {
            @Suppress("DEPRECATION")
            when (connectivityManager.activeNetworkInfo?.type) {
                ConnectivityManager.TYPE_WIFI -> ThemePreference.AudioQuality.HIGH_320
                ConnectivityManager.TYPE_MOBILE -> ThemePreference.AudioQuality.DATA_SAVER_96
                else -> ThemePreference.AudioQuality.DATA_SAVER_48
            }
        }
    }
}
