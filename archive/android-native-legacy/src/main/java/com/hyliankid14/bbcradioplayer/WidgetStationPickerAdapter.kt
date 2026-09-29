package com.hyliankid14.bbcradioplayer

import android.content.Context
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide

class WidgetStationPickerAdapter(
    private val context: Context,
    private val items: List<Item>,
    private val onStationClick: (String) -> Unit
) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {

    sealed class Item {
        data class Header(val title: String) : Item()
        data class StationRow(val station: Station) : Item()
    }

    override fun getItemViewType(position: Int): Int {
        return when (items[position]) {
            is Item.Header -> VIEW_TYPE_HEADER
            is Item.StationRow -> VIEW_TYPE_STATION
        }
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
        return if (viewType == VIEW_TYPE_HEADER) {
            val view = LayoutInflater.from(parent.context)
                .inflate(R.layout.station_category_header, parent, false)
            HeaderViewHolder(view)
        } else {
            val view = LayoutInflater.from(parent.context)
                .inflate(R.layout.station_list_item, parent, false)
            StationViewHolder(view)
        }
    }

    override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
        when (val item = items[position]) {
            is Item.Header -> (holder as HeaderViewHolder).bind(item)
            is Item.StationRow -> (holder as StationViewHolder).bind(item.station)
        }
    }

    override fun getItemCount(): Int = items.size

    private inner class HeaderViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        private val title: TextView = view.findViewById(R.id.category_title)

        fun bind(item: Item.Header) {
            title.text = item.title
        }
    }

    private inner class StationViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        private val artwork: ImageView = view.findViewById(R.id.station_artwork)
        private val title: TextView = view.findViewById(R.id.station_title)
        private val subtitle: TextView = view.findViewById(R.id.station_subtitle)
        private val star: ImageView = view.findViewById(R.id.station_favorite_star)
        private val dragHandle: ImageView = view.findViewById(R.id.drag_handle)
        private val scheduleButton: ImageView = view.findViewById(R.id.station_schedule_button)

        fun bind(station: Station) {
            title.text = station.title
            subtitle.visibility = View.GONE
            star.visibility = View.GONE
            dragHandle.visibility = View.GONE
            scheduleButton.visibility = View.GONE

            artwork.setImageDrawable(StationArtwork.createDrawable(station.id))

            itemView.setOnClickListener { onStationClick(station.id) }
            title.setOnClickListener { onStationClick(station.id) }
            artwork.setOnClickListener { onStationClick(station.id) }
        }
    }

    companion object {
        private const val VIEW_TYPE_HEADER = 0
        private const val VIEW_TYPE_STATION = 1

        fun buildItems(): List<Item> {
            val rows = mutableListOf<Item>()
            val categorised = StationRepository.getCategorizedStations()

            val categoryOrder = listOf(
                StationCategory.NATIONAL,
                StationCategory.REGIONS,
                StationCategory.LOCAL
            )

            categoryOrder.forEach { category ->
                val stations = categorised[category].orEmpty()
                if (stations.isNotEmpty()) {
                    rows.add(Item.Header(category.displayName))
                    stations.forEach { station -> rows.add(Item.StationRow(station)) }
                }
            }

            return rows
        }
    }
}
