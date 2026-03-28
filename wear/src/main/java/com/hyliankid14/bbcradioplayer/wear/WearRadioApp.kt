package com.hyliankid14.bbcradioplayer.wear

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.SkipNext
import androidx.compose.material.icons.outlined.SkipPrevious
import androidx.compose.material.icons.automirrored.outlined.VolumeUp
import com.hyliankid14.bbcradioplayer.wear.data.EpisodeSummary
import com.hyliankid14.bbcradioplayer.wear.data.PodcastSummary
import com.hyliankid14.bbcradioplayer.wear.data.Station
import com.hyliankid14.bbcradioplayer.wear.data.StationCategory
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
            Screen.FAVOURITES,
            Screen.STATIONS_NATIONAL,
            Screen.STATIONS_REGIONS,
            Screen.STATIONS_LOCAL -> Screen.STATIONS_MENU
            else -> Screen.HOME
        }
    }

    val nationalStations = remember(viewModel.stations) {
        viewModel.stations.filter { it.category == StationCategory.NATIONAL }
    }
    val regionalStations = remember(viewModel.stations) {
        viewModel.stations.filter { it.category == StationCategory.REGIONS }
    }
    val localStations = remember(viewModel.stations) {
        viewModel.stations.filter { it.category == StationCategory.LOCAL }
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
                    onOpenNationalStations = { screen = Screen.STATIONS_NATIONAL },
                    onOpenRegionalStations = { screen = Screen.STATIONS_REGIONS },
                    onOpenLocalStations = { screen = Screen.STATIONS_LOCAL }
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
                        onPlay = {
                            viewModel.playStation(it, allFavourites)
                            previousScreenBeforeNowPlaying = Screen.FAVOURITES
                            screen = Screen.NOW_PLAYING
                        },
                        emptyText = "No favourites synced"
                    )
                }

                Screen.STATIONS_NATIONAL -> {
                    LaunchedEffect(nationalStations) {
                        viewModel.prefetchStationShows(nationalStations, limit = 8)
                    }
                    StationListScreen(
                        title = "National",
                        stations = nationalStations,
                        stationShowTitleMap = viewModel.stationLiveTitleMap,
                        onPlay = {
                            viewModel.playStation(it, nationalStations)
                            previousScreenBeforeNowPlaying = Screen.STATIONS_NATIONAL
                            screen = Screen.NOW_PLAYING
                        },
                        emptyText = "No stations available"
                    )
                }

                Screen.STATIONS_REGIONS -> {
                    LaunchedEffect(regionalStations) {
                        viewModel.prefetchStationShows(regionalStations, limit = 8)
                    }
                    StationListScreen(
                        title = "Regions",
                        stations = regionalStations,
                        stationShowTitleMap = viewModel.stationLiveTitleMap,
                        onPlay = {
                            viewModel.playStation(it, regionalStations)
                            previousScreenBeforeNowPlaying = Screen.STATIONS_REGIONS
                            screen = Screen.NOW_PLAYING
                        },
                        emptyText = "No stations available"
                    )
                }

                Screen.STATIONS_LOCAL -> {
                    LaunchedEffect(localStations) {
                        viewModel.prefetchStationShows(localStations, limit = 8)
                    }
                    StationListScreen(
                        title = "Local",
                        stations = localStations,
                        stationShowTitleMap = viewModel.stationLiveTitleMap,
                        onPlay = {
                            viewModel.playStation(it, localStations)
                            previousScreenBeforeNowPlaying = Screen.STATIONS_LOCAL
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
                                .filterNot(::looksLikeNumericSyntheticId)
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

private val ListContentPadding = PaddingValues(start = 14.dp, end = 14.dp, top = 20.dp, bottom = 14.dp)
private val HeaderHorizontalSafePadding = 24.dp

@Composable
private fun HomeScreen(
    onOpenStations: () -> Unit,
    onOpenPodcasts: () -> Unit
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = ListContentPadding,
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        item { RoundSafeHeaderTitle("British Radio Player", maxLines = 2) }
        item {
            Chip(
                onClick = onOpenStations,
                label = { Text("Stations") },
                secondaryLabel = { Text("Favourites and All Stations") },
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
    onOpenNationalStations: () -> Unit,
    onOpenRegionalStations: () -> Unit,
    onOpenLocalStations: () -> Unit
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = ListContentPadding,
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        item { RoundSafeHeaderTitle("Stations", maxLines = 2) }
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
                onClick = onOpenNationalStations,
                label = { Text("National") },
                secondaryLabel = { Text("UK-wide stations") },
                colors = ChipDefaults.secondaryChipColors(),
                modifier = Modifier.fillMaxWidth()
            )
        }
        item {
            Chip(
                onClick = onOpenRegionalStations,
                label = { Text("Regions") },
                secondaryLabel = { Text("Nations and regions") },
                colors = ChipDefaults.secondaryChipColors(),
                modifier = Modifier.fillMaxWidth()
            )
        }
        item {
            Chip(
                onClick = onOpenLocalStations,
                label = { Text("Local") },
                secondaryLabel = { Text("Local BBC stations") },
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
    onPlay: (Station) -> Unit,
    emptyText: String
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = ListContentPadding,
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        item { RoundSafeHeaderTitle(title, maxLines = 2) }
        if (stations.isEmpty()) {
            item {
                RoundSafeHeaderMessage(emptyText, maxLines = 2)
            }
        } else {
            items(stations, key = { it.id }) { station ->
                val showTitle = stationShowTitleMap[station.id]
                val stationArtwork = remember(station.id) { StationArtwork.createBitmap(station.id, 72).asImageBitmap() }
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

private fun looksLikeNumericSyntheticId(id: String): Boolean {
    val trimmed = id.trim()
    return Regex("^-?\\d{6,}$").matches(trimmed)
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

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = ListContentPadding,
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        item { RoundSafeHeaderTitle(title, maxLines = 2) }

        if (loading) {
            item { RoundSafeHeaderMessage("Loading…", maxLines = 1) }
        }

        if (!loading && errorMessage != null) {
            item { RoundSafeHeaderMessage(errorMessage, maxLines = 2) }
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
            item { RoundSafeHeaderMessage("No podcasts available", maxLines = 1) }
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

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = ListContentPadding,
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        item {
            RoundSafeHeaderTitle(podcast?.title ?: "Episodes", maxLines = 2)
        }

        if (loading) {
            item { RoundSafeHeaderMessage("Loading…", maxLines = 1) }
        } else if (episodes.isEmpty()) {
            item { RoundSafeHeaderMessage("No episodes available", maxLines = 1) }
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

@Composable
private fun RoundSafeHeaderTitle(text: String, maxLines: Int = 2) {
    Box(
        modifier = Modifier.fillMaxWidth(),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.title3,
            textAlign = TextAlign.Center,
            maxLines = maxLines,
            overflow = TextOverflow.Clip,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = HeaderHorizontalSafePadding)
        )
    }
}

@Composable
private fun RoundSafeHeaderMessage(text: String, maxLines: Int) {
    Box(
        modifier = Modifier.fillMaxWidth(),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = text,
            textAlign = TextAlign.Center,
            maxLines = maxLines,
            overflow = TextOverflow.Clip,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = HeaderHorizontalSafePadding)
        )
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
                                imageVector = Icons.Outlined.SkipPrevious,
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
                                imageVector = Icons.Outlined.SkipNext,
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
                                imageVector = Icons.AutoMirrored.Outlined.VolumeUp,
                                contentDescription = "Volume"
                            )
                        }
                        Button(
                            onClick = onTogglePlayPause,
                            modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.primaryButtonColors()
                        ) {
                            Icon(
                                imageVector = if (isPlaying) Icons.Outlined.Pause else Icons.Outlined.PlayArrow,
                                contentDescription = if (isPlaying) "Pause" else "Play"
                            )
                        }
                    }
                }
            }
        }
    }
}
