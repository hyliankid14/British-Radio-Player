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
        // Prefer lower bitrates first for smoother playback on constrained Wear connections.
        val bitrates = listOf("48000", "96000", "128000")
        val candidates = mutableListOf<String>()
        candidates += directStreamUrls.filter { it.isNotBlank() }
        for (sid in streamServiceIds.filter { it.isNotBlank() }) {
            for (bitrate in bitrates) {
                candidates += "https://lsn.lv/bbcradio.m3u8?station=$sid&bitrate=$bitrate"
            }
        }
        // BBC direct HLS streams as final fallbacks (UK high-quality then non-UK lower-quality)
        for (sid in streamServiceIds.filter { it.isNotBlank() }) {
            candidates += "https://a.files.bbci.co.uk/media/live/manifesto/audio/simulcast/hls/uk/sbr_high/ak/$sid.m3u8"
            candidates += "https://a.files.bbci.co.uk/media/live/manifesto/audio/simulcast/hls/nonuk/sbr_low/ak/$sid.m3u8"
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
