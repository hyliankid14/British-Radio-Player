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
    fun streamCandidates(qualityBitrate: String, geoBlocked: Boolean = false): List<String> {
        // Prefer lower bitrates first for smoother playback on constrained Wear connections.
        val bitrates = listOf("48000", "96000", "128000")
        val candidates = mutableListOf<String>()

        // First: UK stream at the user's chosen quality (from directStreamUrls)
        for (url in directStreamUrls.filter { it.isNotBlank() }) {
            if (url.contains("&uk=1") && url.contains("bitrate=$qualityBitrate")) {
                candidates += url
            }
        }

        // Second: International/worldwide streams (Akamai ww, BBC non-UK)
        for (url in directStreamUrls.filter { it.isNotBlank() }) {
            if (!url.contains("&uk=1")) {
                candidates += url
            }
        }
        for (sid in streamServiceIds.filter { it.isNotBlank() }) {
            candidates += "https://a.files.bbci.co.uk/media/live/manifesto/audio/simulcast/hls/nonuk/sbr_low/ak/$sid.m3u8"
        }

        if (geoBlocked) {
            return candidates.distinct()
        }

        // Third: UK streams at other bitrates and generated lsn.lv URLs
        for (url in directStreamUrls.filter { it.isNotBlank() }) {
            if (url.contains("&uk=1") && !url.contains("bitrate=$qualityBitrate")) {
                candidates += url
            }
        }
        for (sid in streamServiceIds.filter { it.isNotBlank() }) {
            for (bitrate in bitrates.filter { it != qualityBitrate }) {
                candidates += "https://lsn.lv/bbcradio.m3u8?station=$sid&bitrate=$bitrate"
            }
        }

        // Fourth: BBC UK HLS as final fallback
        for (sid in streamServiceIds.filter { it.isNotBlank() }) {
            candidates += "https://a.files.bbci.co.uk/media/live/manifesto/audio/simulcast/hls/uk/sbr_high/ak/$sid.m3u8"
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
