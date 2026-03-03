package com.hyliankid14.bbcradioplayer

import android.content.Context
import android.os.Environment
import org.json.JSONObject
import java.io.File

/**
 * Manages downloaded podcast episodes. Stores episode metadata and local file paths.
 * Similar to SavedEpisodes but tracks actual downloaded files on disk.
 */
object DownloadedEpisodes {
    private const val PREFS_NAME = "downloaded_episodes_prefs"
    private const val KEY_DOWNLOADED_SET = "downloaded_set"
    private const val CACHE_MAX_AGE_MS = 60_000L

    private val cacheLock = Any()
    @Volatile private var cachedEntries: List<Entry>? = null
    @Volatile private var cachedSetHash: Int? = null
    @Volatile private var cachedSetSize: Int = -1
    @Volatile private var cachedAtMs: Long = 0L

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private fun sanitizeFilename(value: String): String {
        return value.replace(Regex("[^a-zA-Z0-9._-]"), "_")
    }

    private fun normalizeUrl(url: String?): String {
        if (url.isNullOrBlank()) return ""
        return try {
            val trimmed = url.trim()
            val parsed = android.net.Uri.parse(trimmed)
            if (parsed.scheme.isNullOrBlank()) trimmed.lowercase()
            else parsed.buildUpon().clearQuery().fragment(null).build().toString().lowercase()
        } catch (_: Exception) {
            url.trim().lowercase()
        }
    }

    private fun findDownloadedFileForEpisode(context: Context, episode: Episode): File? {
        return try {
            val baseDir = File(context.getExternalFilesDir(Environment.DIRECTORY_PODCASTS), "episodes")
            if (!baseDir.exists() || !baseDir.isDirectory) return null
            val safeTitle = sanitizeFilename(episode.title).ifBlank { "episode" }
            val safeEpisodeId = sanitizeFilename(episode.id).ifBlank { episode.id.hashCode().toString() }

            val directCurrentPattern = File(baseDir, "${safeTitle.take(70)}_${safeEpisodeId.take(40)}.mp3")
            if (directCurrentPattern.exists()) return directCurrentPattern

            val legacyPattern = File(baseDir, "${safeTitle.take(100)}_${episode.id}.mp3")
            if (legacyPattern.exists()) return legacyPattern

            // Fallback: match by episode id suffix used in our download filename format.
            baseDir.listFiles()?.firstOrNull {
                if (!it.isFile) return@firstOrNull false
                val name = it.name
                name.equals(directCurrentPattern.name, ignoreCase = true) ||
                    name.equals(legacyPattern.name, ignoreCase = true) ||
                    name.endsWith("_${safeEpisodeId.take(40)}.mp3", ignoreCase = true) ||
                    name.endsWith("_${episode.id}.mp3", ignoreCase = true)
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun normaliseLocalPath(path: String?): String {
        if (path.isNullOrBlank()) return ""
        return try {
            when {
                path.startsWith("file://") -> android.net.Uri.parse(path).path ?: ""
                else -> path
            }
        } catch (_: Exception) {
            path
        }
    }

    private fun hasReadableLocalFile(path: String?): Boolean {
        val resolved = normaliseLocalPath(path)
        if (resolved.isBlank()) return false
        if (resolved.startsWith("content://") || resolved.startsWith("http://") || resolved.startsWith("https://")) return false
        return try {
            val file = File(resolved)
            file.exists() && file.isFile && file.length() > 0L
        } catch (_: Exception) {
            false
        }
    }

    data class Entry(
        val id: String,
        val title: String,
        val description: String,
        val imageUrl: String,
        val audioUrl: String,
        val localFilePath: String,
        val pubDate: String,
        val durationMins: Int,
        val podcastId: String,
        val podcastTitle: String,
        val downloadedAtMs: Long,
        val fileSizeBytes: Long,
        val isAutoDownloaded: Boolean
    )

    fun getDownloadedEntries(context: Context): List<Entry> {
        val set = prefs(context).getStringSet(KEY_DOWNLOADED_SET, emptySet()) ?: emptySet()
        val now = System.currentTimeMillis()
        val setHash = computeSetHash(set)

        synchronized(cacheLock) {
            val cached = cachedEntries
            if (cached != null && cachedSetHash == setHash && cachedSetSize == set.size && (now - cachedAtMs) <= CACHE_MAX_AGE_MS) {
                return cached
            }

            val list = mutableListOf<Entry>()
            for (s in set) {
                try {
                    val j = JSONObject(s)
                    val e = Entry(
                        id = j.getString("id"),
                        title = j.optString("title", ""),
                        description = j.optString("description", ""),
                        imageUrl = j.optString("imageUrl", ""),
                        audioUrl = j.optString("audioUrl", ""),
                        localFilePath = j.optString("localFilePath", ""),
                        pubDate = j.optString("pubDate", ""),
                        durationMins = j.optInt("durationMins", 0),
                        podcastId = j.optString("podcastId", ""),
                        podcastTitle = j.optString("podcastTitle", ""),
                        downloadedAtMs = j.optLong("downloadedAtMs", 0L),
                        fileSizeBytes = j.optLong("fileSizeBytes", 0L),
                        isAutoDownloaded = j.optBoolean("isAutoDownloaded", false)
                    )
                    list.add(e)
                } catch (_: Exception) {}
            }

            val sorted = list.sortedByDescending { it.downloadedAtMs }
            cachedEntries = sorted
            cachedSetHash = setHash
            cachedSetSize = set.size
            cachedAtMs = now
            return sorted
        }
    }

    fun isDownloaded(context: Context, episodeId: String): Boolean {
        return getDownloadedEntries(context).any { it.id == episodeId }
    }

    fun isDownloaded(context: Context, episode: Episode): Boolean {
        val byId = getDownloadedEntry(context, episode.id)
        if (byId != null) return true

        val audioKey = normalizeUrl(episode.audioUrl)
        if (audioKey.isNotBlank() && getDownloadedEntries(context).any { normalizeUrl(it.audioUrl) == audioKey }) return true

        return findDownloadedFileForEpisode(context, episode) != null
    }

    fun getDownloadedEntry(context: Context, episodeId: String): Entry? {
        return getDownloadedEntries(context).firstOrNull { it.id == episodeId }
    }

    fun getDownloadedEntry(context: Context, episode: Episode): Entry? {
        getDownloadedEntry(context, episode.id)?.let { byId ->
            if (hasReadableLocalFile(byId.localFilePath)) {
                return byId.copy(localFilePath = normaliseLocalPath(byId.localFilePath))
            }
            val fallback = findDownloadedFileForEpisode(context, episode)
            if (fallback != null) {
                return byId.copy(localFilePath = fallback.absolutePath)
            }
            return byId
        }

        val audioKey = normalizeUrl(episode.audioUrl)
        if (audioKey.isNotBlank()) {
            getDownloadedEntries(context).firstOrNull { normalizeUrl(it.audioUrl) == audioKey }?.let { byAudio ->
                if (hasReadableLocalFile(byAudio.localFilePath)) {
                    return byAudio.copy(localFilePath = normaliseLocalPath(byAudio.localFilePath))
                }
                val fallback = findDownloadedFileForEpisode(context, episode)
                if (fallback != null) {
                    return byAudio.copy(localFilePath = fallback.absolutePath)
                }
                return byAudio
            }
        }

        val fallbackFile = findDownloadedFileForEpisode(context, episode) ?: return null
        return Entry(
            id = episode.id,
            title = episode.title,
            description = episode.description,
            imageUrl = episode.imageUrl,
            audioUrl = episode.audioUrl,
            localFilePath = fallbackFile.absolutePath,
            pubDate = episode.pubDate,
            durationMins = episode.durationMins,
            podcastId = episode.podcastId,
            podcastTitle = "",
            downloadedAtMs = fallbackFile.lastModified(),
            fileSizeBytes = fallbackFile.length(),
            isAutoDownloaded = false
        )
    }

    fun addDownloaded(
        context: Context,
        episode: Episode,
        localFilePath: String,
        fileSizeBytes: Long,
        podcastTitle: String? = null,
        isAutoDownloaded: Boolean = false
    ) {
        val current = prefs(context).getStringSet(KEY_DOWNLOADED_SET, emptySet())?.toMutableSet() ?: mutableSetOf()
        
        // Remove existing entry if present
        val existing = current.firstOrNull { 
            try { JSONObject(it).getString("id") == episode.id } 
            catch (_: Exception) { false } 
        }
        if (existing != null) {
            current.remove(existing)
        }

        val j = JSONObject()
        j.put("id", episode.id)
        j.put("title", episode.title)
        j.put("description", episode.description)
        j.put("imageUrl", episode.imageUrl)
        j.put("audioUrl", episode.audioUrl)
        j.put("localFilePath", localFilePath)
        j.put("pubDate", episode.pubDate)
        j.put("durationMins", episode.durationMins)
        j.put("podcastId", episode.podcastId)
        j.put("podcastTitle", podcastTitle ?: "")
        j.put("downloadedAtMs", System.currentTimeMillis())
        j.put("fileSizeBytes", fileSizeBytes)
        j.put("isAutoDownloaded", isAutoDownloaded)
        
        current.add(j.toString())
        prefs(context).edit().putStringSet(KEY_DOWNLOADED_SET, current).apply()
        invalidateCache()
    }

    fun removeDownloaded(context: Context, episodeId: String): Entry? {
        val current = prefs(context).getStringSet(KEY_DOWNLOADED_SET, emptySet())?.toMutableSet() ?: mutableSetOf()
        val existing = current.firstOrNull { 
            try { JSONObject(it).getString("id") == episodeId } 
            catch (_: Exception) { false } 
        }
        
        var entry: Entry? = null
        if (existing != null) {
            try {
                val j = JSONObject(existing)
                entry = Entry(
                    id = j.getString("id"),
                    title = j.optString("title", ""),
                    description = j.optString("description", ""),
                    imageUrl = j.optString("imageUrl", ""),
                    audioUrl = j.optString("audioUrl", ""),
                    localFilePath = j.optString("localFilePath", ""),
                    pubDate = j.optString("pubDate", ""),
                    durationMins = j.optInt("durationMins", 0),
                    podcastId = j.optString("podcastId", ""),
                    podcastTitle = j.optString("podcastTitle", ""),
                    downloadedAtMs = j.optLong("downloadedAtMs", 0L),
                    fileSizeBytes = j.optLong("fileSizeBytes", 0L),
                    isAutoDownloaded = j.optBoolean("isAutoDownloaded", false)
                )
            } catch (_: Exception) {}
            
            current.remove(existing)
            prefs(context).edit().putStringSet(KEY_DOWNLOADED_SET, current).apply()
            invalidateCache()
        }
        return entry
    }

    fun removeAll(context: Context) {
        prefs(context).edit().putStringSet(KEY_DOWNLOADED_SET, emptySet()).apply()
        invalidateCache()
    }

    fun getDownloadedEpisodesForPodcast(context: Context, podcastId: String): List<Entry> {
        return getDownloadedEntries(context).filter { it.podcastId == podcastId }
    }

    fun getTotalDownloadedSize(context: Context): Long {
        return getDownloadedEntries(context).sumOf { it.fileSizeBytes }
    }

    private fun invalidateCache() {
        synchronized(cacheLock) {
            cachedEntries = null
            cachedSetHash = null
            cachedSetSize = -1
            cachedAtMs = 0L
        }
    }

    private fun computeSetHash(set: Set<String>): Int {
        var hash = 1
        for (s in set) {
            hash = 31 * hash + s.hashCode()
        }
        return hash
    }
}
