package com.hyliankid14.bbcradioplayer

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView

/**
 * Simple adapter that displays a flat list of tag names.
 * Used as the first level of the "Sort by tags" drill-down in the subscribed podcasts view.
 * Tapping a row invokes [onTagClick] with the tag name.
 */
class TagListAdapter(
    private var tags: List<String>,
    private val onTagClick: (String) -> Unit
) : RecyclerView.Adapter<TagListAdapter.TagVH>() {

    fun updateTags(newTags: List<String>) {
        tags = newTags
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): TagVH =
        TagVH(LayoutInflater.from(parent.context).inflate(R.layout.item_tag_list, parent, false))

    override fun onBindViewHolder(holder: TagVH, position: Int) = holder.bind(tags[position])

    override fun getItemCount(): Int = tags.size

    inner class TagVH(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val nameView: TextView = itemView.findViewById(R.id.tag_list_name)
        fun bind(tag: String) {
            nameView.text = tag
            itemView.setOnClickListener { onTagClick(tag) }
        }
    }
}
