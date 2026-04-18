package com.hyliankid14.bbcradioplayer

import android.content.Intent
import android.os.Bundle
import android.view.MenuItem
import android.view.View
import android.view.ViewGroup
import android.widget.ImageButton
import android.widget.ImageView
import com.google.android.material.progressindicator.CircularProgressIndicator
import android.widget.TextView
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.Toolbar
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.tabs.TabLayout
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

class ScheduleActivity : AppCompatActivity() {

    private val activityScope = CoroutineScope(Dispatchers.Main + Job())

    // Cache of already-loaded schedule entries keyed by date string "YYYY-MM-DD"
    private val scheduleCache = mutableMapOf<String, List<ScheduleEntry>>()

    private lateinit var recycler: RecyclerView
    private lateinit var loading: CircularProgressIndicator
    private lateinit var empty: TextView
    private lateinit var tabs: TabLayout

    private var stationId = ""
    private var stationTitle = ""
    private var podcastsByTitle: Map<String, Podcast> = emptyMap()

    // Number of days shown in each direction from today
    private val daysEachWay = 7
    private val todayTabIndex = daysEachWay // index 7 in a 0..14 array

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_schedule)

        val toolbar = findViewById<Toolbar>(R.id.schedule_toolbar)
        setSupportActionBar(toolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        supportActionBar?.setHomeAsUpIndicator(R.drawable.ic_arrow_back)

        stationId = intent.getStringExtra(EXTRA_STATION_ID) ?: run { finish(); return }
        stationTitle = intent.getStringExtra(EXTRA_STATION_TITLE) ?: "Schedule"
        supportActionBar?.title = stationTitle

        recycler = findViewById(R.id.schedule_recycler)
        loading = findViewById(R.id.schedule_loading)
        empty = findViewById(R.id.schedule_empty)
        tabs = findViewById(R.id.schedule_tabs)

        recycler.layoutManager = LinearLayoutManager(this)

        // Apply top inset to the toolbar so it sits below the status bar,
        // and bottom inset to the list so content isn't clipped by the nav bar.
        val rootLayout = findViewById<android.view.View>(R.id.schedule_root)
        ViewCompat.setOnApplyWindowInsetsListener(rootLayout) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            v.updatePadding(top = bars.top)
            recycler.updatePadding(bottom = bars.bottom + 16)
            insets
        }
        ViewCompat.requestApplyInsets(rootLayout)

        // Build tabs: -7 … today … +7
        buildDateTabs()
        // Show loading state immediately while podcasts + schedule load
        showLoading(true)

        // Pre-load podcasts list once
        activityScope.launch {
            val repo = PodcastRepository(this@ScheduleActivity)
            val podcasts = withContext(Dispatchers.IO) { repo.fetchPodcasts(false) }
            podcastsByTitle = podcasts.associateBy { it.title.lowercase() }

            // Load today's schedule on startup
            loadScheduleForTabIndex(todayTabIndex)
        }

        tabs.addOnTabSelectedListener(object : TabLayout.OnTabSelectedListener {
            override fun onTabSelected(tab: TabLayout.Tab) {
                loadScheduleForTabIndex(tab.position)
            }
            override fun onTabUnselected(tab: TabLayout.Tab) {}
            override fun onTabReselected(tab: TabLayout.Tab) {}
        })
    }

    private fun buildDateTabs() {
        val today = Calendar.getInstance()
        val tabLabelFormat = SimpleDateFormat("EEE d", Locale.getDefault())
        val totalDays = daysEachWay * 2 + 1

        for (i in 0 until totalDays) {
            val cal = today.clone() as Calendar
            cal.add(Calendar.DAY_OF_YEAR, i - daysEachWay)

            val tab = tabs.newTab()
            tab.text = if (i == todayTabIndex) getString(R.string.schedule_today)
                       else tabLabelFormat.format(cal.time)
            // Store the date string in the tag
            tab.tag = dateStringFor(cal)
            tabs.addTab(tab, i == todayTabIndex)
        }

        // After layout is complete, scroll so the Today tab is horizontally centred
        tabs.post {
            val tabParent = tabs.getChildAt(0) as? android.view.ViewGroup ?: return@post
            val todayView = tabParent.getChildAt(todayTabIndex) ?: return@post
            val scrollTo = todayView.left - (tabs.width - todayView.width) / 2
            tabs.scrollTo(maxOf(0, scrollTo), 0)
        }
    }

    private fun dateStringFor(cal: Calendar): String {
        val fmt = SimpleDateFormat("yyyy-MM-dd", Locale.US)
        fmt.timeZone = cal.timeZone
        return fmt.format(cal.time)
    }

    private fun loadScheduleForTabIndex(tabIndex: Int) {
        val tab = tabs.getTabAt(tabIndex) ?: return
        val dateStr = tab.tag as? String ?: return

        // If we already have it cached, display immediately
        scheduleCache[dateStr]?.let { entries ->
            displaySchedule(entries, dateStr)
            return
        }

        // Otherwise fetch from network
        showLoading(true)
        activityScope.launch {
            try {
                val entries = ShowInfoFetcher.fetchScheduleForDate(stationId, dateStr)
                scheduleCache[dateStr] = entries
                // Only show if this tab is still selected
                if (tabs.selectedTabPosition == tabIndex) {
                    displaySchedule(entries, dateStr)
                }
            } catch (e: Exception) {
                android.util.Log.w("ScheduleActivity", "Failed to load schedule for $dateStr: ${e.message}")
                if (tabs.selectedTabPosition == tabIndex) {
                    showLoading(false)
                    empty.visibility = View.VISIBLE
                }
            }
        }
    }

    private fun displaySchedule(entries: List<ScheduleEntry>, dateStr: String) {
        showLoading(false)
        if (entries.isEmpty()) {
            recycler.visibility = View.GONE
            empty.visibility = View.VISIBLE
        } else {
            empty.visibility = View.GONE
            recycler.visibility = View.VISIBLE
            recycler.adapter = ScheduleAdapter(entries, podcastsByTitle, stationId, stationTitle)

            // For today's tab scroll to the currently-on-air show; for other dates scroll to top
            val todayDateStr = dateStringFor(Calendar.getInstance())
            if (dateStr == todayDateStr) {
                val now = System.currentTimeMillis()
                val currentIndex = entries.indexOfFirst { it.startTimeMs <= now && it.endTimeMs > now }
                if (currentIndex >= 0) {
                    (recycler.layoutManager as LinearLayoutManager)
                        .scrollToPositionWithOffset(currentIndex, 0)
                }
            } else {
                recycler.scrollToPosition(0)
            }
        }
    }

    private fun showLoading(show: Boolean) {
        loading.visibility = if (show) View.VISIBLE else View.GONE
        if (show) {
            recycler.visibility = View.GONE
            empty.visibility = View.GONE
        }
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        if (item.itemId == android.R.id.home) {
            finish()
            return true
        }
        return super.onOptionsItemSelected(item)
    }

    override fun onDestroy() {
        super.onDestroy()
        activityScope.coroutineContext[Job]?.cancel()
    }

    companion object {
        const val EXTRA_STATION_ID = "station_id"
        const val EXTRA_STATION_TITLE = "station_title"
    }
}

class ScheduleAdapter(
    private val entries: List<ScheduleEntry>,
    private val podcastsByTitle: Map<String, Podcast> = emptyMap(),
    private val stationId: String = "",
    private val stationTitle: String = ""
) : RecyclerView.Adapter<ScheduleAdapter.ViewHolder>() {

    private val timeFormat = SimpleDateFormat("HH:mm", Locale.getDefault()).also {
        it.timeZone = TimeZone.getDefault()
    }

    inner class ViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val startTime: TextView = view.findViewById(R.id.schedule_start_time)
        val endTime: TextView = view.findViewById(R.id.schedule_end_time)
        val showTitle: TextView = view.findViewById(R.id.schedule_show_title)
        val showSubtitle: TextView = view.findViewById(R.id.schedule_show_subtitle)
        val nowIndicator: ImageView = view.findViewById(R.id.schedule_now_indicator)
        val podcastButton: ImageButton = view.findViewById(R.id.schedule_podcast_button)
        var boundPodcast: Podcast? = null

        init {
            podcastButton.setOnClickListener {
                val podcast = boundPodcast ?: return@setOnClickListener
                val intent = Intent(it.context, MainActivity::class.java).apply {
                    addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                    putExtra("open_podcast_id", podcast.id)
                    putExtra("back_source", "schedule")
                    putExtra("schedule_station_id", stationId)
                    putExtra("schedule_station_title", stationTitle)
                }
                it.context.startActivity(intent)
            }
        }
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val view = android.view.LayoutInflater.from(parent.context)
            .inflate(R.layout.item_schedule_entry, parent, false)
        return ViewHolder(view)
    }

    override fun getItemCount() = entries.size

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val entry = entries[position]
        val now = System.currentTimeMillis()

        holder.startTime.text = timeFormat.format(Date(entry.startTimeMs))
        holder.endTime.text = timeFormat.format(Date(entry.endTimeMs))
        holder.showTitle.text = entry.title

        if (!entry.episodeTitle.isNullOrEmpty()) {
            holder.showSubtitle.text = entry.episodeTitle
            holder.showSubtitle.visibility = View.VISIBLE
        } else {
            holder.showSubtitle.visibility = View.GONE
        }

        val isCurrent = entry.startTimeMs <= now && entry.endTimeMs > now
        holder.nowIndicator.visibility = if (isCurrent) View.VISIBLE else View.GONE

        // Highlight the currently playing item
        val colorRes = if (isCurrent) {
            com.google.android.material.R.attr.colorSecondaryContainer
        } else {
            com.google.android.material.R.attr.colorSurface
        }
        val typedValue = android.util.TypedValue()
        holder.itemView.context.theme.resolveAttribute(colorRes, typedValue, true)
        holder.itemView.setBackgroundColor(typedValue.data)

        // Dim past entries
        val alpha = when {
            entry.endTimeMs < now -> 0.5f
            else -> 1.0f
        }
        holder.itemView.alpha = alpha

        // Show podcast button if this show has a matching podcast
        val podcast = podcastsByTitle[entry.title.lowercase()]
        holder.boundPodcast = podcast
        holder.podcastButton.visibility = if (podcast != null) View.VISIBLE else View.GONE
    }
}
