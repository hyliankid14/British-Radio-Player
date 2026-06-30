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
        val bitrates = listOf("48000", "96000", "128000")
        val worldwide = mutableListOf<String>()
        val ukOnly = mutableListOf<String>()

        for (url in directStreamUrls.filter { it.isNotBlank() }) {
            if (url.contains("&uk=1")) {
                ukOnly += url
            } else {
                worldwide += url
            }
        }
        for (sid in streamServiceIds.filter { it.isNotBlank() }) {
            for (bitrate in bitrates) {
                worldwide += "https://lsn.lv/bbcradio.m3u8?station=$sid&bitrate=$bitrate"
            }
        }
        for (sid in streamServiceIds.filter { it.isNotBlank() }) {
            ukOnly += "https://a.files.bbci.co.uk/media/live/manifesto/audio/simulcast/hls/uk/sbr_high/ak/$sid.m3u8"
            worldwide += "https://a.files.bbci.co.uk/media/live/manifesto/audio/simulcast/hls/nonuk/sbr_low/ak/$sid.m3u8"
        }
        return (worldwide + ukOnly).distinct()
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
