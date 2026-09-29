package com.hyliankid14.bbcradioplayer

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import android.widget.ImageView
import androidx.recyclerview.widget.RecyclerView
import android.text.format.DateFormat
import java.util.Date

class SavedSearchAdapter(
    private val items: MutableList<SavedSearchesPreference.SavedSearch>,
    private val onSearchClick: (SavedSearchesPreference.SavedSearch) -> Unit,
    private val onRenameClick: (SavedSearchesPreference.SavedSearch) -> Unit,
    private val onNotifyToggle: (SavedSearchesPreference.SavedSearch, Boolean) -> Unit,
    private val onDeleteClick: (SavedSearchesPreference.SavedSearch) -> Unit
) : RecyclerView.Adapter<SavedSearchAdapter.SavedSearchViewHolder>() {

    class SavedSearchViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        val title: TextView = itemView.findViewById(R.id.saved_search_title)
        val latestDate: TextView = itemView.findViewById(R.id.saved_search_latest_date)
        val notifyButton: View = itemView.findViewById(R.id.saved_search_notify_button)
        val notifyBell: ImageView = itemView.findViewById(R.id.saved_search_notify_icon)
        val renameButton: View = itemView.findViewById(R.id.saved_search_rename_button)
        val deleteButton: View = itemView.findViewById(R.id.saved_search_delete_button)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): SavedSearchViewHolder {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_saved_search, parent, false)
        return SavedSearchViewHolder(view)
    }

    override fun onBindViewHolder(holder: SavedSearchViewHolder, position: Int) {
        val search = items[position]
        holder.title.text = search.name.ifBlank { search.query }
        holder.itemView.setOnClickListener { onSearchClick(search) }

        if (search.lastMatchEpoch > 0L) {
            val date = DateFormat.getMediumDateFormat(holder.itemView.context).format(Date(search.lastMatchEpoch))
            holder.latestDate.text = "Latest: $date"
        } else {
            holder.latestDate.text = "No matches yet"
        }

        val bellRes = if (search.notificationsEnabled) {
            R.drawable.ic_notifications
        } else {
            R.drawable.ic_notifications_off
        }
        holder.notifyBell.setImageResource(bellRes)
        holder.notifyButton.setOnClickListener {
            onNotifyToggle(search, !search.notificationsEnabled)
        }

        holder.renameButton.setOnClickListener { onRenameClick(search) }
        holder.deleteButton.setOnClickListener { onDeleteClick(search) }
    }

    override fun getItemCount(): Int = items.size

    fun updateSearches(newItems: List<SavedSearchesPreference.SavedSearch>) {
        items.clear()
        items.addAll(newItems)
        notifyDataSetChanged()
    }
}
