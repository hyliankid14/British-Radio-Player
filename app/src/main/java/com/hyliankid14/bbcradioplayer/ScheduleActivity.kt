package com.hyliankid14.bbcradioplayer

import android.content.Intent
import android.os.Bundle
import android.view.MenuItem
import android.view.View
import android.view.ViewGroup
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.Toolbar
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

class ScheduleActivity : AppCompatActivity() {

    private val activityScope = CoroutineScope(Dispatchers.Main + Job())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_schedule)

        val toolbar = findViewById<Toolbar>(R.id.schedule_toolbar)
        setSupportActionBar(toolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        supportActionBar?.setHomeAsUpIndicator(R.drawable.ic_arrow_back)

        val stationId = intent.getStringExtra(EXTRA_STATION_ID) ?: run { finish(); return }
        val stationTitle = intent.getStringExtra(EXTRA_STATION_TITLE) ?: "Schedule"
        supportActionBar?.title = stationTitle

        val recycler = findViewById<RecyclerView>(R.id.schedule_recycler)
        val loading = findViewById<ProgressBar>(R.id.schedule_loading)
        val empty = findViewById<TextView>(R.id.schedule_empty)

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

        activityScope.launch {
            try {
                val entries = ShowInfoFetcher.fetchFullSchedule(stationId)
                loading.visibility = View.GONE
                if (entries.isEmpty()) {
                    empty.visibility = View.VISIBLE
                } else {
                    val repo = PodcastRepository(this@ScheduleActivity)
                    val podcasts = withContext(Dispatchers.IO) { repo.fetchPodcasts(false) }
                    val podcastsByTitle = podcasts.associateBy { it.title.lowercase() }

                    recycler.adapter = ScheduleAdapter(entries, podcastsByTitle, stationId, stationTitle)
                    // Scroll to the currently playing item
                    val now = System.currentTimeMillis()
                    val currentIndex = entries.indexOfFirst { it.startTimeMs <= now && it.endTimeMs > now }
                    if (currentIndex >= 0) {
                        (recycler.layoutManager as LinearLayoutManager).scrollToPositionWithOffset(currentIndex, 0)
                    }
                }
            } catch (e: Exception) {
                loading.visibility = View.GONE
                empty.visibility = View.VISIBLE
            }
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
