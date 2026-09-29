package com.hyliankid14.bbcradioplayer.db

import android.content.Context

/**
 * Stubbed AppDatabase while Room is disabled in build. Provides a lightweight getInstance() so
 * code referencing this class compiles; the returned instance's ftsDao() will throw if used.
 */
class AppDatabase private constructor() {
    fun ftsDao(): FtsDao = object : FtsDao {
        override suspend fun searchPodcasts(match: String, limit: Int): List<PodcastFts> = emptyList()
        override suspend fun insertPodcasts(entries: List<PodcastFts>) {}
        override suspend fun clearPodcasts() {}
        override suspend fun searchEpisodes(match: String, limit: Int): List<EpisodeFts> = emptyList()
        override suspend fun insertEpisodes(entries: List<EpisodeFts>) {}
        override suspend fun deleteEpisodesForPodcast(podcastId: String) {}
        override suspend fun clearEpisodes() {}
    }

    companion object {
        @Volatile
        private var INSTANCE: AppDatabase? = null

        @Suppress("UNUSED_PARAMETER")
        fun getInstance(_context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = AppDatabase()
                INSTANCE = instance
                instance
            }
        }
    }
}
