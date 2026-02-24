package com.hyliankid14.bbcradioplayer

import java.text.SimpleDateFormat
import java.util.Locale

object EpisodeDateParser {
    private val DATE_FORMATS = object : ThreadLocal<List<SimpleDateFormat>>() {
        override fun initialValue(): List<SimpleDateFormat> {
            return listOf(
                "EEE, dd MMM yyyy HH:mm:ss Z",
                "EEE, dd MMM yyyy HH:mm:ss z",
                "dd MMM yyyy HH:mm:ss Z",
                "dd MMM yyyy HH:mm:ss z",
                "EEE, dd MMM yyyy HH:mm:ss",
                "EEE, dd MMM yyyy HH",
                "dd MMM yyyy HH",
                "EEE, dd MMM yyyy",
                "dd MMM yyyy"
            ).map { SimpleDateFormat(it, Locale.US) }
        }
    }

    fun parsePubDateToEpoch(raw: String?): Long {
        if (raw.isNullOrBlank()) return 0L
        val formats = DATE_FORMATS.get() ?: return 0L
        for (format in formats) {
            try {
                val parsed = format.parse(raw)
                if (parsed != null) return parsed.time
            } catch (_: Exception) {
                // Try next pattern.
            }
        }
        return 0L
    }
}
