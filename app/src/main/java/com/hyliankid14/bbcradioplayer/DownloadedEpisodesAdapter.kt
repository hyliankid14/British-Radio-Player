package com.hyliankid14.bbcradioplayer

import android.content.Context
import android.view.View

class DownloadedEpisodesAdapter(
    context: Context,
    entries: List<DownloadedEpisodes.Entry>,
    onPlayEpisode: (Episode, String, String) -> Unit,
    onOpenEpisode: (Episode, String, String) -> Unit,
    onDeleteDownload: (String) -> Unit,
    onEpisodeLongPress: ((DownloadedEpisodes.Entry) -> Unit)? = null,
    onEpisodeSelectionClick: ((DownloadedEpisodes.Entry) -> Boolean)? = null,
    onEpisodeOverflowClick: ((View, DownloadedEpisodes.Entry) -> Unit)? = null
) : SavedEpisodesAdapter(
    context = context,
    entries = entries.map { downloadedEntryToSavedEntry(it) },
    onPlayEpisode = onPlayEpisode,
    onOpenEpisode = onOpenEpisode,
    onRemoveSaved = onDeleteDownload,
    onEpisodeLongPress = onEpisodeLongPress?.let { callback ->
        { saved -> callback(savedEntryToDownloadedEntry(saved, entries)) }
    },
    onEpisodeSelectionClick = onEpisodeSelectionClick?.let { callback ->
        { saved -> callback(savedEntryToDownloadedEntry(saved, entries)) }
    },
    onEpisodeOverflowClick = onEpisodeOverflowClick?.let { callback ->
        { view, saved -> callback(view, savedEntryToDownloadedEntry(saved, entries)) }
    }
) {
    private var originalEntries: List<DownloadedEpisodes.Entry> = entries

    fun updateDownloadedEntries(newEntries: List<DownloadedEpisodes.Entry>) {
        originalEntries = newEntries
        updateEntries(newEntries.map { downloadedEntryToSavedEntry(it) })
    }

    fun getDownloadedEntryAt(position: Int): DownloadedEpisodes.Entry? {
        val saved = getEntryAt(position) ?: return null
        return originalEntries.firstOrNull { it.id == saved.id }
            ?: savedEntryToDownloadedEntry(saved, originalEntries)
    }

    fun getDownloadedEntries(): List<DownloadedEpisodes.Entry> {
        return originalEntries
    }
}

private fun downloadedEntryToSavedEntry(entry: DownloadedEpisodes.Entry): SavedEpisodes.Entry {
    return SavedEpisodes.Entry(
        id = entry.id,
        title = entry.title,
        description = entry.description,
        imageUrl = entry.imageUrl,
        audioUrl = entry.audioUrl,
        pubDate = entry.pubDate,
        durationMins = entry.durationMins,
        podcastId = entry.podcastId,
        podcastTitle = entry.podcastTitle,
        savedAtMs = entry.downloadedAtMs
    )
}

private fun savedEntryToDownloadedEntry(
    entry: SavedEpisodes.Entry,
    originalList: List<DownloadedEpisodes.Entry>
): DownloadedEpisodes.Entry {
    val existing = originalList.firstOrNull { it.id == entry.id }
    if (existing != null) return existing

    return DownloadedEpisodes.Entry(
        id = entry.id,
        title = entry.title,
        description = entry.description,
        imageUrl = entry.imageUrl,
        audioUrl = entry.audioUrl,
        localFilePath = "",
        pubDate = entry.pubDate,
        durationMins = entry.durationMins,
        podcastId = entry.podcastId,
        podcastTitle = entry.podcastTitle ?: "",
        downloadedAtMs = entry.savedAtMs,
        fileSizeBytes = 0L,
        isAutoDownloaded = false
    )
}
