package com.hyliankid14.bbcradioplayer.db

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

internal class IndexDatabaseHelper(context: Context) : SQLiteOpenHelper(context, DB_NAME, null, DB_VERSION) {
    companion object {
        private const val DB_NAME = "podcast_index.db"
        private const val DB_VERSION = 3
    }

    override fun onCreate(db: SQLiteDatabase) {
        // FTS4 tables for podcasts and episodes
        db.execSQL("CREATE VIRTUAL TABLE IF NOT EXISTS podcast_fts USING fts4(podcastId TEXT, title TEXT, description TEXT);")
        db.execSQL("CREATE VIRTUAL TABLE IF NOT EXISTS episode_fts USING fts4(episodeId TEXT, podcastId TEXT, title TEXT, description TEXT);")
        db.execSQL("CREATE TABLE IF NOT EXISTS episode_meta (episodeId TEXT PRIMARY KEY, pubDate TEXT, pubEpoch INTEGER DEFAULT 0);")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // For now do a full rebuild on version change
        db.execSQL("DROP TABLE IF EXISTS podcast_fts;")
        db.execSQL("DROP TABLE IF EXISTS episode_fts;")
        db.execSQL("DROP TABLE IF EXISTS episode_meta;")
        onCreate(db)
    }
}
