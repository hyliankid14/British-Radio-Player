package com.hyliankid14.bbcradioplayer

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageButton
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView

class PlaylistSummaryAdapter(
    private var playlists: List<PodcastPlaylists.PlaylistSummary>,
    private val onOpenPlaylist: (PodcastPlaylists.PlaylistSummary) -> Unit,
    private val onRenamePlaylist: (PodcastPlaylists.PlaylistSummary) -> Unit,
    private val onDeletePlaylist: (PodcastPlaylists.PlaylistSummary) -> Unit
) : RecyclerView.Adapter<PlaylistSummaryAdapter.ViewHolder>() {

    inner class ViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val title: TextView = view.findViewById(R.id.playlist_title)
        val subtitle: TextView = view.findViewById(R.id.playlist_subtitle)
        val rename: ImageButton = view.findViewById(R.id.playlist_rename)
        val delete: ImageButton = view.findViewById(R.id.playlist_delete)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_playlist_summary, parent, false)
        return ViewHolder(view)
    }

    override fun getItemCount(): Int = playlists.size

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val playlist = playlists[position]
        holder.title.text = playlist.name
        holder.subtitle.text = if (playlist.itemCount == 1) "1 episode" else "${playlist.itemCount} episodes"
        holder.itemView.setOnClickListener { onOpenPlaylist(playlist) }
        holder.rename.visibility = if (playlist.isDefault) View.GONE else View.VISIBLE
        holder.delete.visibility = if (playlist.isDefault) View.GONE else View.VISIBLE
        holder.rename.setOnClickListener { onRenamePlaylist(playlist) }
        holder.delete.setOnClickListener { onDeletePlaylist(playlist) }
    }

    fun updatePlaylists(newPlaylists: List<PodcastPlaylists.PlaylistSummary>) {
        playlists = newPlaylists
        notifyDataSetChanged()
    }
}