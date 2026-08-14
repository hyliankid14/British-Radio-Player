package com.hyliankid14.bbcradioplayer

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build

object NetworkQualityDetector {
    fun isOnline(context: Context): Boolean {
        try {
            val connectivityManager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return false
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val network = connectivityManager.activeNetwork ?: return false
                val capabilities = connectivityManager.getNetworkCapabilities(network) ?: return false
                val hasInternet = capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                if (!hasInternet) return false
                
                @Suppress("DEPRECATION")
                val activeNetworkInfo = connectivityManager.activeNetworkInfo
                if (activeNetworkInfo?.isConnected != true) return false

                return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) ||
                       capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_SUSPENDED)
            } else {
                @Suppress("DEPRECATION")
                val activeNetworkInfo = connectivityManager.activeNetworkInfo
                return activeNetworkInfo != null && activeNetworkInfo.isConnected
            }
        } catch (_: Exception) {
            return false
        }
    }

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

    fun registerNetworkCallback(
        context: Context,
        onChanged: () -> Unit
    ): ConnectivityManager.NetworkCallback? {
        val connectivityManager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return null
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

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                connectivityManager.registerDefaultNetworkCallback(callback)
            } else {
                val request = android.net.NetworkRequest.Builder()
                    .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    .build()
                connectivityManager.registerNetworkCallback(request, callback)
            }
            return callback
        } catch (_: Exception) {
            return null
        }
    }

    fun unregisterNetworkCallback(
        context: Context,
        callback: ConnectivityManager.NetworkCallback
    ) {
        val connectivityManager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return
        try {
            connectivityManager.unregisterNetworkCallback(callback)
        } catch (_: Exception) {
        }
    }

    fun registerVpnStatusCallback(
        context: Context,
        onChanged: () -> Unit
    ): ConnectivityManager.NetworkCallback? {
        return registerNetworkCallback(context, onChanged)
    }

    fun unregisterVpnStatusCallback(
        context: Context,
        callback: ConnectivityManager.NetworkCallback
    ) {
        unregisterNetworkCallback(context, callback)
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
