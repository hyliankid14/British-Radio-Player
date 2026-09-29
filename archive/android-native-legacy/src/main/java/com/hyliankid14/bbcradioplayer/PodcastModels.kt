package com.hyliankid14.bbcradioplayer

import android.os.Parcelable
import kotlinx.parcelize.Parcelize

@Parcelize
data class Podcast(
    val id: String,
    val title: String,
    val description: String,
    val rssUrl: String,
    val htmlUrl: String,
    val imageUrl: String,
    val genres: List<String>,
    val typicalDurationMins: Int
) : Parcelable

@Parcelize
data class Episode(
    val id: String,
    val title: String,
    val description: String,
    val audioUrl: String,
    val imageUrl: String,
    val pubDate: String,
    val durationMins: Int,
    val podcastId: String
) : Parcelable

data class PodcastFilter(
    val genres: Set<String> = emptySet(),
    val minDuration: Int = 0,
    val maxDuration: Int = 300,
    val searchQuery: String = ""
)

data class ParsedPodcast(
    val podcast: Podcast,
    val episodes: List<Episode>
)

data class PodcastRatingSummary(
    val averageRating: Float,
    val ratingCount: Int,
    val myRating: Float? = null
)
