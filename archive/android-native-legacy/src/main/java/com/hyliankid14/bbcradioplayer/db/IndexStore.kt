package com.hyliankid14.bbcradioplayer.db

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteStatement
import com.hyliankid14.bbcradioplayer.Episode
import com.hyliankid14.bbcradioplayer.Podcast
import java.util.*
import android.util.Log
import java.text.SimpleDateFormat

/**
 * Lightweight SQLite FTS-backed index for podcasts and episodes.
 * Implemented without Room to avoid KAPT/annotation toolchain dependencies.
 */
class IndexStore private constructor(private val context: Context) {
    private val helper = IndexDatabaseHelper(context.applicationContext)

    companion object {
        @Volatile
        private var INSTANCE: IndexStore? = null

        fun getInstance(context: Context): IndexStore {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: IndexStore(context).also { INSTANCE = it }
            }
        }

        private val PUB_DATE_FORMATS = object : ThreadLocal<List<SimpleDateFormat>>() {
            override fun initialValue(): List<SimpleDateFormat> {
                return listOf(
                    "EEE, dd MMM yyyy HH:mm:ss Z",
                    "EEE, dd MMM yyyy HH:mm:ss z",
                    "dd MMM yyyy HH:mm:ss Z",
                    "dd MMM yyyy HH:mm:ss z",
                    "EEE, dd MMM yyyy HH:mm:ss",
                    "dd MMM yyyy HH:mm:ss",
                    "EEE, dd MMM yyyy",
                    "dd MMM yyyy"
                ).map { SimpleDateFormat(it, Locale.US) }
            }
        }

        fun parsePubEpoch(raw: String?): Long {
            if (raw.isNullOrBlank()) return 0L
            val formats = PUB_DATE_FORMATS.get() ?: return 0L
            for (format in formats) {
                try {
                    val t = format.parse(raw)?.time
                    if (t != null) return t
                } catch (_: Exception) { }
            }
            return 0L
        }

        private fun isAdvancedFtsQuery(query: String): Boolean {
            val q = query.trim()
            if (q.isEmpty()) return false
            if (q.contains('"') || q.contains('(') || q.contains(')')) return true
            val upper = q.uppercase(Locale.getDefault())
            if (upper.contains(" AND ") || upper.contains(" OR ") || upper.contains(" NEAR")) return true
            // FTS4 uses - prefix for NOT (e.g., "climate -politics")
            if (q.contains(" -")) return true
            return q.contains('*') || q.contains(':')
        }

        private fun normalizeQueryForFts(query: String): String {
            if (isAdvancedFtsQuery(query)) return query.trim()
            // Normalize: strip punctuation, collapse whitespace, lowercase.
            val q = java.text.Normalizer.normalize(query, java.text.Normalizer.Form.NFD)
                .replace(Regex("\\p{InCombiningDiacriticalMarks}+"), "")
                .replace(Regex("[^\\p{L}0-9\\s]"), " ")
                .replace(Regex("\\s+"), " ")
                .trim()
                .lowercase(Locale.getDefault())

            if (q.isEmpty()) return q
            val tokens = q.split(Regex("\\s+"))
            if (tokens.size == 1) return "${tokens[0]}*"

            // Construct proximity-based search (NEAR/10) first for looser matching,
            // then exact phrase match, and finally a prefix-AND fallback.
            val phrase = '"' + tokens.joinToString(" ") + '"'
            val near = tokens.joinToString(" NEAR/10 ") { it }
            val tokenAnd = tokens.joinToString(" AND ") { "${it}*" }
            // Parenthesize each clause to ensure correct operator precedence in MATCH expressions
            return "($near) OR ($phrase) OR ($tokenAnd)"
        }

        private fun splitOrClauses(query: String): List<String> {
            val q = query.trim()
            if (q.isEmpty()) return emptyList()
            if (q.contains('(') || q.contains(')')) return listOf(q)

            val parts = mutableListOf<String>()
            val sb = StringBuilder()
            var inQuote = false
            var i = 0
            while (i < q.length) {
                val ch = q[i]
                if (ch == '"') {
                    inQuote = !inQuote
                    sb.append(ch)
                    i += 1
                    continue
                }

                if (!inQuote && i + 4 <= q.length && q.regionMatches(i, " OR ", 0, 4, true)) {
                    val part = sb.toString().trim()
                    if (part.isNotEmpty()) parts.add(part)
                    sb.setLength(0)
                    i += 4
                    continue
                }

                sb.append(ch)
                i += 1
            }

            val last = sb.toString().trim()
            if (last.isNotEmpty()) parts.add(last)
            return if (parts.size > 1) parts else listOf(q)
        }
    }

    fun replaceAllPodcasts(podcasts: List<Podcast>) {
        val db = helper.writableDatabase
        db.beginTransaction()
        try {
            db.execSQL("DELETE FROM podcast_fts;")
            val stmt: SQLiteStatement = db.compileStatement("INSERT INTO podcast_fts(podcastId, title, description) VALUES (?, ?, ?);")
            for (p in podcasts) {
                stmt.clearBindings()
                stmt.bindString(1, p.id)
                stmt.bindString(2, p.title)
                stmt.bindString(3, p.description)
                stmt.executeInsert()
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    private fun truncateForIndex(s: String?, maxLen: Int): String {
        if (s.isNullOrBlank()) return ""
        // strip basic HTML and collapse whitespace to reduce index size
        val cleaned = s.replace(Regex("<[^>]+>"), " ")
            .replace(Regex("\\s+"), " ")
            .trim()
        return if (cleaned.length <= maxLen) cleaned else cleaned.substring(0, maxLen)
    }

    /**
     * Append a batch of episodes into the FTS table. This is safe to call repeatedly to build the
     * index in small transactions (keeps memory and journal size bounded).
     */
    fun appendEpisodesBatch(episodes: List<Episode>, maxFieldLength: Int = 4096): Int {
        if (episodes.isEmpty()) return 0
        val db = helper.writableDatabase
        var inserted = 0
        db.beginTransaction()
        try {
            val stmt: SQLiteStatement = db.compileStatement("INSERT INTO episode_fts(episodeId, podcastId, title, description) VALUES (?, ?, ?, ?);")
            val metaStmt: SQLiteStatement = db.compileStatement("INSERT OR REPLACE INTO episode_meta(episodeId, pubDate, pubEpoch) VALUES (?, ?, ?);")
            for (e in episodes) {
                stmt.clearBindings()
                stmt.bindString(1, e.id)
                stmt.bindString(2, e.podcastId)
                // keep original title column short and safe
                stmt.bindString(3, truncateForIndex(e.title, 512))

                // produce a trimmed, de-HTML'd searchable blob (bounded length)
                val cleanedTitle = truncateForIndex(e.title.replace(Regex("[\\p{Punct}\\s]+"), " ").lowercase(Locale.getDefault()), 256)
                val audioName = truncateForIndex(e.audioUrl.substringAfterLast('/').substringBefore('?').replace(Regex("[\\W_]+"), " ").lowercase(Locale.getDefault()), 128)
                val pub = truncateForIndex(e.pubDate, 64)
                val descPart = truncateForIndex(e.description, maxFieldLength)
                val searchBlob = listOf(descPart, cleanedTitle, pub, audioName)
                    .filter { it.isNotBlank() }
                    .joinToString(" ")

                stmt.bindString(4, searchBlob)
                stmt.executeInsert()

                metaStmt.clearBindings()
                metaStmt.bindString(1, e.id)
                metaStmt.bindString(2, e.pubDate)
                metaStmt.bindLong(3, parsePubEpoch(e.pubDate))
                metaStmt.executeInsert()
                inserted++
            }
            db.setTransactionSuccessful()
        } finally {
            try { db.yieldIfContendedSafely() } catch (_: Throwable) { /* best-effort */ }
            db.endTransaction()
        }
        return inserted
    }

    /**
     * Backwards-compatible replaceAllEpisodes that performs the work in bounded-size batches to
     * avoid OOM/journal blowups on large libraries. Trims very long fields before inserting.
     */
    fun replaceAllEpisodes(episodes: List<Episode>, onProgress: (processed: Int, total: Int) -> Unit = { _, _ -> }) {
        val total = episodes.size
        if (total == 0) return

        // Heuristic batch size: larger batches are faster but use more memory/journal.
        val batchSize = when {
            total <= 500 -> 100
            total <= 5_000 -> 500
            else -> 1500
        }

        // Do a single table wipe up-front, then append in batches.
        val db = helper.writableDatabase
        db.execSQL("DELETE FROM episode_fts;")
        db.execSQL("DELETE FROM episode_meta;")

        var processed = 0
        var idx = 0
        while (idx < total) {
            val end = (idx + batchSize).coerceAtMost(total)
            val batch = episodes.subList(idx, end)
            try {
                appendEpisodesBatch(batch)
            } catch (oom: OutOfMemoryError) {
                Log.w("IndexStore", "OOM during index batch (size=${batch.size}), falling back to smaller batches")
                // Try much smaller batches as a fallback
                val small = batch.chunked(50)
                for (sb in small) appendEpisodesBatch(sb)
            } catch (e: Exception) {
                Log.w("IndexStore", "Failed to append episode batch: ${e.message}")
            }
            processed += batch.size
            idx = end
            try { onProgress(processed, total) } catch (_: Exception) {}
            try { db.yieldIfContendedSafely() } catch (_: Throwable) { /* best-effort */ }
        }
    }

    /**
     * Clear all episodes from the local index. Used to remove locally-built indices
     * before applying a remote index.
     */
    fun clearAllEpisodes() {
        val db = helper.writableDatabase
        db.execSQL("DELETE FROM episode_fts;")
        db.execSQL("DELETE FROM episode_meta;")
    }

    @Synchronized
    fun searchPodcasts(query: String, limit: Int = 50): List<PodcastFts> {
        return searchPodcastsInternal(query, limit, true)
    }

    private fun searchPodcastsInternal(query: String, limit: Int, allowOrSplit: Boolean): List<PodcastFts> {
        if (query.isBlank()) return emptyList()
        val db = helper.readableDatabase

        // If the query contains OR clauses, split and merge results just like episode search does.
        if (allowOrSplit && isAdvancedFtsQuery(query)) {
            val parts = splitOrClauses(query)
            Log.d("IndexStore", "OR split: query='$query' parts=${parts.size}: ${parts.map { "'$it'" }}")
            if (parts.size > 1) {
                val merged = LinkedHashMap<String, PodcastFts>()
                for (part in parts) {
                    val results = searchPodcastsInternal(part, limit, false)
                    Log.d("IndexStore", "OR split part='$part' returned ${results.size} podcast hits: ${results.map { it.podcastId }}")
                    for (hit in results) {
                        merged.putIfAbsent(hit.podcastId, hit)
                    }
                }
                Log.d("IndexStore", "OR merged total=${merged.size} podcast ids: ${merged.keys}")
                return merged.values.take(limit)
            }
        }

        // Try prioritized MATCH variants and return first non-empty result set.
        // Keep all generated variants so token-AND fallback is available for broad queries.
        val variants = buildFtsVariants(query)
        for (v in variants) {
            try {
                Log.d("IndexStore", "FTS podcast try: variant='$v' originalQuery='$query' limit=$limit")
                val cursor = db.rawQuery(
                    "SELECT podcastId, title, description FROM podcast_fts WHERE podcast_fts MATCH ? LIMIT ?",
                    arrayOf(v, limit.toString())
                )
                val results = mutableListOf<PodcastFts>()
                cursor.use {
                    while (it.moveToNext()) {
                        val pid = it.getString(0)
                        val title = it.getString(1) ?: ""
                        val desc = it.getString(2) ?: ""
                        results.add(PodcastFts(pid, title, desc))
                    }
                }
                if (results.isNotEmpty()) {
                    Log.d("IndexStore", "FTS podcast search returned ${results.size} hits for query='$query' via variant='$v'")
                    return results
                }
            } catch (e: Exception) {
                Log.w("IndexStore", "FTS podcast variant failed: variant='$v' error=${e.message}")
            }
        }
        Log.d("IndexStore", "FTS podcast search returned 0 hits for query='$query'")
        return emptyList()
    }

    private fun buildFtsVariants(query: String): List<String> {
        if (isAdvancedFtsQuery(query)) return listOf(query.trim())
        // Return a prioritized list of MATCH expressions to try for multi-token queries
        val q = java.text.Normalizer.normalize(query, java.text.Normalizer.Form.NFD)
            .replace(Regex("\\p{InCombiningDiacriticalMarks}+"), "")
            .replace(Regex("[^\\p{L}0-9\\s]"), " ")
            .replace(Regex("\\s+"), " ")
            .trim()
            .lowercase(Locale.getDefault())

        val tokens = q.split(Regex("\\s+")).filter { it.isNotEmpty() }
        if (tokens.isEmpty()) return emptyList()
        if (tokens.size == 1) {
            // For single-token queries try a few prioritized variants: prefix, exact token, and field-scoped exact
            val t = tokens[0]
            return listOf("${t}*", "($t)", "(title:$t) OR (description:$t)")
        }

        val phrase = '"' + tokens.joinToString(" ") + '"'
        val near = tokens.joinToString(" NEAR/10 ") { it }
        // bigram phrase variants: "t1 t2" OR "t2 t3" ... (helps match adjacent-word queries)
        val bigramList = tokens.windowed(2).map { '"' + it.joinToString(" ") + '"' }
        val bigramClause = if (bigramList.isNotEmpty()) bigramList.joinToString(" OR ") else ""
        val tokenAnd = tokens.joinToString(" AND ") { "${it}*" }

        val variants = mutableListOf<String>()
        // NEAR proximity first for looser matching (finds words within 10 positions)
        variants.add("($near)")
        // Exact phrase across all fields
        variants.add("($phrase)")
        // Phrase in title or description specifically
        variants.add("(title:$phrase) OR (description:$phrase)")
        // Bigram adjacency fallback (helps where only partial phrase exists)
        if (bigramClause.isNotBlank()) variants.add("($bigramClause)")
        // Prefix-AND fallback
        variants.add("($tokenAnd)")
        return variants
    }

    private fun batchGetPubEpochs(db: SQLiteDatabase, episodeIds: List<String>): Map<String, Long> {
        if (episodeIds.isEmpty()) return emptyMap()
        val result = mutableMapOf<String, Long>()
        // Process in chunks to avoid exceeding SQLite's variable limit
        episodeIds.chunked(500) { chunk ->
            val placeholders = chunk.joinToString(",") { "?" }
            val cursor = db.rawQuery(
                "SELECT episodeId, pubEpoch FROM episode_meta WHERE episodeId IN ($placeholders)",
                chunk.toTypedArray()
            )
            cursor.use {
                while (it.moveToNext()) {
                    result[it.getString(0)] = it.getLong(1)
                }
            }
        }
        return result
    }

    /** Fetch both pubEpoch and pubDate for a set of episode IDs in one pass. */
    private fun batchGetPubData(db: SQLiteDatabase, episodeIds: List<String>): Map<String, Pair<Long, String>> {
        if (episodeIds.isEmpty()) return emptyMap()
        val result = mutableMapOf<String, Pair<Long, String>>()
        episodeIds.chunked(500) { chunk ->
            val placeholders = chunk.joinToString(",") { "?" }
            val cursor = db.rawQuery(
                "SELECT episodeId, pubEpoch, pubDate FROM episode_meta WHERE episodeId IN ($placeholders)",
                chunk.toTypedArray()
            )
            cursor.use {
                while (it.moveToNext()) {
                    result[it.getString(0)] = it.getLong(1) to (it.getString(2) ?: "")
                }
            }
        }
        return result
    }

    /** Fetch title and description (searchable blob) for a specific page of episode IDs. */
    private fun batchGetEpisodeMeta(db: SQLiteDatabase, episodeIds: List<String>): Map<String, Pair<String, String>> {
        if (episodeIds.isEmpty()) return emptyMap()
        val result = mutableMapOf<String, Pair<String, String>>()
        episodeIds.chunked(500) { chunk ->
            val placeholders = chunk.joinToString(",") { "?" }
            val cursor = db.rawQuery(
                "SELECT episodeId, title, description FROM episode_fts WHERE episodeId IN ($placeholders)",
                chunk.toTypedArray()
            )
            cursor.use {
                while (it.moveToNext()) {
                    result[it.getString(0)] = (it.getString(1) ?: "") to (it.getString(2) ?: "")
                }
            }
        }
        return result
    }

    /**
     * Lean FTS scan: returns episodeId → podcastId for all episodes matching the given query
     * expression (or any of its auto-generated variants). Fetches no heavy columns (title/description)
     * so it remains fast even for queries that match thousands of episodes. Sorting and pagination
     * are handled by the caller after a bulk pubEpoch lookup.
     */
    private fun scanEpisodeIdsByQuery(db: SQLiteDatabase, query: String): LinkedHashMap<String, String> {
        val idToPodcastId = LinkedHashMap<String, String>()
        val variants = buildFtsVariants(query)
        for (v in variants) {
            try {
                val cursor = db.rawQuery(
                    "SELECT episodeId, podcastId FROM episode_fts WHERE episode_fts MATCH ?",
                    arrayOf(v)
                )
                cursor.use {
                    while (it.moveToNext()) {
                        val eid = it.getString(0) ?: continue
                        idToPodcastId.putIfAbsent(eid, it.getString(1) ?: "")
                    }
                }
            } catch (e: Exception) {
                Log.w("IndexStore", "FTS id-scan variant failed '$v': ${e.message}")
            }
        }
        return idToPodcastId
    }

    @Synchronized
    fun searchEpisodes(query: String, limit: Int = 100, offset: Int = 0): List<EpisodeFts> {
        return searchEpisodesInternal(query, limit, offset, true)
    }

    private fun searchEpisodesInternal(query: String, limit: Int, offset: Int, allowOrSplit: Boolean): List<EpisodeFts> {
        if (query.isBlank()) return emptyList()
        val db = helper.readableDatabase

        if (allowOrSplit && isAdvancedFtsQuery(query)) {
            val parts = splitOrClauses(query)
            if (parts.size > 1) {
                // Collect ALL matching IDs for each OR clause without fetching heavy metadata.
                val idToPodcastId = LinkedHashMap<String, String>()
                for (part in parts) {
                    val ids = scanEpisodeIdsByQuery(db, part) // lean scan: episodeId+podcastId only
                    for ((eid, pid) in ids) {
                        idToPodcastId.putIfAbsent(eid, pid)
                    }
                }
                val allIds = idToPodcastId.keys.toList()
                val pubData = batchGetPubData(db, allIds)
                val pageIds = allIds
                    .sortedByDescending { pubData[it]?.first ?: 0L }
                    .drop(offset)
                    .take(limit)
                if (pageIds.isEmpty()) return emptyList()
                val pageMeta = batchGetEpisodeMeta(db, pageIds)
                return pageIds.map { eid ->
                    EpisodeFts(
                        episodeId = eid,
                        podcastId = idToPodcastId[eid] ?: "",
                        title = pageMeta[eid]?.first ?: "",
                        description = pageMeta[eid]?.second ?: "",
                        pubDate = pubData[eid]?.second ?: ""
                    )
                }
            }
        }

        // Collect matching episode IDs across all FTS variants using a lean scan (episodeId+podcastId
        // only, no heavy description blobs). Sort once after a bulk pubEpoch lookup, then fetch
        // title/description only for the final page — ensuring every matching episode is reachable
        // regardless of how many there are (no per-variant LIMIT hides older results).
        val idToPodcastId = scanEpisodeIdsByQuery(db, query)
        Log.d("IndexStore", "FTS episode scan total=${idToPodcastId.size} unique ids for query='$query'")

        if (idToPodcastId.isNotEmpty()) {
            val allIds = idToPodcastId.keys.toList()
            // Single bulk pubEpoch + pubDate fetch, sort, then take only the page we need.
            val pubData = batchGetPubData(db, allIds)
            val pageIds = allIds
                .sortedByDescending { pubData[it]?.first ?: 0L }
                .drop(offset)
                .take(limit)

            Log.d("IndexStore", "FTS episode returning offset=$offset limit=$limit page=${pageIds.size} of total=${allIds.size} for query='$query'")

            if (pageIds.isEmpty()) return emptyList()

            // Fetch title + description only for this page (avoids loading large blobs for all matches).
            val pageMeta = batchGetEpisodeMeta(db, pageIds) // Map<episodeId, Pair<title, desc>>
            return pageIds.map { eid ->
                EpisodeFts(
                    episodeId = eid,
                    podcastId = idToPodcastId[eid] ?: "",
                    title = pageMeta[eid]?.first ?: "",
                    description = pageMeta[eid]?.second ?: "",
                    pubDate = pubData[eid]?.second ?: ""
                )
            }
        }

        // Simplified fallback: only try LIKE for single-token queries to avoid slow multi-token searches
        try {
            val qnorm = java.text.Normalizer.normalize(query, java.text.Normalizer.Form.NFD)
                .replace(Regex("\\p{InCombiningDiacriticalMarks}+"), "")
                .replace(Regex("[^\\p{L}0-9\\s]"), " ")
                .replace(Regex("\\s+"), " ")
                .trim()
                .lowercase(Locale.getDefault())
            val tokens = qnorm.split(Regex("\\s+")).filter { it.isNotEmpty() }
            
            // Only do LIKE fallback for single tokens to keep it fast
            if (tokens.size == 1) {
                val t = "%${tokens[0]}%"
                val sql = "SELECT f.episodeId, f.podcastId, f.title, f.description, m.pubDate FROM episode_fts f LEFT JOIN episode_meta m ON f.episodeId = m.episodeId WHERE LOWER(f.title) LIKE ? ORDER BY m.pubEpoch DESC LIMIT ? OFFSET ?"
                Log.d("IndexStore", "FTS single-token fallback SQL token='${tokens[0]}'")
                val cursor = db.rawQuery(sql, arrayOf(t, limit.toString(), offset.toString()))
                val fbResults = mutableListOf<EpisodeFts>()
                cursor.use {
                    while (it.moveToNext()) {
                        val eid = it.getString(0)
                        val pid = it.getString(1)
                        val title = it.getString(2) ?: ""
                        val desc = it.getString(3) ?: ""
                        val pub = it.getString(4) ?: ""
                        fbResults.add(EpisodeFts(eid, pid, title, desc, pub))
                    }
                }
                Log.d("IndexStore", "FTS single-token fallback returned ${fbResults.size} hits")
                if (fbResults.isNotEmpty()) return fbResults
            }
        } catch (e: Exception) {
            Log.w("IndexStore", "FTS fallback failed: ${e.message}")
        }

        return emptyList()
    }

    @Synchronized
    fun getLatestEpisodePubDateEpoch(episodeIds: List<String>): Long {
        if (episodeIds.isEmpty()) return 0L
        val db = helper.readableDatabase
        var maxEpoch = 0L
        val chunkSize = 900
        var index = 0
        while (index < episodeIds.size) {
            val end = (index + chunkSize).coerceAtMost(episodeIds.size)
            val chunk = episodeIds.subList(index, end)
            val placeholders = chunk.joinToString(",") { "?" }
            val cursor = db.rawQuery(
                "SELECT MAX(pubEpoch) FROM episode_meta WHERE episodeId IN ($placeholders)",
                chunk.toTypedArray()
            )
            cursor.use {
                if (it.moveToFirst()) {
                    val epoch = it.getLong(0)
                    if (epoch > maxEpoch) maxEpoch = epoch
                }
            }
            index = end
        }
        return maxEpoch
    }

    /**
     * Find an indexed episode by its canonical id. This is a fast on-disk lookup used as a
     * fallback for features like Android Auto auto-resume where we need to map an episode id
     * to its parent podcast without fetching every podcast remotely.
     */
    fun findEpisodeById(episodeId: String): EpisodeFts? {
        if (episodeId.isBlank()) return null
        val db = helper.readableDatabase
        try {
            val cursor = db.rawQuery(
                "SELECT episodeId, podcastId, title, description FROM episode_fts WHERE episodeId = ? LIMIT 1",
                arrayOf(episodeId)
            )
            cursor.use {
                if (it.moveToFirst()) {
                    val eid = it.getString(0)
                    val pid = it.getString(1)
                    val title = it.getString(2) ?: ""
                    val desc = it.getString(3) ?: ""
                    return EpisodeFts(eid, pid, title, desc)
                }
            }
        } catch (e: Exception) {
            Log.w("IndexStore", "findEpisodeById failed for $episodeId: ${e.message}")
        }
        return null
    }

    /**
     * Persist and retrieve last reindex time to help users see when the on-disk index was last rebuilt.
     */
    fun setLastReindexTime(timeMillis: Long) {
        val prefs = context.getSharedPreferences("index_prefs", android.content.Context.MODE_PRIVATE)
        prefs.edit().putLong("last_reindex_time", timeMillis).apply()
    }

    fun getLastReindexTime(): Long? {
        val prefs = context.getSharedPreferences("index_prefs", android.content.Context.MODE_PRIVATE)
        return if (prefs.contains("last_reindex_time")) prefs.getLong("last_reindex_time", 0L) else null
    }

    // Check whether a podcast is present in the podcast FTS table
    fun hasPodcast(podcastId: String): Boolean {
        if (podcastId.isBlank()) return false
        val db = helper.readableDatabase
        try {
            val cursor = db.rawQuery("SELECT podcastId FROM podcast_fts WHERE podcastId = ? LIMIT 1", arrayOf(podcastId))
            cursor.use { return it.count > 0 }
        } catch (e: Exception) {
            Log.w("IndexStore", "hasPodcast failed for $podcastId: ${e.message}")
        }
        return false
    }

    // Check if any podcasts have been indexed
    fun hasAnyPodcasts(): Boolean {
        val db = helper.readableDatabase
        try {
            val cursor = db.rawQuery("SELECT 1 FROM podcast_fts LIMIT 1", emptyArray())
            cursor.use {
                return it.moveToFirst()
            }
        } catch (e: Exception) {
            Log.w("IndexStore", "hasAnyPodcasts failed: ${e.message}")
        }
        return false
    }

    // Check if any episodes have been indexed
    fun hasAnyEpisodes(): Boolean {
        val db = helper.readableDatabase
        try {
            val cursor = db.rawQuery("SELECT COUNT(*) FROM episode_fts LIMIT 1", emptyArray())
            cursor.use {
                if (it.moveToFirst()) {
                    return it.getInt(0) > 0
                }
            }
        } catch (e: Exception) {
            Log.w("IndexStore", "hasAnyEpisodes failed: ${e.message}")
        }
        return false
    }

    // Total number of unique indexed episodes
    fun getIndexedEpisodeCount(): Int {
        val db = helper.readableDatabase
        try {
            // episode_meta has one row per unique episodeId (PRIMARY KEY)
            val cursor = db.rawQuery("SELECT COUNT(*) FROM episode_meta", emptyArray())
            cursor.use {
                if (it.moveToFirst()) {
                    return it.getInt(0)
                }
            }
        } catch (e: Exception) {
            Log.w("IndexStore", "getIndexedEpisodeCount failed: ${e.message}")
        }
        return 0
    }

    // Total number of indexed podcasts.
    fun getIndexedPodcastCount(): Int {
        val db = helper.readableDatabase
        try {
            val cursor = db.rawQuery("SELECT COUNT(*) FROM podcast_fts", emptyArray())
            cursor.use {
                if (it.moveToFirst()) {
                    return it.getInt(0)
                }
            }
        } catch (e: Exception) {
            Log.w("IndexStore", "getIndexedPodcastCount failed: ${e.message}")
        }
        return 0
    }

    // Upsert a podcast row into the podcast_fts table
    fun upsertPodcast(p: Podcast) {
        val db = helper.writableDatabase
        db.beginTransaction()
        try {
            try { db.execSQL("DELETE FROM podcast_fts WHERE podcastId = ?", arrayOf(p.id)) } catch (_: Exception) {}
            val stmt = db.compileStatement("INSERT INTO podcast_fts(podcastId, title, description) VALUES (?, ?, ?)")
            stmt.clearBindings()
            stmt.bindString(1, p.id)
            stmt.bindString(2, p.title)
            stmt.bindString(3, p.description)
            stmt.executeInsert()
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    // Return all episode ids currently indexed for the given podcast
    fun getEpisodeIdsForPodcast(podcastId: String): Set<String> {
        val db = helper.readableDatabase
        val set = mutableSetOf<String>()
        try {
            val cursor = db.rawQuery("SELECT episodeId FROM episode_fts WHERE podcastId = ?", arrayOf(podcastId))
            cursor.use {
                while (it.moveToNext()) {
                    set.add(it.getString(0))
                }
            }
        } catch (e: Exception) {
            Log.w("IndexStore", "getEpisodeIdsForPodcast failed for $podcastId: ${e.message}")
        }
        return set
    }

    /**
     * Return oldest/latest indexed episode epochs per podcast. Uses the local episode index,
     * which can represent a much deeper catalogue than an individual RSS feed snapshot.
     */
    fun getPodcastEpisodeBounds(podcastIds: List<String>): Map<String, Pair<Long, Long>> {
        if (podcastIds.isEmpty()) return emptyMap()

        val db = helper.readableDatabase
        val result = mutableMapOf<String, Pair<Long, Long>>()

        try {
            podcastIds.distinct().chunked(800).forEach { chunk ->
                val placeholders = chunk.joinToString(",") { "?" }
                val sql = """
                    SELECT f.podcastId, MIN(m.pubEpoch) AS minPubEpoch, MAX(m.pubEpoch) AS maxPubEpoch
                    FROM episode_fts f
                    INNER JOIN episode_meta m ON m.episodeId = f.episodeId
                    WHERE f.podcastId IN ($placeholders) AND m.pubEpoch > 0
                    GROUP BY f.podcastId
                """.trimIndent()
                val cursor = db.rawQuery(sql, chunk.toTypedArray())
                cursor.use {
                    while (it.moveToNext()) {
                        val podcastId = it.getString(0) ?: continue
                        val minPubEpoch = it.getLong(1)
                        val maxPubEpoch = it.getLong(2)
                        result[podcastId] = minPubEpoch to maxPubEpoch
                    }
                }
            }
        } catch (e: Exception) {
            Log.w("IndexStore", "getPodcastEpisodeBounds failed: ${e.message}")
        }

        return result
    }

    fun getAllPodcastIds(): Set<String> {
        val db = helper.readableDatabase
        val result = mutableSetOf<String>()
        try {
            val cursor = db.rawQuery("SELECT podcastId FROM podcast_fts", emptyArray())
            cursor.use {
                while (it.moveToNext()) {
                    val podcastId = it.getString(0)
                    if (!podcastId.isNullOrBlank()) result.add(podcastId)
                }
            }
        } catch (e: Exception) {
            Log.w("IndexStore", "getAllPodcastIds failed: ${e.message}")
        }
        return result
    }
}
