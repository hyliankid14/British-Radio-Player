package com.hyliankid14.bbcradioplayer.db

/**
 * Stub FTS DAO interface (Room annotations removed while Room is disabled in build).
 * These methods are kept as signatures so the rest of the code can compile; they are not used
 * when indexing is disabled.
 */
interface FtsDao {
    suspend fun searchPodcasts(match: String, limit: Int = 50): List<PodcastFts>
    suspend fun insertPodcasts(entries: List<PodcastFts>)
    suspend fun clearPodcasts()

    suspend fun searchEpisodes(match: String, limit: Int = 100): List<EpisodeFts>
    suspend fun insertEpisodes(entries: List<EpisodeFts>)
    suspend fun deleteEpisodesForPodcast(podcastId: String)
    suspend fun clearEpisodes()
}
