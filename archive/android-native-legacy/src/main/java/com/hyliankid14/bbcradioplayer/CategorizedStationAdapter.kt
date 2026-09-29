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

class CategorizedStationAdapter(
    private val context: Context,
    private val stations: List<Station>,
    private val onStationClick: (String) -> Unit,
    private val onFavoriteToggle: ((String) -> Unit)? = null,
    private val onScheduleClick: ((Station) -> Unit)? = null
) : RecyclerView.Adapter<CategorizedStationAdapter.StationViewHolder>() {
    
    private var adapterScope = CoroutineScope(Dispatchers.Main + Job())
    private val showCache = mutableMapOf<String, Pair<String, Long>>()
    private val fetchingIds = mutableSetOf<String>()
    private val CACHE_DURATION_MS = 120_000L // 2 minutes
    
    // Filter out subscribed podcasts
    private val filteredStations = stations.filter { !it.id.startsWith("podcast_") }
    
    class StationViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val imageView: ImageView = view.findViewById(R.id.station_artwork)
        val textView: TextView = view.findViewById(R.id.station_title)
        val subtitleView: TextView = view.findViewById(R.id.station_subtitle)
        val starView: ImageView = view.findViewById(R.id.station_favorite_star)
        val scheduleButton: ImageView = view.findViewById(R.id.station_schedule_button)
    }
    
    override fun onAttachedToRecyclerView(recyclerView: RecyclerView) {
        super.onAttachedToRecyclerView(recyclerView)
        // Recreate the scope if it was cancelled by a previous detach, so coroutines can run again
        if (adapterScope.coroutineContext[Job]?.isActive == false) {
            adapterScope = CoroutineScope(Dispatchers.Main + Job())
        }
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
    
    override fun getItemCount(): Int = filteredStations.size
    
    override fun onBindViewHolder(holder: StationViewHolder, position: Int) {
        val station = filteredStations[position]
        
        holder.textView.text = station.title
        
        // Handle subtitle (Show Name)
        val cachedEntry = showCache[station.id]
        val isCacheValid = cachedEntry != null && (System.currentTimeMillis() - cachedEntry.second < CACHE_DURATION_MS)
        
        if (isCacheValid && cachedEntry != null) {
            holder.subtitleView.text = cachedEntry.first
            holder.subtitleView.visibility = View.VISIBLE
        } else {
            holder.subtitleView.visibility = View.GONE
            
            if (!fetchingIds.contains(station.id)) {
                fetchingIds.add(station.id)
                adapterScope.launch {
                    try {
                        val show = ShowInfoFetcher.getScheduleCurrentShow(station.id)
                        if (show.title.isNotEmpty()) {
                            showCache[station.id] = Pair(show.title, System.currentTimeMillis())
                            holder.subtitleView.text = show.title
                            holder.subtitleView.visibility = View.VISIBLE
                        }
                    } catch (e: Exception) {
                        android.util.Log.w("CategorizedStationAdapter", "Failed to fetch show info for ${station.id}", e)
                    } finally {
                        fetchingIds.remove(station.id)
                    }
                }
            }
        }
        
        // Load image
        holder.imageView.setImageDrawable(StationArtwork.createDrawable(station.id))
        
        // Handle favorite star
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
        
        // Safer tap handling: gate clicks by movement slop; keep scrolling responsive
        val tapSlop = (12 * context.resources.displayMetrics.density).toInt()
        fun attachTapGuard(view: View, click: () -> Unit) {
            var downX = 0f
            var downY = 0f
            var movedBeyondSlop = false
            view.setOnTouchListener { _, event ->
                when (event.actionMasked) {
                    android.view.MotionEvent.ACTION_DOWN -> {
                        downX = event.x
                        downY = event.y
                        movedBeyondSlop = false
                    }
                    android.view.MotionEvent.ACTION_MOVE -> {
                        val dx = Math.abs(event.x - downX)
                        val dy = Math.abs(event.y - downY)
                        if (dx > tapSlop || dy > tapSlop) movedBeyondSlop = true
                    }
                }
                false
            }
            view.setOnClickListener {
                if (!movedBeyondSlop) click()
            }
        }
        attachTapGuard(holder.itemView) { onStationClick(station.id) }
        attachTapGuard(holder.imageView) { onStationClick(station.id) }
        attachTapGuard(holder.textView) { onStationClick(station.id) }
    }
    
    fun clearShowCache() {
        showCache.clear()
        fetchingIds.clear()
    }
}
