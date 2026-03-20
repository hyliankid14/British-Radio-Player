package com.hyliankid14.bbcradioplayer

import android.content.Context
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
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

        if (song.imageUrl.isNotBlank()) {
            Glide.with(context)
                .load(song.imageUrl)
                .placeholder(R.drawable.ic_music_note)
                .error(R.drawable.ic_music_note)
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

    companion object {
        private val TIME_FORMAT = SimpleDateFormat("EEE d MMM", Locale.UK)
    }
}
