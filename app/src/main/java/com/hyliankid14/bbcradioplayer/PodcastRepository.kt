package com.hyliankid14.bbcradioplayer

import android.content.Context
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.*

class PodcastRepository(private val context: Context) {
    private val cacheFile = File(context.cacheDir, "podcasts_cache.json")
    private val cacheTTL = 24 * 60 * 60 * 1000 // 24 hours in milliseconds
    private val updatesCacheFile = File(context.cacheDir, "podcast_updates_cache.json")
    private val updatesCacheTTL = 6 * 60 * 60 * 1000 // 6 hours

    // In-memory cache of fetched episode metadata to support searching episode titles/descriptions
    // Prefill this in the background when the podcast list is loaded so searches don't trigger network on each keystroke
    private val episodesCache: MutableMap<String, List<Episode>> = mutableMapOf()

    // Lowercased index for episodes for fast, case-insensitive phrase checks. Kept in same order as episodesCache
    private val episodesIndex: MutableMap<String, List<Pair<String, String>>> = mutableMapOf()

    // Lightweight lowercased index for fast case-insensitive podcast title/description checks
    private val podcastSearchIndex: MutableMap<String, Pair<String, String>> = mutableMapOf()

    private fun indexPodcasts(podcasts: List<Podcast>) {
        podcasts.forEach { p ->
            podcastSearchIndex[p.id] = p.title.lowercase(Locale.getDefault()) to p.description.lowercase(Locale.getDefault())
        }
    }

    private fun containsPhraseOrAllTokens(textLower: String, queryLower: String): Boolean {
        // Normalize both text and query by removing diacritics, non-alphanumeric characters and collapsing whitespace
        val normalize = { s: String ->
            val noDiacritics = java.text.Normalizer.normalize(s, java.text.Normalizer.Form.NFD)
                .replace(Regex("\\p{InCombiningDiacriticalMarks}+"), "")
            noDiacritics.replace(Regex("[^\\p{L}0-9\\s]"), " ").replace(Regex("\\s+"), " ").trim()
        }
        val textNorm = normalize(textLower)
        val queryNorm = normalize(queryLower)

        // Word-boundary phrase match: the query must appear at the start of a word
        if (textNorm.contains(Regex("\\b${Regex.escape(queryNorm)}"))) return true

        // Token proximity: ensure all tokens from the query are present in reasonable proximity
        val tokens = queryNorm.split(Regex("\\s+")).filter { it.isNotEmpty() }
        if (tokens.size <= 1) return false
        
        // First check if all tokens exist at word boundaries
        if (!tokens.all { textNorm.contains(Regex("\\b${Regex.escape(it)}")) }) return false
        
        // For 2-token queries, check if they appear within 50 words of each other
        // For 3+ token queries, use simpler all-tokens-present check
        if (tokens.size == 2) {
            val words = textNorm.split(Regex("\\s+"))
            val idx0 = words.indexOfFirst { it.startsWith(tokens[0]) }
            val idx1 = words.indexOfFirst { it.startsWith(tokens[1]) }
            if (idx0 >= 0 && idx1 >= 0) {
                return kotlin.math.abs(idx0 - idx1) <= 50
            }
            return false
        }
        
        return true
    }

    // Public helper so other classes can check normalized phrase/token-AND matches using repository logic
    fun textMatchesNormalized(text: String, query: String): Boolean {
        if (isAdvancedQuery(query)) return true
        val textLower = text.lowercase(Locale.getDefault())
        val queryLower = query.lowercase(Locale.getDefault())
        return containsPhraseOrAllTokens(textLower, queryLower)
    }

    /**
     * Extract plain-text phrases from an advanced query for contains-checking.
     * Splits on OR boundaries, strips quotes, operators and wildcards, normalizes whitespace.
     * e.g. '"Donald Trump" OR "President Trump"' → ["donald trump", "president trump"]
     */
    private fun extractPlainTermsFromQuery(query: String): List<String> {
        val normalize = { s: String ->
            val noDiacritics = java.text.Normalizer.normalize(s, java.text.Normalizer.Form.NFD)
                .replace(Regex("\\p{InCombiningDiacriticalMarks}+"), "")
            noDiacritics.replace(Regex("[^\\p{L}0-9\\s]"), " ").replace(Regex("\\s+"), " ").trim()
                .lowercase(Locale.getDefault())
        }
        // Split on OR operator boundaries (space-delimited, case-insensitive)
        val parts = query.split(Regex("(?i)(?<=\\s)OR(?=\\s)|^OR(?=\\s)|(?<=\\s)OR$"))
            .flatMap { it.split(Regex("(?i)\\bOR\\b")) }
        return parts.map { normalize(it) }.filter { it.isNotEmpty() }
    }

    /**
     * For FTS podcast results, determine whether the match is in the title.
     * For advanced/OR queries, checks if any plain term extracted from the query
     * appears in the title — avoids the always-true shortcut of textMatchesNormalized.
     */
    private fun ftsMatchesTitle(fts: com.hyliankid14.bbcradioplayer.db.PodcastFts, query: String): Boolean {
        if (!isAdvancedQuery(query)) return textMatchesNormalized(fts.title, query)
        val titleLower = fts.title.lowercase(Locale.getDefault())
        return extractPlainTermsFromQuery(query).any { term ->
            term.isNotEmpty() && containsPhraseOrAllTokens(titleLower, term)
        }
    }

    /**
     * For FTS podcast results, determine whether the match is in the description.
     * Mirrors ftsMatchesTitle but operates on the description field.
     */
    private fun ftsMatchesDescription(fts: com.hyliankid14.bbcradioplayer.db.PodcastFts, query: String): Boolean {
        if (!isAdvancedQuery(query)) return textMatchesNormalized(fts.description, query)
        val descLower = fts.description.lowercase(Locale.getDefault())
        return extractPlainTermsFromQuery(query).any { term ->
            term.isNotEmpty() && containsPhraseOrAllTokens(descLower, term)
        }
    }

    private fun isAdvancedQuery(query: String): Boolean {
        val q = query.trim()
        if (q.isEmpty()) return false
        if (q.contains('"') || q.contains('(') || q.contains(')')) return true
        val upper = q.uppercase(Locale.getDefault())
        if (upper.contains(" AND ") || upper.contains(" OR ") || upper.contains(" NEAR")) return true
        // FTS4 uses - prefix for NOT (e.g., "climate -politics")
        if (q.contains(" -")) return true
        return q.contains('*') || q.contains(':')
    }

    /**
     * Check whether text matches any clause of a (possibly OR-compound) query.
     * Splits on OR boundaries so that "donald trump" or "president trump" each
     * get checked individually rather than as a single all-tokens expression.
     */
    private fun textMatchesAnyClauses(text: String, queryLower: String): Boolean {
        val clauses = extractPlainTermsFromQuery(queryLower)
        if (clauses.size > 1) return clauses.any { containsPhraseOrAllTokens(text, it) }
        return containsPhraseOrAllTokens(text, queryLower)
    }

    fun podcastMatches(podcast: Podcast, queryLower: String): Boolean {
        val pair = podcastSearchIndex[podcast.id]
        if (pair != null) {
            val (titleLower, descLower) = pair
            if (textMatchesAnyClauses(titleLower, queryLower)) return true
            if (textMatchesAnyClauses(descLower, queryLower)) return true
            return false
        }
        val tl = podcast.title.lowercase(Locale.getDefault())
        val dl = podcast.description.lowercase(Locale.getDefault())
        return textMatchesAnyClauses(tl, queryLower) || textMatchesAnyClauses(dl, queryLower)
    }

    /**
     * Return whether the query matches podcast title or description, or null if none. Returns
     * "title" or "description" to let callers prioritise where it matched.
     */
    fun podcastMatchKind(podcast: Podcast, queryLower: String): String? {
        val pair = podcastSearchIndex[podcast.id]
        val titleLower = pair?.first ?: podcast.title.lowercase(Locale.getDefault())
        val descLower = pair?.second ?: podcast.description.lowercase(Locale.getDefault())
        if (textMatchesAnyClauses(titleLower, queryLower)) return "title"
        if (textMatchesAnyClauses(descLower, queryLower)) return "description"
        return null
    }

    /**
     * Search cached episodes for a podcast quickly using precomputed lowercase index.
     * Returns up to maxResults Episode objects (keeps original Episode objects from cache).
     */
    fun searchCachedEpisodes(podcastId: String, queryLower: String, maxResults: Int = 3): List<Episode> {
        val eps = episodesCache[podcastId] ?: return emptyList()
        val idx = episodesIndex[podcastId] ?: return emptyList()
        val titleMatches = mutableListOf<Episode>()
        val descMatches = mutableListOf<Episode>()

        for (i in idx.indices) {
            val (titleLower, descLower) = idx[i]
            if (containsPhraseOrAllTokens(titleLower, queryLower)) {
                titleMatches.add(eps[i])
                android.util.Log.d("PodcastRepository", "searchCachedEpisodes: title matched podcast=$podcastId episode='${eps[i].title}' for query='$queryLower'")
            } else if (containsPhraseOrAllTokens(descLower, queryLower)) {
                descMatches.add(eps[i])
                android.util.Log.d("PodcastRepository", "searchCachedEpisodes: description matched podcast=$podcastId episode='${eps[i].title}' for query='$queryLower'")
            }
            if (titleMatches.size >= maxResults) break
            // continue scanning to collect description matches if needed
        }

        // Merge, preferring title matches first, then description matches up to maxResults
        val combined = mutableListOf<Episode>()
        combined.addAll(titleMatches)
        if (combined.size < maxResults) {
            combined.addAll(descMatches.take(maxResults - combined.size))
        }
        return combined
    }

    suspend fun fetchPodcasts(forceRefresh: Boolean = false): List<Podcast> = withContext(Dispatchers.IO) {
        try {
            val cachedData = if (!forceRefresh) getCachedPodcasts() else null
            if (cachedData != null && cachedData.isNotEmpty()) {
                Log.d("PodcastRepository", "Returning cached podcasts")
                // If the user does NOT want to exclude non-English shows, just return cache immediately.
                if (!PodcastFilterPreference.excludeNonEnglish(context)) return@withContext cachedData

                // Otherwise, apply language filtering to the cached results. Use persisted detector results
                // where available and run ML checks (batched) for unknowns to avoid blocking too long.
                val knownIncluded = mutableListOf<Podcast>()
                val unknowns = mutableListOf<Podcast>()
                for (p in cachedData) {
                    val persisted = LanguageDetector.persistedIsPodcastEnglish(context, p)
                    when (persisted) {
                        true -> knownIncluded.add(p)
                        false -> {} // explicitly exclude
                        null -> unknowns.add(p)
                    }
                }

                if (unknowns.isEmpty()) {
                    Log.d("PodcastRepository", "Returning filtered cached podcasts (no unknowns) size=${knownIncluded.size}")
                    return@withContext knownIncluded
                }

                // Check unknowns in limited parallel batches
                val batchResults = mutableListOf<Podcast>()
                val concurrency = 12
                val chunks = unknowns.chunked(concurrency)
                for (chunk in chunks) {
                    val resolved = coroutineScope {
                        val deferred = chunk.map { p -> async { p to LanguageDetector.isPodcastEnglish(context, p) } }
                        deferred.awaitAll()
                    }
                    batchResults.addAll(resolved.filter { it.second }.map { it.first })
                }

                val finalFiltered = knownIncluded + batchResults
                val excluded = cachedData.filter { it.id !in finalFiltered.map { p -> p.id } }
                Log.d("PodcastRepository", "Returning filtered cached podcasts: kept=${finalFiltered.size} excluded=${excluded.size} excludedSample=${excluded.take(6).map { it.title }}")
                return@withContext finalFiltered
            }

            Log.d("PodcastRepository", "Fetching podcasts from BBC OPML feed")
            val podcasts = OPMLParser.fetchAndParseOPML(
                "https://www.bbc.co.uk/radio/opml/bbc_podcast_opml.xml"
            )

            if (podcasts.isNotEmpty()) {
                // Optionally filter out non-English podcasts per user preference.
                // Language checks may involve fetching RSS metadata; run in limited parallel batches so we don't serially block on many feeds.
                val filtered = if (PodcastFilterPreference.excludeNonEnglish(context)) {
                    val results = mutableListOf<Podcast>()
                    val concurrency = 12
                    val chunks = podcasts.chunked(concurrency)
                    for (chunk in chunks) {
                        val resolved = coroutineScope {
                            val deferred = chunk.map { p -> async { p to LanguageDetector.isPodcastEnglish(context, p) } }
                            deferred.awaitAll()
                        }
                        val kept = resolved.filter { it.second }.map { it.first }
                    results.addAll(kept)
                    android.util.Log.d("PodcastRepository", "Batch filter kept=${kept.size} sample=${kept.take(6).map { it.title }}")
                    }
                    results
                } else podcasts
                // Always cache the full unfiltered list so that toggling the language
                // filter does not permanently lose non-English podcasts from the cache.
                cachePodcasts(podcasts)
                filtered
            } else {
                // Try cache as fallback
                getCachedPodcasts() ?: emptyList()
            }
        } catch (e: Exception) {
            Log.e("PodcastRepository", "Error fetching podcasts", e)
            getCachedPodcasts() ?: emptyList()
        }
    }

    suspend fun fetchEpisodes(podcast: Podcast): List<Episode> = withContext(Dispatchers.IO) {
        try {
            Log.d("PodcastRepository", "Fetching episodes for ${podcast.title}")
            RSSParser.fetchAndParseRSS(podcast.rssUrl, podcast.id)
        } catch (e: Exception) {
            Log.e("PodcastRepository", "Error fetching episodes", e)
            emptyList()
        }
    }

    suspend fun fetchEpisodesPaged(podcast: Podcast, startIndex: Int, count: Int): List<Episode> = withContext(Dispatchers.IO) {
        try {
            Log.d("PodcastRepository", "Fetching episodes page for ${podcast.title} start=$startIndex count=$count")
            // Always fetch and cache the full episode list so that pagination is consistent
            // regardless of the BBC feed's native sort order (some feeds are oldest-first).
            // Subsequent calls for the same podcast reuse the in-memory cache to avoid
            // redundant HTTP requests and to guarantee stable pagination.
            // The cache lives for the lifetime of this PodcastRepository instance (i.e. the
            // current screen/session). It is not persisted to disk, so it is effectively
            // cleared on app restart. It can also be bypassed via fetchEpisodesIfNeeded with
            // forceRefresh=true for an explicit pull-to-refresh flow.
            val all = episodesCache[podcast.id]?.takeIf { it.isNotEmpty() } ?: run {
                val eps = RSSParser.fetchAndParseRSS(podcast.rssUrl, podcast.id)
                if (eps.isNotEmpty()) {
                    episodesCache[podcast.id] = eps
                    episodesIndex[podcast.id] = eps.map { it.title.lowercase(Locale.getDefault()) to it.description.lowercase(Locale.getDefault()) }
                }
                eps
            }
            if (all.isEmpty()) return@withContext emptyList()

            val sorted = sortEpisodesForPodcast(podcast.id, all)
            val from = startIndex.coerceAtLeast(0)
            val to = kotlin.math.min(sorted.size, startIndex + count)
            if (from >= to) return@withContext emptyList()
            return@withContext sorted.subList(from, to)
        } catch (e: Exception) {
            Log.e("PodcastRepository", "Error fetching paged episodes", e)
            emptyList()
        }
    }

    fun sortEpisodesForPodcast(podcastId: String, episodes: List<Episode>): List<Episode> {
        val datedEpisodes = episodes.mapIndexed { index, episode ->
            IndexedEpisode(
                episode = episode,
                epochMs = EpisodeDateParser.parsePubDateToEpochOrNull(episode.pubDate),
                originalIndex = index
            )
        }

        val sorted = when (PodcastEpisodeSortPreference.getOrder(context, podcastId)) {
            PodcastEpisodeSortPreference.Order.NEWEST_FIRST -> {
                datedEpisodes.sortedWith(
                    compareByDescending<IndexedEpisode> { it.epochMs != null }
                        .thenByDescending { it.epochMs ?: Long.MIN_VALUE }
                        .thenBy { it.originalIndex }
                )
            }
            PodcastEpisodeSortPreference.Order.OLDEST_FIRST -> {
                datedEpisodes.sortedWith(
                    compareByDescending<IndexedEpisode> { it.epochMs != null }
                        .thenBy { it.epochMs ?: Long.MAX_VALUE }
                        .thenBy { it.originalIndex }
                )
            }
        }

        return sorted.map { it.episode }
    }

    private data class IndexedEpisode(
        val episode: Episode,
        val epochMs: Long?,
        val originalIndex: Int
    )

    /**
     * Prefetch episode metadata for the provided podcasts and store in-memory.
     * This is intentionally best-effort and failures are silently ignored so we don't
     * surface network errors to the filter/search flow.
     */
    suspend fun prefetchEpisodesForPodcasts(podcasts: List<Podcast>, limit: Int = Int.MAX_VALUE) = withContext(Dispatchers.IO) {
        // Best-effort prefetch for a limited set of podcasts (default: all). Failures are ignored.
        podcasts.take(limit).forEach { p ->
            if (episodesCache.containsKey(p.id)) return@forEach
            try {
                val eps = RSSParser.fetchAndParseRSS(p.rssUrl, p.id)
                if (eps.isNotEmpty()) {
                    episodesCache[p.id] = eps
                    // Build lowercased index for quick phrase lookups
                    episodesIndex[p.id] = eps.map { it.title.lowercase(Locale.getDefault()) to it.description.lowercase(Locale.getDefault()) }
                }
            } catch (e: Exception) {
                Log.w("PodcastRepository", "Failed to prefetch episodes for ${p.title}: ${e.message}")
            }
        }
    }

    /**
     * Return cached episodes for a podcast if available; null if not cached yet.
     */
    fun getEpisodesFromCache(podcastId: String): List<Episode>? {
        return episodesCache[podcastId]
    }

    /**
     * Fetch episodes for a podcast if not already cached. Returns cached value immediately when present
     * and otherwise fetches from network and caches the result. This is intended for use from a background
     * coroutine so it may perform network I/O.
     */
    suspend fun fetchEpisodesIfNeeded(podcast: Podcast, forceRefresh: Boolean = false): List<Episode> = withContext(Dispatchers.IO) {
        val cached = episodesCache[podcast.id]
        if (!forceRefresh && !cached.isNullOrEmpty()) {
            Log.d("PodcastRepository", "Using cached episodes for ${podcast.title}: ${cached.size} items")
            return@withContext cached
        }
        try {
            Log.d("PodcastRepository", "Fetching episodes for ${podcast.title} (forceRefresh=$forceRefresh)")
            val eps = RSSParser.fetchAndParseRSS(podcast.rssUrl, podcast.id)
            if (eps.isNotEmpty()) {
                episodesCache[podcast.id] = eps
                episodesIndex[podcast.id] = eps.map { it.title.lowercase(Locale.getDefault()) to it.description.lowercase(Locale.getDefault()) }
                Log.d("PodcastRepository", "Fetched ${eps.size} episodes for ${podcast.title}")
            }
            return@withContext eps
        } catch (e: Exception) {
            Log.w("PodcastRepository", "fetchEpisodesIfNeeded failed for ${podcast.title}: ${e.message}")
            return@withContext emptyList()
        }
    }

    suspend fun fetchLatestUpdates(podcasts: List<Podcast>, forceRefresh: Boolean = false): Map<String, Long> = withContext(Dispatchers.IO) {
        try {
            val cached = readUpdatesCache()
            val now = System.currentTimeMillis()
            val result = mutableMapOf<String, Long>()

            // Separate podcasts that can be served from cache from those that need a network fetch.
            val needsFetch = mutableListOf<Podcast>()
            podcasts.forEach { p ->
                val cachedVal = cached[p.id]
                if (!forceRefresh && cachedVal != null && (now - cachedVal.second) < updatesCacheTTL) {
                    result[p.id] = cachedVal.first
                } else {
                    needsFetch.add(p)
                }
            }

            // Fetch all stale / missing entries in parallel to avoid sequential network delays.
            if (needsFetch.isNotEmpty()) {
                Log.d("PodcastRepository", "Fetching latest update timestamps for ${needsFetch.size} podcasts in parallel")
                val fetched = coroutineScope {
                    needsFetch.map { p ->
                        async { p.id to RSSParser.fetchLatestPubDateEpoch(p.rssUrl) }
                    }.awaitAll()
                }
                fetched.forEach { (id, latest) ->
                    if (latest != null) {
                        result[id] = latest
                        cached[id] = latest to now
                    }
                }
            }

            writeUpdatesCache(cached)
            result
        } catch (e: Exception) {
            Log.e("PodcastRepository", "Error fetching latest updates", e)
            emptyMap()
        }
    }

    private fun readUpdatesCache(): MutableMap<String, Pair<Long, Long>> {
        if (!updatesCacheFile.exists()) return mutableMapOf()
        return try {
            val obj = JSONObject(updatesCacheFile.readText())
            val map = mutableMapOf<String, Pair<Long, Long>>()
            val data = obj.optJSONObject("data") ?: JSONObject()
            data.keys().forEach { key ->
                val o = data.optJSONObject(key) ?: return@forEach
                map[key] = (o.optLong("epoch", 0L)) to (o.optLong("ts", 0L))
            }
            map
        } catch (_: Exception) { mutableMapOf() }
    }

    private fun writeUpdatesCache(data: Map<String, Pair<Long, Long>>) {
        try {
            val root = JSONObject()
            val d = JSONObject()
            data.forEach { (k,v) ->
                val o = JSONObject()
                o.put("epoch", v.first)
                o.put("ts", v.second)
                d.put(k, o)
            }
            root.put("data", d)
            updatesCacheFile.writeText(root.toString())
        } catch (_: Exception) {}
    }

    fun filterPodcasts(podcasts: List<Podcast>, filter: PodcastFilter): List<Podcast> {
        // First apply hard filters (genres + duration)
        val baseFiltered = podcasts.filter { podcast ->
            val genreMatch = if (filter.genres.isEmpty()) true
            else podcast.genres.any { it in filter.genres }
            val durationMatch = podcast.typicalDurationMins in filter.minDuration..filter.maxDuration
            genreMatch && durationMatch
        }

        // If there's no search query, return the base filtered list (ensure index built)
        val q = filter.searchQuery.trim()
        if (q.isEmpty()) {
            indexPodcasts(baseFiltered)
            return baseFiltered
        }

        // Ensure we have indexed data for fast checks
        indexPodcasts(baseFiltered)
        val qLower = q.lowercase(Locale.getDefault())

        // Attempt to use the remote server index first, then fall back to the on-disk
        // SQLite FTS index, and finally fall back to the in-memory cache.
        val titleMatches = mutableListOf<Podcast>()
        val descMatches = mutableListOf<Podcast>()
        val epTitleMatches = mutableListOf<Podcast>()
        val epDescMatches = mutableListOf<Podcast>()

        // Try remote server index first (fastest and most complete)
        var usedRemote = false
        try {
            val remote = RemoteIndexClient(context)
            if (remote.isServerAvailable()) {
                val pMatches = remote.searchPodcasts(q, 50)
                android.util.Log.d("PodcastRepository", "Remote searchPodcasts q='$q' returned ${pMatches.size}")
                val pTitleIds = pMatches.filter { ftsMatchesTitle(it, q) }.map { it.podcastId }.toSet()
                val pDescIds  = pMatches.filter { !ftsMatchesTitle(it, q) && ftsMatchesDescription(it, q) }.map { it.podcastId }.toSet()

                val eMatches = remote.searchEpisodes(q, 200)
                val eTitleIds = eMatches.filter { textMatchesNormalized(it.title, q) }.map { it.podcastId }.toSet()
                val eDescIds  = eMatches.filter { !textMatchesNormalized(it.title, q) && textMatchesNormalized(it.description, q) }.map { it.podcastId }.toSet()

                val seen = mutableSetOf<String>()
                for (p in baseFiltered) {
                    when (p.id) {
                        in pTitleIds -> { titleMatches.add(p); seen.add(p.id) }
                        in pDescIds  -> { descMatches.add(p); seen.add(p.id) }
                    }
                }
                for (p in baseFiltered) {
                    if (p.id in seen) continue
                    if (p.id in eTitleIds) { epTitleMatches.add(p); seen.add(p.id) }
                }
                for (p in baseFiltered) {
                    if (p.id in seen) continue
                    if (p.id in eDescIds) { epDescMatches.add(p); seen.add(p.id) }
                }
                usedRemote = true
            }
        } catch (e: Exception) {
            android.util.Log.d("PodcastRepository", "Remote index unavailable, falling back: ${e.message}")
        }

        if (usedRemote) {
            return titleMatches + descMatches + epTitleMatches + epDescMatches
        }

        // Fall back to on-disk SQLite FTS4 index
        try {
            val index = com.hyliankid14.bbcradioplayer.db.IndexStore.getInstance(context)

            val pMatches = index.searchPodcasts(q, 50)
            android.util.Log.d("PodcastRepository", "searchPodcasts q='$q' returned ${pMatches.size}: ${pMatches.map { it.podcastId + '/' + it.title }}")
            val pTitleIds = pMatches.filter { ftsMatchesTitle(it, q) }.map { it.podcastId }.toSet()
            // Only include as a description match if the description actually has a word-boundary match
            val pDescIds = pMatches.filter { !ftsMatchesTitle(it, q) && ftsMatchesDescription(it, q) }.map { it.podcastId }.toSet()
            android.util.Log.d("PodcastRepository", "pTitleIds=$pTitleIds pDescIds=$pDescIds")
            val extractedTerms = extractPlainTermsFromQuery(q)
            android.util.Log.d("PodcastRepository", "extractedTerms=$extractedTerms")
            pMatches.forEach { fts ->
                android.util.Log.d("PodcastRepository", "  fts pid=${fts.podcastId} title='${fts.title}' ftsMatchesTitle=${ftsMatchesTitle(fts, q)} terms check: ${extractedTerms.map { term -> term to containsPhraseOrAllTokens(fts.title.lowercase(Locale.getDefault()), term) }}")
            }

            val eMatches = index.searchEpisodes(q, 200)
            val eTitleIds = eMatches.filter { textMatchesNormalized(it.title, q) }.map { it.podcastId }.toSet()
            val eDescIds = eMatches.filter { !textMatchesNormalized(it.title, q) && textMatchesNormalized(it.description, q) }.map { it.podcastId }.toSet()

            val seen = mutableSetOf<String>()
            for (p in baseFiltered) {
                when (p.id) {
                    in pTitleIds -> { titleMatches.add(p); seen.add(p.id) }
                    in pDescIds -> { descMatches.add(p); seen.add(p.id) }
                }
            }
            for (p in baseFiltered) {
                if (p.id in seen) continue
                if (p.id in eTitleIds) { epTitleMatches.add(p); seen.add(p.id) }
            }
            for (p in baseFiltered) {
                if (p.id in seen) continue
                if (p.id in eDescIds) { epDescMatches.add(p); seen.add(p.id) }
            }

            return titleMatches + descMatches + epTitleMatches + epDescMatches
        } catch (e: Exception) {
            // Fall back to previous in-memory checks if the index is unavailable or fails
            android.util.Log.w("PodcastRepository", "Index lookup failed, falling back to in-memory: ${e.message}")
        }

        // Original in-memory fallback (unchanged behavior)
        for (p in baseFiltered) {
            if (podcastMatches(p, qLower)) {
                // determine whether it matched title or description first
                val pair = podcastSearchIndex[p.id]
                if (pair != null) {
                    if (containsPhraseOrAllTokens(pair.first, qLower)) titleMatches.add(p)
                    else descMatches.add(p)
                    continue
                } else {
                    // fallback: check title then description with word-boundary
                    val tl = p.title.lowercase(Locale.getDefault())
                    val dl = p.description.lowercase(Locale.getDefault())
                    if (containsPhraseOrAllTokens(tl, qLower)) {
                        titleMatches.add(p)
                        continue
                    }
                    if (containsPhraseOrAllTokens(dl, qLower)) {
                        descMatches.add(p)
                        continue
                    }
                }
            }

            // Check episode metadata cache for matches. If not cached yet, skip episode matching so we don't block.
            val episodes = episodesCache[p.id]
            val episodeIdx = episodesIndex[p.id]
            if (!episodeIdx.isNullOrEmpty()) {
                if (episodeIdx.any { (titleLower, _) -> containsPhraseOrAllTokens(titleLower, qLower) }) {
                    epTitleMatches.add(p)
                    continue
                }
                if (episodeIdx.any { (_, descLower) -> containsPhraseOrAllTokens(descLower, qLower) }) {
                    epDescMatches.add(p)
                    continue
                }
            } else if (!episodes.isNullOrEmpty()) {
                // Fallback: older cached episodes without precomputed index
                if (episodes.any { containsPhraseOrAllTokens(it.title.lowercase(Locale.getDefault()), qLower) }) {
                    epTitleMatches.add(p)
                    continue
                }
                if (episodes.any { containsPhraseOrAllTokens(it.description.lowercase(Locale.getDefault()), qLower) }) {
                    epDescMatches.add(p)
                    continue
                }
            }
        }

        // Keep the relative order within each bucket same as the source order
        return titleMatches + descMatches + epTitleMatches + epDescMatches
    }

    fun getUniqueGenres(podcasts: List<Podcast>): List<String> {
        return podcasts
            .flatMap { it.genres }
            .distinct()
            .sorted()
    }

    private fun cachePodcasts(podcasts: List<Podcast>) {
        try {
            val jsonArray = JSONArray()
            podcasts.forEach { podcast ->
                val jsonObj = JSONObject().apply {
                    put("id", podcast.id)
                    put("title", podcast.title)
                    put("description", podcast.description)
                    put("rssUrl", podcast.rssUrl)
                    put("htmlUrl", podcast.htmlUrl)
                    put("imageUrl", podcast.imageUrl)
                    put("typicalDurationMins", podcast.typicalDurationMins)
                    put("genres", JSONArray(podcast.genres))
                }
                jsonArray.put(jsonObj)
            }
            
            val rootObj = JSONObject()
            rootObj.put("timestamp", System.currentTimeMillis())
            rootObj.put("data", jsonArray)
            
            cacheFile.writeText(rootObj.toString())
            Log.d("PodcastRepository", "Cached ${podcasts.size} podcasts")
        } catch (e: Exception) {
            Log.e("PodcastRepository", "Error caching podcasts", e)
        }
    }

    private fun getCachedPodcasts(ignoreExpiry: Boolean = false): List<Podcast>? {
        if (!cacheFile.exists()) return null
        
        return try {
            val content = cacheFile.readText()
            if (content.isEmpty()) return null
            
            val rootObj = JSONObject(content)
            val timestamp = rootObj.optLong("timestamp", 0)
            
            if (!ignoreExpiry && System.currentTimeMillis() - timestamp > cacheTTL) {
                Log.d("PodcastRepository", "Cache expired")
                return null
            }
            
            val jsonArray = rootObj.getJSONArray("data")
            val podcasts = mutableListOf<Podcast>()
            
            for (i in 0 until jsonArray.length()) {
                val obj = jsonArray.getJSONObject(i)
                val genresJson = obj.getJSONArray("genres")
                val genres = mutableListOf<String>()
                for (j in 0 until genresJson.length()) {
                    genres.add(genresJson.getString(j))
                }
                
                podcasts.add(Podcast(
                    id = obj.getString("id"),
                    title = obj.getString("title"),
                    description = obj.optString("description", ""),
                    rssUrl = obj.getString("rssUrl"),
                    htmlUrl = obj.optString("htmlUrl", ""),
                    imageUrl = obj.optString("imageUrl", ""),
                    genres = genres,
                    typicalDurationMins = obj.optInt("typicalDurationMins", 0)
                ))
            }
            if (podcasts.isNotEmpty()) {
                Log.d("PodcastRepository", "Loaded ${podcasts.size} podcasts from cache (ignoreExpiry=$ignoreExpiry)")
                return podcasts
            }
            null
        } catch (e: Exception) {
            Log.e("PodcastRepository", "Error reading cache", e)
            null
        }
    }

    /**
     * Returns true when the on-disk podcast cache is absent or older than [cacheTTL],
     * meaning a network refresh is required to get up-to-date data.
     *
     * Uses the file's last-modified timestamp (a fast OS call) rather than re-reading
     * the full JSON, since [cachePodcasts] is the only writer for this file.
     */
    fun needsNetworkRefresh(): Boolean {
        if (!cacheFile.exists()) return true
        return (System.currentTimeMillis() - cacheFile.lastModified()) > cacheTTL
    }

    /**
     * Return any podcasts that are available locally right now — either from the on-disk
     * cache (even if stale / expired) or from the bundled seed asset shipped with the app.
     * No network I/O is performed, so this returns instantly.
     *
     * The bundled seed is only read when the on-disk cache file does not yet exist (e.g.
     * on first launch).  Once the network refresh writes the real cache, the seed is never
     * consulted again.
     *
     * If the user has opted to exclude non-English podcasts, only persisted language-detector
     * results are used here (fast — no ML inference).  Unknowns are included optimistically;
     * the subsequent background network refresh will apply the full ML filter.
     *
     * Returns an empty list when no local data is available (i.e. fresh install with no seed).
     */
    fun getAvailablePodcastsNow(): List<Podcast> {
        val raw = getCachedPodcasts(ignoreExpiry = true) ?: getBundledPodcasts()
        if (raw.isEmpty()) return emptyList()

        if (!PodcastFilterPreference.excludeNonEnglish(context)) return raw

        // Fast language filter — persisted results only, unknowns included optimistically
        return raw.filter { p ->
            LanguageDetector.persistedIsPodcastEnglish(context, p) != false
        }
    }

    /**
     * Return the last-known latest-episode epoch for each podcast ID that has been
     * cached on disk, regardless of cache age.  No network I/O is performed, so this
     * returns quickly and is safe to call from any background thread.  Avoid calling
     * this on the main thread as it performs file I/O.
     *
     * Intended for use alongside [getAvailablePodcastsNow] to provide an instant
     * first render of the subscription list before the background refresh completes.
     */
    fun getAvailableUpdatesNow(): Map<String, Long> {
        return readUpdatesCache().mapValues { it.value.first }
    }

    /**
     * Load the bundled podcast seed that is shipped as an app asset
     * (assets/podcasts_seed.json.gz).  Used as a fallback on first launch before
     * the network cache has been populated.  Returns an empty list on any failure.
     */
    private fun getBundledPodcasts(): List<Podcast> {
        return try {
            context.assets.open("podcasts_seed.json.gz").use { assetStream ->
                java.util.zip.GZIPInputStream(assetStream).use { gzipStream ->
                    val content = gzipStream.bufferedReader(Charsets.UTF_8).readText()
                    val rootObj = JSONObject(content)
                    val jsonArray = rootObj.getJSONArray("data")
                    val podcasts = mutableListOf<Podcast>()
                    for (i in 0 until jsonArray.length()) {
                        val obj = jsonArray.getJSONObject(i)
                        val genresJson = obj.optJSONArray("genres") ?: JSONArray()
                        val genres = mutableListOf<String>()
                        for (j in 0 until genresJson.length()) {
                            genres.add(genresJson.getString(j))
                        }
                        podcasts.add(Podcast(
                            id = obj.getString("id"),
                            title = obj.getString("title"),
                            description = obj.optString("description", ""),
                            rssUrl = obj.optString("rssUrl", ""),
                            htmlUrl = obj.optString("htmlUrl", ""),
                            imageUrl = obj.optString("imageUrl", ""),
                            genres = genres,
                            typicalDurationMins = obj.optInt("typicalDurationMins", 0)
                        ))
                    }
                    Log.d("PodcastRepository", "Loaded ${podcasts.size} podcasts from bundled seed")
                    podcasts
                }
            }
        } catch (e: Exception) {
            Log.w("PodcastRepository", "Failed to load bundled podcasts: ${e.message}")
            emptyList()
        }
    }
}
