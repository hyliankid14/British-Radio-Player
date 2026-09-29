package com.hyliankid14.bbcradioplayer

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView

class PodcastGenreAdapter(
    private val items: MutableList<Item>,
    private val onClick: (Item) -> Unit
) : RecyclerView.Adapter<PodcastGenreAdapter.GenreViewHolder>() {

    data class Item(
        val name: String,
        val iconRes: Int
    )

    class GenreViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        val icon: ImageView = itemView.findViewById(R.id.genre_icon)
        val name: TextView = itemView.findViewById(R.id.genre_name)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): GenreViewHolder {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_genre, parent, false)
        return GenreViewHolder(view)
    }

    override fun onBindViewHolder(holder: GenreViewHolder, position: Int) {
        val item = items[position]
        holder.name.text = item.name
        holder.icon.setImageResource(item.iconRes)
        holder.itemView.setOnClickListener { onClick(item) }
    }

    override fun getItemCount(): Int = items.size

    fun submit(newItems: List<Item>) {
        items.clear()
        items.addAll(newItems)
        notifyDataSetChanged()
    }
}
