package com.hyliankid14.bbcradioplayer

import android.net.Uri
import com.google.android.exoplayer2.upstream.DataSource
import com.google.android.exoplayer2.upstream.DataSpec
import com.google.android.exoplayer2.upstream.HttpDataSource
import com.google.android.exoplayer2.upstream.DefaultHttpDataSource
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * Custom HttpDataSource that upgrades all HTTP URLs (including redirects) to HTTPS.
 * This prevents cleartext traffic issues with BBC podcast redirects.
 */
class SecureHttpDataSource : DataSource.Factory {
    
    override fun createDataSource(): DataSource {
        return SecureHttpDataSourceImpl()
    }

    private class SecureHttpDataSourceImpl : HttpDataSource {
        private var connection: HttpURLConnection? = null
        private var inputStream: InputStream? = null
        private var uri: Uri? = null
        private var responseCode: Int = -1
        private var opened = false

        override fun open(dataSpec: DataSpec): Long {
            // Start with the requested URL, upgraded to HTTPS
            var currentUrl = dataSpec.uri.toString().replace("http://", "https://")
            var redirectCount = 0
            val maxRedirects = 20

            while (redirectCount < maxRedirects) {
                val url = URL(currentUrl)
                connection = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = "GET"
                    connectTimeout = 15000
                    readTimeout = 15000
                    instanceFollowRedirects = false // Handle redirects manually
                    setRequestProperty("User-Agent", "BBC Radio Player/1.0 (Android)")
                }

                val responseCode = connection!!.responseCode
                this.responseCode = responseCode

                // Check if it's a redirect
                if (responseCode in 300..399) {
                    val location = connection!!.getHeaderField("Location")
                    connection!!.disconnect()
                    
                    if (location.isNullOrEmpty()) {
                        throw IOException("Redirect with no Location header")
                    }

                    // Upgrade redirect target to HTTPS
                    currentUrl = if (location.startsWith("http")) {
                        location.replace("http://", "https://")
                    } else {
                        // Relative URL - resolve against current
                        URL(URL(currentUrl), location).toString().replace("http://", "https://")
                    }
                    
                    redirectCount++
                    continue
                }

                // Not a redirect - check if successful
                if (responseCode != HttpURLConnection.HTTP_OK) {
                    connection!!.disconnect()
                    throw HttpDataSource.HttpDataSourceException(
                        dataSpec,
                        HttpDataSource.HttpDataSourceException.TYPE_OPEN
                    )
                }

                // Success - save the final URI and open stream
                uri = Uri.parse(currentUrl)
                inputStream = connection!!.inputStream
                opened = true
                
                val contentLength = connection!!.contentLength.toLong()
                return if (contentLength >= 0) contentLength else -1L
            }

            throw IOException("Too many redirects")
        }

        override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
            return inputStream?.read(buffer, offset, length) ?: throw IOException("Not opened")
        }

        override fun close() {
            inputStream?.close()
            connection?.disconnect()
            inputStream = null
            connection = null
            opened = false
        }

        override fun getUri(): Uri? = uri

        override fun getResponseHeaders(): Map<String, List<String>> {
            return connection?.headerFields?.filterKeys { it != null }?.mapKeys { it.key!! } ?: emptyMap()
        }

        override fun getResponseCode(): Int = responseCode

        override fun addTransferListener(transferListener: com.google.android.exoplayer2.upstream.TransferListener) {}

        override fun setRequestProperty(name: String, value: String) {}
       
        override fun clearRequestProperty(name: String) {}
        
        override fun clearAllRequestProperties() {}
    }
}
