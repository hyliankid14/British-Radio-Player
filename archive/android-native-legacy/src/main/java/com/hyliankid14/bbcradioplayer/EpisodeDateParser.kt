package com.hyliankid14.bbcradioplayer

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

object EpisodeDateParser {
    private val DATE_FORMATS = object : ThreadLocal<List<SimpleDateFormat>>() {
        override fun initialValue(): List<SimpleDateFormat> {
            return listOf(
                "EEE, dd MMM yyyy HH:mm:ss Z",
                "EEE, dd MMM yyyy HH:mm:ss z",
                "EEE, d MMM yyyy HH:mm:ss Z",
                "EEE, d MMM yyyy HH:mm:ss z",
                "dd MMM yyyy HH:mm:ss Z",
                "dd MMM yyyy HH:mm:ss z",
                "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
                "yyyy-MM-dd'T'HH:mm:ssXXX",
                "yyyy-MM-dd'T'HH:mm:ss'Z'",
                "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
                "yyyy-MM-dd'T'HH:mm:ss",
                "yyyy-MM-dd HH:mm:ss",
                "yyyy-MM-dd",
                "EEE, dd MMM yyyy HH:mm:ss",
                "EEE, dd MMM yyyy HH",
                "dd MMM yyyy HH",
                "EEE, dd MMM yyyy",
                "dd MMM yyyy"
            ).map { pattern ->
                SimpleDateFormat(pattern, Locale.US).apply {
                    isLenient = false
                    if (!pattern.contains("Z") && !pattern.contains("z") && !pattern.contains("X")) {
                        timeZone = TimeZone.getTimeZone("UTC")
                    }
                }
            }
        }
    }

    fun parsePubDate(raw: String?): Date? {
        val normalised = normaliseDate(raw) ?: return null
        val formats = DATE_FORMATS.get() ?: return null
        for (format in formats) {
            try {
                val parsed = format.parse(normalised)
                if (parsed != null) return parsed
            } catch (_: Exception) {
                // Try next pattern.
            }
        }
        return null
    }

    fun parsePubDateToEpoch(raw: String?): Long {
        return parsePubDate(raw)?.time ?: 0L
    }

    fun parsePubDateToEpochOrNull(raw: String?): Long? {
        return parsePubDate(raw)?.time
    }

    private fun normaliseDate(raw: String?): String? {
        if (raw.isNullOrBlank()) return null
        return raw
            .trim()
            .replace("UTC", "+0000")
            .replace(Regex("\\s+GMT$", RegexOption.IGNORE_CASE), " +0000")
            .replace(Regex("\\s+UT$", RegexOption.IGNORE_CASE), " +0000")
            .replace(Regex("([+-]\\d{2}):(\\d{2})$"), "$1$2")
    }
}
