package com.hyliankid14.bbcradioplayer.wear

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.hyliankid14.bbcradioplayer.wear.data.EpisodeSummary
import com.hyliankid14.bbcradioplayer.wear.data.PodcastSummary
import com.hyliankid14.bbcradioplayer.wear.data.Station
import com.hyliankid14.bbcradioplayer.wear.ui.Screen
import coil.compose.AsyncImage
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.ButtonDefaults
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.Icon
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.ScalingLazyColumn
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import androidx.wear.compose.material.items

@Composable
fun WearRadioApp(viewModel: WearViewModel = viewModel()) {
    var screen by rememberSaveable { mutableStateOf(Screen.HOME) }
    var selectedPodcast by remember { mutableStateOf<PodcastSummary?>(null) }

    val stationsById = remember(viewModel.stations) {
        viewModel.stations.associateBy { it.id }
    }

    val favouriteStations by remember(viewModel.favouriteOrder, viewModel.favouriteIds, stationsById) {
        derivedStateOf {
            viewModel.favouriteOrder.mapNotNull { favouriteId ->
                stationsById[favouriteId]?.takeIf { it.id in viewModel.favouriteIds }
            }
        }
    }

    val remainingFavouriteStations by remember(viewModel.stations, viewModel.favouriteIds, viewModel.favouriteOrder) {
        derivedStateOf {
            viewModel.stations.filter { station ->
                station.id in viewModel.favouriteIds && station.id !in viewModel.favouriteOrder
            }
        }
    }

    val subscribedPodcasts by remember(viewModel.podcasts, viewModel.subscribedPodcastIds) {
        derivedStateOf {
            val known = viewModel.podcasts.filter { it.id in viewModel.subscribedPodcastIds }
            val knownIds = known.map { it.id }.toSet()
            val unresolved = viewModel.subscribedPodcastIds
                .filterNot { it in knownIds }
                .map { id ->
                    PodcastSummary(
                        id = id,
                        title = id,
                        description = "",
                        rssUrl = "",
                        imageUrl = ""
                    )
                }
            known + unresolved
        }
    }

    BackHandler(enabled = screen != Screen.HOME) {
        screen = when (screen) {
            Screen.EPISODES -> Screen.PODCASTS
            Screen.NOW_PLAYING -> Screen.HOME
            Screen.FAVOURITES, Screen.ALL_STATIONS -> Screen.STATIONS_MENU
            else -> Screen.HOME
        }
    }

    MaterialTheme {
        Scaffold(timeText = { TimeText() }) {
            when (screen) {
                Screen.HOME -> HomeScreen(
                    onOpenStations = { screen = Screen.STATIONS_MENU },
                    onOpenPodcasts = { screen = Screen.PODCASTS }
                )

                Screen.STATIONS_MENU -> StationsMenuScreen(
                    onOpenFavourites = { screen = Screen.FAVOURITES },
                    onOpenAllStations = { screen = Screen.ALL_STATIONS }
                )

                Screen.FAVOURITES -> StationListScreen(
                    title = "Favourites",
                    stations = favouriteStations + remainingFavouriteStations,
                    favouriteIds = viewModel.favouriteIds,
                    onPlay = {
                        viewModel.playStation(it)
                        screen = Screen.NOW_PLAYING
                    },
                    emptyText = "No favourites synced"
                )

                Screen.ALL_STATIONS -> StationListScreen(
                    title = "All Stations",
                    stations = viewModel.stations,
                    favouriteIds = viewModel.favouriteIds,
                    onPlay = {
                        viewModel.playStation(it)
                        screen = Screen.NOW_PLAYING
                    },
                    emptyText = "No stations available"
                )

                Screen.PODCASTS -> PodcastListScreen(
                    title = "Subscribed Podcasts",
                    podcasts = subscribedPodcasts,
                    loading = viewModel.loadingPodcasts,
                    errorMessage = viewModel.errorMessage,
                    onRetry = { viewModel.refreshPodcasts() },
                    onOpenPodcast = { podcast ->
                        selectedPodcast = podcast
                        viewModel.openPodcast(podcast)
                        screen = Screen.EPISODES
                    }
                )

                Screen.EPISODES -> EpisodeListScreen(
                    podcast = selectedPodcast,
                    episodes = viewModel.episodes,
                    playedEpisodeIds = viewModel.playedEpisodeIds,
                    progressMap = viewModel.episodeProgressMap,
                    loading = viewModel.loadingEpisodes,
                    onPlayEpisode = { episode ->
                        viewModel.playEpisode(episode, selectedPodcast?.imageUrl)
                        screen = Screen.NOW_PLAYING
                    }
                )

                Screen.NOW_PLAYING -> NowPlayingScreen(
                    nowPlayingTitle = viewModel.nowPlaying?.title,
                    nowPlayingSubtitle = viewModel.nowPlaying?.subtitle,
                    artworkUrl = viewModel.nowPlaying?.artworkUrl,
                    isLive = viewModel.nowPlaying?.isLive ?: true,
                    isPlaying = viewModel.nowPlaying?.isPlaying ?: false,
                    positionMs = viewModel.nowPlaying?.positionMs ?: 0L,
                    durationMs = viewModel.nowPlaying?.durationMs ?: 0L,
                    onTogglePlayPause = { viewModel.togglePlayPause() },
                    onSkipPrevious = { viewModel.seekBack() },
                    onSkipNext = { viewModel.seekForward() },
                    onStop = { viewModel.stopPlayback() }
                )
            }
        }
    }
}

@Composable
private fun HomeScreen(
    onOpenStations: () -> Unit,
    onOpenPodcasts: () -> Unit
) {
    ScalingLazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        item {
            Text(
                text = "BBC Radio Player",
                style = MaterialTheme.typography.title3,
                modifier = Modifier.padding(horizontal = 6.dp)
            )
        }
        item {
            Chip(
                onClick = onOpenStations,
                label = { Text("Stations") },
                secondaryLabel = { Text("Favourites and all") },
                colors = ChipDefaults.primaryChipColors(),
                modifier = Modifier.fillMaxWidth()
            )
        }
        item {
            Chip(
                onClick = onOpenPodcasts,
                label = { Text("Podcasts") },
                secondaryLabel = { Text("Subscribed shows") },
                colors = ChipDefaults.primaryChipColors(),
                modifier = Modifier.fillMaxWidth()
            )
        }
    }
}

@Composable
private fun StationsMenuScreen(
    onOpenFavourites: () -> Unit,
    onOpenAllStations: () -> Unit
) {
    ScalingLazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        item {
            Text(
                text = "Stations",
                style = MaterialTheme.typography.title3,
                modifier = Modifier.padding(horizontal = 6.dp)
            )
        }
        item {
            Chip(
                onClick = onOpenFavourites,
                label = { Text("Favourites") },
                secondaryLabel = { Text("Synced from phone") },
                colors = ChipDefaults.primaryChipColors(),
                modifier = Modifier.fillMaxWidth()
            )
        }
        item {
            Chip(
                onClick = onOpenAllStations,
                label = { Text("All Stations") },
                secondaryLabel = { Text("Live radio") },
                colors = ChipDefaults.secondaryChipColors(),
                modifier = Modifier.fillMaxWidth()
            )
        }
    }
}

@Composable
private fun StationListScreen(
    title: String,
    stations: List<Station>,
    favouriteIds: Set<String>,
    onPlay: (Station) -> Unit,
    emptyText: String
) {
    ScalingLazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        item {
            Text(text = title, style = MaterialTheme.typography.title3, modifier = Modifier.padding(horizontal = 6.dp))
        }
        if (stations.isEmpty()) {
            item { Text(emptyText, modifier = Modifier.padding(horizontal = 6.dp)) }
        } else {
            items(stations) { station ->
                val isFavourite = station.id in favouriteIds
                Chip(
                    onClick = { onPlay(station) },
                    label = { Text(station.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    secondaryLabel = { Text(if (isFavourite) "\u2605 Saved" else "Live") },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ChipDefaults.primaryChipColors()
                )
            }
        }
    }
}

@Composable
private fun PodcastListScreen(
    title: String,
    podcasts: List<PodcastSummary>,
    loading: Boolean,
    errorMessage: String?,
    onRetry: () -> Unit,
    onOpenPodcast: (PodcastSummary) -> Unit
) {
    ScalingLazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        item { Text(title, style = MaterialTheme.typography.title3, modifier = Modifier.padding(horizontal = 6.dp)) }

        if (loading) {
            item { Text("Loading…", modifier = Modifier.padding(horizontal = 6.dp)) }
        }

        if (!loading && errorMessage != null) {
            item { Text(errorMessage, modifier = Modifier.padding(horizontal = 6.dp)) }
            item {
                Chip(
                    onClick = onRetry,
                    label = { Text("Retry") },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ChipDefaults.secondaryChipColors()
                )
            }
        }

        if (!loading && errorMessage == null && podcasts.isEmpty()) {
            item { Text("No podcasts available", modifier = Modifier.padding(horizontal = 6.dp)) }
        }

        items(podcasts) { podcast ->
            Chip(
                onClick = { onOpenPodcast(podcast) },
                label = {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (podcast.imageUrl.isNotBlank()) {
                            AsyncImage(
                                model = podcast.imageUrl,
                                contentDescription = podcast.title,
                                modifier = Modifier
                                    .size(28.dp)
                                    .clip(CircleShape),
                                contentScale = ContentScale.Crop
                            )
                        } else {
                            Spacer(
                                modifier = Modifier
                                    .size(28.dp)
                                    .clip(CircleShape)
                                    .background(MaterialTheme.colors.onBackground.copy(alpha = 0.18f))
                            )
                        }
                        Text(podcast.title, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                },
                secondaryLabel = {
                    if (podcast.description.isNotBlank()) {
                        Text(podcast.description, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    } else {
                        Text("Open episodes")
                    }
                },
                modifier = Modifier.fillMaxWidth(),
                colors = ChipDefaults.primaryChipColors()
            )
        }
    }
}

@Composable
private fun EpisodeListScreen(
    podcast: PodcastSummary?,
    episodes: List<EpisodeSummary>,
    playedEpisodeIds: Set<String>,
    progressMap: Map<String, Long>,
    loading: Boolean,
    onPlayEpisode: (EpisodeSummary) -> Unit
) {
    ScalingLazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        item {
            Text(
                text = podcast?.title ?: "Episodes",
                style = MaterialTheme.typography.title3,
                modifier = Modifier.padding(horizontal = 6.dp),
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
        }

        if (loading) {
            item { Text("Loading…", modifier = Modifier.padding(horizontal = 6.dp)) }
        } else if (episodes.isEmpty()) {
            item { Text("No episodes available", modifier = Modifier.padding(horizontal = 6.dp)) }
        } else {
            items(episodes) { episode ->
                val isPlayed = episode.id in playedEpisodeIds
                val progressMs = progressMap[episode.id] ?: 0L
                Chip(
                    onClick = { onPlayEpisode(episode) },
                    label = { Text(episode.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    secondaryLabel = {
                        val secondary = when {
                            isPlayed -> "Played"
                            progressMs > 0L -> "Resume at ${formatPosition(progressMs)}"
                            episode.pubDate.isNotBlank() -> episode.pubDate
                            else -> "Play episode"
                        }
                        Text(text = secondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ChipDefaults.primaryChipColors()
                )
            }
        }
    }
}

private fun formatPosition(positionMs: Long): String {
    val totalSeconds = (positionMs / 1000L).coerceAtLeast(0L)
    val minutes = totalSeconds / 60L
    val seconds = totalSeconds % 60L
    return String.format("%d:%02d", minutes, seconds)
}

@Composable
private fun NowPlayingScreen(
    nowPlayingTitle: String?,
    nowPlayingSubtitle: String?,
    artworkUrl: String?,
    isLive: Boolean,
    isPlaying: Boolean,
    positionMs: Long,
    durationMs: Long,
    onTogglePlayPause: () -> Unit,
    onSkipPrevious: () -> Unit,
    onSkipNext: () -> Unit,
    onStop: () -> Unit
) {
    Box(modifier = Modifier.fillMaxSize()) {
        if (!artworkUrl.isNullOrBlank()) {
            AsyncImage(
                model = artworkUrl,
                contentDescription = "Now playing artwork",
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize()
            )
        }

        // Dark scrim for text and controls readability over artwork.
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.55f))
        )

        ScalingLazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        item {
            Text(
                text = nowPlayingTitle ?: "Nothing playing",
                style = MaterialTheme.typography.title3,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
        }

        if (!nowPlayingSubtitle.isNullOrBlank()) {
            item {
                Text(
                    text = nowPlayingSubtitle,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }

        item {
            val playbackMeta = if (isLive) {
                if (isPlaying) "Live now" else "Live paused"
            } else {
                val positionText = formatPosition(positionMs)
                val durationText = if (durationMs > 0L) formatPosition(durationMs) else "--:--"
                "$positionText / $durationText"
            }
            Text(
                text = playbackMeta,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }

        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Button(
                    onClick = onSkipPrevious,
                    enabled = !isLive,
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.secondaryButtonColors()
                ) {
                    Icon(
                        painter = painterResource(android.R.drawable.ic_media_previous),
                        contentDescription = "Skip previous"
                    )
                }
                Button(
                    onClick = onTogglePlayPause,
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.primaryButtonColors()
                ) {
                    Icon(
                        painter = painterResource(if (isPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play),
                        contentDescription = if (isPlaying) "Pause" else "Play"
                    )
                }
                Button(
                    onClick = onSkipNext,
                    enabled = !isLive,
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.secondaryButtonColors()
                ) {
                    Icon(
                        painter = painterResource(android.R.drawable.ic_media_next),
                        contentDescription = "Skip next"
                    )
                }
            }
        }

        item {
            Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                Button(
                    onClick = onStop,
                    colors = ButtonDefaults.secondaryButtonColors()
                ) {
                    Icon(
                        painter = painterResource(android.R.drawable.ic_menu_close_clear_cancel),
                        contentDescription = "Stop"
                    )
                }
            }
        }
    }
    }
}
