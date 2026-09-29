package com.hyliankid14.bbcradioplayer

import android.content.Context
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import android.widget.ImageView
import android.widget.TextView
import android.graphics.Color
import androidx.core.content.ContextCompat
import com.bumptech.glide.Glide
import kotlinx.coroutines.*

class StationAdapter(
    private val context: Context,
    private val stations: List<Station>,
    private val onStationClick: (String) -> Unit,
    private val onFavoriteToggle: ((String) -> Unit)? = null,
    private val onScheduleClick: ((Station) -> Unit)? = null
) : RecyclerView.Adapter<StationAdapter.StationViewHolder>() {
    
    private val adapterScope = CoroutineScope(Dispatchers.Main + Job())
    // Cache stores Pair<ShowTitle, Timestamp>
    private val showCache = mutableMapOf<String, Pair<String, Long>>()
    private val fetchingIds = mutableSetOf<String>()
    private val CACHE_DURATION_MS = 120_000L // 2 minutes

    class StationViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val imageView: ImageView = view.findViewById(R.id.station_artwork)
        val textView: TextView = view.findViewById(R.id.station_title)
        val subtitleView: TextView = view.findViewById(R.id.station_subtitle)
        val starView: ImageView = view.findViewById(R.id.station_favorite_star)
        val scheduleButton: ImageView = view.findViewById(R.id.station_schedule_button)
    }
    
    override fun onDetachedFromRecyclerView(recyclerView: RecyclerView) {
        super.onDetachedFromRecyclerView(recyclerView)
        adapterScope.cancel()
    }
    
    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): StationViewHolder {
        val view = LayoutInflater.from(parent.context).inflate(
            R.layout.station_list_item,
            parent,
            false
        )
        return StationViewHolder(view)
    }
    
    override fun getItemCount(): Int = stations.size
    
    override fun onBindViewHolder(holder: StationViewHolder, position: Int) {
        val station = stations[position]
        
        holder.textView.text = station.title
        
        // Handle subtitle (Show Name)
        val cachedEntry = showCache[station.id]
        val isCacheValid = cachedEntry != null && (System.currentTimeMillis() - cachedEntry.second < CACHE_DURATION_MS)
        
        if (isCacheValid) {
            holder.subtitleView.text = cachedEntry!!.first
            holder.subtitleView.visibility = View.VISIBLE
        } else {
            // If cache is invalid or missing, hide view (or keep old value if available) and fetch
            if (cachedEntry != null) {
                holder.subtitleView.text = cachedEntry.first
                holder.subtitleView.visibility = View.VISIBLE
            } else {
                holder.subtitleView.visibility = View.GONE
            }
            
            if (!fetchingIds.contains(station.id)) {
                fetchingIds.add(station.id)
                adapterScope.launch {
                    try {
                        val show = withContext(Dispatchers.IO) {
                            ShowInfoFetcher.getScheduleCurrentShow(station.id)
                        }
                        val showTitle = show.title
                        // Only show if it's not the generic default
                        if (showTitle != "BBC Radio") {
                            showCache[station.id] = Pair(showTitle, System.currentTimeMillis())
                            // Update the item if it's still visible/bound to the same position
                            val currentPos = holder.bindingAdapterPosition
                            if (currentPos != RecyclerView.NO_POSITION && currentPos < stations.size && stations[currentPos].id == station.id) {
                                notifyItemChanged(currentPos)
                            }
                        }
                    } catch (e: Exception) {
                        // Ignore errors
                    } finally {
                        fetchingIds.remove(station.id)
                    }
                }
            }
        }
        
        holder.imageView.setImageDrawable(StationArtwork.createDrawable(station.id))
        
        // Update star icon
        val isFavorite = FavoritesPreference.isFavorite(context, station.id)
        if (isFavorite) {
            holder.starView.setImageResource(R.drawable.ic_star_filled)
            holder.starView.setColorFilter(ContextCompat.getColor(context, R.color.favorite_star_color))
        } else {
            holder.starView.setImageResource(R.drawable.ic_star_outline)
            holder.starView.clearColorFilter()
        }
        
        holder.starView.setOnClickListener {
            FavoritesPreference.toggleFavorite(context, station.id)
            val nowFavorite = FavoritesPreference.isFavorite(context, station.id)
            if (nowFavorite) {
                holder.starView.setImageResource(R.drawable.ic_star_filled)
                holder.starView.setColorFilter(ContextCompat.getColor(context, R.color.favorite_star_color))
            } else {
                holder.starView.setImageResource(R.drawable.ic_star_outline)
                holder.starView.clearColorFilter()
            }
            onFavoriteToggle?.invoke(station.id)
        }

        holder.scheduleButton.setOnClickListener {
            if (onScheduleClick != null) {
                onScheduleClick.invoke(station)
            } else {
                val intent = android.content.Intent(context, ScheduleActivity::class.java)
                intent.putExtra(ScheduleActivity.EXTRA_STATION_ID, station.id)
                intent.putExtra(ScheduleActivity.EXTRA_STATION_TITLE, station.title)
                context.startActivity(intent)
            }
        }
        
        // Make image and text clickable to play
        val clickListener = View.OnClickListener { onStationClick(station.id) }
        holder.imageView.setOnClickListener(clickListener)
        holder.textView.setOnClickListener(clickListener)
        holder.itemView.setOnClickListener(clickListener)
    }
    
    fun clearShowCache() {
        showCache.clear()
        fetchingIds.clear()
    }
}
