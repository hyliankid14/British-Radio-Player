package com.hyliankid14.bbcradioplayer

import android.content.Context
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.animation.AccelerateDecelerateInterpolator
import android.widget.ImageView
import android.widget.ProgressBar
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.google.android.material.button.MaterialButton
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import androidx.core.text.HtmlCompat
import androidx.core.content.ContextCompat

class PodcastAdapter(
    private val context: Context,
    private var podcasts: MutableList<Podcast> = mutableListOf(),
    private val onPodcastClick: (Podcast) -> Unit,
    private val onOpenPlayer: (() -> Unit)? = null,
    private val highlightSubscribed: Boolean = false,
    private val showSubscribedIcon: Boolean = true,
    private val showNotificationBell: Boolean = true
) : RecyclerView.Adapter<PodcastAdapter.PodcastViewHolder>() {

    private var newEpisodeIds: Set<String> = emptySet()
    
    // Cache subscription and notification status to avoid repeated SharedPreferences reads
    private var subscribedIds: Set<String> = emptySet()
    private var notificationsEnabledIds: Set<String> = emptySet()
    
    init {
        refreshSubscriptionCache()
    }
    
    private fun refreshSubscriptionCache() {
        subscribedIds = PodcastSubscriptions.getSubscribedIds(context)
        notificationsEnabledIds = PodcastSubscriptions.getNotificationsEnabledIds(context)
    }

    fun updatePodcasts(newPodcasts: List<Podcast>) {
        podcasts.clear()
        podcasts.addAll(newPodcasts)
        refreshSubscriptionCache()
        notifyDataSetChanged()
    }

    fun addPodcasts(newPodcasts: List<Podcast>) {
        if (newPodcasts.isEmpty()) return
        val oldSize = podcasts.size
        podcasts.addAll(newPodcasts)
        notifyItemRangeInserted(oldSize, newPodcasts.size)
    }

    fun updateNewEpisodes(newSet: Set<String>) {
        newEpisodeIds = newSet
        notifyDataSetChanged()
    }
    
    /**
     * Refresh the cached subscription status. Call this when subscriptions or notifications change.
     */
    fun refreshCache() {
        refreshSubscriptionCache()
        notifyDataSetChanged()
    }

    /**
     * Remove podcast at adapter position and return it, or null if invalid position.
     */
    fun removePodcastAt(pos: Int): Podcast? {
        return if (pos in podcasts.indices) {
            val removed = podcasts[pos]
            podcasts.removeAt(pos)
            notifyItemRemoved(pos)
            removed
        } else null
    }

    /**
     * Insert a podcast at the specified adapter position (clamped) and notify.
     */
    fun insertPodcastAt(pos: Int, podcast: Podcast) {
        val insertPos = pos.coerceIn(0, podcasts.size)
        podcasts.add(insertPos, podcast)
        notifyItemInserted(insertPos)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): PodcastViewHolder {
        val view = LayoutInflater.from(context).inflate(R.layout.item_podcast, parent, false)
        return PodcastViewHolder(view, onPodcastClick)
    }

    override fun onBindViewHolder(holder: PodcastViewHolder, position: Int) {
        holder.bind(podcasts[position])
    }

    override fun getItemCount() = podcasts.size

    inner class PodcastViewHolder(
        itemView: View,
        private val onPodcastClick: (Podcast) -> Unit
    ) : RecyclerView.ViewHolder(itemView) {
        private lateinit var currentPodcast: Podcast
        private val imageView: ImageView = itemView.findViewById(R.id.podcast_image)
        private val titleView: TextView = itemView.findViewById(R.id.podcast_title)
        private val descriptionView: TextView = itemView.findViewById(R.id.podcast_description)
        private val genresView: TextView = itemView.findViewById(R.id.podcast_genres)
        private val notificationBell: ImageView = itemView.findViewById(R.id.podcast_notification_bell)

        init {
            // Use adapter position to safely resolve the podcast at the time of the click
            itemView.setOnClickListener {
                val pos = bindingAdapterPosition
                if (pos != RecyclerView.NO_POSITION && pos < this@PodcastAdapter.podcasts.size) {
                    val podcast = this@PodcastAdapter.podcasts[pos]
                    android.util.Log.d("PodcastAdapter", "Tapped podcast row: ${podcast.title}")
                    onPodcastClick(podcast)
                }
            }
            titleView.setOnClickListener {
                val pos = bindingAdapterPosition
                if (pos != RecyclerView.NO_POSITION && pos < this@PodcastAdapter.podcasts.size) {
                    val podcast = this@PodcastAdapter.podcasts[pos]
                    android.util.Log.d("PodcastAdapter", "Tapped podcast title: ${podcast.title}")
                    onPodcastClick(podcast)
                }
            }
            descriptionView.setOnClickListener {
                val pos = bindingAdapterPosition
                if (pos != RecyclerView.NO_POSITION && pos < this@PodcastAdapter.podcasts.size) {
                    val podcast = this@PodcastAdapter.podcasts[pos]
                    android.util.Log.d("PodcastAdapter", "Tapped podcast description: ${podcast.title}")
                    onPodcastClick(podcast)
                }
            }
            imageView.setOnClickListener {
                val pos = bindingAdapterPosition
                if (pos != RecyclerView.NO_POSITION && pos < this@PodcastAdapter.podcasts.size) {
                    val podcast = this@PodcastAdapter.podcasts[pos]
                    android.util.Log.d("PodcastAdapter", "Tapped podcast image: ${podcast.title}")
                    onPodcastClick(podcast)
                }
            }
            
            // Bell icon click handler - toggle notifications
            notificationBell.setOnClickListener {
                val pos = bindingAdapterPosition
                if (pos != RecyclerView.NO_POSITION && pos < this@PodcastAdapter.podcasts.size) {
                    val podcast = this@PodcastAdapter.podcasts[pos]
                    PodcastSubscriptions.toggleNotifications(itemView.context, podcast.id)
                    refreshSubscriptionCache()
                    
                    // Show feedback
                    val enabled = notificationsEnabledIds.contains(podcast.id)
                    val msg = if (enabled) "Notifications enabled for ${podcast.title}" 
                             else "Notifications disabled for ${podcast.title}"
                    android.widget.Toast.makeText(itemView.context, msg, android.widget.Toast.LENGTH_SHORT).show()
                    
                    updateBellIcon(podcast.id)
                }
            }
        }
        
        private fun updateBellIcon(podcastId: String) {
            val enabled = notificationsEnabledIds.contains(podcastId)
            val iconRes = if (enabled) R.drawable.ic_notifications else R.drawable.ic_notifications_off
            notificationBell.setImageResource(iconRes)
        }

        fun bind(podcast: Podcast) {
            currentPodcast = podcast
            titleView.text = podcast.title
            descriptionView.text = podcast.description
            genresView.text = podcast.genres.take(2).joinToString(", ")

            if (podcast.imageUrl.isNotEmpty()) {
                Glide.with(itemView.context)
                    .load(podcast.imageUrl)
                    .dontAnimate()
                    .into(imageView)
            } else {
                // Show placeholder icon for podcasts without artwork
                imageView.setImageResource(R.drawable.ic_podcast)
            }
            
            // Use cached subscription status instead of SharedPreferences lookups
            val isSubscribed = subscribedIds.contains(podcast.id)

            // Show a filled star for subscribed podcasts in the main list
            val subscribedIcon: ImageView? = itemView.findViewById(R.id.podcast_subscribed_icon)
            if (showSubscribedIcon && isSubscribed) {
                subscribedIcon?.setImageResource(R.drawable.ic_star_filled)
                subscribedIcon?.visibility = View.VISIBLE
            } else {
                subscribedIcon?.visibility = View.GONE
            }

            // Show notification bell only for subscribed podcasts when enabled
            if (showNotificationBell && isSubscribed) {
                notificationBell.visibility = View.VISIBLE
                updateBellIcon(podcast.id)
            } else {
                notificationBell.visibility = View.GONE
            }

            // New-episode indicator dot (shown when this podcast has unseen episodes)
            val newDot: TextView? = itemView.findViewById(R.id.podcast_new_dot)
            if (newEpisodeIds.contains(podcast.id)) {
                newDot?.visibility = View.VISIBLE
            } else {
                newDot?.visibility = View.GONE
            }

            // Highlight subscribed podcasts when used in the Favorites list using fixed lavender color
            if ((itemView.context as? android.app.Activity) != null && (bindingAdapterPosition >= 0)) {
                if (highlightSubscribed && isSubscribed) {
                    val bg = androidx.core.content.ContextCompat.getColor(itemView.context, R.color.subscribed_podcasts_bg)
                    val on = androidx.core.content.ContextCompat.getColor(itemView.context, R.color.subscribed_podcasts_text)
                    itemView.setBackgroundColor(bg)
                    // Use the same darker text for title, description and genres to increase contrast
                    titleView.setTextColor(on)
                    descriptionView.setTextColor(on)
                    genresView.setTextColor(on)
                } else {
                    itemView.setBackgroundColor(android.graphics.Color.TRANSPARENT)
                    titleView.setTextColor(androidx.core.content.ContextCompat.getColor(itemView.context, R.color.md_theme_onSurface))
                    descriptionView.setTextColor(androidx.core.content.ContextCompat.getColor(itemView.context, R.color.md_theme_onSurfaceVariant))
                    genresView.setTextColor(androidx.core.content.ContextCompat.getColor(itemView.context, R.color.md_theme_onSurfaceVariant))
                }
            }
        }
    }
}

class EpisodeAdapter(
    private val context: Context,
    private var episodes: List<Episode> = emptyList(),
    private val onPlayClick: (Episode) -> Unit,
    private val onOpenFull: (Episode) -> Unit
) : RecyclerView.Adapter<EpisodeAdapter.EpisodeViewHolder>() {

    fun updateEpisodes(newEpisodes: List<Episode>) {
        // Sort by publication date (most recent first). Unknown dates are treated as epoch 0.
        episodes = newEpisodes.sortedByDescending { EpisodeDateParser.parsePubDateToEpoch(it.pubDate) }
        notifyDataSetChanged()
    }

    fun addEpisodes(newEpisodes: List<Episode>) {
        episodes = (episodes + newEpisodes).sortedByDescending { EpisodeDateParser.parsePubDateToEpoch(it.pubDate) }
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): EpisodeViewHolder {
        val view = LayoutInflater.from(context).inflate(R.layout.item_episode, parent, false)
        return EpisodeViewHolder(view, onPlayClick, onOpenFull)
    }

    override fun onBindViewHolder(holder: EpisodeViewHolder, position: Int) {
        holder.bind(episodes[position])
    }

    override fun getItemCount() = episodes.size

    class EpisodeViewHolder(
        itemView: View,
        private val onPlayClick: (Episode) -> Unit,
        private val onOpenFull: (Episode) -> Unit
    ) : RecyclerView.ViewHolder(itemView) {
        private lateinit var currentEpisode: Episode
        private val titleView: TextView = itemView.findViewById(R.id.episode_title)
        private val descriptionView: TextView = itemView.findViewById(R.id.episode_description)
        private val podcastTitleView: TextView? = itemView.findViewById(R.id.episode_podcast)
        private val progressBar: ProgressBar = itemView.findViewById(R.id.episode_progress_bar)
        private val dateView: TextView = itemView.findViewById(R.id.episode_date)
        private val durationView: TextView = itemView.findViewById(R.id.episode_duration)
        private val playButton: MaterialButton = itemView.findViewById(R.id.episode_play_icon)
        private val playedIcon: TextView? = itemView.findViewById(R.id.episode_played_icon)
        private val downloadIcon: ImageView? = itemView.findViewById(R.id.episode_download_icon)
        private var isExpanded = false
        private val collapsedLines = 2

        init {
            val playAction: (View) -> Unit = {
                // Subtle scale animation to give tap feedback
                playButton.animate()
                    .scaleX(0.92f)
                    .scaleY(0.92f)
                    .setDuration(80)
                    .withEndAction {
                        playButton.animate()
                            .scaleX(1f)
                            .scaleY(1f)
                            .setDuration(80)
                            .setInterpolator(AccelerateDecelerateInterpolator())
                            .start()
                    }
                    .setInterpolator(AccelerateDecelerateInterpolator())
                    .start()
                onPlayClick(currentEpisode)
            }
            // Play when the play button is tapped
            playButton.setOnClickListener(playAction)

            // Do not open preview when the row itself is tapped — only specific subviews are actionable
            itemView.setOnClickListener(null)

            // Make the title and description open the full-screen player in preview mode (no autoplay)
            titleView.isClickable = true
            titleView.isFocusable = true
            titleView.setOnClickListener { onOpenFull(currentEpisode) }

            descriptionView.isClickable = true
            descriptionView.isFocusable = true
            descriptionView.setOnClickListener { onOpenFull(currentEpisode) }
        }

        fun bind(episode: Episode) {
            currentEpisode = episode
            titleView.text = episode.title
            isExpanded = false
            descriptionView.maxLines = collapsedLines

            // Show description text sanitized
            val fullDesc = sanitizeDescription(episode.description)
            descriptionView.text = fullDesc

            // Clicking the description opens the full-screen player (no inline toggle)

            // Show saved playback progress if available and episode has duration
            val progressMs = PlayedEpisodesPreference.getProgress(itemView.context, episode.id)
            val durMs = (episode.durationMins.takeIf { it > 0 } ?: 0) * 60_000L
            val isPlayed = PlayedEpisodesPreference.isPlayed(itemView.context, episode.id)

            // Set progress bar visibility and value (only when not completed)
            if (!isPlayed && durMs > 0 && progressMs > 0L) {
                val ratio = (progressMs.toDouble() / durMs.toDouble()).coerceIn(0.0, 1.0)
                val percent = Math.round(ratio * 100).toInt()
                progressBar.progress = percent
                progressBar.visibility = View.VISIBLE
            } else {
                progressBar.visibility = View.GONE
            }

            // Show indicator: check (green) for completed, tilde (amber) for in-progress, otherwise hidden
            if (isPlayed) {
                playedIcon?.text = "\u2713"
                playedIcon?.setTextColor(ContextCompat.getColor(itemView.context, R.color.episode_check_green))
                playedIcon?.visibility = View.VISIBLE
            } else if (durMs > 0 && progressMs > 0L) {
                // Consider in-progress when progress > 0 and < 95%
                val ratio = progressMs.toDouble() / durMs.toDouble()
                if (ratio < 0.95) {
                    playedIcon?.text = "~"
                    playedIcon?.setTextColor(ContextCompat.getColor(itemView.context, R.color.episode_tilde_amber))
                    playedIcon?.visibility = View.VISIBLE
                } else {
                    playedIcon?.visibility = View.GONE
                }
            } else {
                playedIcon?.visibility = View.GONE
            }
            // Remove timestamp from date - just show date portion
            dateView.text = formatEpisodeDate(episode.pubDate)
            durationView.text = "${episode.durationMins} min"

            // Show download icon if episode is downloaded
            if (DownloadedEpisodes.isDownloaded(itemView.context, episode)) {
                downloadIcon?.visibility = View.VISIBLE
            } else {
                downloadIcon?.visibility = View.GONE
            }

            // Hide podcast subtitle for per-podcast lists (reduces vertical gaps when absent)
            podcastTitleView?.visibility = View.GONE
        }

        private fun sanitizeDescription(raw: String): String {
            if (!raw.contains("<") && !raw.contains("&")) return raw.trim()
            val spanned = HtmlCompat.fromHtml(raw, HtmlCompat.FROM_HTML_MODE_LEGACY)
            return spanned.toString().trim()
        }

        private fun formatEpisodeDate(raw: String): String {
            val epoch = EpisodeDateParser.parsePubDateToEpoch(raw)
            return if (epoch > 0L) {
                OUTPUT_FORMAT.format(Date(epoch))
            } else {
                if (raw.contains(":")) raw.substringBefore(":").substringBeforeLast(" ").trim() else raw.trim()
            }
        }
    }

    companion object {
        private val OUTPUT_FORMAT = SimpleDateFormat("EEE, dd MMM yyyy", Locale.US)
    }
}

