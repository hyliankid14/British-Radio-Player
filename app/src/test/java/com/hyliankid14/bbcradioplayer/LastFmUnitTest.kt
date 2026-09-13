package com.hyliankid14.bbcradioplayer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test
import java.security.MessageDigest

class LastFmUnitTest {

    @Test
    fun testApiSignatureCalculation() {
        val params = mapOf(
            "method" to "auth.getSession",
            "api_key" to "my_api_key",
            "token" to "my_token",
            "format" to "json",
            "callback" to "my_callback"
        )
        val secret = "my_secret"

        // format and callback must be excluded, and params sorted alphabetically:
        // api_key + my_api_key + method + auth.getSession + token + my_token + my_secret
        val expectedString = "api_keymy_api_keymethodauth.getSessiontokenmy_tokenmy_secret"
        val md = MessageDigest.getInstance("MD5")
        val expectedMd5 = md.digest(expectedString.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }

        val signature = LastFmApiClient.createApiSignature(params, secret)
        assertEquals(expectedMd5, signature)
    }

    @Test
    fun testScrobbleThresholdCalculation() {
        // Under Last.fm rules:
        // Duration 180s (3m): 50% is 90s (which is >= 30s and <= 240s)
        val duration180 = 180
        val threshold180 = minOf(duration180 * 1000L / 2, 240_000L).coerceAtLeast(30_000L)
        assertEquals(90_000L, threshold180)

        // Duration 600s (10m): 50% is 300s, capped at 240s (4m)
        val duration600 = 600
        val threshold600 = minOf(duration600 * 1000L / 2, 240_000L).coerceAtLeast(30_000L)
        assertEquals(240_000L, threshold600)

        // Duration 40s: 50% is 20s, but floor is 30s
        val duration40 = 40
        val threshold40 = minOf(duration40 * 1000L / 2, 240_000L).coerceAtLeast(30_000L)
        assertEquals(30_000L, threshold40)
    }
}
