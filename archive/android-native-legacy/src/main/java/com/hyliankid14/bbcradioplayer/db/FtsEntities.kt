package com.hyliankid14.bbcradioplayer.db

/**
 * Stub FTS entity classes (annotations removed while Room is disabled in build).
 * When Room is re-enabled we'll restore FTS4 annotations.
 */
data class PodcastFts(
    val podcastId: String,
    val title: String,
    val description: String
)

data class EpisodeFts(
    val episodeId: String,
    val podcastId: String,
    val title: String,
    val description: String,
    val pubDate: String = ""
)
