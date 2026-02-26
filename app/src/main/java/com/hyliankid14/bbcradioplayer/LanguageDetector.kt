package com.hyliankid14.bbcradioplayer

import android.content.Context
import android.util.Log
import android.util.Xml
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.xmlpull.v1.XmlPullParser
import java.net.URL

object LanguageDetector {
    // A small set of common English stopwords used to help detect English language text.
    private val englishStopwords = setOf(
        "the", "and", "to", "of", "a", "in", "is", "for", "on", "with", "that", "this", "it", "as", "are", "was", "be", "by", "or"
    )
    private val nonEnglishSignals = setOf(
        "der", "die", "das", "und", "nicht", "ein", "eine", // de
        "le", "la", "les", "des", "une", "est", "dans", "pas", // fr
        "el", "los", "las", "una", "uno", "que", "con", "para", // es
        "il", "gli", "che", "non", "per", "una", "della", // it
        "het", "een", "van", "niet", // nl
        "não", "uma", "com", "para", "dos", "das", // pt
        "και", "του", "της", "στη", // el
        "это", "как", "для", "что", "или", "это", // ru
        "的", "了", "在", "是", "我", "你", // zh
        "の", "に", "は", "を", "です", // ja
        "이", "가", "은", "는", "을", "를" // ko
    )
    private val knownEnglishLanguageCodes = setOf("en", "en-gb", "en-us", "en-au", "en-ca", "eng")

    // In-memory cache for fast checks; persisted cache lives in SharedPreferences to survive restarts.
    private val memoryCache: MutableMap<String, Pair<Boolean, Long>> = mutableMapOf()
    private const val CACHE_TTL_MS = 24 * 60 * 60 * 1000L // 24 hours
    private const val PREFS_NAME = "language_detector_cache_v3"

    fun isLikelyEnglish(text: String?): Boolean {
        if (text.isNullOrBlank()) return false
        // Normalize and tokenise
        val norm = java.text.Normalizer.normalize(text, java.text.Normalizer.Form.NFD)
            .replace(Regex("\\p{InCombiningDiacriticalMarks}+"), "")
            .replace(Regex("[^\\p{L}0-9\\s]"), " ")
            .replace(Regex("\\s+"), " ")
            .trim()
            .lowercase()

        if (norm.length < 20) {
            // For very short strings fall back to measuring Latin character ratio
            val letters = norm.replace(Regex("[^\\p{L}]+"), "")
            if (letters.isEmpty()) return false
            val latinCount = letters.count { it in 'a'..'z' || it in 'A'..'Z' }
            val latinRatio = latinCount.toDouble() / letters.length.toDouble()
            val hasEnglishSignal = norm.split(' ').any { englishStopwords.contains(it) }
            return latinRatio >= 0.9 && hasEnglishSignal
        }

        val tokens = norm.split(' ').filter { it.isNotBlank() }
        val tokenCount = tokens.size
        if (tokenCount == 0) return false

        val stopwordMatches = tokens.count { englishStopwords.contains(it) }
        val stopwordRatio = stopwordMatches.toDouble() / tokenCount.toDouble()
        val nonEnglishMatches = tokens.count { nonEnglishSignals.contains(it) }
        val nonEnglishRatio = nonEnglishMatches.toDouble() / tokenCount.toDouble()

        // Latin script ratio (counts letters in Latin Unicode block)
        val lettersOnly = norm.replace(Regex("[^\\p{L}]+"), "")
        val latinLetters = lettersOnly.count { it.code in 0x0041..0x007A } // rough Latin range
        val latinRatio = if (lettersOnly.isEmpty()) 0.0 else latinLetters.toDouble() / lettersOnly.length.toDouble()

        // Heuristic: require a reasonable latin script presence and some English stopwords
        if (nonEnglishRatio >= 0.08 && stopwordRatio < 0.12) return false
        return (latinRatio >= 0.75 && stopwordRatio >= 0.08) || (latinRatio >= 0.92 && stopwordRatio >= 0.05) || stopwordRatio >= 0.14
    }

    // Use ML Kit when available (on-device) for stronger detection. This is suspend and intended to be called
    // from a coroutine context so we can make network/ML calls without blocking.
    suspend fun isPodcastEnglish(context: Context, podcast: Podcast): Boolean {
        // Fast check: if cached recently, honour the cached result
        val key = podcast.rssUrl.ifEmpty { podcast.htmlUrl }
        val cached = getCachedResult(context, key)
        if (cached != null && (System.currentTimeMillis() - cached.second) < CACHE_TTL_MS) return cached.first

        // Quick heuristic using title+description first (cheap)
        val heading = listOfNotNull(podcast.title, podcast.description).joinToString(" ")

        // Prefer RSS channel language when available, then sample item text heuristics.
        try {
            val (rssLang, samples) = fetchRssLanguageAndSamples(podcast.rssUrl)
            if (rssLang != null) {
                val lang = rssLang.trim().lowercase()
                val result = knownEnglishLanguageCodes.contains(lang) || lang.startsWith("en-")
                Log.d("LanguageDetector", "RSS <language>='$lang' for podcast key=$key -> english=$result")
                putCachedResult(context, key, result)
                return result
            }

            val nonEmptySamples = samples.filter { it.isNotBlank() }
            if (nonEmptySamples.isNotEmpty()) {
                // Heuristic vote across sampled RSS entries
                val votes = nonEmptySamples.map { isLikelyEnglish(it) }
                val yes = votes.count { it }
                val ratio = yes.toDouble() / votes.size.toDouble()
                val result = yes >= 2 && ratio >= 0.67
                Log.d("LanguageDetector", "Heuristic sample vote for key=$key -> yes=$yes total=${votes.size} ratio=$ratio english=$result")
                putCachedResult(context, key, result)
                return result
            }
        } catch (e: Exception) {
            Log.w("LanguageDetector", "RSS language/sample detection failed for ${podcast.rssUrl}: ${e.message}")
        }

        // Final fallback to the original title+description heuristic
        val final = isLikelyEnglish(heading)
        putCachedResult(context, key, final)
        return final
    }

    private suspend fun fetchRssLanguageAndSamples(rssUrl: String): Pair<String?, List<String>> = withContext(Dispatchers.IO) {
        if (rssUrl.isBlank()) return@withContext null to emptyList()
        val samples = mutableListOf<String>()
        try {
            val connection = URL(rssUrl).openConnection() as java.net.HttpURLConnection
            connection.instanceFollowRedirects = true
            connection.connectTimeout = 5000
            connection.readTimeout = 5000
            connection.requestMethod = "GET"
            connection.setRequestProperty("User-Agent", "BBC Radio Player/1.0 (Android)")

            val code = connection.responseCode
            if (code != 200) {
                connection.disconnect()
                return@withContext null to emptyList()
            }

            connection.inputStream.use { stream ->
                val parser = Xml.newPullParser()
                parser.setInput(stream, null)
                var eventType = parser.eventType
                var inChannel = false
                var inItem = false
                var title = ""
                var description = ""
                var foundLang: String? = null
                var itemsSeen = 0

                while (eventType != XmlPullParser.END_DOCUMENT && (foundLang == null && itemsSeen < 6)) {
                    when (eventType) {
                        XmlPullParser.START_TAG -> {
                            when (parser.name.lowercase()) {
                                "channel" -> inChannel = true
                                "language" -> if (inChannel) {
                                    if (parser.next() == XmlPullParser.TEXT) {
                                        foundLang = parser.text
                                    }
                                }
                                "item" -> { inItem = true; title = ""; description = "" }
                                "title" -> if (inItem && parser.next() == XmlPullParser.TEXT) title = parser.text
                                "description" -> if (inItem && parser.next() == XmlPullParser.TEXT) description = parser.text
                                "encoded" -> if (inItem && parser.next() == XmlPullParser.TEXT) description = parser.text
                            }
                        }
                        XmlPullParser.END_TAG -> {
                            if (parser.name.equals("item", true)) {
                                val combined = listOfNotNull(title, description).joinToString(" ")
                                if (combined.isNotBlank()) samples.add(combined)
                                itemsSeen++
                                inItem = false
                            }
                        }
                    }
                    eventType = parser.next()
                }

                connection.disconnect()
                return@withContext foundLang to samples
            }
        } catch (e: Exception) {
            Log.w("LanguageDetector", "Failed to fetch RSS $rssUrl: ${e.message}")
            return@withContext null to emptyList()
        }
    }

    private fun getCachedResult(context: Context, key: String): Pair<Boolean, Long>? {
        memoryCache[key]?.let {
            Log.d("LanguageDetector", "getCachedResult: memory hit key=${key} -> ${it.first}")
            return it
        }
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val sub = "ld_${key.hashCode()}"
        if (!prefs.contains("${sub}_ts")) {
            Log.d("LanguageDetector", "getCachedResult: no persisted value for key=${key}")
            return null
        }
        val res = prefs.getBoolean("${sub}_res", false)
        val ts = prefs.getLong("${sub}_ts", 0L)
        val pair = res to ts
        memoryCache[key] = pair
        Log.d("LanguageDetector", "getCachedResult: persisted key=${key} -> $res (ts=$ts)")
        return pair
    }

    private fun putCachedResult(context: Context, key: String, result: Boolean) {
        val ts = System.currentTimeMillis()
        memoryCache[key] = result to ts
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val sub = "ld_${key.hashCode()}"
        prefs.edit().putBoolean("${sub}_res", result).putLong("${sub}_ts", ts).apply()
        Log.d("LanguageDetector", "putCachedResult: persisted key=${key} -> $result (ts=$ts)")
    }

    // Optionally clear cache (useful for tests)
    fun clearCache() { memoryCache.clear() }
    fun clearCache(context: Context) {
        memoryCache.clear()
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().clear().apply()
    }

    /**
     * Synchronous helper to check persisted cache for a podcast language result. Returns
     * true/false iff a recent persisted result exists, otherwise null.
     */
    fun persistedIsPodcastEnglish(context: Context, podcast: Podcast): Boolean? {
        val key = podcast.rssUrl.ifEmpty { podcast.htmlUrl }
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val sub = "ld_${key.hashCode()}"
        if (!prefs.contains("${sub}_ts")) return null
        val ts = prefs.getLong("${sub}_ts", 0L)
        if (System.currentTimeMillis() - ts > CACHE_TTL_MS) return null
        return prefs.getBoolean("${sub}_res", false)
    }
}
