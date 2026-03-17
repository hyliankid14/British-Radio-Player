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
        //   release: "1.3.0"  (auto-computed from conventional commits since last tag)
        //   debug:   "1.3.0-debug"  (same base version with -debug suffix)
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

        // Matches the debug pre-release suffix appended at build time (e.g. "-debug")
        private val DEBUG_SUFFIX_PATTERN = Regex("-debug$")
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
                    ?: return@withContext null
            } catch (e: Exception) {
                Log.w(TAG, "Failed to get app version", e)
                return@withContext null
            }
            // Strip debug pre-release suffix for version comparison
            // e.g. "1.2.1-debug" -> "1.2.1"
            val currentVersion = fullVersionString.replace(DEBUG_SUFFIX_PATTERN, "")
            Log.d(TAG, "Checking for updates. Current version: '$currentVersion' (full: '$fullVersionString')")
            
            val releaseInfo = fetchLatestRelease() ?: return@withContext null
            Log.d(TAG, "Fetched release info: ${releaseInfo.versionName} (prerelease: ${releaseInfo.isPreRelease})")
            
            // Only offer stable releases (not pre-releases)
            if (releaseInfo.isPreRelease) {
                Log.d(TAG, "Latest release ${releaseInfo.versionName} is marked as pre-release, skipping")
                return@withContext null
            }
            
            val isNewer = isNewerVersion(releaseInfo.versionName, currentVersion)
            Log.d(TAG, "Version comparison result: ${releaseInfo.versionName} > $currentVersion = $isNewer")
            
            if (isNewer) {
                Log.d(TAG, "✅ Update available: ${releaseInfo.versionName}")
                // Cache the release info
                cacheReleaseInfo(releaseInfo)
                return@withContext releaseInfo
            } else {
                Log.d(TAG, "❌ No update available - already on version $currentVersion or newer")
                return@withContext null
            }
        } catch (e: Exception) {
            Log.w(TAG, "❌ Failed to check for updates: ${e.message}", e)
            return@withContext null
        }
    }
    
    /**
     * Fetch the latest release info from GitHub API
     */
    private fun fetchLatestRelease(): ReleaseInfo? {
        Log.d(TAG, "Fetching latest release from GitHub API...")
        val connection = (URL(GITHUB_API_LATEST_RELEASE).openConnection() as HttpURLConnection).apply {
            instanceFollowRedirects = false
            connectTimeout = 15000
            readTimeout = 15000
            requestMethod = "GET"
            setRequestProperty("User-Agent", "British Radio Player/1.0 (Android)")
            setRequestProperty("Accept", "application/vnd.github.v3+json")
        }
        
        return try {
            if (connection.responseCode == HttpURLConnection.HTTP_OK) {
                val response = connection.inputStream.bufferedReader().use { it.readText() }
                Log.d(TAG, "GitHub API response received (${response.length} bytes)")
                parseReleaseResponse(response)
            } else {
                Log.w(TAG, "❌ GitHub API error: HTTP ${connection.responseCode}")
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
            Log.d(TAG, "Parsed release: tag=$tagName, version=$versionName, prerelease=$isPreRelease")
            
            // Get the body as release notes
            val releaseNotes = json.optString("body", "No release notes available")
            
            // Find the APK download URL in the release assets (exclude debug builds)
            val assets = json.getJSONArray("assets")
            Log.d(TAG, "Found ${assets.length()} asset(s) in release")
            
            val downloadUrl = (0 until assets.length()).firstNotNullOfOrNull { i ->
                val asset = assets.getJSONObject(i)
                val name = asset.getString("name")
                Log.d(TAG, "Asset: $name")
                if (name.endsWith(".apk") && !name.contains("debug", ignoreCase = true)) {
                    Log.d(TAG, "Found matching APK: $name")
                    asset.getString("browser_download_url")
                } else {
                    null
                }
            }
            
            if (downloadUrl == null) {
                Log.w(TAG, "❌ No APK found in release assets")
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
            Log.w(TAG, "❌ Failed to parse release response: ${e.message}", e)
            null
        }
    }
    
    /**
     * Compare two version strings (semantic versioning)
     * Returns true if newVersion > currentVersion
     */
    private fun isNewerVersion(newVersion: String, currentVersion: String): Boolean {
        return try {
            // Strip any debug suffixes and whitespace for clean comparison
            val cleanNew = newVersion.trim().replace(DEBUG_SUFFIX_PATTERN, "")
            val cleanCurrent = currentVersion.trim().replace(DEBUG_SUFFIX_PATTERN, "")
            
            // Extract numeric parts, handling pre-release versions (e.g., "1.3.0-rc1" -> "1.3.0")
            val newVersionOnly = cleanNew.split("-")[0]  // Strip pre-release suffix
            val currentVersionOnly = cleanCurrent.split("-")[0]  // Strip pre-release suffix
            
            val newParts = newVersionOnly.split(".").map { part ->
                part.filter { it.isDigit() }.toIntOrNull() ?: 0
            }
            val currentParts = currentVersionOnly.split(".").map { part ->
                part.filter { it.isDigit() }.toIntOrNull() ?: 0
            }
            
            Log.d(TAG, "Comparing versions: new='$newVersion' -> cleaned='$cleanNew' -> parts=$newParts")
            Log.d(TAG, "Comparing versions: current='$currentVersion' -> cleaned='$cleanCurrent' -> parts=$currentParts")
            
            // Pad both lists to same length with 0s for missing components
            val maxLen = maxOf(newParts.size, currentParts.size)
            val paddedNew = newParts + List(maxLen - newParts.size) { 0 }
            val paddedCurrent = currentParts + List(maxLen - currentParts.size) { 0 }
            
            for (i in 0 until maxLen) {
                val newPart = paddedNew[i]
                val currentPart = paddedCurrent[i]
                
                when {
                    newPart > currentPart -> {
                        Log.d(TAG, "New version is newer at position $i: $newPart > $currentPart")
                        return true
                    }
                    newPart < currentPart -> {
                        Log.d(TAG, "Current version is newer or equal at position $i: $newPart < $currentPart")
                        return false
                    }
                }
            }
            Log.d(TAG, "Versions are equal: $cleanNew == $cleanCurrent")
            false
        } catch (e: Exception) {
            Log.w(TAG, "Failed to compare versions: new=$newVersion vs current=$currentVersion", e)
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
