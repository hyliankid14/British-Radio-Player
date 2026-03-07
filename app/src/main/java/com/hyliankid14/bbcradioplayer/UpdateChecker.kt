package com.hyliankid14.bbcradioplayer

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

fun getDisplayVersion(context: Context): String {
    return try {
        // The versionName already encodes the build type:
        //   release: "1.2.0"
        //   debug:   "1.2.0-debug.42"  (commit count since last tag, set at build time)
        context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "Unknown"
    } catch (e: Exception) {
        "Unknown"
    }
}

data class ReleaseInfo(
    val tagName: String,
    val versionName: String,
    val releaseNotes: String,
    val downloadUrl: String,
    val isPreRelease: Boolean
)

class UpdateChecker(private val context: Context) {
    
    companion object {
        private const val PREFS_NAME = "update_checker_prefs"
        private const val KEY_LAST_CHECK_TIME = "last_check_time"
        private const val KEY_LATEST_VERSION = "latest_version"
        private const val KEY_LATEST_DOWNLOAD_URL = "latest_download_url"
        private const val KEY_LATEST_RELEASE_NOTES = "latest_release_notes"
        private const val KEY_LATEST_TAG = "latest_tag"
        private const val TAG = "UpdateChecker"
        
        private const val GITHUB_API_LATEST_RELEASE = 
            "https://api.github.com/repos/hyliankid14/bbc-radio-player/releases/latest"
        // Reduced to 15 minutes for testing; can be changed to 24 hours in production
        private const val CHECK_INTERVAL_MS = 15 * 60 * 1000L // 15 minutes

        // Matches the debug pre-release suffix appended at build time (e.g. "-debug.42")
        private val DEBUG_SUFFIX_PATTERN = Regex("-debug\\.\\d+$")
    }
    
    private val prefs: SharedPreferences = 
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    
    /**
     * Check for updates from GitHub.
     * Returns ReleaseInfo if a newer version is available, null otherwise.
     */
    suspend fun checkForUpdate(): ReleaseInfo? = withContext(Dispatchers.IO) {
        try {
            val fullVersionString = try {
                context.packageManager.getPackageInfo(context.packageName, 0).versionName
            } catch (e: Exception) {
                Log.w(TAG, "Failed to get app version", e)
                return@withContext null
            }
            // Strip debug pre-release suffix for version comparison
            // e.g. "1.2.0-debug.42" -> "1.2.0"
            val currentVersion = fullVersionString.replace(DEBUG_SUFFIX_PATTERN, "")
            Log.d(TAG, "Checking for updates. Current version: $currentVersion (display: $fullVersionString)")
            
            val releaseInfo = fetchLatestRelease() ?: return@withContext null
            
            // Only offer stable releases (not pre-releases)
            if (releaseInfo.isPreRelease) {
                Log.d(TAG, "Latest release is a pre-release, skipping")
                return@withContext null
            }
            
            if (isNewerVersion(releaseInfo.versionName, currentVersion)) {
                Log.d(TAG, "Update available: ${releaseInfo.versionName}")
                // Cache the release info
                cacheReleaseInfo(releaseInfo)
                return@withContext releaseInfo
            } else {
                Log.d(TAG, "Already on latest version or newer")
                return@withContext null
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to check for updates", e)
            return@withContext null
        }
    }
    
    /**
     * Fetch the latest release info from GitHub API
     */
    private fun fetchLatestRelease(): ReleaseInfo? {
        val connection = (URL(GITHUB_API_LATEST_RELEASE).openConnection() as HttpURLConnection).apply {
            instanceFollowRedirects = false
            connectTimeout = 15000
            readTimeout = 15000
            requestMethod = "GET"
            setRequestProperty("User-Agent", "BBC Radio Player/1.0 (Android)")
            setRequestProperty("Accept", "application/vnd.github.v3+json")
        }
        
        return try {
            if (connection.responseCode == HttpURLConnection.HTTP_OK) {
                val response = connection.inputStream.bufferedReader().use { it.readText() }
                parseReleaseResponse(response)
            } else {
                Log.w(TAG, "GitHub API response code: ${connection.responseCode}")
                null
            }
        } finally {
            connection.disconnect()
        }
    }
    
    /**
     * Parse GitHub API response JSON
     */
    private fun parseReleaseResponse(jsonString: String): ReleaseInfo? {
        return try {
            val json = JSONObject(jsonString)
            val tagName = json.getString("tag_name")
            val versionName = tagName.removePrefix("v")
            val isPreRelease = json.getBoolean("prerelease")
            
            // Get the body as release notes
            val releaseNotes = json.optString("body", "No release notes available")
            
            // Find the APK download URL for nogoogle variant (F-Droid compatible)
            val assets = json.getJSONArray("assets")
            Log.d(TAG, "Found ${assets.length()} assets in release")
            
            val downloadUrl = (0 until assets.length()).firstNotNullOfOrNull { i ->
                val asset = assets.getJSONObject(i)
                val name = asset.getString("name")
                Log.d(TAG, "Asset: $name")
                if (name.endsWith("-nogoogle.apk")) {
                    Log.d(TAG, "Found matching APK: $name")
                    asset.getString("browser_download_url")
                } else {
                    null
                }
            }
            
            if (downloadUrl == null) {
                Log.w(TAG, "No APK download URL found in release assets")
                return null
            }
            
            ReleaseInfo(
                tagName = tagName,
                versionName = versionName,
                releaseNotes = releaseNotes,
                downloadUrl = downloadUrl,
                isPreRelease = isPreRelease
            )
        } catch (e: Exception) {
            Log.w(TAG, "Failed to parse release response", e)
            null
        }
    }
    
    /**
     * Compare two version strings (semantic versioning)
     * Returns true if newVersion > currentVersion
     */
    private fun isNewerVersion(newVersion: String, currentVersion: String): Boolean {
        return try {
            val newParts = newVersion.split(".").mapNotNull { it.toIntOrNull() }
            val currentParts = currentVersion.split(".").mapNotNull { it.toIntOrNull() }
            
            Log.d(TAG, "Comparing versions: new=$newVersion ($newParts) vs current=$currentVersion ($currentParts)")
            
            for (i in 0 until maxOf(newParts.size, currentParts.size)) {
                val newPart = newParts.getOrNull(i) ?: 0
                val currentPart = currentParts.getOrNull(i) ?: 0
                
                when {
                    newPart > currentPart -> {
                        Log.d(TAG, "New version is newer at position $i: $newPart > $currentPart")
                        return true
                    }
                    newPart < currentPart -> {
                        Log.d(TAG, "Current version is newer at position $i: $newPart < $currentPart")
                        return false
                    }
                }
            }
            Log.d(TAG, "Versions are equal")
            false
        } catch (e: Exception) {
            Log.w(TAG, "Failed to compare versions", e)
            false
        }
    }
    
    /**
     * Cache release info for later retrieval
     */
    private fun cacheReleaseInfo(releaseInfo: ReleaseInfo) {
        prefs.edit().apply {
            putLong(KEY_LAST_CHECK_TIME, System.currentTimeMillis())
            putString(KEY_LATEST_VERSION, releaseInfo.versionName)
            putString(KEY_LATEST_DOWNLOAD_URL, releaseInfo.downloadUrl)
            putString(KEY_LATEST_RELEASE_NOTES, releaseInfo.releaseNotes)
            putString(KEY_LATEST_TAG, releaseInfo.tagName)
        }.apply()
    }
    
    /**
     * Get cached release info
     */
    fun getCachedReleaseInfo(): ReleaseInfo? {
        val version = prefs.getString(KEY_LATEST_VERSION, null) ?: return null
        val downloadUrl = prefs.getString(KEY_LATEST_DOWNLOAD_URL, null) ?: return null
        val releaseNotes = prefs.getString(KEY_LATEST_RELEASE_NOTES, "") ?: ""
        val tagName = prefs.getString(KEY_LATEST_TAG, "v$version") ?: "v$version"
        
        return ReleaseInfo(
            tagName = tagName,
            versionName = version,
            releaseNotes = releaseNotes,
            downloadUrl = downloadUrl,
            isPreRelease = false
        )
    }
    
    /**
     * Get last check timestamp
     */
    fun getLastCheckTime(): Long = prefs.getLong(KEY_LAST_CHECK_TIME, 0)
    
    /**
     * Check if enough time has passed since last check
     */
    fun shouldCheckForUpdate(): Boolean {
        val lastCheckTime = getLastCheckTime()
        return System.currentTimeMillis() - lastCheckTime > CHECK_INTERVAL_MS
    }
    
    /**
     * Clear cached update info
     */
    fun clearCachedInfo() {
        prefs.edit().clear().apply()
    }
}
