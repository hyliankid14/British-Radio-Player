package com.hyliankid14.bbcradioplayer

import android.content.Context
import android.text.SpannableString
import android.text.style.StyleSpan
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import java.util.Locale
import androidx.core.text.HtmlCompat

/**
 * Adapter that displays grouped search results with section headers. Supports three sections:
 * - Podcast Name matches
 * - Podcast Description matches
 * - Episode matches (shows episode title and parent podcast title)
 */
class SearchResultsAdapter(
    private val context: Context,
    private val titleMatches: List<Podcast>,
    private val descMatches: List<Podcast>,
    private val episodeMatches: List<Pair<Episode, Podcast>>,
    private val onPodcastClick: (Podcast) -> Unit,
    private val onPlayEpisode: (Episode) -> Unit,
    private val onOpenEpisode: (Episode, Podcast) -> Unit,
    private val prebuiltItems: List<Item>? = null
) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {

    sealed class Item {
        data class Section(val title: String) : Item()
        data class PodcastItem(val podcast: Podcast) : Item()
        data class EpisodeItem(val episode: Episode, val podcast: Podcast) : Item()
    }

    private var items: MutableList<Item> = mutableListOf()

    init {
        if (prebuiltItems != null) {
            items = prebuiltItems.toMutableList()
        } else {
            rebuildItems(titleMatches, descMatches, episodeMatches)
        }
    }

    fun snapshotItems(): List<Item> = items.toList()

    private fun rebuildItems(titleMatches: List<Podcast>, descMatches: List<Podcast>, episodeMatches: List<Pair<Episode, Podcast>>) {
        items.clear()
        if (titleMatches.isNotEmpty()) {
            items.add(Item.Section("Podcast Name"))
            titleMatches.forEach { items.add(Item.PodcastItem(it)) }
        }
        if (descMatches.isNotEmpty()) {
            items.add(Item.Section("Podcast Description"))
            descMatches.forEach { items.add(Item.PodcastItem(it)) }
        }
        if (episodeMatches.isNotEmpty()) {
            items.add(Item.Section("Episode"))
            episodeMatches.forEach { (ep, p) -> items.add(Item.EpisodeItem(ep, p)) }
        }
    }

    /**
     * Update the episode matches (called incrementally as results arrive) and refresh the view.
     */
    fun updateEpisodeMatches(newEpisodeMatches: List<Pair<Episode, Podcast>>) {
        // Find the index of the Episode section or append it
        // For simplicity rebuild items from the existing title/desc sections and the new episode list
        // Note: title/desc are not stored on the adapter instance; to keep this simple we assume
        // callers will recreate the adapter when top-level title/desc changes. We only update episode list.
        // For robustness, we will locate any existing podcast/sections and append episode section.
        // Clear any previous Episode items
        items.removeAll { it is Item.EpisodeItem }
        // Remove any existing Section("Episode") header
        items.removeAll { it is Item.Section && it.title == "Episode" }
        if (newEpisodeMatches.isNotEmpty()) {
            items.add(Item.Section("Episode"))
            newEpisodeMatches.forEach { (ep, p) -> items.add(Item.EpisodeItem(ep, p)) }
        }
        notifyDataSetChanged()
    }

    fun appendItems(more: List<Item>) {
        if (more.isEmpty()) return
        val start = items.size
        items.addAll(more)
        notifyItemRangeInserted(start, more.size)
    }

    fun appendEpisodeMatches(moreEpisodeMatches: List<Pair<Episode, Podcast>>) {
        if (moreEpisodeMatches.isEmpty()) return

        // Deduplicate against already-rendered episode items.
        val seenIds = items.asSequence()
            .mapNotNull { (it as? Item.EpisodeItem)?.episode?.id }
            .toMutableSet()

        val filtered = moreEpisodeMatches.filter { seenIds.add(it.first.id) }
        if (filtered.isEmpty()) return

        var sectionIndex = items.indexOfFirst { it is Item.Section && it.title == "Episode" }
        if (sectionIndex == -1) {
            sectionIndex = items.size
            items.add(Item.Section("Episode"))
            notifyItemInserted(sectionIndex)
        }

        val insertStart = items.size
        filtered.forEach { (ep, p) -> items.add(Item.EpisodeItem(ep, p)) }
        notifyItemRangeInserted(insertStart, filtered.size)
    }

    /**
     * Patch individual episode items in-place with enriched data (audio URLs, pub dates, etc.).
     * Uses fine-grained notifyItemChanged per updated item — no scroll-resetting full rebind.
     */
    fun patchEpisodes(updatedEpisodes: Map<String, Episode>) {
        if (updatedEpisodes.isEmpty()) return
        for (i in items.indices) {
            val item = items[i]
            if (item is Item.EpisodeItem) {
                val updated = updatedEpisodes[item.episode.id] ?: continue
                items[i] = Item.EpisodeItem(updated, item.podcast)
                // Pass a payload to prevent DefaultItemAnimator from cross-fading (blinking) the item
                notifyItemChanged(i, "enrichment")
            }
        }
    }

    companion object {
        private const val TYPE_SECTION = 0
        private const val TYPE_PODCAST = 1
        private const val TYPE_EPISODE = 2

        private val DATE_FORMATS = listOf(
            "EEE, dd MMM yyyy HH:mm:ss Z",
            "dd MMM yyyy HH:mm:ss Z",
            "EEE, dd MMM yyyy HH",
            "EEE, dd MMM yyyy",
            "dd MMM yyyy HH",
            "dd MMM yyyy"
        ).map { java.text.SimpleDateFormat(it, Locale.US) }

        private val OUTPUT_FORMAT = java.text.SimpleDateFormat("EEE, dd MMM yyyy", Locale.US)
    }

    override fun getItemViewType(position: Int): Int {
        return when (items[position]) {
            is Item.Section -> TYPE_SECTION
            is Item.PodcastItem -> TYPE_PODCAST
            is Item.EpisodeItem -> TYPE_EPISODE
        }
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
        val inflater = LayoutInflater.from(context)
        return when (viewType) {
            TYPE_SECTION -> {
                val v = inflater.inflate(R.layout.item_section_header, parent, false)
                SectionViewHolder(v)
            }
            TYPE_PODCAST -> {
                val v = inflater.inflate(R.layout.item_podcast, parent, false)
                PodcastViewHolder(v)
            }
            TYPE_EPISODE -> {
                val v = inflater.inflate(R.layout.item_episode, parent, false)
                EpisodeViewHolder(v)
            }
            else -> throw IllegalArgumentException("Unknown view type $viewType")
        }
    }

    override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
        when (val it = items[position]) {
            is Item.Section -> (holder as SectionViewHolder).bind(it.title)
            is Item.PodcastItem -> (holder as PodcastViewHolder).bind(it.podcast)
            is Item.EpisodeItem -> (holder as EpisodeViewHolder).bind(it.episode, it.podcast)
        }
    }

    override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int, payloads: MutableList<Any>) {
        if (payloads.isNotEmpty() && payloads[0] == "enrichment" && holder is EpisodeViewHolder) {
            val item = items[position] as Item.EpisodeItem
            holder.bindEnrichmentOnly(item.episode, item.podcast)
        } else {
            super.onBindViewHolder(holder, position, payloads)
        }
    }

    override fun getItemCount(): Int = items.size

    inner class SectionViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val title: TextView = itemView.findViewById(R.id.section_title)
        fun bind(text: String) {
            title.text = text
        }
    }

    inner class PodcastViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val imageView: ImageView = itemView.findViewById(R.id.podcast_image)
        private val titleView: TextView = itemView.findViewById(R.id.podcast_title)
        private val descriptionView: TextView = itemView.findViewById(R.id.podcast_description)

        fun bind(podcast: Podcast) {
            titleView.text = podcast.title
            // Strip HTML from description if present
            val cleanDesc = if (podcast.description.contains("<") || podcast.description.contains("&")) {
                androidx.core.text.HtmlCompat.fromHtml(
                    podcast.description,
                    androidx.core.text.HtmlCompat.FROM_HTML_MODE_LEGACY
                ).toString().trim()
            } else {
                podcast.description
            }
            descriptionView.text = cleanDesc

            if (podcast.imageUrl.isNotEmpty()) {
                Glide.with(itemView.context).load(podcast.imageUrl).into(imageView)
            } else {
                // Load placeholder icon for podcasts without artwork
                imageView.setImageResource(R.drawable.ic_podcast)
            }

            itemView.setOnClickListener { onPodcastClick(podcast) }
            titleView.setOnClickListener { onPodcastClick(podcast) }
            descriptionView.setOnClickListener { onPodcastClick(podcast) }
        }
    }

    inner class EpisodeViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val titleView: TextView = itemView.findViewById(R.id.episode_title)
        private val descriptionView: TextView = itemView.findViewById(R.id.episode_description)
        private val dateView: TextView = itemView.findViewById(R.id.episode_date)
        private val playButton: View? = itemView.findViewById(R.id.episode_play_icon)
        private val durationView: TextView? = itemView.findViewById(R.id.episode_duration)
        private val downloadIcon: ImageView? = itemView.findViewById(R.id.episode_download_icon)

        fun bindEnrichmentOnly(episode: Episode, podcast: Podcast) {
            dateView.text = formatDate(episode.pubDate)
            val durText = when {
                episode.durationMins > 0 -> "${episode.durationMins} min"
                podcast.typicalDurationMins > 0 -> "${podcast.typicalDurationMins} min"
                else -> "…"
            }
            durationView?.text = durText

            playButton?.isEnabled = true
            playButton?.alpha = 1.0f
            playButton?.setOnClickListener { onPlayEpisode(episode) }
        }

        fun bind(episode: Episode, podcast: Podcast) {
            titleView.text = episode.title
            // Show podcast title as small subtitle appended to description for context
            val desc = sanitize(episode.description)
            descriptionView.text = desc
            // Set podcast subtitle separately and hide if empty
            val podcastTitleView: TextView? = itemView.findViewById(R.id.episode_podcast)
            if (podcast.title.isNullOrBlank()) {
                podcastTitleView?.visibility = View.GONE
            } else {
                podcastTitleView?.visibility = View.VISIBLE
                podcastTitleView?.text = podcast.title
            }
            dateView.text = formatDate(episode.pubDate)
            // Show typical duration when exact duration is missing; use an ellipsis while resolving
            val durText = when {
                episode.durationMins > 0 -> "${episode.durationMins} min"
                podcast.typicalDurationMins > 0 -> "${podcast.typicalDurationMins} min"
                else -> "…"
            }
            durationView?.text = durText

            // Show download icon if episode is downloaded
            if (DownloadedEpisodes.isDownloaded(itemView.context, episode)) {
                downloadIcon?.visibility = View.VISIBLE
            } else {
                downloadIcon?.visibility = View.GONE
            }

            // Keep play affordance enabled; playback flow can resolve missing audio URLs on demand.
            playButton?.isEnabled = true
            playButton?.alpha = 1.0f
            playButton?.setOnClickListener { onPlayEpisode(episode) }

            // Open preview (full activity) when title, podcast, or description tapped
            titleView.setOnClickListener { onOpenEpisode(episode, podcast) }
            podcastTitleView?.setOnClickListener { onOpenEpisode(episode, podcast) }
            descriptionView.setOnClickListener { onOpenEpisode(episode, podcast) }
        }

        private fun sanitize(raw: String): String {
            if (!raw.contains("<") && !raw.contains("&")) return raw.trim()
            val sp = HtmlCompat.fromHtml(raw, HtmlCompat.FROM_HTML_MODE_LEGACY)
            return sp.toString().trim()
        }

        private fun formatDate(raw: String): String {
            val parsed: java.util.Date? = DATE_FORMATS.firstNotNullOfOrNull { format ->
                try {
                    format.parse(raw)
                } catch (e: java.text.ParseException) {
                    null
                }
            }
            // Robust fallback: trim, drop trailing timezone tokens, and remove stray trailing hour numbers (e.g. " ... 20")
            val cleaned = raw.trim()
                .replace(Regex("\\s+(GMT|UTC|UT)", RegexOption.IGNORE_CASE), "")
                .replace(Regex(",\\s+"), ", ")
            val fallback = cleaned.replace(Regex("\\s+\\d{1,2}$"), "").trim()

            return parsed?.let {
                OUTPUT_FORMAT.format(it)
            } ?: fallback
        }
    }
}
