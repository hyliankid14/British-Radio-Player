package com.hyliankid14.bbcradioplayer

import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.widget.Button
import android.widget.RadioGroup
import android.widget.TextView
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch

class SettingsDetailActivity : AppCompatActivity() {
    
    companion object {
        const val EXTRA_SECTION = "section"
        const val SECTION_THEME = "theme"
        const val SECTION_ANDROID_AUTO = "android_auto"
        const val SECTION_PLAYBACK = "playback"
        const val SECTION_SUBSCRIPTIONS = "subscriptions"
        const val SECTION_INDEXING = "indexing"
        const val SECTION_BACKUP = "backup"
        const val SECTION_PRIVACY = "privacy"
        const val SECTION_ALARM = "alarm"
        const val SECTION_ABOUT = "about"
    }

    private lateinit var createDocumentLauncher: ActivityResultLauncher<String>
    private lateinit var openDocumentLauncher: ActivityResultLauncher<Array<String>>
    private var suppressIndexSpinnerSelection = false
    private var lastSeenIndexPercent = 0

    private val githubReleasesUrl = "https://github.com/hyliankid14/BBC-Radio-Player/releases"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        val section = intent.getStringExtra(EXTRA_SECTION) ?: SECTION_THEME
        
        // Set the layout based on the section
        when (section) {
            SECTION_THEME -> {
                setContentView(R.layout.settings_theme)
                setupThemeSettings()
            }
            SECTION_ANDROID_AUTO -> {
                setContentView(R.layout.settings_android_auto)
                setupAndroidAutoSettings()
            }
            SECTION_PLAYBACK -> {
                setContentView(R.layout.settings_playback)
                setupPlaybackSettings()
            }
            SECTION_SUBSCRIPTIONS -> {
                setContentView(R.layout.settings_subscriptions)
                setupSubscriptionsSettings()
            }
            SECTION_INDEXING -> {
                setContentView(R.layout.settings_indexing)
                setupIndexingSettings()
            }
            SECTION_BACKUP -> {
                setContentView(R.layout.settings_backup)
                setupBackupSettings()
            }
            SECTION_PRIVACY -> {
                setContentView(R.layout.settings_privacy)
                setupPrivacySettings()
            }
            SECTION_ALARM -> {
                setContentView(R.layout.settings_alarm)
                setupAlarmSettings()
            }
            SECTION_ABOUT -> {
                setContentView(R.layout.settings_about)
                setupAboutSettings()
            }
        }
        
        // Set up the toolbar as the action bar
        val toolbar: com.google.android.material.appbar.MaterialToolbar = findViewById(R.id.toolbar)
        try {
            setSupportActionBar(toolbar)
        } catch (e: IllegalStateException) {
            android.util.Log.w("SettingsDetailActivity", "Could not set support action bar: ${e.message}")
        }
        
        // Configure action bar with section title and back button
        val sectionTitle = when (section) {
            SECTION_THEME -> "Theme"
            SECTION_ANDROID_AUTO -> "Android Auto"
            SECTION_PLAYBACK -> "Playback"
            SECTION_SUBSCRIPTIONS -> "Subscriptions"
            SECTION_INDEXING -> "Indexing"
            SECTION_BACKUP -> "Backup"
            SECTION_PRIVACY -> "Privacy"
            SECTION_ALARM -> "Alarm"
            SECTION_ABOUT -> "About"
            else -> "Settings"
        }
        supportActionBar?.apply {
            title = sectionTitle
            setDisplayHomeAsUpEnabled(true)
            setDisplayShowHomeEnabled(false)
        }
    }

    override fun onSupportNavigateUp(): Boolean {
        finish()
        return true
    }

    private fun setupThemeSettings() {
        val themeGroup: RadioGroup = findViewById(R.id.theme_radio_group)
        
        // Set current theme selection
        val currentTheme = ThemePreference.getTheme(this)
        when (currentTheme) {
            ThemePreference.THEME_LIGHT -> themeGroup.check(R.id.radio_light)
            ThemePreference.THEME_DARK -> themeGroup.check(R.id.radio_dark)
            ThemePreference.THEME_SYSTEM -> themeGroup.check(R.id.radio_system)
        }
        
        themeGroup.setOnCheckedChangeListener { _, checkedId ->
            val selectedTheme = when (checkedId) {
                R.id.radio_light -> ThemePreference.THEME_LIGHT
                R.id.radio_dark -> ThemePreference.THEME_DARK
                R.id.radio_system -> ThemePreference.THEME_SYSTEM
                else -> ThemePreference.THEME_SYSTEM
            }
            
            ThemePreference.setTheme(this, selectedTheme)
            ThemeManager.applyTheme(selectedTheme)
        }
    }

    private fun setupAndroidAutoSettings() {
        val autoResumeAndroidAutoCheckbox: android.widget.CheckBox = findViewById(R.id.auto_resume_android_auto_checkbox)
        val nonGoogleNoticeContainer: android.view.View = findViewById(R.id.non_google_android_auto_notice_container)
        val githubDownloadButton: Button = findViewById(R.id.non_google_android_auto_download_button)

        val hasAndroidAutoMetadata = hasGoogleCarMetadata()
        if (!hasAndroidAutoMetadata) {
            nonGoogleNoticeContainer.visibility = android.view.View.VISIBLE
            autoResumeAndroidAutoCheckbox.isEnabled = false
            autoResumeAndroidAutoCheckbox.alpha = 0.5f

            githubDownloadButton.setOnClickListener {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(githubReleasesUrl)))
            }
        } else {
            nonGoogleNoticeContainer.visibility = android.view.View.GONE
        }
        
        autoResumeAndroidAutoCheckbox.isChecked = PlaybackPreference.isAutoResumeAndroidAutoEnabled(this)
        autoResumeAndroidAutoCheckbox.setOnCheckedChangeListener { _, isChecked ->
            PlaybackPreference.setAutoResumeAndroidAuto(this, isChecked)
        }
    }

    private fun hasGoogleCarMetadata(): Boolean {
        return try {
            val appInfo = packageManager.getApplicationInfo(packageName, PackageManager.GET_META_DATA)
            appInfo.metaData?.containsKey("com.google.android.gms.car.application") == true
        } catch (_: Exception) {
            false
        }
    }

    private fun setupPlaybackSettings() {
        // Setup Audio Quality settings
        val qualityGroup: RadioGroup = findViewById(R.id.quality_radio_group)
        val autoQualityCheckbox: android.widget.CheckBox = findViewById(R.id.auto_quality_checkbox)
        
        // Set current auto-detect quality selection
        val autoDetectQuality = ThemePreference.getAutoDetectQuality(this)
        autoQualityCheckbox.isChecked = autoDetectQuality
        qualityGroup.alpha = if (autoDetectQuality) 0.5f else 1.0f
        qualityGroup.isEnabled = !autoDetectQuality
        
        // Set manual quality selection (only used if auto-detect is disabled)
        val highQuality = if (autoDetectQuality) {
            NetworkQualityDetector.shouldUseHighQuality(this)
        } else {
            ThemePreference.getHighQuality(this)
        }
        if (highQuality) {
            qualityGroup.check(R.id.radio_high_quality)
        } else {
            qualityGroup.check(R.id.radio_low_quality)
        }
        
        autoQualityCheckbox.setOnCheckedChangeListener { _, isChecked ->
            ThemePreference.setAutoDetectQuality(this, isChecked)
            qualityGroup.alpha = if (isChecked) 0.5f else 1.0f
            qualityGroup.isEnabled = !isChecked
            
            // If currently playing, reload stream with new quality settings
            val currentStation = PlaybackStateHelper.getCurrentStation()
            if (currentStation != null && PlaybackStateHelper.getIsPlaying()) {
                val intent = Intent(this, RadioService::class.java).apply {
                    action = RadioService.ACTION_PLAY_STATION
                    putExtra(RadioService.EXTRA_STATION_ID, currentStation.id)
                }
                startService(intent)
            }
        }
        
        qualityGroup.setOnCheckedChangeListener { _, checkedId ->
            if (!autoQualityCheckbox.isChecked) {
                val isHighQuality = checkedId == R.id.radio_high_quality
                ThemePreference.setHighQuality(this, isHighQuality)
                // If currently playing, reload stream with the new quality
                val currentStation = PlaybackStateHelper.getCurrentStation()
                if (currentStation != null && PlaybackStateHelper.getIsPlaying()) {
                    val intent = Intent(this, RadioService::class.java).apply {
                        action = RadioService.ACTION_PLAY_STATION
                        putExtra(RadioService.EXTRA_STATION_ID, currentStation.id)
                    }
                    startService(intent)
                }
            }
        }
        
        // Setup Playback Mode settings
        val scrollingModeGroup: RadioGroup = findViewById(R.id.scrolling_mode_radio_group)
        
        // Set current scrolling mode selection
        val currentScrollMode = ScrollingPreference.getScrollMode(this)
        when (currentScrollMode) {
            ScrollingPreference.MODE_ALL_STATIONS -> scrollingModeGroup.check(R.id.radio_scroll_all_stations)
            ScrollingPreference.MODE_FAVORITES -> scrollingModeGroup.check(R.id.radio_scroll_favorites)
        }
        
        scrollingModeGroup.setOnCheckedChangeListener { _, checkedId ->
            val selectedMode = when (checkedId) {
                R.id.radio_scroll_all_stations -> ScrollingPreference.MODE_ALL_STATIONS
                R.id.radio_scroll_favorites -> ScrollingPreference.MODE_FAVORITES
                else -> ScrollingPreference.MODE_ALL_STATIONS
            }
            ScrollingPreference.setScrollMode(this, selectedMode)
        }
    }

    private fun setupSubscriptionsSettings() {
        // Setup subscription refresh interval spinner
        try {
            val refreshSpinner: com.google.android.material.textfield.MaterialAutoCompleteTextView = findViewById(R.id.subscription_refresh_spinner)
            val refreshOptions = arrayOf("Disabled", "15 minutes", "30 minutes", "60 minutes", "2 hours", "6 hours", "12 hours", "24 hours")
            val refreshValues = intArrayOf(0, 15, 30, 60, 120, 360, 720, 1440) // in minutes
            val refreshAdapter = android.widget.ArrayAdapter(this, R.layout.spinner_dropdown_item, refreshOptions)
            refreshSpinner.setAdapter(refreshAdapter)

            // Get saved interval and find corresponding position
            val savedMinutes = SubscriptionRefreshPreference.getIntervalMinutes(this)
            val refreshPos = refreshValues.indexOf(savedMinutes).takeIf { it >= 0 } ?: 3 // Default to 60 minutes (index 3)
            refreshSpinner.setText(refreshOptions[refreshPos], false)

            // Ensure any previously-configured schedule is (re)activated at startup
            if (savedMinutes > 0) {
                SubscriptionRefreshScheduler.scheduleRefresh(this)
            }

            refreshSpinner.setOnItemClickListener { _, _, position, _ ->
                val minutes = refreshValues[position]
                val previous = SubscriptionRefreshPreference.getIntervalMinutes(this@SettingsDetailActivity)
                
                if (minutes != previous) {
                    SubscriptionRefreshPreference.setIntervalMinutes(this@SettingsDetailActivity, minutes)
                    if (minutes > 0) {
                        SubscriptionRefreshScheduler.scheduleRefresh(this@SettingsDetailActivity)
                        val label = refreshOptions[position]
                        android.widget.Toast.makeText(this@SettingsDetailActivity, "Will check for new episodes every $label", android.widget.Toast.LENGTH_SHORT).show()
                    } else {
                        SubscriptionRefreshScheduler.cancel(this@SettingsDetailActivity)
                        android.widget.Toast.makeText(this@SettingsDetailActivity, "Subscription notifications disabled", android.widget.Toast.LENGTH_SHORT).show()
                    }
                }
            }
        } catch (_: Exception) {}

        // Setup download settings
        try {
            val autoDownloadCheckbox: android.widget.CheckBox = findViewById(R.id.auto_download_checkbox)
            val autoDownloadLimitSpinner: com.google.android.material.textfield.MaterialAutoCompleteTextView = findViewById(R.id.auto_download_limit_spinner)
            val wifiOnlyCheckbox: android.widget.CheckBox = findViewById(R.id.wifi_only_download_checkbox)
            val deleteOnPlayedCheckbox: android.widget.CheckBox = findViewById(R.id.delete_on_played_checkbox)
            val deleteAllButton: Button = findViewById(R.id.delete_all_downloads_button)

            // Initialize auto-download enabled checkbox
            autoDownloadCheckbox.isChecked = DownloadPreferences.isAutoDownloadEnabled(this)
            autoDownloadCheckbox.setOnCheckedChangeListener { _, isChecked ->
                DownloadPreferences.setAutoDownloadEnabled(this, isChecked)
                if (isChecked) {
                    // When enabling auto-download, immediately trigger downloads for all existing subscriptions
                    PodcastSubscriptions.triggerAutoDownloadForAllSubscriptions(this)
                    android.widget.Toast.makeText(this, "Auto-download enabled - checking subscribed podcasts...", android.widget.Toast.LENGTH_SHORT).show()
                } else {
                    android.widget.Toast.makeText(this, "Auto-download disabled", android.widget.Toast.LENGTH_SHORT).show()
                }
            }

            // Initialize download limit spinner
            val limitOptions = arrayOf("Latest episode", "Latest 2 episodes", "Latest 3 episodes", "Latest 5 episodes", "Latest 10 episodes")
            val limitValues = intArrayOf(1, 2, 3, 5, 10)
            val limitAdapter = android.widget.ArrayAdapter(this, R.layout.spinner_dropdown_item, limitOptions)
            autoDownloadLimitSpinner.setAdapter(limitAdapter)

            val savedLimit = DownloadPreferences.getAutoDownloadLimit(this)
            val limitPos = limitValues.indexOf(savedLimit).takeIf { it >= 0 } ?: 0
            autoDownloadLimitSpinner.setText(limitOptions[limitPos], false)

            autoDownloadLimitSpinner.setOnItemClickListener { _, _, position, _ ->
                val limit = limitValues[position]
                DownloadPreferences.setAutoDownloadLimit(this, limit)
                android.widget.Toast.makeText(this, "Auto-download limit: ${limitOptions[position]}", android.widget.Toast.LENGTH_SHORT).show()
            }

            // Initialize WiFi-only checkbox
            wifiOnlyCheckbox.isChecked = DownloadPreferences.isDownloadOnWifiOnly(this)
            wifiOnlyCheckbox.setOnCheckedChangeListener { _, isChecked ->
                DownloadPreferences.setDownloadOnWifiOnly(this, isChecked)
                val msg = if (isChecked) "Downloads will use WiFi only" else "Downloads can use mobile data"
                android.widget.Toast.makeText(this, msg, android.widget.Toast.LENGTH_SHORT).show()
            }

            // Initialize delete-on-played checkbox
            deleteOnPlayedCheckbox.isChecked = DownloadPreferences.isDeleteOnPlayed(this)
            deleteOnPlayedCheckbox.setOnCheckedChangeListener { _, isChecked ->
                DownloadPreferences.setDeleteOnPlayed(this, isChecked)
                val msg = if (isChecked) "Downloaded episodes will be deleted after completion" else "Downloaded episodes will be kept after playing"
                android.widget.Toast.makeText(this, msg, android.widget.Toast.LENGTH_SHORT).show()
            }

            // Delete all downloads button
            deleteAllButton.setOnClickListener {
                val downloadCount = DownloadedEpisodes.getDownloadedEntries(this).size
                if (downloadCount == 0) {
                    android.widget.Toast.makeText(this, "No downloads to delete", android.widget.Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }

                // Show confirmation dialog
                androidx.appcompat.app.AlertDialog.Builder(this)
                    .setTitle("Delete All Downloads")
                    .setMessage("Delete all $downloadCount downloaded episode(s)?")
                    .setPositiveButton("Delete") { _, _ ->
                        EpisodeDownloadManager.deleteAllDownloads(this)
                    }
                    .setNegativeButton("Cancel", null)
                    .show()
            }
        } catch (_: Exception) {}
    }

    private fun setupIndexingSettings() {
        val indexNowBtn: Button = findViewById(R.id.index_now_button)
        val indexLastRebuilt: TextView = findViewById(R.id.index_last_rebuilt)
        val indexEpisodeCount: TextView = findViewById(R.id.index_episode_count)
        val indexEpisodesProgress: android.widget.ProgressBar = findViewById(R.id.index_episodes_progress)
        val indexStore = com.hyliankid14.bbcradioplayer.db.IndexStore.getInstance(this)

        fun updateLastRebuilt(ts: Long?) {
            indexLastRebuilt.text = if (ts != null) {
                val fmt = java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.MEDIUM, java.text.DateFormat.SHORT)
                "Last retrieved: ${fmt.format(java.util.Date(ts))}"
            } else {
                "Last retrieved: —"
            }
        }

        fun updateIndexedEpisodeCount() {
            lifecycleScope.launch(kotlinx.coroutines.Dispatchers.IO) {
                val count = try {
                    indexStore.getIndexedEpisodeCount()
                } catch (_: Exception) {
                    0
                }
                runOnUiThread {
                    indexEpisodeCount.text = "$count episodes indexed"
                }
            }
        }

        // Initialize display from persisted value
        updateLastRebuilt(indexStore.getLastReindexTime())
        updateIndexedEpisodeCount()

        indexNowBtn.setOnClickListener {
            try {
                // Cancel any pending one-time background work first, but keep periodic scheduling
                com.hyliankid14.bbcradioplayer.workers.BackgroundIndexWorker.cancelOneTimeIndexing(this@SettingsDetailActivity)
                
                indexEpisodesProgress.isIndeterminate = false
                indexEpisodesProgress.visibility = android.view.View.VISIBLE
                indexEpisodesProgress.progress = 0
                lastSeenIndexPercent = 0
                
                // Use direct execution for manual indexing (faster, with progress updates)
                lifecycleScope.launch {
                    com.hyliankid14.bbcradioplayer.workers.IndexWorker.reindexAll(this@SettingsDetailActivity) { status, percent, isEpisodePhase ->
                        runOnUiThread {
                            if (percent >= 0) {
                                val target = percent.coerceIn(0, 100)
                                if (target > lastSeenIndexPercent || target == 100) {
                                    indexEpisodesProgress.isIndeterminate = false
                                    indexEpisodesProgress.progress = target
                                    lastSeenIndexPercent = target
                                }
                            } else {
                                indexEpisodesProgress.isIndeterminate = true
                            }
                            
                            if (percent == 100 || status.contains("complete", ignoreCase = true)) {
                                indexEpisodesProgress.visibility = android.view.View.GONE
                                updateLastRebuilt(System.currentTimeMillis())
                                updateIndexedEpisodeCount()
                            }
                        }
                    }
                    runOnUiThread {
                        indexEpisodesProgress.visibility = android.view.View.GONE
                        updateLastRebuilt(indexStore.getLastReindexTime())
                        updateIndexedEpisodeCount()
                    }
                }
                
            } catch (e: Exception) {
                android.util.Log.w("SettingsDetailActivity", "Failed to start indexing: ${e.message}")
                indexEpisodesProgress.visibility = android.view.View.GONE
            }
        }

        // Initialize and wire up index schedule dropdown
        try {
            val indexScheduleSpinner: com.google.android.material.textfield.MaterialAutoCompleteTextView = findViewById(R.id.index_schedule_spinner)
            val adapter = android.widget.ArrayAdapter.createFromResource(this, R.array.index_schedule_options, R.layout.spinner_dropdown_item)
            adapter.setDropDownViewResource(R.layout.spinner_dropdown_item)
            indexScheduleSpinner.setAdapter(adapter)

            // Map saved days to spinner position and set initial text
            val savedDays = IndexPreference.getIntervalDays(this)
            val pos = when (savedDays) {
                1 -> 1
                3 -> 2
                7 -> 3
                else -> 0
            }
            val options = resources.getStringArray(R.array.index_schedule_options)
            suppressIndexSpinnerSelection = true
            indexScheduleSpinner.setText(options[pos], false)

            // Ensure any previously-configured schedule is (re)activated at startup
            if (savedDays > 0) {
                IndexScheduler.scheduleIndexing(this)
            }

            indexScheduleSpinner.setOnItemClickListener { _, _, position, _ ->
                if (suppressIndexSpinnerSelection) {
                    suppressIndexSpinnerSelection = false
                    return@setOnItemClickListener
                }

                val days = when (position) {
                    1 -> 1
                    2 -> 3
                    3 -> 7
                    else -> 0
                }

                val previous = IndexPreference.getIntervalDays(this@SettingsDetailActivity)
                if (days != previous) {
                    IndexPreference.setIntervalDays(this@SettingsDetailActivity, days)
                    if (days > 0) {
                        IndexScheduler.scheduleIndexing(this@SettingsDetailActivity)
                        android.widget.Toast.makeText(this@SettingsDetailActivity, "Scheduled indexing every ${days} day(s)", android.widget.Toast.LENGTH_SHORT).show()
                    } else {
                        IndexScheduler.cancel(this@SettingsDetailActivity)
                        android.widget.Toast.makeText(this@SettingsDetailActivity, "Periodic indexing disabled", android.widget.Toast.LENGTH_SHORT).show()
                    }
                }
            }

            // Initialize 'exclude non-English' checkbox and bind preference
            try {
                val excludeCb: android.widget.CheckBox = findViewById(R.id.exclude_non_english_checkbox)
                val excluded = PodcastFilterPreference.excludeNonEnglish(this)
                excludeCb.isChecked = excluded
                excludeCb.setOnCheckedChangeListener { _, isChecked ->
                    PodcastFilterPreference.setExcludeNonEnglish(this, isChecked)
                    android.widget.Toast.makeText(this, if (isChecked) "Non-English podcasts will be hidden and not indexed" else "All podcasts will be shown and indexed", android.widget.Toast.LENGTH_SHORT).show()
                }
            } catch (_: Exception) {}
        } catch (_: Exception) {}
    }

    private fun setupBackupSettings() {
        // Register Activity Result Launchers for Export / Import
        createDocumentLauncher = registerForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri: Uri? ->
            if (uri != null) {
                Thread {
                    runOnUiThread { android.widget.Toast.makeText(this, "Export started...", android.widget.Toast.LENGTH_SHORT).show() }
                    val success = exportPreferencesToUri(uri)
                    runOnUiThread { android.widget.Toast.makeText(this, if (success) "Export successful" else "Export failed", android.widget.Toast.LENGTH_LONG).show() }
                }.start()
            }
        }

        openDocumentLauncher = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
            if (uri != null) {
                try {
                    contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
                } catch (e: Exception) { }
                Thread {
                    runOnUiThread { android.widget.Toast.makeText(this, "Import started...", android.widget.Toast.LENGTH_SHORT).show() }
                    val success = importPreferencesFromUri(uri)
                    runOnUiThread {
                        android.widget.Toast.makeText(this, if (success) "Import successful" else "Import failed", android.widget.Toast.LENGTH_LONG).show()
                        ThemeManager.applyTheme(ThemePreference.getTheme(this))
                    }
                }.start()
            }
        }

        val exportBtn: Button = findViewById(R.id.export_prefs_button)
        val importBtn: Button = findViewById(R.id.import_prefs_button)

        exportBtn.setOnClickListener {
            createDocumentLauncher.launch("bbcradio_prefs.json")
        }

        importBtn.setOnClickListener {
            openDocumentLauncher.launch(arrayOf("application/json"))
        }
    }

    private fun exportPreferencesToUri(uri: Uri): Boolean {
        return try {
            val names = listOf("favorites_prefs", "podcast_subscriptions", "saved_episodes_prefs", "saved_searches_prefs", "played_episodes_prefs", "played_history_prefs", "playback_prefs", "scrolling_prefs", "index_prefs", "subscription_refresh_prefs", "podcast_filter_prefs", "theme_prefs", "download_prefs")
            val root = org.json.JSONObject()
            for (name in names) {
                val prefs = getSharedPreferences(name, MODE_PRIVATE)
                val obj = org.json.JSONObject()
                for ((k, v) in prefs.all) {
                    when (v) {
                        is Set<*> -> {
                            val arr = org.json.JSONArray()
                            v.forEach { arr.put(it.toString()) }
                            obj.put(k, arr)
                        }
                        is Boolean -> obj.put(k, v)
                        is Number -> obj.put(k, v)
                        else -> obj.put(k, v?.toString())
                    }
                }
                // Ensure known defaults are present
                if (name == "scrolling_prefs" && !obj.has("scroll_mode")) {
                    obj.put("scroll_mode", ScrollingPreference.getScrollMode(this))
                }
                if (name == "playback_prefs" && !obj.has("auto_resume_android_auto")) {
                    obj.put("auto_resume_android_auto", PlaybackPreference.isAutoResumeAndroidAutoEnabled(this))
                }
                if (name == "index_prefs") {
                    if (!obj.has("index_interval_days")) obj.put("index_interval_days", IndexPreference.getIntervalDays(this))
                    if (obj.has("last_reindex_time")) obj.remove("last_reindex_time")
                }
                if (name == "subscription_refresh_prefs" && !obj.has("refresh_interval_minutes")) {
                    obj.put("refresh_interval_minutes", SubscriptionRefreshPreference.getIntervalMinutes(this))
                }
                if (name == "podcast_filter_prefs" && !obj.has("exclude_non_english")) {
                    obj.put("exclude_non_english", PodcastFilterPreference.excludeNonEnglish(this))
                }
                if (name == "download_prefs") {
                    if (!obj.has("auto_download_enabled")) obj.put("auto_download_enabled", DownloadPreferences.isAutoDownloadEnabled(this))
                    if (!obj.has("auto_download_limit")) obj.put("auto_download_limit", DownloadPreferences.getAutoDownloadLimit(this))
                    if (!obj.has("download_on_wifi_only")) obj.put("download_on_wifi_only", DownloadPreferences.isDownloadOnWifiOnly(this))
                    if (!obj.has("delete_on_played")) obj.put("delete_on_played", DownloadPreferences.isDeleteOnPlayed(this))
                }
                root.put(name, obj)
            }

            contentResolver.openOutputStream(uri)?.use { out ->
                out.write(root.toString(2).toByteArray())
            }
            true
        } catch (e: Exception) {
            android.util.Log.e("SettingsDetailActivity", "Failed to export preferences", e)
            false
        }
    }

    private fun importPreferencesFromUri(uri: Uri): Boolean {
        return try {
            val text = contentResolver.openInputStream(uri)?.use { it.bufferedReader().readText() } ?: return false
            val root = org.json.JSONObject(text)
            val keys = root.keys()
            while (keys.hasNext()) {
                val prefsName = keys.next()
                val prefsObj = root.getJSONObject(prefsName)
                val prefs = getSharedPreferences(prefsName, MODE_PRIVATE)
                val edit = prefs.edit()
                edit.clear()
                val kIt = prefsObj.keys()
                while (kIt.hasNext()) {
                    val key = kIt.next()
                    if (prefsName == "index_prefs" && key == "last_reindex_time") continue
                    val value = prefsObj.get(key)
                    when (value) {
                        is org.json.JSONArray -> {
                            val set = mutableSetOf<String>()
                            for (i in 0 until value.length()) set.add(value.getString(i))
                            edit.putStringSet(key, set)
                        }
                        is Boolean -> edit.putBoolean(key, value)
                        is Int -> edit.putInt(key, value)
                        is Long -> edit.putLong(key, value)
                        is Double -> {
                            val d = value
                            if (d % 1.0 == 0.0) {
                                val l = d.toLong()
                                if (l <= Int.MAX_VALUE && l >= Int.MIN_VALUE) edit.putInt(key, l.toInt()) else edit.putLong(key, l)
                            } else {
                                edit.putFloat(key, d.toFloat())
                            }
                        }
                        else -> {
                            val s = if (value == org.json.JSONObject.NULL) null else value.toString()
                            edit.putString(key, s)
                        }
                    }
                }
                edit.apply()
            }

            // Apply imported settings
            if (root.has("scrolling_prefs")) {
                val sp = root.getJSONObject("scrolling_prefs")
                if (sp.has("scroll_mode")) {
                    ScrollingPreference.setScrollMode(this, sp.optString("scroll_mode", ScrollingPreference.MODE_ALL_STATIONS))
                }
            }
            if (root.has("playback_prefs")) {
                val pp = root.getJSONObject("playback_prefs")
                if (pp.has("auto_resume_android_auto")) {
                    PlaybackPreference.setAutoResumeAndroidAuto(this, pp.optBoolean("auto_resume_android_auto", false))
                }
            }
            if (root.has("index_prefs")) {
                val ip = root.getJSONObject("index_prefs")
                if (ip.has("index_interval_days")) {
                    val days = ip.optInt("index_interval_days", 0)
                    IndexPreference.setIntervalDays(this, days)
                    if (days > 0) IndexScheduler.scheduleIndexing(this) else IndexScheduler.cancel(this)
                }
            }
            if (root.has("subscription_refresh_prefs")) {
                val sr = root.getJSONObject("subscription_refresh_prefs")
                if (sr.has("refresh_interval_minutes")) {
                    val minutes = sr.optInt("refresh_interval_minutes", SubscriptionRefreshPreference.getIntervalMinutes(this))
                    SubscriptionRefreshPreference.setIntervalMinutes(this, minutes)
                    if (minutes > 0) SubscriptionRefreshScheduler.scheduleRefresh(this) else SubscriptionRefreshScheduler.cancel(this)
                }
            }
            if (root.has("podcast_filter_prefs")) {
                val pf = root.getJSONObject("podcast_filter_prefs")
                if (pf.has("exclude_non_english")) {
                    PodcastFilterPreference.setExcludeNonEnglish(this, pf.optBoolean("exclude_non_english", false))
                }
            }
            
            true
        } catch (e: Exception) {
            android.util.Log.e("SettingsDetailActivity", "Failed to import preferences", e)
            false
        }
    }
    
    private fun setupPrivacySettings() {
        try {
            val analyticsSwitch: androidx.appcompat.widget.SwitchCompat = findViewById(R.id.analytics_switch)
            val privacyPolicyButton: Button = findViewById(R.id.privacy_policy_button)
            val analytics = PrivacyAnalytics(this)
            
            // Set initial switch state
            analyticsSwitch.isChecked = analytics.isEnabled()
            
            // Handle switch state changes
            analyticsSwitch.setOnCheckedChangeListener { _, isChecked ->
                analytics.setEnabled(isChecked)
                
                val message = if (isChecked) {
                    "Thanks for helping improve the app!"
                } else {
                    "Analytics disabled. No data will be shared."
                }
                android.widget.Toast.makeText(this, message, android.widget.Toast.LENGTH_SHORT).show()
            }
            
            // Privacy policy button
            privacyPolicyButton.setOnClickListener {
                showPrivacyPolicy()
            }
        } catch (e: Exception) {
            android.util.Log.e("SettingsDetailActivity", "Error setting up privacy settings", e)
        }
    }
    
    private fun showPrivacyPolicy() {
        val privacyPolicyText = """BBC Radio Player Analytics Privacy Policy
            
When you enable analytics:
• We collect station, podcast, and episode play events
• We collect the date and time (UTC timestamp) and app version
• Data is sent over HTTPS to our private server
• IP addresses are not stored in the analytics database
• No user identifiers, device IDs, or personal info collected
• Data is anonymous and only used for popularity trends
            
When you disable analytics:
• No data is collected or sent
• You can disable it anytime in settings
            
We never sell or share your data with third parties.
            
Source code: github.com/hyliankid14/BBC-Radio-Player""".trimIndent()
        
        androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("Privacy Policy")
            .setMessage(privacyPolicyText)
            .setPositiveButton("OK", null)
            .show()
    }
    
    private fun setupAlarmSettings() {
        try {
            val alarmEnabledSwitch: androidx.appcompat.widget.SwitchCompat = findViewById(R.id.alarm_enabled_switch)
            val alarmHourSpinner: com.google.android.material.textfield.MaterialAutoCompleteTextView = findViewById(R.id.alarm_hour_spinner)
            val alarmMinuteSpinner: com.google.android.material.textfield.MaterialAutoCompleteTextView = findViewById(R.id.alarm_minute_spinner)
            val alarmStationSpinner: com.google.android.material.textfield.MaterialAutoCompleteTextView = findViewById(R.id.alarm_station_spinner)
            val alarmVolumeRampCheckbox: android.widget.CheckBox = findViewById(R.id.alarm_volume_ramp_checkbox)
            val alarmPermissionStatus: TextView = findViewById(R.id.alarm_permission_status)
            val alarmManualVolumeContainer: android.view.View = findViewById(R.id.alarm_manual_volume_container)
            val alarmManualVolumeSlider: com.google.android.material.slider.Slider = findViewById(R.id.alarm_manual_volume_slider)
            val alarmManualVolumeValue: TextView = findViewById(R.id.alarm_manual_volume_value)
            
            // Day checkboxes
            val daySunday: android.widget.CheckBox = findViewById(R.id.alarm_day_sunday)
            val dayMonday: android.widget.CheckBox = findViewById(R.id.alarm_day_monday)
            val dayTuesday: android.widget.CheckBox = findViewById(R.id.alarm_day_tuesday)
            val dayWednesday: android.widget.CheckBox = findViewById(R.id.alarm_day_wednesday)
            val dayThursday: android.widget.CheckBox = findViewById(R.id.alarm_day_thursday)
            val dayFriday: android.widget.CheckBox = findViewById(R.id.alarm_day_friday)
            val daySaturday: android.widget.CheckBox = findViewById(R.id.alarm_day_saturday)
            
            val dayCheckboxes = listOf(
                Pair(daySunday, AlarmPreference.DAY_SUNDAY),
                Pair(dayMonday, AlarmPreference.DAY_MONDAY),
                Pair(dayTuesday, AlarmPreference.DAY_TUESDAY),
                Pair(dayWednesday, AlarmPreference.DAY_WEDNESDAY),
                Pair(dayThursday, AlarmPreference.DAY_THURSDAY),
                Pair(dayFriday, AlarmPreference.DAY_FRIDAY),
                Pair(daySaturday, AlarmPreference.DAY_SATURDAY)
            )
            
            // Populate hour spinner
            val hourOptions = resources.getStringArray(R.array.hour_options).toList()
            val hourAdapter = android.widget.ArrayAdapter(this, android.R.layout.simple_dropdown_item_1line, hourOptions)
            alarmHourSpinner.setAdapter(hourAdapter)
            alarmHourSpinner.setText(hourOptions[AlarmPreference.getHour(this)], false)
            alarmHourSpinner.setOnClickListener { alarmHourSpinner.showDropDown() }
            alarmHourSpinner.setOnFocusChangeListener { _, hasFocus -> if (hasFocus) alarmHourSpinner.showDropDown() }
            
            // Populate minute spinner
            val minuteOptions = resources.getStringArray(R.array.minute_options).toList()
            val minuteAdapter = android.widget.ArrayAdapter(this, android.R.layout.simple_dropdown_item_1line, minuteOptions)
            alarmMinuteSpinner.setAdapter(minuteAdapter)
            alarmMinuteSpinner.setText(minuteOptions[AlarmPreference.getMinute(this) / 5], false)
            alarmMinuteSpinner.setOnClickListener { alarmMinuteSpinner.showDropDown() }
            alarmMinuteSpinner.setOnFocusChangeListener { _, hasFocus -> if (hasFocus) alarmMinuteSpinner.showDropDown() }
            
            // Check permission status
            val hasExactAlarmPermission = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
                val alarmManager = getSystemService(android.content.Context.ALARM_SERVICE) as android.app.AlarmManager
                alarmManager.canScheduleExactAlarms()
            } else {
                true
            }
            
            // Populate station spinner
            val stations = try {
                StationRepository.getStations()
            } catch (e: Exception) {
                emptyList()
            }
            val stationNames = stations.map { it.title }
            val stationAdapter = android.widget.ArrayAdapter(this, android.R.layout.simple_dropdown_item_1line, stationNames)
            alarmStationSpinner.setAdapter(stationAdapter)
            
            val selectedStationId = AlarmPreference.getStationId(this)
            if (selectedStationId != null) {
                val selectedStation = stations.find { it.id == selectedStationId }
                if (selectedStation != null) {
                    alarmStationSpinner.setText(selectedStation.title)
                }
            }
            
            // Load alarm enabled state
            alarmEnabledSwitch.isChecked = AlarmPreference.isEnabled(this)
            
            // Load day selections
            for ((checkbox, dayBit) in dayCheckboxes) {
                checkbox.isChecked = AlarmPreference.isDayEnabled(this, dayBit)
            }
            
            // Load volume ramp state
            alarmVolumeRampCheckbox.isChecked = AlarmPreference.isVolumeRampEnabled(this)
            
            // Load and setup manual volume slider
            val manualVolume = AlarmPreference.getManualVolume(this)
            alarmManualVolumeSlider.value = manualVolume.toFloat()
            alarmManualVolumeValue.text = manualVolume.toString()
            
            // Enable/disable manual volume slider based on volume ramp state
            val updateSliderEnabledState = {
                val isVolumeRampEnabled = alarmVolumeRampCheckbox.isChecked
                alarmManualVolumeContainer.isEnabled = !isVolumeRampEnabled
                alarmManualVolumeSlider.isEnabled = !isVolumeRampEnabled
                alarmManualVolumeSlider.alpha = if (isVolumeRampEnabled) 0.5f else 1.0f
            }
            updateSliderEnabledState()
            
            // Update permission status display
            if (!hasExactAlarmPermission) {
                alarmPermissionStatus.visibility = android.view.View.VISIBLE
                alarmPermissionStatus.text = getString(R.string.alarm_permission_error)
            }
            
            // Listen for changes
            alarmEnabledSwitch.setOnCheckedChangeListener { _, isChecked ->
                saveAlarmSettings(
                    isChecked,
                    alarmHourSpinner,
                    alarmMinuteSpinner,
                    dayCheckboxes,
                    alarmStationSpinner,
                    alarmVolumeRampCheckbox,
                    alarmManualVolumeSlider,
                    stations,
                    hasExactAlarmPermission,
                    alarmPermissionStatus
                )
            }
            
            alarmHourSpinner.setOnItemClickListener { _, _, _, _ ->
                saveAlarmSettings(
                    alarmEnabledSwitch.isChecked,
                    alarmHourSpinner,
                    alarmMinuteSpinner,
                    dayCheckboxes,
                    alarmStationSpinner,
                    alarmVolumeRampCheckbox,
                    alarmManualVolumeSlider,
                    stations,
                    hasExactAlarmPermission,
                    alarmPermissionStatus
                )
            }
            
            alarmMinuteSpinner.setOnItemClickListener { _, _, _, _ ->
                saveAlarmSettings(
                    alarmEnabledSwitch.isChecked,
                    alarmHourSpinner,
                    alarmMinuteSpinner,
                    dayCheckboxes,
                    alarmStationSpinner,
                    alarmVolumeRampCheckbox,
                    alarmManualVolumeSlider,
                    stations,
                    hasExactAlarmPermission,
                    alarmPermissionStatus
                )
            }
            
            alarmStationSpinner.setOnItemClickListener { _, _, _, _ ->
                saveAlarmSettings(
                    alarmEnabledSwitch.isChecked,
                    alarmHourSpinner,
                    alarmMinuteSpinner,
                    dayCheckboxes,
                    alarmStationSpinner,
                    alarmVolumeRampCheckbox,
                    alarmManualVolumeSlider,
                    stations,
                    hasExactAlarmPermission,
                    alarmPermissionStatus
                )
            }
            
            for ((checkbox, _) in dayCheckboxes) {
                checkbox.setOnCheckedChangeListener { _, _ ->
                    saveAlarmSettings(
                        alarmEnabledSwitch.isChecked,
                        alarmHourSpinner,
                        alarmMinuteSpinner,
                        dayCheckboxes,
                        alarmStationSpinner,
                        alarmVolumeRampCheckbox,
                        alarmManualVolumeSlider,
                        stations,
                        hasExactAlarmPermission,
                        alarmPermissionStatus
                    )
                }
            }
            
            alarmVolumeRampCheckbox.setOnCheckedChangeListener { _, _ ->
                updateSliderEnabledState()
                saveAlarmSettings(
                    alarmEnabledSwitch.isChecked,
                    alarmHourSpinner,
                    alarmMinuteSpinner,
                    dayCheckboxes,
                    alarmStationSpinner,
                    alarmVolumeRampCheckbox,
                    alarmManualVolumeSlider,
                    stations,
                    hasExactAlarmPermission,
                    alarmPermissionStatus
                )
            }
            
            alarmManualVolumeSlider.addOnChangeListener { _, value, _ ->
                alarmManualVolumeValue.text = value.toInt().toString()
                saveAlarmSettings(
                    alarmEnabledSwitch.isChecked,
                    alarmHourSpinner,
                    alarmMinuteSpinner,
                    dayCheckboxes,
                    alarmStationSpinner,
                    alarmVolumeRampCheckbox,
                    alarmManualVolumeSlider,
                    stations,
                    hasExactAlarmPermission,
                    alarmPermissionStatus
                )
            }
            
        } catch (e: Exception) {
            android.util.Log.e("SettingsDetailActivity", "Error setting up alarm settings", e)
        }
    }
    
    private fun saveAlarmSettings(
        enabled: Boolean,
        hourSpinner: com.google.android.material.textfield.MaterialAutoCompleteTextView,
        minuteSpinner: com.google.android.material.textfield.MaterialAutoCompleteTextView,
        dayCheckboxes: List<Pair<android.widget.CheckBox, Int>>,
        stationSpinner: com.google.android.material.textfield.MaterialAutoCompleteTextView,
        volumeRampCheckbox: android.widget.CheckBox,
        manualVolumeSlider: com.google.android.material.slider.Slider,
        stations: List<Station>,
        hasExactAlarmPermission: Boolean,
        permissionStatus: TextView
    ) {
        try {
            val hourText = hourSpinner.text.toString()
            val minuteText = minuteSpinner.text.toString()
            val stationText = stationSpinner.text.toString()
            
            // Parse hour and minute
            val hour = hourText.takeIf { it.isNotEmpty() }?.toIntOrNull() ?: AlarmPreference.getHour(this)
            val minuteIndex = resources.getStringArray(R.array.minute_options).indexOf(minuteText)
            val minute = if (minuteIndex >= 0) minuteIndex * 5 else AlarmPreference.getMinute(this)
            
            // Find selected station
            val selectedStation = stations.find { it.title == stationText }
            val stationId = selectedStation?.id ?: AlarmPreference.getStationId(this)
            
            // Update preferences
            AlarmPreference.setEnabled(this, enabled)
            AlarmPreference.setHour(this, hour)
            AlarmPreference.setMinute(this, minute)
            AlarmPreference.setStationId(this, stationId)
            AlarmPreference.setVolumeRampEnabled(this, volumeRampCheckbox.isChecked)
            AlarmPreference.setManualVolume(this, manualVolumeSlider.value.toInt())
            
            // Update day selections
            for ((checkbox, dayBit) in dayCheckboxes) {
                AlarmPreference.setDayEnabled(this, dayBit, checkbox.isChecked)
            }
            
            // Try to schedule or cancel alarm
            if (enabled) {
                if (!hasExactAlarmPermission) {
                    permissionStatus.visibility = android.view.View.VISIBLE
                    permissionStatus.text = getString(R.string.alarm_permission_error)
                    AlarmPreference.setEnabled(this, false)
                    return
                }
                
                if (stationId == null) {
                    permissionStatus.visibility = android.view.View.VISIBLE
                    permissionStatus.text = getString(R.string.alarm_no_station_error)
                    AlarmPreference.setEnabled(this, false)
                    return
                }
                
                try {
                    AlarmScheduler.schedule(this)
                    permissionStatus.visibility = android.view.View.GONE
                } catch (e: Exception) {
                    permissionStatus.visibility = android.view.View.VISIBLE
                    permissionStatus.text = e.message ?: "Failed to schedule alarm"
                    AlarmPreference.setEnabled(this, false)
                }
            } else {
                AlarmScheduler.cancel(this)
                permissionStatus.visibility = android.view.View.GONE
            }
            
        } catch (e: Exception) {
            android.util.Log.e("SettingsDetailActivity", "Error saving alarm settings", e)
        }
    }

    private fun setupAboutSettings() {
        try {
            val currentVersionText: TextView = findViewById(R.id.current_version_text)
            val lastCheckedText: TextView = findViewById(R.id.last_checked_text)
            val checkUpdatesButton: Button = findViewById(R.id.check_updates_button)
            val githubButton: Button = findViewById(R.id.github_button)
            
            val updateChecker = UpdateChecker(this)
            
            // Display current version (with debug- prefix if debuggable)
            val currentVersion = try {
                val version = packageManager.getPackageInfo(packageName, 0).versionName ?: "Unknown"
                if (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0) {
                    "debug-$version"
                } else {
                    version
                }
            } catch (e: Exception) {
                "Unknown"
            }
            currentVersionText.text = currentVersion
            
            // Display last check time
            updateLastCheckTime(lastCheckedText, updateChecker)
            
            // Check for updates button
            checkUpdatesButton.setOnClickListener {
                lifecycleScope.launch {
                    checkUpdatesButton.isEnabled = false
                    checkUpdatesButton.text = getString(R.string.checking_for_updates)
                    
                    val releaseInfo = updateChecker.checkForUpdate()
                    updateLastCheckTime(lastCheckedText, updateChecker)
                    
                    if (releaseInfo != null) {
                        // Show update dialog
                        UpdateDialog.show(
                            this@SettingsDetailActivity,
                            releaseInfo,
                            onDownload = {
                                com.hyliankid14.bbcradioplayer.workers.UpdateDownloadWorker.enqueueDownload(
                                    this@SettingsDetailActivity,
                                    releaseInfo.downloadUrl,
                                    releaseInfo.versionName
                                )
                                android.widget.Toast.makeText(
                                    this@SettingsDetailActivity,
                                    "Downloading update...",
                                    android.widget.Toast.LENGTH_SHORT
                                ).show()
                            }
                        )
                    } else {
                        android.widget.Toast.makeText(
                            this@SettingsDetailActivity,
                            getString(R.string.update_not_available),
                            android.widget.Toast.LENGTH_SHORT
                        ).show()
                    }
                    
                    checkUpdatesButton.isEnabled = true
                    checkUpdatesButton.text = getString(R.string.check_for_updates)
                }
            }
            
            // GitHub button
            githubButton.setOnClickListener {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(githubReleasesUrl))
                startActivity(intent)
            }
            
            // Long-click to clear update cache (for testing)
            checkUpdatesButton.setOnLongClickListener {
                updateChecker.clearCachedInfo()
                updateLastCheckTime(lastCheckedText, updateChecker)
                android.widget.Toast.makeText(
                    this,
                    "Update cache cleared. Try checking again.",
                    android.widget.Toast.LENGTH_SHORT
                ).show()
                true
            }
        } catch (e: Exception) {
            android.util.Log.e("SettingsDetailActivity", "Error setting up about settings", e)
        }
    }
    
    private fun updateLastCheckTime(textView: TextView, updateChecker: UpdateChecker) {
        val lastCheckTime = updateChecker.getLastCheckTime()
        if (lastCheckTime > 0) {
            val timeAgo = getTimeAgo(lastCheckTime)
            textView.text = getString(R.string.last_checked, timeAgo)
        } else {
            textView.text = getString(R.string.never_checked)
        }
    }
    
    private fun getTimeAgo(timestamp: Long): String {
        val diff = System.currentTimeMillis() - timestamp
        return when {
            diff < 60_000 -> "just now"
            diff < 3600_000 -> "${diff / 60_000} minutes ago"
            diff < 86400_000 -> "${diff / 3600_000} hours ago"
            else -> "${diff / 86400_000} days ago"
        }
    }
}
