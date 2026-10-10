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
        val candidates = mutableListOf<String>()

        val isUkUrl: (String) -> Boolean = { url ->
            url.contains("&uk=1") || url.contains("/live/uk/") || url.contains("/hls/uk/")
        }
        val isWwUrl: (String) -> Boolean = { url ->
            url.contains("/live/ww/") || url.contains("/nonuk/")
        }

        // First: UK stream at the user's chosen quality (from directStreamUrls)
        for (url in directStreamUrls.filter { it.isNotBlank() }) {
            if (isUkUrl(url) && (url.contains("bitrate=$qualityBitrate") || url.contains("audio=$qualityBitrate"))) {
                candidates += url
            }
        }

        if (geoBlocked) {
            // Only add international streams if geo-blocked
            for (url in directStreamUrls.filter { it.isNotBlank() }) {
                if (isWwUrl(url)) {
                    candidates += url
                }
            }
            for (sid in streamServiceIds.filter { it.isNotBlank() }) {
                candidates += "https://a.files.bbci.co.uk/ms6/live/3441A116-B12E-4D2F-ACA8-C1984642FA4B/audio/simulcast/hls/nonuk/pc_hd_abr_v2/cf/$sid.m3u8"
            }
            return candidates.distinct()
        }

        // Second: Other UK direct streams
        for (url in directStreamUrls.filter { it.isNotBlank() }) {
            if (isUkUrl(url) && !url.contains("bitrate=$qualityBitrate") && !url.contains("audio=$qualityBitrate")) {
                candidates += url
            }
        }

        // Third: BBC UK HLS as standard UK streams
        for (sid in streamServiceIds.filter { it.isNotBlank() }) {
            candidates += "https://a.files.bbci.co.uk/ms6/live/3441A116-B12E-4D2F-ACA8-C1984642FA4B/audio/simulcast/hls/uk/audio_syndication_high_sbr_v1/cf/$sid.m3u8"
            candidates += "https://a.files.bbci.co.uk/ms6/live/3441A116-B12E-4D2F-ACA8-C1984642FA4B/audio/simulcast/hls/uk/pc_hd_abr_v2/cf/$sid.m3u8"
        }

        // Fourth: International/worldwide streams as last resort (Akamai ww, BBC non-UK)
        for (url in directStreamUrls.filter { it.isNotBlank() }) {
            if (isWwUrl(url)) {
                candidates += url
            }
        }
        for (sid in streamServiceIds.filter { it.isNotBlank() }) {
            candidates += "https://a.files.bbci.co.uk/ms6/live/3441A116-B12E-4D2F-ACA8-C1984642FA4B/audio/simulcast/hls/nonuk/pc_hd_abr_v2/cf/$sid.m3u8"
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
