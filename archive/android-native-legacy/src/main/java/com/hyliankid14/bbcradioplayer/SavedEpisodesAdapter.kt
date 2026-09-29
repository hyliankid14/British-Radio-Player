package com.hyliankid14.bbcradioplayer

import android.content.Context
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.ImageButton
import android.widget.CheckBox
import android.widget.TextView
import com.google.android.material.progressindicator.LinearProgressIndicator
import androidx.appcompat.content.res.AppCompatResources
import androidx.core.graphics.drawable.DrawableCompat
import androidx.recyclerview.widget.RecyclerView
import androidx.core.text.HtmlCompat
import androidx.core.content.ContextCompat

open class SavedEpisodesAdapter(
    private val context: Context,
    protected var entries: List<SavedEpisodes.Entry>,
    private val onPlayEpisode: (Episode, String, String) -> Unit,
    private val onOpenEpisode: (Episode, String, String) -> Unit,
    private val onRemoveSaved: (String) -> Unit,
    private val onEpisodeLongPress: ((SavedEpisodes.Entry) -> Unit)? = null,
    private val onEpisodeSelectionClick: ((SavedEpisodes.Entry) -> Boolean)? = null,
    private val onEpisodeOverflowClick: ((View, SavedEpisodes.Entry) -> Unit)? = null
) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {

    private sealed class DisplayItem {
        data class EntryItem(val entry: SavedEpisodes.Entry) : DisplayItem()
        object PlayedHeader : DisplayItem()
    }

    private var displayItems: List<DisplayItem> = entries.map { DisplayItem.EntryItem(it) }
    private var showPlayedSection = false
    private var playedSectionExpanded = false

    private var downloadCompleteReceiver: android.content.BroadcastReceiver? = null
    private var selectedEntryIds: Set<String> = emptySet()

    private fun rebuildDisplayItems() {
        if (!showPlayedSection) {
            displayItems = entries.map { DisplayItem.EntryItem(it) }
            notifyDataSetChanged()
            return
        }
        val unplayed = entries.filter { !PlayedEpisodesPreference.isPlayed(context, it.id) }
        val played = entries.filter { PlayedEpisodesPreference.isPlayed(context, it.id) }
        displayItems = buildList {
            addAll(unplayed.map { DisplayItem.EntryItem(it) })
            if (played.isNotEmpty()) {
                add(DisplayItem.PlayedHeader)
                if (playedSectionExpanded) {
                    addAll(played.map { DisplayItem.EntryItem(it) })
                }
            }
        }
        notifyDataSetChanged()
    }

    fun setShowPlayedSection(enabled: Boolean) {
        if (showPlayedSection == enabled) return
        showPlayedSection = enabled
        if (!enabled) playedSectionExpanded = false
        rebuildDisplayItems()
    }

    fun refreshPlayedState() {
        rebuildDisplayItems()
    }

    private fun togglePlayedSection() {
        playedSectionExpanded = !playedSectionExpanded
        rebuildDisplayItems()
    }

    override fun onAttachedToRecyclerView(recyclerView: RecyclerView) {
        super.onAttachedToRecyclerView(recyclerView)
        
        // Register receiver to refresh list when downloads complete
        downloadCompleteReceiver = object : android.content.BroadcastReceiver() {
            override fun onReceive(context: android.content.Context?, intent: android.content.Intent?) {
                try {
                    // Refresh the entire adapter when any download completes
                    notifyDataSetChanged()
                } catch (_: Exception) { }
            }
        }
        
        try {
            context.registerReceiver(
                downloadCompleteReceiver,
                android.content.IntentFilter(EpisodeDownloadManager.ACTION_DOWNLOAD_COMPLETE),
                android.content.Context.RECEIVER_NOT_EXPORTED
            )
        } catch (_: Exception) { }
    }

    override fun onDetachedFromRecyclerView(recyclerView: RecyclerView) {
        super.onDetachedFromRecyclerView(recyclerView)
        
        // Unregister receiver
        try {
            downloadCompleteReceiver?.let { context.unregisterReceiver(it) }
            downloadCompleteReceiver = null
        } catch (_: Exception) { }
    }

    inner class ViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val title: TextView = view.findViewById(R.id.episode_title)
        val desc: TextView = view.findViewById(R.id.episode_description)
        val podcastTitle: TextView? = view.findViewById(R.id.episode_podcast)
        val date: TextView = view.findViewById(R.id.episode_date)
        val duration: TextView? = view.findViewById(R.id.episode_duration)
        val progressBar: LinearProgressIndicator = view.findViewById(R.id.episode_progress_bar)
        val playedIcon: TextView? = view.findViewById(R.id.episode_played_icon)
        val downloadIcon: ImageView? = view.findViewById(R.id.episode_download_icon)
        val play: View? = view.findViewById(R.id.episode_play_icon)
        val overflow: ImageButton? = view.findViewById(R.id.episode_overflow_button)
        val selectionCheckBox: CheckBox? = view.findViewById(R.id.episode_selection_checkbox)
        val textContainer: View? = view.findViewById(R.id.episode_text_container)
        val metaRow: View? = view.findViewById(R.id.episode_meta_row)
    }

    private fun sanitize(raw: String): String {
        if (!raw.contains("<") && !raw.contains("&")) return raw.trim()
        return HtmlCompat.fromHtml(raw, HtmlCompat.FROM_HTML_MODE_LEGACY).toString().trim()
    }

    private fun formatDate(raw: String): String {
        if (raw.isBlank()) return ""
        val parsed: java.util.Date? = DATE_FORMATS.firstNotNullOfOrNull { format ->
            try {
                format.parse(raw)
            } catch (e: java.text.ParseException) {
                null
            }
        }
        val cleaned = raw.trim().replace(Regex("\\s+(GMT|UTC|UT)", RegexOption.IGNORE_CASE), "").replace(Regex(",\\s+"), ", ")
        val fallback = cleaned.replace(Regex("\\s+\\d{1,2}:\\d{2}(:\\d{2})?"), "").replace(Regex("\\s+\\d{1,2}$"), "").trim()
        return parsed?.let { OUTPUT_FORMAT.format(it) } ?: fallback
    }
    inner class PlayedSectionHeaderViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val titleView: TextView = view.findViewById(R.id.section_title)

        init {
            view.isClickable = true
            view.isFocusable = true
            view.setOnClickListener { togglePlayedSection() }
        }

        fun bind(expanded: Boolean) {
            titleView.text = itemView.context.getString(R.string.podcast_detail_played_section_title)
            val icon = if (expanded) R.drawable.ic_expand_less else R.drawable.ic_expand_more
            val drawable = AppCompatResources.getDrawable(itemView.context, icon)?.mutate()
            if (drawable != null) {
                DrawableCompat.setTint(drawable, titleView.currentTextColor)
            }
            titleView.setCompoundDrawablesRelativeWithIntrinsicBounds(null, null, drawable, null)
            titleView.compoundDrawablePadding = (8 * itemView.resources.displayMetrics.density).toInt()
        }
    }

    override fun getItemViewType(position: Int): Int {
        return when (displayItems[position]) {
            is DisplayItem.EntryItem -> VIEW_TYPE_EPISODE
            DisplayItem.PlayedHeader -> VIEW_TYPE_PLAYED_HEADER
        }
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
        return if (viewType == VIEW_TYPE_PLAYED_HEADER) {
            val v = LayoutInflater.from(context).inflate(R.layout.item_section_header, parent, false)
            PlayedSectionHeaderViewHolder(v)
        } else {
            val v = LayoutInflater.from(context).inflate(R.layout.item_episode, parent, false)
            ViewHolder(v)
        }
    }

    override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
        if (holder is PlayedSectionHeaderViewHolder) {
            holder.bind(playedSectionExpanded)
            return
        }
        val episodeHolder = holder as ViewHolder
        val item = displayItems[position] as? DisplayItem.EntryItem ?: return
        val e = item.entry
        episodeHolder.title.text = e.title
        episodeHolder.desc.text = sanitize(e.description)
        if (e.podcastTitle.isNullOrBlank()) {
            episodeHolder.podcastTitle?.visibility = View.GONE
        } else {
            episodeHolder.podcastTitle?.visibility = View.VISIBLE
            episodeHolder.podcastTitle?.text = e.podcastTitle
        }
        episodeHolder.date.text = formatDate(e.pubDate)
        episodeHolder.duration?.text = if (e.durationMins > 0) "${e.durationMins} min" else "–"
        // Note: item_episode layout doesn't include an image view by default, so we don't attempt to load it here

        val episode = Episode(
            id = e.id,
            title = e.title,
            description = e.description,
            audioUrl = e.audioUrl,
            imageUrl = e.imageUrl,
            pubDate = e.pubDate,
            durationMins = e.durationMins,
            podcastId = e.podcastId
        )

        // Playback progress / played-state indicators
        try {
            val progressMs = PlayedEpisodesPreference.getProgress(episodeHolder.itemView.context, episode.id)
            val durMs = (episode.durationMins.takeIf { it > 0 } ?: 0) * 60_000L
            val isPlayed = PlayedEpisodesPreference.isPlayed(episodeHolder.itemView.context, episode.id)

            if (!isPlayed && durMs > 0 && progressMs > 0L) {
                val ratio = (progressMs.toDouble() / durMs.toDouble()).coerceIn(0.0, 1.0)
                val percent = kotlin.math.round(ratio * 100).toInt()
                episodeHolder.progressBar.progress = percent
                episodeHolder.progressBar.visibility = View.VISIBLE
            } else {
                episodeHolder.progressBar.visibility = View.GONE
            }

            if (isPlayed) {
                episodeHolder.playedIcon?.text = "\u2713"
                episodeHolder.playedIcon?.setTextColor(ContextCompat.getColor(episodeHolder.itemView.context, R.color.episode_check_green))
                episodeHolder.playedIcon?.visibility = View.VISIBLE
            } else if (durMs > 0 && progressMs > 0L) {
                val ratio = progressMs.toDouble() / durMs.toDouble()
                if (ratio < 0.95) {
                    episodeHolder.playedIcon?.text = "~"
                    episodeHolder.playedIcon?.setTextColor(ContextCompat.getColor(episodeHolder.itemView.context, R.color.episode_tilde_amber))
                    episodeHolder.playedIcon?.visibility = View.VISIBLE
                } else {
                    episodeHolder.playedIcon?.visibility = View.GONE
                }
            } else {
                episodeHolder.playedIcon?.visibility = View.GONE
            }
        } catch (_: Exception) {
            episodeHolder.progressBar.visibility = View.GONE
            episodeHolder.playedIcon?.visibility = View.GONE
        }

        // Show download icon if episode is downloaded
        if (DownloadedEpisodes.isDownloaded(episodeHolder.itemView.context, episode)) {
            episodeHolder.downloadIcon?.visibility = View.VISIBLE
        } else {
            episodeHolder.downloadIcon?.visibility = View.GONE
        }

        val isSelectionMode = selectedEntryIds.isNotEmpty()
        val isSelected = selectedEntryIds.contains(e.id)
        episodeHolder.selectionCheckBox?.visibility = if (isSelectionMode) View.VISIBLE else View.GONE
        episodeHolder.selectionCheckBox?.isChecked = isSelected

        // Hide play button completely in selection mode (GONE not INVISIBLE) so the row
        // doesn't reflow. Slide text content right instead, matching the search-results pattern.
        episodeHolder.play?.visibility = if (isSelectionMode) View.GONE else View.VISIBLE
        val slideX = if (isSelectionMode) {
            (12 * episodeHolder.itemView.resources.displayMetrics.density)
        } else {
            0f
        }
        episodeHolder.textContainer?.animate()?.cancel()
        episodeHolder.metaRow?.animate()?.cancel()
        episodeHolder.textContainer?.animate()?.translationX(slideX)?.setDuration(150)?.start()
        episodeHolder.metaRow?.animate()?.translationX(slideX)?.setDuration(150)?.start()

        episodeHolder.overflow?.visibility = if (onEpisodeOverflowClick != null && !isSelectionMode) View.VISIBLE else View.GONE
        episodeHolder.overflow?.setOnClickListener {
            onEpisodeOverflowClick?.invoke(it, e)
        }

        // Checkbox click handler for selection mode
        episodeHolder.selectionCheckBox?.setOnClickListener {
            onEpisodeSelectionClick?.invoke(e)
        }

        val handleSelectionClick: (() -> Boolean) = {
            onEpisodeSelectionClick?.invoke(e) == true
        }

        episodeHolder.play?.setOnClickListener {
            if (!handleSelectionClick()) {
                onPlayEpisode(episode, e.podcastTitle, e.imageUrl)
            }
        }
        episodeHolder.itemView.setOnClickListener {
            if (!handleSelectionClick()) {
                onOpenEpisode(episode, e.podcastTitle, e.imageUrl)
            }
        }
        episodeHolder.itemView.setOnLongClickListener {
            if (onEpisodeLongPress != null) {
                onEpisodeLongPress.invoke(e)
                true
            } else {
                false
            }
        }
        // Long-press no longer removes episodes. Use swipe-to-delete in the Saved Episodes list instead.
    }

    override fun getItemCount(): Int = displayItems.size

    open fun getEntryAt(position: Int): SavedEpisodes.Entry? {
        return (displayItems.getOrNull(position) as? DisplayItem.EntryItem)?.entry
    }

    open fun updateEntries(newEntries: List<SavedEpisodes.Entry>) {
        entries = newEntries
        rebuildDisplayItems()
    }

    fun setSelectedEntryIds(ids: Set<String>) {
        selectedEntryIds = ids
        notifyDataSetChanged()
    }

    open fun moveEntry(fromPosition: Int, toPosition: Int): Boolean {
        if (fromPosition == toPosition) return false
        // Only support drag-reorder when the played section is not active
        if (showPlayedSection) return false
        if (fromPosition !in entries.indices || toPosition !in entries.indices) return false
        val mutable = entries.toMutableList()
        val moved = mutable.removeAt(fromPosition)
        mutable.add(toPosition, moved)
        entries = mutable
        rebuildDisplayItems()
        return true
    }

    companion object {
        private const val VIEW_TYPE_EPISODE = 0
        private const val VIEW_TYPE_PLAYED_HEADER = 1

        private val DATE_FORMATS = listOf(
            "EEE, dd MMM yyyy HH:mm:ss Z",
            "dd MMM yyyy HH:mm:ss Z",
            "EEE, dd MMM yyyy HH",
            "EEE, dd MMM yyyy",
            "dd MMM yyyy HH",
            "dd MMM yyyy"
        ).map { java.text.SimpleDateFormat(it, java.util.Locale.US) }

        private val OUTPUT_FORMAT = java.text.SimpleDateFormat("EEE, dd MMM yyyy", java.util.Locale.US)
    }
}
