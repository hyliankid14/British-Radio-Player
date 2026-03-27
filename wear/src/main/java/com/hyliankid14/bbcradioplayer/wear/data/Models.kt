package com.hyliankid14.bbcradioplayer.wear.data

data class Station(
    val id: String,
    val title: String,
    val serviceId: String,
    val streamServiceIds: List<String> = listOf(serviceId),
    val directStreamUrls: List<String> = emptyList(),
    val logoUrl: String,
    val category: StationCategory = StationCategory.LOCAL
) {
    fun streamCandidates(): List<String> {
        val bitrates = listOf("96000", "128000", "48000")
        val candidates = mutableListOf<String>()
        candidates += directStreamUrls.filter { it.isNotBlank() }
        for (sid in streamServiceIds.filter { it.isNotBlank() }) {
            for (bitrate in bitrates) {
                candidates += "https://lsn.lv/bbcradio.m3u8?station=$sid&bitrate=$bitrate"
            }
        }
        return candidates.distinct()
    }
}

enum class StationCategory {
    NATIONAL,
    REGIONS,
    LOCAL
}

data class PodcastSummary(
    val id: String,
    val title: String,
    val description: String,
    val rssUrl: String,
    val imageUrl: String
)

data class EpisodeSummary(
    val id: String,
    val podcastId: String,
    val podcastTitle: String,
    val title: String,
    val description: String,
    val audioUrl: String,
    val pubDate: String
)
