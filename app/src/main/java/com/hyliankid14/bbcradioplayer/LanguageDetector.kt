package com.hyliankid14.bbcradioplayer

import android.content.Context
import android.util.Log
import android.util.Xml
import com.google.mlkit.nl.languageid.LanguageIdentification
import com.google.mlkit.nl.languageid.LanguageIdentifier
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import org.xmlpull.v1.XmlPullParser
import java.net.URL
import kotlin.coroutines.resume

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
        "이", "가", "은", "는", "을", "를", // ko
        "yr", "yn", "ac", "mae", "newyddion", "cymru", "peldroed", // cy (Welsh)
        "agus", "tha", "bha", "ann", "nach", "ach", "dhan", "aig", "nam", "nan", // gd (Scottish Gaelic)
        "orm", "faoi" // ga (Irish Gaelic) — accent-free distinctive words; accented forms (tá, níl, féin) are stripped by normalization
    )
    private val knownEnglishLanguageCodes = setOf("en", "en-gb", "en-us", "en-au", "en-ca", "eng")
    
    // Explicit list of common non-English language codes to immediately reject.
    // This prevents feeds that lack strong non-Latin signal or clear stopwords from
    // slipping through heuristic checks when they are explicitly tagged as non-English.
    private val knownNonEnglishLanguageCodes = setOf(
        "cy", "cy-gb", // Welsh
        "gd", "gd-gb", // Scottish Gaelic
        "ga", "ga-ie", // Irish
        "fr", "fr-fr", // French
        "de", "de-de", // German
        "es", "es-es", // Spanish
        "it", "it-it", // Italian
        "nl", "nl-nl", // Dutch
        "pt", "pt-pt", "pt-br", // Portuguese
        "ru", "ru-ru", // Russian
        "zh", "zh-cn", "zh-tw", // Chinese
        "ja", "ja-jp", // Japanese
        "ko", "ko-kr", // Korean
        "ar", "ar-sa", // Arabic
        "hi", "hi-in", // Hindi
        "ur", "ur-pk", // Urdu
        "bn", "bn-bd", // Bengali
        "ta", "ta-in", // Tamil
        "tr", "tr-tr", // Turkish
        "pl", "pl-pl", // Polish
        "sv", "sv-se", "sv-fi", // Swedish
        "no", "no-no", "nb", "nn", // Norwegian
        "da", "da-dk", // Danish
        "fi", "fi-fi" // Finnish
    )

    // In-memory cache for fast checks; persisted cache lives in SharedPreferences to survive restarts.
    private val memoryCache: MutableMap<String, Pair<Boolean, Long>> = mutableMapOf()
    private const val CACHE_TTL_MS = 24 * 60 * 60 * 1000L // 24 hours
    private const val PREFS_NAME = "language_detector_cache_v5"
    private val languageIdentifier: LanguageIdentifier by lazy {
        LanguageIdentification.getClient(
            com.google.mlkit.nl.languageid.LanguageIdentificationOptions.Builder()
                .setConfidenceThreshold(0.55f)
                .build()
        )
    }

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

    // Google ML Kit language detection with RSS/script/heuristic fallbacks.
    suspend fun isPodcastEnglish(context: Context, podcast: Podcast): Boolean {
        // Fast check: if cached recently, honour the cached result
        val key = podcast.rssUrl.ifEmpty { podcast.htmlUrl }
        val cached = getCachedResult(context, key)
        if (cached != null && (System.currentTimeMillis() - cached.second) < CACHE_TTL_MS) return cached.first

        // Quick heuristic using title+description first (cheap)
        val heading = listOfNotNull(podcast.title, podcast.description).joinToString(" ")

        // RSS language is only a hint; validate with sample/script evidence.
        try {
            val (rssLang, samples) = fetchRssLanguageAndSamples(podcast.rssUrl)
            val signalText = buildString {
                append(heading)
                if (samples.isNotEmpty()) {
                    append(' ')
                    append(samples.joinToString(" "))
                }
            }

            if (hasStrongNonLatinSignal(signalText)) {
                putCachedResult(context, key, false)
                return false
            }

            if (rssLang != null) {
                val lang = rssLang.trim().lowercase()
                if (knownNonEnglishLanguageCodes.contains(lang)) {
                    Log.d("LanguageDetector", "RSS <language>='$lang' is known non-English for podcast key=$key -> english=false")
                    putCachedResult(context, key, false)
                    return false
                }
                val isEnglishTag = knownEnglishLanguageCodes.contains(lang) || lang.startsWith("en-")
                if (!isEnglishTag) {
                    Log.d("LanguageDetector", "RSS <language>='$lang' for podcast key=$key -> english=false")
                    putCachedResult(context, key, false)
                    return false
                }
            }

            val nonEmptySamples = samples.filter { it.isNotBlank() }
            if (nonEmptySamples.isNotEmpty()) {
                // First try ML Kit voting across RSS samples.
                val mlVotes = mutableListOf<Boolean>()
                for (sample in nonEmptySamples.take(4)) {
                    if (hasStrongNonLatinSignal(sample)) {
                        mlVotes.add(false)
                        continue
                    }
                    when (detectIsEnglishWithMlKit(sample)) {
                        true -> mlVotes.add(true)
                        false -> mlVotes.add(false)
                        null -> {}
                    }
                }

                if (mlVotes.isNotEmpty()) {
                    val yes = mlVotes.count { it }
                    val requiredYes = if (mlVotes.size <= 2) mlVotes.size else kotlin.math.ceil(mlVotes.size * 0.67).toInt()
                    val result = yes >= requiredYes
                    Log.d("LanguageDetector", "ML Kit sample vote for key=$key -> yes=$yes total=${mlVotes.size} english=$result")
                    putCachedResult(context, key, result)
                    return result
                }

                // Fallback: heuristic vote across sampled RSS entries
                val votes = nonEmptySamples.map { sample ->
                    !hasStrongNonLatinSignal(sample) && isLikelyEnglish(sample)
                }
                val yes = votes.count { it }
                val ratio = yes.toDouble() / votes.size.toDouble()
                val requiredYes = if (votes.size <= 2) votes.size else kotlin.math.ceil(votes.size * 0.67).toInt()
                val result = yes >= requiredYes
                Log.d("LanguageDetector", "Heuristic sample vote for key=$key -> yes=$yes total=${votes.size} ratio=$ratio english=$result")
                putCachedResult(context, key, result)
                return result
            }
        } catch (e: Exception) {
            Log.w("LanguageDetector", "RSS language/sample detection failed for ${podcast.rssUrl}: ${e.message}")
        }

        // Try ML Kit on the heading when RSS sampling is unavailable.
        if (!hasStrongNonLatinSignal(heading)) {
            when (detectIsEnglishWithMlKit(heading)) {
                true -> {
                    putCachedResult(context, key, true)
                    return true
                }
                false -> {
                    putCachedResult(context, key, false)
                    return false
                }
                null -> {}
            }
        }

        // Final fallback: conservative to avoid letting non-English feeds through when exclude is enabled.
        val final = heading.length >= 20 && !hasStrongNonLatinSignal(heading) && isLikelyEnglish(heading)
        putCachedResult(context, key, final)
        return final
    }

    private fun hasStrongNonLatinSignal(text: String): Boolean {
        if (text.isBlank()) return false
        val letters = text.filter { it.isLetter() }
        if (letters.length < 8) return false
        val nonLatin = letters.count { Character.UnicodeScript.of(it.code) != Character.UnicodeScript.LATIN }
        val ratio = nonLatin.toDouble() / letters.length.toDouble()
        return ratio >= 0.25
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
            connection.setRequestProperty("User-Agent", "British Radio Player/1.0 (Android)")

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

                while (eventType != XmlPullParser.END_DOCUMENT && itemsSeen < 6) {
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
                                "content:encoded" -> if (inItem && parser.next() == XmlPullParser.TEXT) description = parser.text
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

    private suspend fun detectIsEnglishWithMlKit(text: String): Boolean? {
        val input = text.trim()
        if (input.length < 20) return null
        return try {
            val code = identifyLanguageSuspending(input.take(4000)) ?: return null
            when {
                code.equals("und", ignoreCase = true) -> null
                code.equals("en", ignoreCase = true) -> true
                code.startsWith("en-", ignoreCase = true) -> true
                else -> false
            }
        } catch (e: Exception) {
            Log.w("LanguageDetector", "ML Kit language detection failed: ${e.message}")
            null
        }
    }

    private suspend fun identifyLanguageSuspending(text: String): String? =
        suspendCancellableCoroutine { cont ->
            languageIdentifier.identifyLanguage(text)
                .addOnSuccessListener { lang ->
                    if (cont.isActive) cont.resume(lang)
                }
                .addOnFailureListener { _ ->
                    if (cont.isActive) cont.resume(null)
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
