package com.hyliankid14.bbcradioplayer

import android.os.Bundle
import android.view.KeyEvent
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.core.widget.addTextChangedListener
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class PodcastSearchFragment : Fragment() {

    private lateinit var history: SearchHistory
    private lateinit var recentAdapter: RecentSearchAdapter
    private lateinit var suggestionsAdapter: SuggestionsAdapter
    private lateinit var remoteIndexClient: RemoteIndexClient
    private var suggestionsJob: Job? = null

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        return inflater.inflate(R.layout.fragment_podcast_search, container, false)
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        history = SearchHistory(requireContext())
        remoteIndexClient = RemoteIndexClient(requireContext())

        val toolbar = view.findViewById<com.google.android.material.appbar.MaterialToolbar>(R.id.podcast_search_toolbar)
        val searchInput = view.findViewById<com.google.android.material.textfield.TextInputEditText>(R.id.podcast_search_input)
        val recentRecycler = view.findViewById<RecyclerView>(R.id.recent_searches_recycler)
        val suggestionsRecycler = view.findViewById<RecyclerView>(R.id.suggestions_recycler)

        toolbar.setNavigationOnClickListener {
            requireActivity().onBackPressedDispatcher.onBackPressed()
        }

        recentRecycler.layoutManager = LinearLayoutManager(requireContext())
        recentAdapter = RecentSearchAdapter(
            items = mutableListOf(),
            onQueryClick = { query ->
                searchInput.setText(query)
                searchInput.setSelection(query.length)
                openResults(query)
            },
            onEditSave = { query ->
                showSaveSearchDialog(query)
                reloadRecent()
            },
            onDelete = { query ->
                history.remove(query)
                reloadRecent()
            }
        )
        recentRecycler.adapter = recentAdapter

        suggestionsRecycler.layoutManager = LinearLayoutManager(requireContext())
        suggestionsAdapter = SuggestionsAdapter(
            items = mutableListOf(),
            onSuggestionClick = { suggestion ->
                searchInput.setText(suggestion)
                searchInput.setSelection(suggestion.length)
                openResults(suggestion)
            }
        )
        suggestionsRecycler.adapter = suggestionsAdapter

        val initialQuery = requireArguments().getString(ARG_INITIAL_QUERY).orEmpty()
        searchInput.setText(initialQuery)
        if (initialQuery.isNotEmpty()) {
            searchInput.setSelection(initialQuery.length)
        }

        searchInput.addTextChangedListener { text ->
            val query = text?.toString()?.trim().orEmpty()
            if (query.length < 2) {
                suggestionsRecycler.visibility = View.GONE
                suggestionsJob?.cancel()
                return@addTextChangedListener
            }

            suggestionsJob?.cancel()
            suggestionsJob = viewLifecycleOwner.lifecycleScope.launch {
                delay(300)
                val suggestions = withContext(Dispatchers.IO) {
                    remoteIndexClient.searchSuggestions(query)
                }
                if (suggestions.isNotEmpty()) {
                    suggestionsAdapter.submit(suggestions)
                    suggestionsRecycler.visibility = View.VISIBLE
                } else {
                    suggestionsRecycler.visibility = View.GONE
                }
            }
        }

        searchInput.setOnEditorActionListener { _, actionId, event ->
            val isSearchKey = actionId == android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH ||
                actionId == android.view.inputmethod.EditorInfo.IME_ACTION_DONE ||
                (event?.keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_DOWN)
            if (!isSearchKey) return@setOnEditorActionListener false
            val query = searchInput.text?.toString().orEmpty().trim()
            openResults(query)
            true
        }

        reloadRecent()
    }

    private fun reloadRecent() {
        recentAdapter.submit(history.getRecent())
    }

    private fun openResults(queryRaw: String) {
        val query = queryRaw.trim()
        if (query.isBlank()) return
        history.add(query)
        reloadRecent()

        val resultsFragment = PodcastsFragment.newSearchResultsInstance(query)
        parentFragmentManager.beginTransaction().apply {
            setReorderingAllowed(true)
            replace(R.id.fragment_container, resultsFragment, "podcast_search_results")
            addToBackStack("podcast_search_results")
            commit()
        }
    }

    private fun showSaveSearchDialog(queryRaw: String) {
        val query = queryRaw.trim()
        if (query.isBlank()) return

        val existing = SavedSearchesPreference.getSavedSearches(requireContext())
            .firstOrNull { it.query.equals(query, ignoreCase = true) }

        val dialogView = layoutInflater.inflate(R.layout.dialog_saved_search, null)
        val nameInput = dialogView.findViewById<com.google.android.material.textfield.TextInputEditText>(R.id.saved_search_name_input)
        val queryInput = dialogView.findViewById<com.google.android.material.textfield.TextInputEditText>(R.id.saved_search_query_input)
        val queryInfo = dialogView.findViewById<View>(R.id.saved_search_query_info)
        val notifySwitch = dialogView.findViewById<com.google.android.material.switchmaterial.SwitchMaterial>(R.id.saved_search_notify_switch)

        nameInput.setText(existing?.name ?: query)
        nameInput.setSelection(nameInput.text?.length ?: 0)
        queryInput.setText(query)
        queryInput.setSelection(query.length)
        notifySwitch.isChecked = existing?.notificationsEnabled ?: false
        queryInfo.setOnClickListener { showSearchOperatorInfo() }

        androidx.appcompat.app.AlertDialog.Builder(requireContext())
            .setTitle(if (existing != null) "Update Saved Search" else "Save Search")
            .setView(dialogView)
            .setPositiveButton("Save") { _, _ ->
                val finalName = nameInput.text?.toString()?.trim().orEmpty().ifBlank { query }
                val finalQuery = queryInput.text?.toString()?.trim().orEmpty().ifBlank { query }
                val saved = SavedSearchesPreference.SavedSearch(
                    id = existing?.id ?: java.util.UUID.randomUUID().toString(),
                    name = finalName,
                    query = finalQuery,
                    genres = emptyList(),
                    minDuration = 0,
                    maxDuration = Int.MAX_VALUE,
                    sort = "Most recently updated",
                    notificationsEnabled = notifySwitch.isChecked,
                    lastSeenEpisodeIds = existing?.lastSeenEpisodeIds ?: emptyList(),
                    createdAt = existing?.createdAt ?: System.currentTimeMillis(),
                    lastMatchEpoch = existing?.lastMatchEpoch ?: 0L
                )
                SavedSearchesPreference.saveSearch(requireContext(), saved)
                Toast.makeText(requireContext(), "Search saved", Toast.LENGTH_SHORT).show()
                reloadRecent()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun showSearchOperatorInfo() {
        val message = "Operators:\n" +
            "- AND: both terms must appear\n" +
            "- OR: either term can appear\n" +
            "- Minus (-): exclude a term\n" +
            "- NEAR/x: terms within x words (e.g. NEAR/10)\n" +
            "- \"phrase\": exact phrase match\n" +
            "- *: prefix wildcard (e.g. child*)\n\n" +
            "Examples:\n" +
            "climate AND politics\n" +
            "sports OR news\n" +
            "climate -politics\n" +
            "climate NEAR/5 change\n" +
            "\"bbc news\"\n" +
            "child*"
        androidx.appcompat.app.AlertDialog.Builder(requireContext())
            .setTitle("Search operators")
            .setMessage(message)
            .setPositiveButton("OK", null)
            .show()
    }

    class RecentSearchAdapter(
        private val items: MutableList<String>,
        private val onQueryClick: (String) -> Unit,
        private val onEditSave: (String) -> Unit,
        private val onDelete: (String) -> Unit
    ) : RecyclerView.Adapter<RecentSearchAdapter.RecentViewHolder>() {

        class RecentViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
            val queryText: TextView = itemView.findViewById(R.id.recent_search_text)
            val saveIcon: ImageView = itemView.findViewById(R.id.recent_search_save_icon)
            val saveButton: View = itemView.findViewById(R.id.recent_search_save)
            val deleteButton: View = itemView.findViewById(R.id.recent_search_delete)
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecentViewHolder {
            val view = LayoutInflater.from(parent.context)
                .inflate(R.layout.item_recent_search_action, parent, false)
            return RecentViewHolder(view)
        }

        override fun onBindViewHolder(holder: RecentViewHolder, position: Int) {
            val query = items[position]
            holder.queryText.text = query
            holder.saveIcon.setImageResource(R.drawable.ic_edit)
            holder.itemView.setOnClickListener { onQueryClick(query) }
            holder.saveButton.setOnClickListener { onEditSave(query) }
            holder.deleteButton.setOnClickListener { onDelete(query) }
        }

        override fun getItemCount(): Int = items.size

        fun submit(newItems: List<String>) {
            items.clear()
            items.addAll(newItems)
            notifyDataSetChanged()
        }
    }

    class SuggestionsAdapter(
        private val items: MutableList<String>,
        private val onSuggestionClick: (String) -> Unit
    ) : RecyclerView.Adapter<SuggestionsAdapter.SuggestionViewHolder>() {

        class SuggestionViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
            val suggestionText: TextView = itemView.findViewById(R.id.suggestion_text)
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): SuggestionViewHolder {
            val view = LayoutInflater.from(parent.context)
                .inflate(R.layout.item_search_suggestion, parent, false)
            return SuggestionViewHolder(view)
        }

        override fun onBindViewHolder(holder: SuggestionViewHolder, position: Int) {
            val suggestion = items[position]
            holder.suggestionText.text = suggestion
            holder.itemView.setOnClickListener { onSuggestionClick(suggestion) }
        }

        override fun getItemCount(): Int = items.size

        fun submit(newItems: List<String>) {
            items.clear()
            items.addAll(newItems)
            notifyDataSetChanged()
        }
    }

    companion object {
        private const val ARG_INITIAL_QUERY = "initial_query"

        fun newInstance(initialQuery: String): PodcastSearchFragment {
            return PodcastSearchFragment().apply {
                arguments = Bundle().apply {
                    putString(ARG_INITIAL_QUERY, initialQuery)
                }
            }
        }
    }
}
