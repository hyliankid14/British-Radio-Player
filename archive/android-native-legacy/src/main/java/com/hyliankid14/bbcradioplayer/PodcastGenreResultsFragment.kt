package com.hyliankid14.bbcradioplayer

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class PodcastGenreResultsFragment : Fragment() {

    private lateinit var repository: PodcastRepository
    private lateinit var adapter: PodcastAdapter

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        return inflater.inflate(R.layout.fragment_podcast_genre_results, container, false)
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        repository = PodcastRepository(requireContext())

        val genre = requireArguments().getString(ARG_GENRE).orEmpty()
        val toolbar = view.findViewById<com.google.android.material.appbar.MaterialToolbar>(R.id.genre_results_toolbar)
        val recycler = view.findViewById<RecyclerView>(R.id.genre_results_recycler)
        val empty = view.findViewById<TextView>(R.id.genre_results_empty)

        toolbar.title = genre
        toolbar.setNavigationOnClickListener {
            requireActivity().onBackPressedDispatcher.onBackPressed()
        }

        recycler.layoutManager = LinearLayoutManager(requireContext())
        adapter = PodcastAdapter(
            context = requireContext(),
            onPodcastClick = { podcast -> openPodcastDetail(podcast) }
        )
        recycler.adapter = adapter

        viewLifecycleOwner.lifecycleScope.launch {
            val all = withContext(Dispatchers.IO) { repository.fetchPodcasts(false) }
            val filtered = all.filter { pod ->
                pod.genres.any { it.equals(genre, ignoreCase = true) }
            }.sortedBy { it.title.lowercase() }
            adapter.updatePodcasts(filtered)
            val hasItems = filtered.isNotEmpty()
            recycler.visibility = if (hasItems) View.VISIBLE else View.GONE
            empty.visibility = if (hasItems) View.GONE else View.VISIBLE
        }
    }

    private fun openPodcastDetail(podcast: Podcast) {
        (activity as? androidx.appcompat.app.AppCompatActivity)?.supportActionBar?.show()
        val detailFragment = PodcastDetailFragment().apply {
            arguments = Bundle().apply { putParcelable("podcast", podcast) }
        }
        parentFragmentManager.beginTransaction().apply {
            setReorderingAllowed(true)
            add(R.id.fragment_container, detailFragment, "podcast_detail")
            hide(this@PodcastGenreResultsFragment)
            addToBackStack("podcast_detail")
            commit()
        }
    }

    companion object {
        private const val ARG_GENRE = "genre"

        fun newInstance(genre: String): PodcastGenreResultsFragment {
            return PodcastGenreResultsFragment().apply {
                arguments = Bundle().apply {
                    putString(ARG_GENRE, genre)
                }
            }
        }
    }
}
