package com.hyliankid14.bbcradioplayer

import com.google.android.exoplayer2.upstream.DataSource
import com.google.android.exoplayer2.upstream.DefaultHttpDataSource
import com.google.android.exoplayer2.upstream.HttpDataSource

/**
 * Custom DataSource.Factory that upgrades all HTTP URLs to HTTPS for secure streaming.
 * This prevents cleartext traffic issues while maintaining compatibility with existing stream URLs.
 */
class SecureHttpDataSource : DataSource.Factory {
    private val defaultFactory = DefaultHttpDataSource.Factory()
        .setAllowCrossProtocolRedirects(true)
        .setConnectTimeoutMs(DefaultHttpDataSource.DEFAULT_CONNECT_TIMEOUT_MILLIS)
        .setReadTimeoutMs(DefaultHttpDataSource.DEFAULT_READ_TIMEOUT_MILLIS)

    override fun createDataSource(): DataSource {
        return SecureDataSourceWrapper(defaultFactory.createDataSource())
    }

    private class SecureDataSourceWrapper(
        private val wrappedDataSource: HttpDataSource
    ) : HttpDataSource by wrappedDataSource {

        override fun open(dataSpec: com.google.android.exoplayer2.upstream.DataSpec): Long {
            // Upgrade HTTP to HTTPS
            val secureUri = dataSpec.uri.toString().replace("http://", "https://")
            val secureDataSpec = dataSpec.buildUpon()
                .setUri(secureUri)
                .build()
            
            return wrappedDataSource.open(secureDataSpec)
        }
    }
}
