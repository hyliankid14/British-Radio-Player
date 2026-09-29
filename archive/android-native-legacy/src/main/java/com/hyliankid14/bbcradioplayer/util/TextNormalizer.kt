package com.hyliankid14.bbcradioplayer.util

object TextNormalizer {
    fun normalize(s: String?): String {
        if (s == null) return ""
        val lower = s.lowercase()
        val noDiacritics = java.text.Normalizer.normalize(lower, java.text.Normalizer.Form.NFD)
            .replace(Regex("\\p{InCombiningDiacriticalMarks}+"), "")
        return noDiacritics.replace(Regex("[^\\p{L}0-9\\s]"), " ").replace(Regex("\\s+"), " ").trim()
    }
}
