package com.hyliankid14.bbcradioplayer

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.HttpDataSource
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * Custom HttpDataSource that upgrades all HTTP URLs (including redirects) to HTTPS.
 * This prevents cleartext traffic issues with BBC podcast redirects.
 */
@OptIn(UnstableApi::class)
class SecureHttpDataSource : DataSource.Factory {
    
    override fun createDataSource(): DataSource {
        return SecureHttpDataSourceImpl()
    }

    private class SecureHttpDataSourceImpl : HttpDataSource {
        private var connection: HttpURLConnection? = null
        private var inputStream: InputStream? = null
        private var uri: Uri? = null
        private var responseCode: Int = -1
        private val requestProperties = mutableMapOf<String, String>()

        override fun open(dataSpec: DataSpec): Long {
            // Start with the requested URL, upgraded to HTTPS
            var currentUrl = dataSpec.uri.toString().replace("http://", "https://")
            var redirectCount = 0
            val maxRedirects = 20
            val position = dataSpec.position.coerceAtLeast(0L)
            val length = dataSpec.length

            val rangeHeader = when {
                position > 0L && length != C.LENGTH_UNSET.toLong() -> {
                    val end = (position + length - 1L).coerceAtLeast(position)
                    "bytes=${position}-${end}"
                }
                position > 0L -> "bytes=${position}-"
                length != C.LENGTH_UNSET.toLong() -> "bytes=0-${length - 1L}"
                else -> null
            }

            while (redirectCount < maxRedirects) {
                val url = URL(currentUrl)
                val headersSnapshot = synchronized(requestProperties) { requestProperties.toMap() }
                connection = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = when (dataSpec.httpMethod) {
                        DataSpec.HTTP_METHOD_HEAD -> "HEAD"
                        DataSpec.HTTP_METHOD_POST -> "POST"
                        else -> "GET"
                    }
                    connectTimeout = 15000
                    readTimeout = 15000
                    instanceFollowRedirects = false // Handle redirects manually
                    setRequestProperty("User-Agent", "British Radio Player/1.0 (Android)")
                    setRequestProperty("Accept-Encoding", "identity")
                    rangeHeader?.let { setRequestProperty("Range", it) }
                    for ((name, value) in headersSnapshot) {
                        setRequestProperty(name, value)
                    }
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
                val accepted = responseCode == HttpURLConnection.HTTP_OK || responseCode == HttpURLConnection.HTTP_PARTIAL
                if (!accepted) {
                    connection!!.disconnect()
                    throw IOException("Unexpected HTTP response code: $responseCode")
                }

                // Success - save the final URI and open stream
                uri = Uri.parse(currentUrl)
                inputStream = connection!!.inputStream

                // If server ignored our Range header and returned 200, manually skip to requested offset.
                if (responseCode == HttpURLConnection.HTTP_OK && position > 0L) {
                    skipFully(inputStream!!, position)
                }

                val contentLength = connection!!.contentLengthLong
                return when {
                    length != C.LENGTH_UNSET.toLong() -> length
                    responseCode == HttpURLConnection.HTTP_OK && position > 0L && contentLength > 0L ->
                        (contentLength - position).coerceAtLeast(0L)
                    contentLength >= 0L -> contentLength
                    else -> C.LENGTH_UNSET.toLong()
                }
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
        }

        override fun getUri(): Uri? = uri

        override fun getResponseHeaders(): Map<String, List<String>> {
            return connection?.headerFields?.filterKeys { it != null }?.mapKeys { it.key!! } ?: emptyMap()
        }

        override fun getResponseCode(): Int = responseCode

        override fun addTransferListener(transferListener: androidx.media3.datasource.TransferListener) {}

        override fun setRequestProperty(name: String, value: String) {
            synchronized(requestProperties) { requestProperties[name] = value }
        }
       
        override fun clearRequestProperty(name: String) {
            synchronized(requestProperties) { requestProperties.remove(name) }
        }
        
        override fun clearAllRequestProperties() {
            synchronized(requestProperties) { requestProperties.clear() }
        }

        private fun skipFully(stream: InputStream, bytesToSkip: Long) {
            var remaining = bytesToSkip
            while (remaining > 0L) {
                val skipped = stream.skip(remaining)
                if (skipped > 0L) {
                    remaining -= skipped
                    continue
                }
                val one = stream.read()
                if (one == -1) throw IOException("Unexpected EOF whilst skipping to offset")
                remaining--
            }
        }
    }
}
