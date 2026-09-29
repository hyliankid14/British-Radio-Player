package com.hyliankid14.bbcradioplayer

import android.content.Context

/**
 * Simple persisted search history (most-recent-first) stored in SharedPreferences.
 * Duplicates are de-duplicated case-insensitively and the list is limited.
 */
class SearchHistory(private val context: Context) {
    companion object {
        private const val PREFS = "search_history_prefs"
        private const val KEY = "history_list"
        private const val SEP = "\u001F" // Unit Separator - unlikely to appear in queries
        private const val DEFAULT_LIMIT = 30
    }

    fun add(query: String, limit: Int = DEFAULT_LIMIT) {
        val q = query.trim()
        if (q.isEmpty()) return
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY, "") ?: ""
        val list = if (raw.isBlank()) mutableListOf() else raw.split(SEP).toMutableList()

        // Remove any existing case-insensitive duplicates first so we can re-prepend the entry
        // (this also handles the "re-run existing search → move to top" case).
        val existingIndex = list.indexOfFirst { it.equals(q, ignoreCase = true) }
        if (existingIndex >= 0) list.removeAt(existingIndex)

        // If there's a *longer* entry that already starts with this query (and it's not an exact
        // match, handled above), don't add the shorter prefix query — prevents suggestions like
        // "barbers", "barbersh" when the user previously searched "barbershop".
        if (list.any { it.startsWith(q, ignoreCase = true) }) return

        // Remove any shorter entries that are prefixes of the new, longer query so the
        // longer query replaces noisy partial entries (e.g. remove "barbers" when
        // adding "barbershop").
        val toRemove = list.filter { q.startsWith(it, ignoreCase = true) }
        list.removeAll(toRemove)

        // Prepend the new query
        list.add(0, q)
        // Trim to limit
        while (list.size > limit) list.removeAt(list.size - 1)
        prefs.edit().putString(KEY, list.joinToString(SEP)).apply()
    }

    fun getRecent(limit: Int = DEFAULT_LIMIT): List<String> {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY, "") ?: ""
        if (raw.isBlank()) return emptyList()
        return raw.split(SEP).filter { it.isNotBlank() }.take(limit)
    }

    fun clear() {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs.edit().remove(KEY).apply()
    }

    fun remove(query: String) {
        val q = query.trim()
        if (q.isEmpty()) return
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY, "") ?: ""
        if (raw.isBlank()) return
        val list = raw.split(SEP)
            .filter { it.isNotBlank() }
            .filterNot { it.equals(q, ignoreCase = true) }
        prefs.edit().putString(KEY, list.joinToString(SEP)).apply()
    }
}
