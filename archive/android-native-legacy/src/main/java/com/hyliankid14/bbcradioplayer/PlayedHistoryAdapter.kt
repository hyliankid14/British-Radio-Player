package com.hyliankid14.bbcradioplayer

import android.content.Context
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import com.google.android.material.progressindicator.LinearProgressIndicator
import androidx.recyclerview.widget.RecyclerView
import androidx.core.text.HtmlCompat
import androidx.core.content.ContextCompat

class PlayedHistoryAdapter(
    private val context: Context,
    private var entries: List<PlayedHistoryPreference.Entry>,
    private val onPlayEpisode: (Episode, String, String) -> Unit,
    private val onOpenEpisode: (Episode, String, String) -> Unit
) : RecyclerView.Adapter<PlayedHistoryAdapter.ViewHolder>() {

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
    }

    private fun sanitize(raw: String): String {
        if (!raw.contains("<") && !raw.contains("&")) return raw.trim()
        return HtmlCompat.fromHtml(raw, HtmlCompat.FROM_HTML_MODE_LEGACY).toString().trim()
    }

    private fun formatDate(raw: String): String {
        if (raw.isBlank()) return ""
        val epoch = EpisodeDateParser.parsePubDateToEpoch(raw)
        val cleaned = raw.trim().replace(Regex("\\s+(GMT|UTC|UT)", RegexOption.IGNORE_CASE), "").replace(Regex(",\\s+"), ", ")
        val fallback = cleaned.replace(Regex("\\s+\\d{1,2}:\\d{2}(:\\d{2})?"), "").replace(Regex("\\s+\\d{1,2}$"), "").trim()
        return if (epoch > 0L) {
            OUTPUT_FORMAT.format(java.util.Date(epoch))
        } else {
            fallback
        }
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val v = LayoutInflater.from(context).inflate(R.layout.item_episode, parent, false)
        return ViewHolder(v)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val e = entries[position]
        holder.title.text = e.title
        holder.desc.text = sanitize(e.description)
        if (e.podcastTitle.isBlank()) {
            holder.podcastTitle?.visibility = View.GONE
        } else {
            holder.podcastTitle?.visibility = View.VISIBLE
            holder.podcastTitle?.text = e.podcastTitle
        }
        holder.date.text = formatDate(e.pubDate)
        holder.duration?.text = "${e.durationMins} min"

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
            val progressMs = PlayedEpisodesPreference.getProgress(holder.itemView.context, episode.id)
            val durMs = (episode.durationMins.takeIf { it > 0 } ?: 0) * 60_000L
            val isPlayed = PlayedEpisodesPreference.isPlayed(holder.itemView.context, episode.id)

            if (!isPlayed && durMs > 0 && progressMs > 0L) {
                val ratio = (progressMs.toDouble() / durMs.toDouble()).coerceIn(0.0, 1.0)
                val percent = kotlin.math.round(ratio * 100).toInt()
                holder.progressBar.progress = percent
                holder.progressBar.visibility = View.VISIBLE
            } else {
                holder.progressBar.visibility = View.GONE
            }

            if (isPlayed) {
                holder.playedIcon?.text = "\u2713"
                holder.playedIcon?.setTextColor(ContextCompat.getColor(holder.itemView.context, R.color.episode_check_green))
                holder.playedIcon?.visibility = View.VISIBLE
            } else if (durMs > 0 && progressMs > 0L) {
                val ratio = progressMs.toDouble() / durMs.toDouble()
                if (ratio < 0.95) {
                    holder.playedIcon?.text = "~"
                    holder.playedIcon?.setTextColor(ContextCompat.getColor(holder.itemView.context, R.color.episode_tilde_amber))
                    holder.playedIcon?.visibility = View.VISIBLE
                } else {
                    holder.playedIcon?.visibility = View.GONE
                }
            } else {
                holder.playedIcon?.visibility = View.GONE
            }
        } catch (_: Exception) {
            // Defensive: don't let indicator rendering crash the list
            holder.progressBar.visibility = View.GONE
            holder.playedIcon?.visibility = View.GONE
        }

        // Show download icon if episode is downloaded
        if (DownloadedEpisodes.isDownloaded(holder.itemView.context, episode)) {
            holder.downloadIcon?.visibility = View.VISIBLE
        } else {
            holder.downloadIcon?.visibility = View.GONE
        }

        holder.play?.setOnClickListener { onPlayEpisode(episode, e.podcastTitle, e.imageUrl) }
        holder.itemView.setOnClickListener { onOpenEpisode(episode, e.podcastTitle, e.imageUrl) }
    }

    override fun getItemCount(): Int = entries.size

    fun getEntryAt(position: Int): PlayedHistoryPreference.Entry? {
        return entries.getOrNull(position)
    }

    fun updateEntries(newEntries: List<PlayedHistoryPreference.Entry>) {
        entries = newEntries
        notifyDataSetChanged()
    }

    companion object {
        private val OUTPUT_FORMAT = java.text.SimpleDateFormat("EEE, dd MMM yyyy", java.util.Locale.US)
    }
}
