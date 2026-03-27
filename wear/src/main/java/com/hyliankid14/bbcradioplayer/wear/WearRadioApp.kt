package com.hyliankid14.bbcradioplayer.wear

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.Image
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.hyliankid14.bbcradioplayer.wear.data.EpisodeSummary
import com.hyliankid14.bbcradioplayer.wear.data.PodcastSummary
import com.hyliankid14.bbcradioplayer.wear.data.Station
import com.hyliankid14.bbcradioplayer.wear.data.StationArtwork
import com.hyliankid14.bbcradioplayer.wear.ui.Screen
import coil.compose.AsyncImage
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.ButtonDefaults
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.Icon
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import kotlinx.coroutines.delay

@Composable
fun WearRadioApp(viewModel: WearViewModel = viewModel()) {
    var screen by rememberSaveable { mutableStateOf(Screen.HOME) }
    var previousScreenBeforeNowPlaying by rememberSaveable { mutableStateOf(Screen.HOME) }
    var selectedPodcast by remember { mutableStateOf<PodcastSummary?>(null) }

    BackHandler(enabled = screen != Screen.HOME) {
        screen = when (screen) {
            Screen.EPISODES -> Screen.PODCASTS
            Screen.NOW_PLAYING -> previousScreenBeforeNowPlaying
            Screen.FAVOURITES, Screen.ALL_STATIONS -> Screen.STATIONS_MENU
            else -> Screen.HOME
        }
    }

    MaterialTheme {
        Scaffold(timeText = { if (screen != Screen.NOW_PLAYING) TimeText() }) {
            when (screen) {
                Screen.HOME -> HomeScreen(
                    onOpenStations = { screen = Screen.STATIONS_MENU },
                    onOpenPodcasts = { screen = Screen.PODCASTS }
                )

                Screen.STATIONS_MENU -> StationsMenuScreen(
                    onOpenFavourites = { screen = Screen.FAVOURITES },
                    onOpenAllStations = { screen = Screen.ALL_STATIONS }
                )

                Screen.FAVOURITES -> {
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
                    val allFavourites = remember(favouriteStations, remainingFavouriteStations) {
                        favouriteStations + remainingFavouriteStations
                    }
                    LaunchedEffect(allFavourites) {
                        viewModel.prefetchStationShows(allFavourites)
                    }
                    StationListScreen(
                        title = "Favourites",
                        stations = allFavourites,
                        stationShowTitleMap = viewModel.stationLiveTitleMap,
                        onRequestShow = { viewModel.prefetchStationShows(listOf(it), limit = 1) },
                        onPlay = {
                            viewModel.playStation(it, allFavourites)
                            previousScreenBeforeNowPlaying = Screen.FAVOURITES
                            screen = Screen.NOW_PLAYING
                        },
                        emptyText = "No favourites synced"
                    )
                }

                Screen.ALL_STATIONS -> {
                    LaunchedEffect(viewModel.stations) {
                        viewModel.prefetchStationShows(viewModel.stations, limit = 12)
                    }
                    StationListScreen(
                        title = "All Stations",
                        stations = viewModel.stations,
                        stationShowTitleMap = viewModel.stationLiveTitleMap,
                        onRequestShow = { viewModel.prefetchStationShows(listOf(it), limit = 1) },
                        onPlay = {
                            viewModel.playStation(it, viewModel.stations)
                            previousScreenBeforeNowPlaying = Screen.ALL_STATIONS
                            screen = Screen.NOW_PLAYING
                        },
                        emptyText = "No stations available"
                    )
                }

                Screen.PODCASTS -> {
                    val subscribedPodcasts by remember(viewModel.podcasts, viewModel.subscribedPodcastIds, viewModel.podcastUpdatedAtMap) {
                        derivedStateOf {
                            val known = viewModel.podcasts.filter { it.id in viewModel.subscribedPodcastIds }
                            val knownIds = known.map { it.id }.toSet()
                            val sortedKnown = known.sortedWith(
                                compareByDescending<PodcastSummary> { viewModel.podcastUpdatedAtMap[it.id] ?: 0L }
                                    .thenBy { it.title.lowercase() }
                            )
                            val unresolved = viewModel.subscribedPodcastIds
                                .filterNot { it in knownIds }
                                .sorted()
                                .map { id ->
                                    PodcastSummary(
                                        id = id,
                                        title = id,
                                        description = "",
                                        rssUrl = "",
                                        imageUrl = ""
                                    )
                                }
                            sortedKnown + unresolved
                        }
                    }
                    PodcastListScreen(
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
                }

                Screen.EPISODES -> EpisodeListScreen(
                    podcast = selectedPodcast,
                    episodes = viewModel.episodes,
                    playedEpisodeIds = viewModel.playedEpisodeIds,
                    progressMap = viewModel.episodeProgressMap,
                    loading = viewModel.loadingEpisodes,
                    onPlayEpisode = { episode ->
                        viewModel.playEpisode(episode, selectedPodcast?.imageUrl)
                        previousScreenBeforeNowPlaying = Screen.EPISODES
                        screen = Screen.NOW_PLAYING
                    }
                )

                Screen.NOW_PLAYING -> {
                    val np = viewModel.nowPlaying
                    NowPlayingScreen(
                        nowPlayingTitle = np?.title,
                        nowPlayingSubtitle = np?.subtitle,
                        artworkUrl = np?.artworkUrl,
                        stationId = np?.stationId,
                        isLive = np?.isLive ?: true,
                        isPlaying = np?.isPlaying ?: false,
                        skipPreviousEnabled = viewModel.canSkipPreviousInNowPlaying(),
                        skipNextEnabled = viewModel.canSkipNextInNowPlaying(),
                        positionMs = np?.positionMs ?: 0L,
                        durationMs = np?.durationMs ?: 0L,
                        onTogglePlayPause = { viewModel.togglePlayPause() },
                        onSkipPrevious = { viewModel.skipPreviousInNowPlaying() },
                        onSkipNext = { viewModel.skipNextInNowPlaying() },
                        onOpenVolumeUi = { viewModel.openVolumeControls() }
                    )
                }
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
                text = "British Radio Player",
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
    stationShowTitleMap: Map<String, String>,
    onRequestShow: (Station) -> Unit,
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
            items(stations, key = { it.id }) { station ->
                val showTitle = stationShowTitleMap[station.id]
                LaunchedEffect(station.id, showTitle) {
                    if (showTitle.isNullOrBlank()) {
                        onRequestShow(station)
                    }
                }
                val stationArtwork = remember(station.id) { StationArtwork.createBitmap(station.id, 96).asImageBitmap() }
                Chip(
                    onClick = { onPlay(station) },
                    label = { Text(station.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    secondaryLabel = {
                        Text(
                            showTitle ?: "On air now",
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    },
                    icon = {
                        Image(
                            bitmap = stationArtwork,
                            contentDescription = station.title,
                            modifier = Modifier
                                .size(28.dp)
                                .clip(CircleShape)
                        )
                    },
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
    var visibleCount by rememberSaveable { mutableStateOf(8) }
    val visiblePodcasts = podcasts.take(visibleCount.coerceAtMost(podcasts.size))

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

        items(visiblePodcasts, key = { it.id }) { podcast ->
            Chip(
                onClick = { onOpenPodcast(podcast) },
                label = { Text(podcast.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                modifier = Modifier.fillMaxWidth(),
                colors = ChipDefaults.primaryChipColors()
            )
        }

        if (visibleCount < podcasts.size) {
            item {
                Chip(
                    onClick = { visibleCount += 8 },
                    label = { Text("Load more") },
                    secondaryLabel = { Text("${podcasts.size - visibleCount} remaining") },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ChipDefaults.secondaryChipColors()
                )
            }
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
    var visibleCount by rememberSaveable(podcast?.id) { mutableStateOf(8) }
    val visibleEpisodes = episodes.take(visibleCount.coerceAtMost(episodes.size))

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
            items(visibleEpisodes, key = { it.id }) { episode ->
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

            if (visibleCount < episodes.size) {
                item {
                    Chip(
                        onClick = { visibleCount += 8 },
                        label = { Text("Load older") },
                        secondaryLabel = { Text("${episodes.size - visibleCount} remaining") },
                        modifier = Modifier.fillMaxWidth(),
                        colors = ChipDefaults.secondaryChipColors()
                    )
                }
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
    stationId: String?,
    isLive: Boolean,
    isPlaying: Boolean,
    skipPreviousEnabled: Boolean,
    skipNextEnabled: Boolean,
    positionMs: Long,
    durationMs: Long,
    onTogglePlayPause: () -> Unit,
    onSkipPrevious: () -> Unit,
    onSkipNext: () -> Unit,
    onOpenVolumeUi: () -> Unit
) {
    var overlayVisible by rememberSaveable { mutableStateOf(false) }
    val blankTapInteraction = remember { MutableInteractionSource() }

    LaunchedEffect(overlayVisible) {
        if (overlayVisible) {
            delay(3_000L)
            overlayVisible = false
        }
    }

    BackHandler(enabled = overlayVisible) {
        overlayVisible = false
    }

    Box(modifier = Modifier.fillMaxSize()) {
        if (!artworkUrl.isNullOrBlank()) {
            AsyncImage(
                model = artworkUrl,
                contentDescription = "Now playing artwork",
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize()
            )
        } else if (!stationId.isNullOrBlank()) {
            Image(
                bitmap = remember(stationId) { StationArtwork.createBitmap(stationId, 512).asImageBitmap() },
                contentDescription = "Station artwork",
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize()
            )
        }

        // Dark scrim for text and controls readability over artwork.
        Box(
            modifier = Modifier
                .fillMaxSize()
                .clickable(
                    interactionSource = blankTapInteraction,
                    indication = null
                ) {
                    overlayVisible = !overlayVisible
                }
                .background(Color.Black.copy(alpha = 0.68f))
        )

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 14.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp, androidx.compose.ui.Alignment.CenterVertically),
            horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally
        ) {
            val isMusicStyleTitle = isLive && nowPlayingTitle?.contains(" - ") == true
            val firstLine = when {
                isLive && isMusicStyleTitle -> nowPlayingSubtitle ?: nowPlayingTitle ?: "Live radio"
                isLive -> nowPlayingTitle ?: nowPlayingSubtitle ?: "Live radio"
                else -> nowPlayingSubtitle ?: "Podcast"
            }
            val secondLine = when {
                isLive && isMusicStyleTitle -> nowPlayingTitle.orEmpty()
                isLive -> nowPlayingSubtitle.orEmpty()
                else -> nowPlayingTitle.orEmpty()
            }

            Text(
                text = firstLine,
                style = MaterialTheme.typography.title3,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .fillMaxWidth()
            )

            if (secondLine.isNotBlank()) {
                Text(
                    text = secondLine,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .fillMaxWidth()
                )
            }

            if (!isLive) {
                val positionText = formatPosition(positionMs)
                val durationText = if (durationMs > 0L) formatPosition(durationMs) else "--:--"
                Text(
                    text = "$positionText / $durationText",
                    maxLines = 1,
                    textAlign = TextAlign.Center,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        }

        if (overlayVisible) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.22f))
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null
                    ) {
                        overlayVisible = false
                    },
                contentAlignment = androidx.compose.ui.Alignment.Center
            ) {
                Column(
                    modifier = Modifier.fillMaxWidth(0.78f),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Button(
                            onClick = onSkipPrevious,
                            enabled = if (isLive) skipPreviousEnabled else true,
                            modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.secondaryButtonColors()
                        ) {
                            Icon(
                                painter = painterResource(android.R.drawable.ic_media_previous),
                                contentDescription = "Previous"
                            )
                        }
                        Button(
                            onClick = onSkipNext,
                            enabled = if (isLive) skipNextEnabled else true,
                            modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.secondaryButtonColors()
                        ) {
                            Icon(
                                painter = painterResource(android.R.drawable.ic_media_next),
                                contentDescription = "Next"
                            )
                        }
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Button(
                            onClick = onOpenVolumeUi,
                            modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.secondaryButtonColors()
                        ) {
                            Icon(
                                painter = painterResource(android.R.drawable.ic_lock_silent_mode_off),
                                contentDescription = "Volume"
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
                    }
                }
            }
        }
    }
}
