package com.hyliankid14.bbcradioplayer

import android.content.Context
import android.graphics.drawable.BitmapDrawable
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.bumptech.glide.load.DataSource
import com.bumptech.glide.load.engine.GlideException
import com.bumptech.glide.request.RequestListener
import com.bumptech.glide.request.target.Target
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit

class RecentSongsAdapter(
    private val context: Context,
    private var songs: List<RecentSongsPreference.SongEntry>,
    private val onSongClicked: (RecentSongsPreference.SongEntry) -> Unit
) : RecyclerView.Adapter<RecentSongsAdapter.ViewHolder>() {

    inner class ViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val artwork: ImageView = view.findViewById(R.id.song_artwork)
        val track: TextView = view.findViewById(R.id.song_track)
        val artist: TextView = view.findViewById(R.id.song_artist)
        val station: TextView = view.findViewById(R.id.song_station)
        val time: TextView = view.findViewById(R.id.song_time)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val v = LayoutInflater.from(context).inflate(R.layout.item_recent_song, parent, false)
        return ViewHolder(v)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val song = songs[position]

        holder.track.text = song.track.ifBlank { song.artist }
        holder.artist.text = song.artist
        holder.artist.visibility = if (song.artist.isBlank()) View.GONE else View.VISIBLE
        holder.station.text = song.stationName
        holder.time.text = formatRelativeTime(song.playedAtMs)

        val stationLogoUrl = StationRepository.getStationById(song.stationId)?.logoUrl
        val artworkUrl = song.imageUrl.ifBlank { stationLogoUrl }
        if (artworkUrl != null) {
            val request = Glide.with(context).load(artworkUrl)
            val withFallback = if (song.imageUrl.isNotBlank() && stationLogoUrl != null) {
                request.error(Glide.with(context).load(stationLogoUrl).error(R.drawable.ic_music_note))
            } else {
                request.error(R.drawable.ic_music_note)
            }
            withFallback
                .placeholder(R.drawable.ic_music_note)
                .listener(object : RequestListener<android.graphics.drawable.Drawable> {
                    override fun onLoadFailed(e: GlideException?, model: Any?, target: Target<android.graphics.drawable.Drawable>?, isFirstResource: Boolean): Boolean {
                        return false
                    }
                    override fun onResourceReady(resource: android.graphics.drawable.Drawable?, model: Any?, target: Target<android.graphics.drawable.Drawable>?, dataSource: DataSource?, isFirstResource: Boolean): Boolean {
                        if (resource is BitmapDrawable && stationLogoUrl != null && isPlaceholderImage(resource.bitmap)) {
                            holder.artwork.post {
                                Glide.with(context)
                                    .load(stationLogoUrl)
                                    .error(R.drawable.ic_music_note)
                                    .into(holder.artwork)
                            }
                            return true
                        }
                        return false
                    }
                })
                .into(holder.artwork)
        } else {
            Glide.with(context).clear(holder.artwork)
            holder.artwork.setImageResource(R.drawable.ic_music_note)
        }

        holder.itemView.setOnClickListener { onSongClicked(song) }
    }

    override fun getItemCount(): Int = songs.size

    fun updateSongs(newSongs: List<RecentSongsPreference.SongEntry>) {
        songs = newSongs
        notifyDataSetChanged()
    }

    private fun formatRelativeTime(playedAtMs: Long): String {
        val now = System.currentTimeMillis()
        val diff = now - playedAtMs
        return when {
            diff < TimeUnit.MINUTES.toMillis(1) -> "Just now"
            diff < TimeUnit.HOURS.toMillis(1) -> {
                val mins = TimeUnit.MILLISECONDS.toMinutes(diff)
                "$mins min ago"
            }
            diff < TimeUnit.HOURS.toMillis(24) -> {
                val hours = TimeUnit.MILLISECONDS.toHours(diff)
                "$hours hr ago"
            }
            else -> TIME_FORMAT.format(Date(playedAtMs))
        }
    }

    private fun isPlaceholderImage(bitmap: android.graphics.Bitmap): Boolean {
        val width = bitmap.width
        val height = bitmap.height
        if (width == 1 && height == 1) return true
        if (width < 10 || height < 10) return false
        val p1 = bitmap.getPixel(5, 5)
        val p2 = bitmap.getPixel(width - 5, 5)
        val p3 = bitmap.getPixel(5, height - 5)
        val p4 = bitmap.getPixel(width - 5, height - 5)
        val p5 = bitmap.getPixel(width / 2, height / 2)
        val pixels = listOf(p1, p2, p3, p4, p5)
        val first = pixels[0]
        for (p in pixels) {
            if (!areColorsSimilar(first, p)) return false
        }
        return isGrey(first)
    }

    private fun areColorsSimilar(c1: Int, c2: Int): Boolean {
        val r1 = (c1 shr 16) and 0xFF
        val g1 = (c1 shr 8) and 0xFF
        val b1 = c1 and 0xFF
        val r2 = (c2 shr 16) and 0xFF
        val g2 = (c2 shr 8) and 0xFF
        val b2 = c2 and 0xFF
        val diff = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2)
        return diff < 30
    }

    private fun isGrey(color: Int): Boolean {
        val r = (color shr 16) and 0xFF
        val g = (color shr 8) and 0xFF
        val b = color and 0xFF
        val maxDiff = Math.max(Math.abs(r - g), Math.max(Math.abs(r - b), Math.abs(g - b)))
        return maxDiff < 20
    }

    companion object {
        private val TIME_FORMAT = SimpleDateFormat("EEE d MMM", Locale.UK)
    }
}
