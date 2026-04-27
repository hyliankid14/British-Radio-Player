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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalConfiguration
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
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.MusicNote
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.SkipNext
import androidx.compose.material.icons.outlined.SkipPrevious
import androidx.compose.material.icons.automirrored.outlined.VolumeUp
import com.hyliankid14.bbcradioplayer.wear.data.EpisodeSummary
import com.hyliankid14.bbcradioplayer.wear.data.PodcastSummary
import com.hyliankid14.bbcradioplayer.wear.data.Station
import com.hyliankid14.bbcradioplayer.wear.data.StationCategory
import com.hyliankid14.bbcradioplayer.wear.data.StationArtwork
import com.hyliankid14.bbcradioplayer.wear.ui.Screen
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import androidx.wear.compose.foundation.AnchorType
import androidx.wear.compose.foundation.CurvedAlignment
import androidx.wear.compose.foundation.CurvedDirection
import androidx.wear.compose.foundation.CurvedLayout
import androidx.wear.compose.foundation.CurvedModifier
import androidx.wear.compose.foundation.CurvedTextStyle
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.ScalingLazyColumnDefaults
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.foundation.angularGradientBackground as curvedAngularGradientBackground
import androidx.wear.compose.foundation.background as curvedBackground
import androidx.wear.compose.foundation.basicCurvedText
import androidx.wear.compose.foundation.padding as curvedPadding
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.ButtonDefaults
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.Icon
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.PositionIndicator
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import coil.request.ImageRequest
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
    val batteryPercent = rememberBatteryPercent()
    val nowPlayingState = viewModel.nowPlaying

    MaterialTheme {
        Box(modifier = Modifier.fillMaxSize()) {
            Scaffold(timeText = {
                if (screen != Screen.NOW_PLAYING) {
                    TopCurvedTimeBackdrop()
                }
                TimeText(
                    endLinearContent = {
                        Text("$batteryPercent%", color = Color.White)
                    },
                    endCurvedContent = {
                        basicCurvedText(
                            text = "$batteryPercent%",
                            style = CurvedTextStyle(color = Color.White)
                        )
                    }
                )
            }) {
                Box(modifier = Modifier.fillMaxSize()) {
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
                            while (true) {
                                viewModel.prefetchStationShows(allFavourites, limit = 8)
                                delay(STATION_SHOW_REFRESH_POLL_MS)
                            }
                        }
                        StationListScreen(
                            stations = allFavourites,
                            stationShowTitleMap = viewModel.stationLiveTitleMap,
                            stationShowDetailMap = viewModel.stationLiveDetailMap,
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
                            while (true) {
                                viewModel.prefetchStationShows(nationalStations, limit = 8)
                                delay(STATION_SHOW_REFRESH_POLL_MS)
                            }
                        }
                        StationListScreen(
                            stations = nationalStations,
                            stationShowTitleMap = viewModel.stationLiveTitleMap,
                            stationShowDetailMap = viewModel.stationLiveDetailMap,
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
                            while (true) {
                                viewModel.prefetchStationShows(regionalStations, limit = 8)
                                delay(STATION_SHOW_REFRESH_POLL_MS)
                            }
                        }
                        StationListScreen(
                            stations = regionalStations,
                            stationShowTitleMap = viewModel.stationLiveTitleMap,
                            stationShowDetailMap = viewModel.stationLiveDetailMap,
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
                            while (true) {
                                viewModel.prefetchStationShows(localStations, limit = 8)
                                delay(STATION_SHOW_REFRESH_POLL_MS)
                            }
                        }
                        StationListScreen(
                            stations = localStations,
                            stationShowTitleMap = viewModel.stationLiveTitleMap,
                            stationShowDetailMap = viewModel.stationLiveDetailMap,
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
                        val np = nowPlayingState
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

            if (screen != Screen.NOW_PLAYING && nowPlayingState?.isPlaying == true) {
                Box(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(bottom = 6.dp)
                        .size(28.dp)
                        .clip(CircleShape)
                        .background(Color.Black.copy(alpha = 0.78f))
                        .clickable {
                            previousScreenBeforeNowPlaying = screen
                            screen = Screen.NOW_PLAYING
                        },
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Outlined.MusicNote,
                        contentDescription = "Now Playing",
                        tint = Color.White,
                        modifier = Modifier.size(16.dp)
                    )
                }
            }
        }
    }
}

private val HeaderHorizontalSafePadding = 28.dp
private const val STATION_SHOW_REFRESH_POLL_MS = 30_000L

private val AggressiveEdgeScaling = ScalingLazyColumnDefaults.scalingParams(
    edgeScale = 0.45f,
    edgeAlpha = 0.40f,
    minElementHeight = 0.15f,
    maxElementHeight = 0.90f,
    minTransitionArea = 0.35f,
    maxTransitionArea = 0.85f
)

private val CurvedBackdropGradient = listOf(
    Color.Transparent,
    Color.Black.copy(alpha = 0.12f),
    Color.Black.copy(alpha = 0.42f),
    Color.Black.copy(alpha = 0.42f),
    Color.Black.copy(alpha = 0.12f),
    Color.Transparent
)

private val TopCurvedBackdropGradient = listOf(
    Color.Transparent,
    Color.Black.copy(alpha = 0.14f),
    Color.Black.copy(alpha = 0.46f),
    Color.Black.copy(alpha = 0.46f),
    Color.Black.copy(alpha = 0.14f),
    Color.Transparent
)

@Composable
private fun HomeScreen(
    onOpenStations: () -> Unit,
    onOpenPodcasts: () -> Unit
) {
    val chipWidthFraction = roundSafeChipWidthFraction()
    val secondaryMaxLines = secondaryMaxLinesForFontScale()

    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 10.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Chip(
                onClick = onOpenStations,
                label = { Text("Stations", maxLines = 2, overflow = TextOverflow.Ellipsis) },
                secondaryLabel = { Text("Favourites and All Stations", maxLines = secondaryMaxLines, overflow = TextOverflow.Ellipsis) },
                colors = ChipDefaults.primaryChipColors(),
                modifier = Modifier.fillMaxWidth(chipWidthFraction)
            )
            Chip(
                onClick = onOpenPodcasts,
                label = { Text("Podcasts", maxLines = 2, overflow = TextOverflow.Ellipsis) },
                secondaryLabel = { Text("Subscribed shows", maxLines = secondaryMaxLines, overflow = TextOverflow.Ellipsis) },
                colors = ChipDefaults.primaryChipColors(),
                modifier = Modifier.fillMaxWidth(chipWidthFraction)
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
    val listState = rememberScalingLazyListState()
    val listContentPadding = listContentPaddingForFontScale()
    val chipWidthFraction = roundSafeChipWidthFraction()
    val secondaryMaxLines = secondaryMaxLinesForFontScale()

    Box(modifier = Modifier.fillMaxSize()) {
        ScalingLazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize(),
            contentPadding = listContentPadding,
            verticalArrangement = Arrangement.spacedBy(8.dp),
            scalingParams = AggressiveEdgeScaling
        ) {
            item {
                Chip(
                    onClick = onOpenFavourites,
                    label = { Text("Favourites", maxLines = 2, overflow = TextOverflow.Ellipsis) },
                    secondaryLabel = { Text("Synced from phone", maxLines = secondaryMaxLines, overflow = TextOverflow.Ellipsis) },
                    colors = ChipDefaults.primaryChipColors(),
                    modifier = Modifier.fillMaxWidth(chipWidthFraction)
                )
            }
            item {
                Chip(
                    onClick = onOpenNationalStations,
                    label = { Text("National", maxLines = 2, overflow = TextOverflow.Ellipsis) },
                    secondaryLabel = { Text("UK-wide stations", maxLines = secondaryMaxLines, overflow = TextOverflow.Ellipsis) },
                    colors = ChipDefaults.secondaryChipColors(),
                    modifier = Modifier.fillMaxWidth(chipWidthFraction)
                )
            }
            item {
                Chip(
                    onClick = onOpenRegionalStations,
                    label = { Text("Regions", maxLines = 2, overflow = TextOverflow.Ellipsis) },
                    secondaryLabel = { Text("Nations and regions", maxLines = secondaryMaxLines, overflow = TextOverflow.Ellipsis) },
                    colors = ChipDefaults.secondaryChipColors(),
                    modifier = Modifier.fillMaxWidth(chipWidthFraction)
                )
            }
            item {
                Chip(
                    onClick = onOpenLocalStations,
                    label = { Text("Local", maxLines = 2, overflow = TextOverflow.Ellipsis) },
                    secondaryLabel = { Text("Local BBC stations", maxLines = secondaryMaxLines, overflow = TextOverflow.Ellipsis) },
                    colors = ChipDefaults.secondaryChipColors(),
                    modifier = Modifier.fillMaxWidth(chipWidthFraction)
                )
            }
        }

        PositionIndicator(scalingLazyListState = listState)
    }
}

@Composable
private fun StationListScreen(
    stations: List<Station>,
    stationShowTitleMap: Map<String, String>,
    stationShowDetailMap: Map<String, String>,
    onPlay: (Station) -> Unit,
    emptyText: String
) {
    val listState = rememberScalingLazyListState()
    val listContentPadding = listContentPaddingForFontScale()
    val chipWidthFraction = roundSafeChipWidthFraction()
    val secondaryMaxLines = secondaryMaxLinesForFontScale()

    Box(modifier = Modifier.fillMaxSize()) {
        ScalingLazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize(),
            contentPadding = listContentPadding,
            verticalArrangement = Arrangement.spacedBy(8.dp),
            scalingParams = AggressiveEdgeScaling
        ) {
            if (stations.isEmpty()) {
                item {
                    RoundSafeHeaderMessage(emptyText, maxLines = 2)
                }
            } else {
                items(stations, key = { it.id }) { station ->
                    val showTitle = stationShowTitleMap[station.id]
                    val showDetail = stationShowDetailMap[station.id]
                    val stationArtwork = remember(station.id) { StationArtwork.createBitmap(station.id, 72).asImageBitmap() }
                    Chip(
                        onClick = { onPlay(station) },
                        label = { Text(station.title, maxLines = 2, overflow = TextOverflow.Ellipsis) },
                        secondaryLabel = {
                            Text(
                                showDetail ?: showTitle ?: "On air now",
                                maxLines = secondaryMaxLines,
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
                        modifier = Modifier.fillMaxWidth(chipWidthFraction),
                        colors = ChipDefaults.primaryChipColors()
                    )
                }
            }
        }

        PositionIndicator(scalingLazyListState = listState)
    }
}

private val NumericSyntheticIdRegex = Regex("^-?\\d{6,}$")

private fun looksLikeNumericSyntheticId(id: String): Boolean {
    return NumericSyntheticIdRegex.matches(id.trim())
}

@Composable
private fun PodcastListScreen(
    podcasts: List<PodcastSummary>,
    loading: Boolean,
    errorMessage: String?,
    onRetry: () -> Unit,
    onOpenPodcast: (PodcastSummary) -> Unit
) {
    val context = LocalContext.current
    var visibleCount by rememberSaveable { mutableStateOf(8) }
    val visiblePodcasts = podcasts.take(visibleCount.coerceAtMost(podcasts.size))
    val listState = rememberScalingLazyListState()
    val listContentPadding = listContentPaddingForFontScale()
    val chipWidthFraction = roundSafeChipWidthFraction()
    val secondaryMaxLines = secondaryMaxLinesForFontScale()

    Box(modifier = Modifier.fillMaxSize()) {
        ScalingLazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize(),
            contentPadding = listContentPadding,
            verticalArrangement = Arrangement.spacedBy(8.dp),
            scalingParams = AggressiveEdgeScaling
        ) {
            if (loading) {
                item { RoundSafeHeaderMessage("Loading…", maxLines = 1) }
            }

            if (!loading && errorMessage != null) {
                item { RoundSafeHeaderMessage(errorMessage, maxLines = 2) }
                item {
                    Chip(
                        onClick = onRetry,
                        label = { Text("Retry", maxLines = 2, overflow = TextOverflow.Ellipsis) },
                        modifier = Modifier.fillMaxWidth(chipWidthFraction),
                        colors = ChipDefaults.secondaryChipColors()
                    )
                }
            }

            if (!loading && errorMessage == null && podcasts.isEmpty()) {
                item { RoundSafeHeaderMessage("No podcasts available", maxLines = 1) }
            }

            items(visiblePodcasts, key = { it.id }) { podcast ->
                val artworkRequest = remember(podcast.imageUrl) {
                    podcast.imageUrl
                        .takeIf { it.isNotBlank() }
                        ?.let { imageUrl ->
                            ImageRequest.Builder(context)
                                .data(imageUrl)
                                .crossfade(false)
                                .size(56)
                                .build()
                        }
                }
                Chip(
                    onClick = { onOpenPodcast(podcast) },
                    label = { Text(podcast.title, maxLines = 2, overflow = TextOverflow.Ellipsis) },
                    icon = {
                        if (artworkRequest != null) {
                            AsyncImage(
                                model = artworkRequest,
                                contentDescription = podcast.title,
                                contentScale = ContentScale.Crop,
                                modifier = Modifier
                                    .size(28.dp)
                                    .clip(CircleShape)
                            )
                        } else {
                            Box(
                                modifier = Modifier
                                    .size(28.dp)
                                    .clip(CircleShape)
                                    .background(Color.Black.copy(alpha = 0.26f)),
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(
                                    imageVector = Icons.Outlined.MusicNote,
                                    contentDescription = null,
                                    tint = Color.White,
                                    modifier = Modifier.size(16.dp)
                                )
                            }
                        }
                    },
                    modifier = Modifier.fillMaxWidth(chipWidthFraction),
                    colors = ChipDefaults.primaryChipColors()
                )
            }

            if (visibleCount < podcasts.size) {
                item {
                    Chip(
                        onClick = { visibleCount += 8 },
                        label = { Text("Load more", maxLines = 2, overflow = TextOverflow.Ellipsis) },
                        secondaryLabel = { Text("${podcasts.size - visibleCount} remaining", maxLines = secondaryMaxLines, overflow = TextOverflow.Ellipsis) },
                        modifier = Modifier.fillMaxWidth(chipWidthFraction),
                        colors = ChipDefaults.secondaryChipColors()
                    )
                }
            }
        }

        PositionIndicator(scalingLazyListState = listState)
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
    val listState = rememberScalingLazyListState()
    val listContentPadding = listContentPaddingForFontScale()
    val chipWidthFraction = roundSafeChipWidthFraction()
    val secondaryMaxLines = secondaryMaxLinesForFontScale()

    Box(modifier = Modifier.fillMaxSize()) {
        ScalingLazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize(),
            contentPadding = listContentPadding,
            verticalArrangement = Arrangement.spacedBy(8.dp),
            scalingParams = AggressiveEdgeScaling
        ) {
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
                        label = { Text(episode.title, maxLines = 2, overflow = TextOverflow.Ellipsis) },
                        secondaryLabel = {
                            val secondary = when {
                                isPlayed -> "Played"
                                progressMs > 0L -> "Resume at ${formatPosition(progressMs)}"
                                episode.pubDate.isNotBlank() -> episode.pubDate.replace(Regex("[T\\s]\\d{2}:\\d{2}:\\d{2}.*"), "")
                                else -> "Play episode"
                            }
                            Text(text = secondary, maxLines = secondaryMaxLines, overflow = TextOverflow.Ellipsis)
                        },
                        modifier = Modifier.fillMaxWidth(chipWidthFraction),
                        colors = ChipDefaults.primaryChipColors()
                    )
                }

                if (visibleCount < episodes.size) {
                    item {
                        Chip(
                            onClick = { visibleCount += 8 },
                            label = { Text("Load older", maxLines = 2, overflow = TextOverflow.Ellipsis) },
                            secondaryLabel = { Text("${episodes.size - visibleCount} remaining", maxLines = secondaryMaxLines, overflow = TextOverflow.Ellipsis) },
                            modifier = Modifier.fillMaxWidth(chipWidthFraction),
                            colors = ChipDefaults.secondaryChipColors()
                        )
                    }
                }
            }
        }

        PositionIndicator(scalingLazyListState = listState)
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

@Composable
private fun listContentPaddingForFontScale(): PaddingValues {
    val fontScale = LocalConfiguration.current.fontScale
    val horizontal = when {
        fontScale >= 1.4f -> 14.dp
        fontScale >= 1.2f -> 12.dp
        else -> 10.dp
    }
    val top = when {
        fontScale >= 1.4f -> 34.dp
        fontScale >= 1.2f -> 28.dp
        else -> 22.dp
    }
    val bottom = when {
        fontScale >= 1.4f -> 28.dp
        fontScale >= 1.2f -> 24.dp
        else -> 20.dp
    }
    return PaddingValues(start = horizontal, end = horizontal, top = top, bottom = bottom)
}

@Composable
private fun roundSafeChipWidthFraction(): Float {
    val fontScale = LocalConfiguration.current.fontScale
    return when {
        fontScale >= 1.4f -> 0.88f
        fontScale >= 1.2f -> 0.90f
        else -> 0.93f
    }
}

@Composable
private fun secondaryMaxLinesForFontScale(): Int {
    return if (LocalConfiguration.current.fontScale >= 1.2f) 1 else 2
}

private fun formatPosition(positionMs: Long): String {
    val totalSeconds = (positionMs / 1000L).coerceAtLeast(0L)
    val minutes = totalSeconds / 60L
    val seconds = totalSeconds % 60L
    return String.format("%d:%02d", minutes, seconds)
}

@Composable
private fun rememberBatteryPercent(): Int {
    val context = LocalContext.current
    val batteryPercent = remember { mutableIntStateOf(100) }
    DisposableEffect(context) {
        val filter = IntentFilter(Intent.ACTION_BATTERY_CHANGED)
        context.registerReceiver(null, filter)?.let { intent ->
            val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
            val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, 100)
            if (level >= 0 && scale > 0) batteryPercent.intValue = level * 100 / scale
        }
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context?, intent: Intent?) {
                val level = intent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
                val scale = intent?.getIntExtra(BatteryManager.EXTRA_SCALE, 100) ?: 100
                if (level >= 0 && scale > 0) batteryPercent.intValue = level * 100 / scale
            }
        }
        context.registerReceiver(receiver, filter)
        onDispose { context.unregisterReceiver(receiver) }
    }
    return batteryPercent.intValue
}

@Composable
private fun BottomCurvedLabel(text: String, showBackdrop: Boolean = true) {
    if (text.isBlank()) return

    CurvedLayout(
        modifier = Modifier
            .fillMaxSize()
            .offset(y = 28.dp),
        anchor = 90f,
        anchorType = AnchorType.Center,
        radialAlignment = CurvedAlignment.Radial.Outer,
        angularDirection = CurvedDirection.Angular.Reversed
    ) {
        val curvedTextModifier = if (showBackdrop) {
            CurvedModifier
                .curvedPadding(35.dp, 0.dp)
                .curvedAngularGradientBackground(CurvedBackdropGradient)
        } else {
            CurvedModifier
        }
        basicCurvedText(
            text = text.take(30),
            modifier = curvedTextModifier,
            style = CurvedTextStyle(fontSize = 13.sp, color = Color.White)
        )
    }
}

@Composable
private fun TopCurvedTimeBackdrop() {
    CurvedLayout(
        modifier = Modifier
            .fillMaxSize()
            .offset(y = (-5).dp),
        anchor = 270f,
        anchorType = AnchorType.Center,
        radialAlignment = CurvedAlignment.Radial.Outer,
        angularDirection = CurvedDirection.Angular.Reversed
    ) {
        basicCurvedText(
            text = "MMMMMMMMMM",
            modifier = CurvedModifier
                .curvedPadding(8.dp, 0.dp)
                .curvedAngularGradientBackground(TopCurvedBackdropGradient),
            style = CurvedTextStyle(color = Color.Transparent)
        )
    }
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
    var overlayInteractionVersion by rememberSaveable { mutableIntStateOf(0) }
    val blankTapInteraction = remember { MutableInteractionSource() }

    LaunchedEffect(overlayVisible, overlayInteractionVersion) {
        if (overlayVisible) {
            delay(3_000L)
            overlayVisible = false
        }
    }

    BackHandler(enabled = overlayVisible) {
        overlayVisible = false
    }

    Box(modifier = Modifier.fillMaxSize()) {
        // Station artwork is always the base layer — acts as fallback if the
        // now-playing artwork URL fails to load or is unavailable.
        if (!stationId.isNullOrBlank()) {
            Image(
                bitmap = remember(stationId) { StationArtwork.createBitmap(stationId, 512).asImageBitmap() },
                contentDescription = "Station artwork",
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize()
            )
        }
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
                .clickable(
                    interactionSource = blankTapInteraction,
                    indication = null
                ) {
                    overlayVisible = !overlayVisible
                    if (overlayVisible) {
                        overlayInteractionVersion += 1
                    }
                }
                .background(Color.Black.copy(alpha = 0.68f))
        )

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 22.dp, vertical = 14.dp),
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
                            onClick = {
                                overlayInteractionVersion += 1
                                onSkipPrevious()
                            },
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
                            onClick = {
                                overlayInteractionVersion += 1
                                onSkipNext()
                            },
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
                            onClick = {
                                overlayInteractionVersion += 1
                                onOpenVolumeUi()
                            },
                            modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.secondaryButtonColors()
                        ) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Outlined.VolumeUp,
                                contentDescription = "Volume"
                            )
                        }
                        Button(
                            onClick = {
                                overlayInteractionVersion += 1
                                onTogglePlayPause()
                            },
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
