package com.hyliankid14.bbcradioplayer

import android.content.Context

class PlaylistEpisodesAdapter(
    context: Context,
    entries: List<PodcastPlaylists.Entry>,
    onPlayEpisode: (Episode, String, String) -> Unit,
    onOpenEpisode: (Episode, String, String) -> Unit,
    onRemoveSaved: (String) -> Unit,
    onEpisodeLongPress: ((PodcastPlaylists.Entry) -> Unit)? = null,
    onEpisodeSelectionClick: ((PodcastPlaylists.Entry) -> Boolean)? = null,
    onEpisodeOverflowClick: ((android.view.View, PodcastPlaylists.Entry) -> Unit)? = null
) : SavedEpisodesAdapter(
    context = context,
    entries = entries.map { playlistEntryToSavedEntry(it) },
    onPlayEpisode = onPlayEpisode,
    onOpenEpisode = onOpenEpisode,
    onRemoveSaved = onRemoveSaved,
    onEpisodeLongPress = onEpisodeLongPress?.let { callback ->
        { saved -> callback(savedEntryToPlaylistEntry(saved)) }
    },
    onEpisodeSelectionClick = onEpisodeSelectionClick?.let { callback ->
        { saved -> callback(savedEntryToPlaylistEntry(saved)) }
    },
    onEpisodeOverflowClick = onEpisodeOverflowClick?.let { callback ->
        { view, saved -> callback(view, savedEntryToPlaylistEntry(saved)) }
    }
) {
    fun updatePlaylistEntries(newEntries: List<PodcastPlaylists.Entry>) {
        updateEntries(newEntries.map { playlistEntryToSavedEntry(it) })
    }

    fun getPlaylistEntryAt(position: Int): PodcastPlaylists.Entry? {
        return getEntryAt(position)?.let { savedEntryToPlaylistEntry(it) }
    }

    fun getPlaylistEntries(): List<PodcastPlaylists.Entry> {
        return entries.map { savedEntryToPlaylistEntry(it) }
    }
}

private fun playlistEntryToSavedEntry(entry: PodcastPlaylists.Entry): SavedEpisodes.Entry {
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
        savedAtMs = entry.savedAtMs
    )
}

private fun savedEntryToPlaylistEntry(entry: SavedEpisodes.Entry): PodcastPlaylists.Entry {
    return PodcastPlaylists.Entry(
        id = entry.id,
        title = entry.title,
        description = entry.description,
        imageUrl = entry.imageUrl,
        audioUrl = entry.audioUrl,
        pubDate = entry.pubDate,
        durationMins = entry.durationMins,
        podcastId = entry.podcastId,
        podcastTitle = entry.podcastTitle,
        savedAtMs = entry.savedAtMs
    )
}