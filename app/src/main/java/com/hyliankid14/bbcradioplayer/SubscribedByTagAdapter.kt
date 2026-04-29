package com.hyliankid14.bbcradioplayer

import android.content.Context
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.google.android.material.chip.Chip
import com.google.android.material.chip.ChipGroup

/**
 * RecyclerView adapter that displays subscribed podcasts grouped by tag.
 * Each section starts with a [TagItem.Header] (tag name) followed by [TagItem.Entry] rows.
 * Tapping the × on a tag chip removes that tag; tapping ＋ triggers [onTagAdded].
 */
class SubscribedByTagAdapter(
    private val context: Context,
    private var items: List<TagItem>,
    private val onPodcastClick: (Podcast) -> Unit,
    val onTagRemoved: ((Podcast, String) -> Unit)? = null,
    val onTagAdded: ((Podcast) -> Unit)? = null,
    private var newEpisodeIds: Set<String> = emptySet()
) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {

    sealed class TagItem {
        data class Header(val tag: String) : TagItem()
        data class Entry(val podcast: Podcast) : TagItem()
    }

    companion object {
        const val TYPE_HEADER = 0
        const val TYPE_PODCAST = 1

        /**
         * Builds a flat list of [TagItem]s from [podcasts] grouped by their effective tags.
         * Podcasts with no tags are placed under an "Untagged" section at the end.
         */
        fun buildItems(context: Context, podcasts: List<Podcast>): List<TagItem> {
            val tags = PodcastTagsPreference.getAllTagsForSubscribed(context, podcasts)
            val result = mutableListOf<TagItem>()
            val taggedPodcastIds = mutableSetOf<String>()
            tags.forEach { tag ->
                val tagged = PodcastTagsPreference.getPodcastsForTag(context, tag, podcasts)
                if (tagged.isNotEmpty()) {
                    result.add(TagItem.Header(tag))
                    tagged.forEach { p ->
                        result.add(TagItem.Entry(p))
                        taggedPodcastIds.add(p.id)
                    }
                }
            }
            val untagged = podcasts.filter { it.id !in taggedPodcastIds }
            if (untagged.isNotEmpty()) {
                result.add(TagItem.Header("Untagged"))
                untagged.forEach { result.add(TagItem.Entry(it)) }
            }
            return result
        }
    }

    fun updateItems(newItems: List<TagItem>) {
        items = newItems
        notifyDataSetChanged()
    }

    fun updateNewEpisodes(ids: Set<String>) {
        newEpisodeIds = ids
        notifyDataSetChanged()
    }

    override fun getItemViewType(position: Int): Int = when (items[position]) {
        is TagItem.Header -> TYPE_HEADER
        is TagItem.Entry -> TYPE_PODCAST
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
        val inflater = LayoutInflater.from(context)
        return when (viewType) {
            TYPE_HEADER -> HeaderVH(inflater.inflate(R.layout.item_tag_section_header, parent, false))
            else -> PodcastVH(inflater.inflate(R.layout.item_podcast, parent, false))
        }
    }

    override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
        when (val item = items[position]) {
            is TagItem.Header -> (holder as HeaderVH).bind(item.tag)
            is TagItem.Entry -> (holder as PodcastVH).bind(item.podcast)
        }
    }

    override fun getItemCount(): Int = items.size

    inner class HeaderVH(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val text: TextView = itemView.findViewById(R.id.tag_header_text)
        fun bind(tag: String) { text.text = tag }
    }

    inner class PodcastVH(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val imageView: ImageView = itemView.findViewById(R.id.podcast_image)
        private val titleView: TextView = itemView.findViewById(R.id.podcast_title)
        private val descriptionView: TextView = itemView.findViewById(R.id.podcast_description)
        private val genresView: TextView = itemView.findViewById(R.id.podcast_genres)
        private val tagsGroup: ChipGroup? = itemView.findViewById(R.id.podcast_tags_group)
        private val notificationBell: ImageView = itemView.findViewById(R.id.podcast_notification_bell)
        private val newDot: TextView? = itemView.findViewById(R.id.podcast_new_dot)
        private val dragHandle: ImageView? = itemView.findViewById(R.id.podcast_drag_handle)

        fun bind(podcast: Podcast) {
            titleView.text = podcast.title
            descriptionView.text = podcast.description

            if (podcast.imageUrl.isNotEmpty()) {
                Glide.with(context).load(podcast.imageUrl).dontAnimate().into(imageView)
            } else {
                imageView.setImageResource(R.drawable.ic_podcast)
            }

            newDot?.visibility = if (podcast.id in newEpisodeIds) View.VISIBLE else View.GONE
            dragHandle?.visibility = View.GONE
            notificationBell.visibility = View.GONE

            // Tag chips
            if (tagsGroup != null) {
                genresView.visibility = View.GONE
                tagsGroup.visibility = View.VISIBLE
                tagsGroup.removeAllViews()
                val tags = PodcastTagsPreference.getTags(context, podcast).sorted()
                tags.forEach { tag ->
                    val chip = Chip(context)
                    chip.text = tag
                    chip.isCloseIconVisible = onTagRemoved != null
                    chip.isClickable = false
                    chip.isFocusable = false
                    chip.setOnCloseIconClickListener { onTagRemoved?.invoke(podcast, tag) }
                    tagsGroup.addView(chip)
                }
                if (onTagAdded != null) {
                    val addChip = Chip(context)
                    addChip.text = "＋"
                    addChip.isCloseIconVisible = false
                    addChip.setOnClickListener { onTagAdded.invoke(podcast) }
                    tagsGroup.addView(addChip)
                }
            } else {
                genresView.text = podcast.genres.take(2).joinToString(", ")
                genresView.visibility = View.VISIBLE
                tagsGroup?.visibility = View.GONE
            }

            itemView.setOnClickListener { onPodcastClick(podcast) }
        }
    }
}
