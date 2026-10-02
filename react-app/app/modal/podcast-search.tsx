import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  Image,
  StyleSheet,
  ActivityIndicator,
  Modal,
  Switch
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { MaterialIcons } from "@expo/vector-icons";
import { useAppTheme, useIsDarkTheme } from "../../src/theme/colors";
import {
  Episode,
  Podcast,
  SearchEpisodeResult,
  SearchPodcastResult,
  PodcastRatingSummary,
  PodcastApi,
  decodeXmlEntities,
  matchesBooleanSearch,
  filterSuggestions,
  extractPositiveQuery,
  episodeMatchesQuery,
  formatRatingValue
} from "../../src/api/podcasts";
import { Preferences } from "../../src/storage/preferences";
import { applyLanguageFilter } from "../../src/podcasts/languageFilter";
import { ensureLanguageIndex } from "../../src/podcasts/languageResolver";
import {
  appendEpisodePage,
  emptyEpisodePageState,
  rankEpisodes,
  type EpisodePageState
} from "../../src/podcasts/episodeSearchPaging";
import { usePlayerStore } from "../../src/store/playerStore";
import { OfflineBanner, VpnBanner } from "../../src/components/NetworkBanners";
import { ensureNotificationPermissions } from "../../src/notifications/notifications";
import { EpisodePlaybackIndicator, EpisodeProgressBar } from "../../src/components/EpisodeIndicators";
import { computeEpisodePlaybackStatus } from "../../src/podcasts/episodePlaybackStatus";

const SEARCH_DEBOUNCE_MS = 250;

// Episodes are searched lazily. Broad queries such as "More or Less" or
// "Newscast" match thousands of episodes; fetching every page up front blocked
// the screen for minutes and pushed thousands of rows into memory. Instead we
// show podcast names from a single bounded request, then pull one small page of
// episodes and fetch further pages only when the user asks for them.
const EPISODE_SEARCH_PAGE_SIZE = 50;
const EPISODE_SEARCH_MAX_EPISODES = 1000;

// Rows actually mounted. Growing on scroll keeps long result sets cheap to
// render regardless of how many matches have been loaded.
const PODCAST_REVEAL_STEP = 20;
const EPISODE_REVEAL_STEP = 30;

type SearchResultItem =
  | { key: string; type: "podcast"; podcast: Podcast }
  | { key: string; type: "episodesHeading" }
  | { key: string; type: "episode"; episode: SearchEpisodeResult }
  | { key: string; type: "loadingMore" }
  | { key: string; type: "revealMore" };

export default function PodcastSearchScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ search?: string; savedSearchId?: string; episodeId?: string }>();
  const notifiedEpisodeId = typeof params.episodeId === "string" ? params.episodeId : "";
  const notifiedEpisodeRef = useRef<string | null>(null);
  const theme = useAppTheme();
  const isDark = useIsDarkTheme();
  const insets = useSafeAreaInsets();

  const [catalog, setCatalog] = useState<Podcast[]>([]);
  const [subscribedIds, setSubscribedIds] = useState<string[]>([]);
  const [podcastRatings, setPodcastRatings] = useState<Record<string, PodcastRatingSummary>>(() =>
    Preferences.getCachedPodcastRatings()
  );

  const [searchQuery, setSearchQuery] = useState(
    typeof params.search === "string" ? params.search : ""
  );
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [isSearchingPodcasts, setIsSearchingPodcasts] = useState(false);
  const [isSearchingEpisodes, setIsSearchingEpisodes] = useState(false);
  const [isLoadingMoreEpisodes, setIsLoadingMoreEpisodes] = useState(false);
  // Total matches reported by the backend, shown as soon as the first page
  // lands. Null until then, or when the deployment does not report a total.
  const [totalEpisodeCount, setTotalEpisodeCount] = useState<number | null>(null);
  const [visiblePodcastCount, setVisiblePodcastCount] = useState(PODCAST_REVEAL_STEP);
  const [visibleEpisodeCount, setVisibleEpisodeCount] = useState(EPISODE_REVEAL_STEP);
  const [searchPodcastMatches, setSearchPodcastMatches] = useState<Podcast[]>([]);
  const [searchEpisodeMatches, setSearchEpisodeMatches] = useState<SearchEpisodeResult[]>(() => {
    if (notifiedEpisodeId) {
      const snapshot = Preferences.getNotifiedEpisode(notifiedEpisodeId);
      if (snapshot) {
        return [
          {
            episodeId: notifiedEpisodeId,
            podcastId: snapshot.podcastId || "",
            title: snapshot.title,
            description: "",
            pubDate: snapshot.pubDate || ""
          }
        ];
      }
    }
    return [];
  });
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<{ podcastId: string; title: string }[]>([]);

  const searchDebounceTimer = useRef<any>(null);
  const textInputRef = useRef<TextInput>(null);

  // Search plumbing refs. These keep the latest server payload and query so the
  // displayed matches can be re-derived without refetching, and so responses
  // from superseded queries can never overwrite the current results.
  const catalogRef = useRef<Podcast[]>([]);
  const searchSeqRef = useRef(0);
  const lastQueryRef = useRef("");
  const piPodcastResultsRef = useRef<SearchPodcastResult[]>([]);
  const piEpisodeResultsRef = useRef<SearchEpisodeResult[]>([]);
  const resultsQueryRef = useRef("");

  // Podcast and episode searches are separate, independently cancellable
  // requests so the podcast names render as soon as that request lands, and a
  // superseded query does not keep its episode paging running to completion.
  const podcastAbortRef = useRef<AbortController | null>(null);
  const episodeAbortRef = useRef<AbortController | null>(null);
  const episodePageRef = useRef<EpisodePageState>(emptyEpisodePageState());

  const [savedSearches, setSavedSearches] = useState(() => Preferences.getSavedPodcastSearches());
  const [saveSearchModalVisible, setSaveSearchModalVisible] = useState(false);
  const [saveSearchName, setSaveSearchName] = useState("");
  const [saveSearchNotify, setSaveSearchNotify] = useState(true);

  const { playEpisode } = usePlayerStore();
  const currentEpisode = usePlayerStore((state) => state.currentEpisode);
  const positionSeconds = usePlayerStore((state) => state.positionSeconds);
  const [playedIds, setPlayedIds] = useState<Set<string>>(
    () => new Set(Preferences.getPlayedEpisodeIds())
  );
  const [progressMap, setProgressMap] = useState<Record<string, number>>(() =>
    Preferences.getEpisodeProgressMap()
  );
  const [resolvingEpisodeId, setResolvingEpisodeId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      setSavedSearches(Preferences.getSavedPodcastSearches());
      setSubscribedIds(Preferences.getSubscribedPodcasts());
      setPodcastRatings(Preferences.getCachedPodcastRatings());
      setRecentSearches(Preferences.getRecentPodcastSearches());
      setPlayedIds(new Set(Preferences.getPlayedEpisodeIds()));
      setProgressMap(Preferences.getEpisodeProgressMap());
    }, [])
  );

  useEffect(() => {
    const sub = Preferences.onChanged((key) => {
      if (key === "played_episode_ids") {
        setPlayedIds(new Set(Preferences.getPlayedEpisodeIds()));
      } else if (key === "episode_progress" || key === "last_podcast_positions") {
        setProgressMap(Preferences.getEpisodeProgressMap());
      } else if (key === "cache_podcast_ratings_data") {
        setPodcastRatings(Preferences.getCachedPodcastRatings());
      }
    });
    return () => sub.remove();
  }, []);

  // Load catalog in background if not already cached
  useEffect(() => {
    let mounted = true;
    PodcastApi.fetchLiveCatalog().then((cats) => {
      if (!mounted) return;
      setCatalog(applyLanguageFilter(cats));
      // Same background language index as the Podcasts tab, so results stop showing
      // Welsh and Gaelic podcasts once their feed languages are known.
      if (Preferences.getSetting("pref_exclude_non_english", false)) {
        ensureLanguageIndex(cats, () => {
          if (mounted) setCatalog(applyLanguageFilter(cats));
        });
      }
      const ids = cats.map((p) => p.id);
      PodcastApi.fetchRatings(ids).then((ratings) => {
        if (mounted) setPodcastRatings(ratings);
      }).catch(() => {});
    }).catch((err) => {
      console.warn("Search screen catalog load error:", err);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const currentSavedSearch = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return null;
    return savedSearches.find((s) => s.query.trim().toLowerCase() === q) || null;
  }, [searchQuery, savedSearches]);

  const isSearchSaved = !!currentSavedSearch;

  const handleOpenSaveSearch = useCallback(() => {
    const query = searchQuery.trim();
    if (!query) return;
    if (currentSavedSearch) {
      setSaveSearchName(currentSavedSearch.name);
      setSaveSearchNotify(currentSavedSearch.notificationsEnabled);
    } else {
      setSaveSearchName(query);
      setSaveSearchNotify(true);
    }
    setSaveSearchModalVisible(true);
  }, [searchQuery, currentSavedSearch]);

  // Filter the podcast payload and publish it. This runs as soon as the single
  // podcast request resolves, well before any episode page has been fetched.
  // Mirrors the Kotlin episodeMatchesQuery / textMatchesNormalized logic.
  const applyPodcastResults = useCallback(() => {
    const q = lastQueryRef.current;
    if (!q) return;

    const catalog = catalogRef.current;

    // Podcasts: filter on server-provided title+description, then enrich with
    // catalog metadata. Unlike episodes we don't have a podcast name to pass
    // to episodeMatchesQuery, so we use matchesBooleanSearch directly.
    const podcastCandidates = piPodcastResultsRef.current.filter((p) =>
      matchesBooleanSearch(q, `${p.title} ${p.description}`)
    );
    const enriched = applyLanguageFilter(
      PodcastApi.enrichSearchResults(podcastCandidates, catalog)
    );

    if (enriched.length === 0 && catalog.length > 0) {
      const fallback = applyLanguageFilter(
        catalog.filter((p) =>
          matchesBooleanSearch(q, `${p.title} ${p.description} ${p.genres.join(" ")}`)
        )
      );
      setSearchPodcastMatches(fallback);
    } else {
      setSearchPodcastMatches(enriched);
    }
  }, []);

  // Filter the accumulated episode payload and publish it. Runs once per
  // loaded page, so the cost is bounded by how much the user has asked for.
  const applyEpisodeResults = useCallback(() => {
    const q = lastQueryRef.current;
    if (!q) return;

    const podcastNames = new Map<string, string>();
    for (const p of catalogRef.current) podcastNames.set(p.id, p.title);

    // Episodes: use the Kotlin-style matcher that checks title OR description
    // with normalised word-boundary matching, and enforces NOT terms.
    const matchingEpisodes = rankEpisodes(
      piEpisodeResultsRef.current.filter((ep) =>
        episodeMatchesQuery(ep.title, ep.description, podcastNames.get(ep.podcastId) || "", q)
      ),
      // Episodes from a podcast whose own name matches the query lead the list.
      new Set(
        catalogRef.current.filter((p) => matchesBooleanSearch(q, p.title)).map((p) => p.id)
      )
    );

    if (notifiedEpisodeId) {
      const targetIndex = matchingEpisodes.findIndex(
        (ep) =>
          ep.episodeId === notifiedEpisodeId ||
          ep.episodeId.includes(notifiedEpisodeId) ||
          notifiedEpisodeId.includes(ep.episodeId)
      );
      if (targetIndex > 0) {
        const [targetEp] = matchingEpisodes.splice(targetIndex, 1);
        matchingEpisodes.unshift(targetEp);
      } else if (targetIndex === -1) {
        const snapshot = Preferences.getNotifiedEpisode(notifiedEpisodeId);
        if (snapshot) {
          matchingEpisodes.unshift({
            episodeId: notifiedEpisodeId,
            podcastId: snapshot.podcastId || "",
            title: snapshot.title,
            description: "",
            pubDate: snapshot.pubDate || ""
          });
        }
      }
    }

    setSearchEpisodeMatches(matchingEpisodes);

    const latestResultDate = matchingEpisodes
      .map((episode) => episode.pubDate)
      .filter((date) => typeof date === "string" && Number.isFinite(Date.parse(date)))
      .sort((a, b) => Date.parse(b) - Date.parse(a))[0];

    const matchedSavedSearch = Preferences.getSavedPodcastSearches().find(
      (s) => s.query.trim().toLowerCase() === q.toLowerCase()
    );
    const targetSavedSearchId = params.savedSearchId || matchedSavedSearch?.id;
    if (targetSavedSearchId && latestResultDate) {
      Preferences.updatePodcastSearchLatestResult(targetSavedSearchId, latestResultDate);
    }
  }, [params.savedSearchId, notifiedEpisodeId]);

  // Fetch one page of episode candidates and merge it into the accumulated set.
  // The first page runs automatically right after the podcast search starts;
  // every later page is user-initiated.
  const loadEpisodePage = useCallback(
    async (seq: number, query: string, offset: number, isFirstPage: boolean) => {
      if (seq !== searchSeqRef.current || episodePageRef.current.exhausted) return;

      if (isFirstPage) {
        episodeAbortRef.current?.abort();
        episodeAbortRef.current = new AbortController();
        setIsSearchingEpisodes(true);
      } else {
        setIsLoadingMoreEpisodes(true);
      }

      const signal = episodeAbortRef.current?.signal;
      try {
        // Strip NOT terms before sending to the server, mirroring the Kotlin
        // extractPositiveQuery. The server does not understand -term exclusion.
        const qFts = extractPositiveQuery(query);
        // Only the first page asks for the total; it costs a full index scan
        // server-side, so later pages must not pay for it again.
        const page = await PodcastApi.searchEpisodesPageOnPi(
          qFts,
          EPISODE_SEARCH_PAGE_SIZE,
          offset,
          signal,
          isFirstPage
        );
        if (seq !== searchSeqRef.current) return;

        const batch = page.results;
        if (page.total !== null) setTotalEpisodeCount(page.total);

        const next = appendEpisodePage(
          episodePageRef.current,
          batch,
          EPISODE_SEARCH_PAGE_SIZE,
          EPISODE_SEARCH_MAX_EPISODES
        );
        episodePageRef.current = next;
        piEpisodeResultsRef.current = next.episodes;

        resultsQueryRef.current = query;
        applyEpisodeResults();
      } catch (err) {
        console.warn("Episode search failed:", err);
        if (seq === searchSeqRef.current) {
          episodePageRef.current = { ...episodePageRef.current, exhausted: true };
        }
      } finally {
        if (seq === searchSeqRef.current) {
          setIsSearchingEpisodes(false);
          setIsLoadingMoreEpisodes(false);
        }
      }
    },
    [applyEpisodeResults]
  );

  const handleLoadMoreEpisodes = useCallback(() => {
    const q = lastQueryRef.current;
    const page = episodePageRef.current;
    if (!q || page.exhausted) return;
    void loadEpisodePage(searchSeqRef.current, q, page.nextOffset, false);
  }, [loadEpisodePage]);

  const executeSearch = useCallback(
    (text: string) => {
      const q = text.trim();
      const seq = ++searchSeqRef.current;
      lastQueryRef.current = q;

      // Cancel anything still in flight for the previous query rather than
      // letting it finish against a result set nobody is looking at.
      podcastAbortRef.current?.abort();
      podcastAbortRef.current = null;
      episodeAbortRef.current?.abort();
      episodeAbortRef.current = null;

      if (searchDebounceTimer.current) {
        clearTimeout(searchDebounceTimer.current);
        searchDebounceTimer.current = null;
      }

      episodePageRef.current = emptyEpisodePageState();
      setTotalEpisodeCount(null);
      setVisiblePodcastCount(PODCAST_REVEAL_STEP);
      setVisibleEpisodeCount(EPISODE_REVEAL_STEP);

      if (!q) {
        piPodcastResultsRef.current = [];
        piEpisodeResultsRef.current = [];
        resultsQueryRef.current = "";
        setSearchPodcastMatches([]);
        setSearchEpisodeMatches([]);
        setIsSearchingPodcasts(false);
        setIsSearchingEpisodes(false);
        setIsLoadingMoreEpisodes(false);
        return;
      }

      setIsSearchingPodcasts(true);
      setIsSearchingEpisodes(true);

      searchDebounceTimer.current = setTimeout(() => {
        const qFts = extractPositiveQuery(q);

        // Phase 1 — podcasts. One bounded request, published as soon as it
        // lands so the user sees podcast names immediately.
        const podcastAbort = new AbortController();
        podcastAbortRef.current = podcastAbort;
        void (async () => {
          try {
            const piPodcasts = await PodcastApi.searchPodcastsOnPi(qFts, 100, podcastAbort.signal);
            if (seq !== searchSeqRef.current) return;
            piPodcastResultsRef.current = piPodcasts;
            resultsQueryRef.current = q;
            applyPodcastResults();
          } catch (err) {
            console.warn("Podcast search failed:", err);
          } finally {
            if (seq === searchSeqRef.current) setIsSearchingPodcasts(false);
          }
        })();

        // Phase 2 — episodes. One page only; more pages are fetched on demand.
        void loadEpisodePage(seq, q, 0, true);
      }, SEARCH_DEBOUNCE_MS);
    },
    [applyPodcastResults, loadEpisodePage]
  );

  const handleSearchChange = (text: string) => {
    setSearchQuery(text);
    executeSearch(text);
  };

  useEffect(() => {
    const initialQuery = typeof params.search === "string" ? params.search : "";
    if (initialQuery.trim()) {
      setSearchQuery(initialQuery);
      executeSearch(initialQuery);
    }
  }, [params.search, executeSearch]);

  // Keep the ref in sync and re-derive matches once the catalog arrives, so a
  // search issued before the catalog loaded is enriched rather than left on
  // placeholder metadata.
  useEffect(() => {
    catalogRef.current = catalog;
    if (lastQueryRef.current && resultsQueryRef.current === lastQueryRef.current) {
      applyPodcastResults();
      applyEpisodeResults();
    }
  }, [catalog, applyPodcastResults, applyEpisodeResults]);

  // Live suggestions when typing
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!isSearchFocused || trimmed.length < 2) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const results = await PodcastApi.searchSuggestionsOnPi(trimmed, 8);
      if (!cancelled) setSuggestions(results);
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery, isSearchFocused]);

  const handleSelectQuery = (query: string) => {
    setSearchQuery(query);
    setSuggestions([]);
    setIsSearchFocused(false);
    Preferences.addRecentPodcastSearch(query);
    setRecentSearches(Preferences.getRecentPodcastSearches());
    executeSearch(query);
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/podcasts");
    }
  };

  const handleOpenPodcast = useCallback(
    (podcast: Podcast) => {
      PodcastApi.fetchEpisodes(podcast.rssUrl, podcast.id);
      router.push({
        pathname: "/modal/podcast-detail",
        params: {
          podcastId: podcast.id,
          podcastData: JSON.stringify(podcast)
        }
      });
    },
    [router]
  );

  const openSearchEpisode = useCallback(
    async (ep: SearchEpisodeResult) => {
      const parentPodcast = catalog.find((p) => p.id === ep.podcastId) || {
        id: ep.podcastId,
        title: "BBC Podcast",
        description: "",
        rssUrl: `https://podcasts.files.bbci.co.uk/${ep.podcastId}.rss`,
        htmlUrl: "",
        imageUrl: "",
        genres: [],
        typicalDurationMins: 0
      };

      setResolvingEpisodeId(ep.episodeId);
      try {
        const episodes = await PodcastApi.fetchEpisodes(parentPodcast.rssUrl, parentPodcast.id);
        const resolved =
          episodes.find((e) => e.id === ep.episodeId || e.id.includes(ep.episodeId) || ep.episodeId.includes(e.id)) ||
          episodes.find((e) => e.title.toLowerCase() === ep.title.toLowerCase());

        const snapshot = Preferences.getNotifiedEpisode(ep.episodeId);
        const targetEpisode: Episode | null =
          resolved ||
          (snapshot && snapshot.audioUrl
            ? {
                id: ep.episodeId,
                title: ep.title,
                description: ep.description || "",
                pubDate: ep.pubDate || snapshot.pubDate || "",
                durationMins: snapshot.durationMins || 0,
                audioUrl: snapshot.audioUrl,
                imageUrl: snapshot.imageUrl || parentPodcast.imageUrl || "",
                podcastId: parentPodcast.id
              }
            : null);

        if (targetEpisode) {
          router.push({
            pathname: "/modal/now-playing",
            params: {
              podcastData: JSON.stringify(parentPodcast),
              episodeData: JSON.stringify(targetEpisode)
            }
          });
        }
      } catch (err) {
        console.warn("Failed to open episode:", err);
      } finally {
        setResolvingEpisodeId(null);
      }
    },
    [catalog, router]
  );

  // A saved-search alert names the episode that triggered it. Highlight that
  // match in the results list rather than jumping straight to Now Playing —
  // the user can tap the episode row to open the player themselves.
  // notifiedEpisodeRef is used to ensure we only act once per notification tap.
  useEffect(() => {
    if (!notifiedEpisodeId || notifiedEpisodeRef.current === notifiedEpisodeId) return;
    if (isSearchingEpisodes || searchEpisodeMatches.length === 0) return;
    const match = searchEpisodeMatches.find((ep) => ep.episodeId === notifiedEpisodeId);
    if (!match) return;
    notifiedEpisodeRef.current = notifiedEpisodeId;
    // Episode is already visible in the list; no further action needed.
  }, [notifiedEpisodeId, isSearchingEpisodes, searchEpisodeMatches]);

  const handlePlaySearchEpisode = useCallback(
    async (ep: SearchEpisodeResult) => {
      const parentPodcast = catalog.find((p) => p.id === ep.podcastId) || {
        id: ep.podcastId,
        title: "BBC Podcast",
        description: "",
        rssUrl: `https://podcasts.files.bbci.co.uk/${ep.podcastId}.rss`,
        htmlUrl: "",
        imageUrl: "",
        genres: [],
        typicalDurationMins: 0
      };

      setResolvingEpisodeId(ep.episodeId);
      try {
        const eps = await PodcastApi.fetchEpisodes(parentPodcast.rssUrl, parentPodcast.id);
        const resolved =
          eps.find((e) => e.id === ep.episodeId || e.id.includes(ep.episodeId) || ep.episodeId.includes(e.id)) ||
          eps.find((e) => e.title.toLowerCase() === ep.title.toLowerCase()) ||
          (eps.length > 0 ? eps[0] : null);

        const snapshot = Preferences.getNotifiedEpisode(ep.episodeId);
        const targetEpisode: Episode | null =
          resolved ||
          (snapshot && snapshot.audioUrl
            ? {
                id: ep.episodeId,
                title: ep.title,
                description: ep.description || "",
                pubDate: ep.pubDate || snapshot.pubDate || "",
                durationMins: snapshot.durationMins || 0,
                audioUrl: snapshot.audioUrl,
                imageUrl: snapshot.imageUrl || parentPodcast.imageUrl || "",
                podcastId: parentPodcast.id
              }
            : null);

        if (targetEpisode && targetEpisode.audioUrl) {
          await playEpisode(parentPodcast, targetEpisode);
        } else {
          handleOpenPodcast(parentPodcast);
        }
      } catch (err) {
        console.warn("Failed to resolve episode:", err);
      } finally {
        setResolvingEpisodeId(null);
      }
    },
    [catalog, playEpisode, handleOpenPodcast]
  );

  const isSearchActive = searchQuery.trim().length > 0;

  const visiblePodcasts = useMemo(
    () => searchPodcastMatches.slice(0, visiblePodcastCount),
    [searchPodcastMatches, visiblePodcastCount]
  );
  const visibleEpisodes = useMemo(
    () => searchEpisodeMatches.slice(0, visibleEpisodeCount),
    [searchEpisodeMatches, visibleEpisodeCount]
  );
  const hiddenResultCount =
    searchPodcastMatches.length - visiblePodcasts.length +
    (searchEpisodeMatches.length - visibleEpisodes.length);

  const showEpisodesSection =
    totalEpisodeCount !== null || isSearchingEpisodes || visibleEpisodes.length > 0;

  // Podcast rows first, then the episodes section. Keeping both in one
  // virtualized list means a long result set never mounts thousands of views
  // inside a single ScrollView.
  const resultItems = useMemo<SearchResultItem[]>(() => {
    const items: SearchResultItem[] = visiblePodcasts.map((podcast) => ({
      key: `podcast:${podcast.id}`,
      type: "podcast",
      podcast
    }));
    if (showEpisodesSection) {
      items.push({ key: "episodes-heading", type: "episodesHeading" });
      for (const episode of visibleEpisodes) {
        items.push({ key: `episode:${episode.episodeId}`, type: "episode", episode });
      }
    }
    if (hiddenResultCount > 0) {
      items.push({ key: "reveal-more", type: "revealMore" });
    }
    if (isLoadingMoreEpisodes) {
      items.push({ key: "loading-more", type: "loadingMore" });
    }
    return items;
  }, [
    visiblePodcasts,
    showEpisodesSection,
    visibleEpisodes,
    hiddenResultCount,
    isLoadingMoreEpisodes
  ]);

  const handleRevealMore = useCallback(() => {
    setVisiblePodcastCount((count) => count + PODCAST_REVEAL_STEP);
    setVisibleEpisodeCount((count) => count + EPISODE_REVEAL_STEP);
  }, []);

  // Never suggest a podcast back under the exact name just typed. That podcast
  // is already the top result below, and a single suggestion echoing the query
  // looks like a second copy of the search field.
  const visibleSuggestions = useMemo(
    () => filterSuggestions(suggestions, searchQuery),
    [suggestions, searchQuery]
  );

  // Episode rows name their podcast, so this lookup backs that label.
  const podcastNamesById = useMemo(() => {
    const names = new Map<string, string>();
    for (const p of catalog) names.set(p.id, decodeXmlEntities(p.title));
    return names;
  }, [catalog]);

  // Scrolling to the end reveals the next slice of what is already loaded, then
  // fetches the next page from the backend. No button to find or press.
  const handleEndReached = useCallback(() => {
    if (hiddenResultCount > 0) {
      handleRevealMore();
      return;
    }
    if (!isSearchingEpisodes && !isLoadingMoreEpisodes) handleLoadMoreEpisodes();
  }, [hiddenResultCount, handleRevealMore, handleLoadMoreEpisodes, isSearchingEpisodes, isLoadingMoreEpisodes]);

  const renderPodcastRow = (pod: Podcast) => {
    const isSub = subscribedIds.includes(pod.id);
    const ratingSummary = podcastRatings[pod.id];
    const displayGenres = pod.genres
      .filter((g) => !/^podcasts?$/i.test(g.trim()))
      .slice(0, 2);

    return (
      <TouchableOpacity
        style={[styles.podcastCard, { backgroundColor: theme.surface, borderBottomColor: theme.outlineVariant }]}
        onPress={() => handleOpenPodcast(pod)}
        activeOpacity={0.7}
      >
        {pod.imageUrl ? (
          <Image source={{ uri: pod.imageUrl }} style={styles.artwork} resizeMode="cover" />
        ) : (
          <View style={[styles.artworkFallback, { backgroundColor: theme.primaryContainer }]}>
            <MaterialIcons name="podcasts" size={36} color={theme.primary} />
          </View>
        )}

        <View style={styles.cardContent}>
          <Text style={[styles.podcastTitle, { color: theme.onSurface }]} numberOfLines={2}>
            {decodeXmlEntities(pod.title)}
          </Text>
          <Text style={[styles.podcastDesc, { color: theme.onSurfaceVariant }]} numberOfLines={3}>
            {decodeXmlEntities(pod.description)}
          </Text>

          <View style={styles.cardBottomRow}>
            {ratingSummary && ratingSummary.count > 0 && ratingSummary.average > 0 ? (
              <Text style={[styles.ratingBadge, { color: theme.onSurfaceVariant }]}>
                {`★ ${formatRatingValue(ratingSummary.average)}`}
              </Text>
            ) : null}

            {displayGenres.length > 0 ? (
              <Text style={[styles.genresText, { color: theme.onSurfaceVariant }]} numberOfLines={1}>
                {decodeXmlEntities(displayGenres.join(", "))}
              </Text>
            ) : null}
          </View>
        </View>

        {isSub ? (
          <View style={styles.cardActionIcon}>
            <MaterialIcons name="star" size={24} color={theme.onSurface} />
          </View>
        ) : null}
      </TouchableOpacity>
    );
  };

  const renderEpisodeRow = (ep: SearchEpisodeResult) => {
    const isResolving = resolvingEpisodeId === ep.episodeId;
    const podcastName = podcastNamesById.get(ep.podcastId) || "BBC Podcast";
    const isNotified = Boolean(
      notifiedEpisodeId &&
        (ep.episodeId === notifiedEpisodeId ||
          ep.episodeId.includes(notifiedEpisodeId) ||
          notifiedEpisodeId.includes(ep.episodeId))
    );
    const isCurrentEpisode = currentEpisode?.id === ep.episodeId;
    const isPlayed = playedIds.has(ep.episodeId) || Preferences.isEpisodePlayed(ep.episodeId);
    const progressSeconds =
      isCurrentEpisode && positionSeconds > 0
        ? positionSeconds
        : (progressMap[ep.episodeId] || Preferences.getEpisodeProgress(ep.episodeId));
    const cachedEp = PodcastApi.getEpisodesFromCache(ep.podcastId)?.find((e) => e.id === ep.episodeId);
    const notifiedEp = Preferences.getNotifiedEpisode(ep.episodeId);
    const durationMins = cachedEp?.durationMins || notifiedEp?.durationMins || 0;
    const playbackStatus = computeEpisodePlaybackStatus(isPlayed, durationMins, progressSeconds);

    return (
      <View
        style={[
          styles.episodeResultCard,
          {
            backgroundColor: isNotified ? theme.surfaceContainer : theme.surface,
            borderColor: isNotified ? theme.primary : theme.outlineVariant,
            borderLeftWidth: isNotified ? 4 : 1,
            borderLeftColor: isNotified ? theme.primary : theme.outlineVariant
          }
        ]}
      >
        <TouchableOpacity
          style={styles.episodeResultText}
          activeOpacity={0.7}
          onPress={() => openSearchEpisode(ep)}
        >
          {/* Which show an episode came from, so a result set spanning many
              podcasts is still readable. */}
          <Text style={[styles.episodeResultPodcast, { color: theme.primary }]} numberOfLines={1}>
            {podcastName}
          </Text>
          <View style={styles.episodeTitleRow}>
            {isNotified ? (
              <View style={[styles.newBadge, { backgroundColor: theme.primary }]}>
                <Text style={[styles.newBadgeText, { color: theme.onPrimary }]}>New match</Text>
              </View>
            ) : null}
            <Text style={[styles.episodeResultTitle, { color: theme.onSurface, flex: 1 }]} numberOfLines={2}>
              {decodeXmlEntities(ep.title)}
            </Text>
          </View>
          {ep.description ? (
            <Text style={[styles.episodeResultDesc, { color: theme.onSurfaceVariant }]} numberOfLines={2}>
              {decodeXmlEntities(ep.description)}
            </Text>
          ) : null}
          {playbackStatus.progressPercent > 0 ? (
            <EpisodeProgressBar
              progressPercent={playbackStatus.progressPercent}
              trackColor={theme.surfaceVariant}
              fillColor={theme.primary}
            />
          ) : null}
          <View style={styles.episodeMetaRow}>
            {ep.pubDate ? (
              <Text style={[styles.episodeResultDate, { color: theme.onSurfaceVariant, flex: 1, marginBottom: 0 }]}>
                {ep.pubDate.split(" ").slice(0, 4).join(" ")}
              </Text>
            ) : (
              <View style={{ flex: 1 }} />
            )}
            {durationMins > 0 ? (
              <Text style={[styles.episodeResultDate, { color: theme.onSurfaceVariant, marginBottom: 0 }]}>
                {durationMins} min
              </Text>
            ) : null}
            <EpisodePlaybackIndicator
              isPlayed={isPlayed}
              durationMins={durationMins}
              progressSeconds={progressSeconds}
            />
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.episodePlayBtn, { backgroundColor: theme.primary }]}
          onPress={() => handlePlaySearchEpisode(ep)}
          disabled={isResolving}
        >
          {isResolving ? (
            <ActivityIndicator size="small" color={theme.onPrimary} />
          ) : (
            <MaterialIcons name="play-arrow" size={24} color={theme.onPrimary} />
          )}
        </TouchableOpacity>
      </View>
    );
  };

  // Not memoized: FlatList holds onto renderItem, and a cached closure would
  // keep stale per-row state (resolving spinners, subscriptions, theme).
  // listExtraData is the memoized signal that makes mounted rows re-render.
  const renderResultItem = ({ item }: { item: SearchResultItem }) => {
      switch (item.type) {
        case "podcast":
          return renderPodcastRow(item.podcast);
        case "episodesHeading": {
          const episodeCount = totalEpisodeCount ?? searchEpisodeMatches.length;
          return (
            <View>
              <Text style={[styles.sectionHeading, { color: theme.onSurface, marginTop: 24 }]}>
                Episodes ({episodeCount})
              </Text>
              {visibleEpisodes.length === 0 && isSearchingEpisodes ? (
                <View style={styles.inlineLoadingRow}>
                  <ActivityIndicator size="small" color={theme.primary} />
                  <Text style={[styles.inlineLoadingText, { color: theme.onSurfaceVariant }]}>
                    Loading episodes...
                  </Text>
                </View>
              ) : null}
            </View>
          );
        }
        case "episode":
          return renderEpisodeRow(item.episode);
        case "loadingMore":
          return (
            <View style={styles.inlineLoadingRow}>
              <ActivityIndicator size="small" color={theme.primary} />
              <Text style={[styles.inlineLoadingText, { color: theme.onSurfaceVariant }]}>
                Loading more episodes...
              </Text>
            </View>
          );
        case "revealMore":
          return (
            <TouchableOpacity
              style={[styles.moreButton, { backgroundColor: theme.surface, borderColor: theme.outlineVariant }]}
              onPress={handleRevealMore}
              accessibilityRole="button"
              accessibilityLabel="Show more results"
            >
              <MaterialIcons name="expand-more" size={20} color={theme.primary} />
              <Text style={[styles.moreButtonText, { color: theme.primary }]}>Show more results</Text>
            </TouchableOpacity>
          );
        default:
          return null;
      }
  };

  const listExtraData = useMemo(
    () => ({
      theme,
      subscribedIds,
      podcastRatings,
      resolvingEpisodeId,
      isSearchingEpisodes,
      totalEpisodeCount,
      loadedEpisodeCount: searchEpisodeMatches.length,
      visibleEpisodeCount: visibleEpisodes.length,
      playedIds,
      progressMap,
      positionSeconds,
      currentEpisodeId: currentEpisode?.id
    }),
    [
      theme,
      subscribedIds,
      podcastRatings,
      resolvingEpisodeId,
      isSearchingEpisodes,
      totalEpisodeCount,
      searchEpisodeMatches.length,
      visibleEpisodes.length,
      playedIds,
      progressMap,
      positionSeconds,
      currentEpisode?.id
    ]
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.surfaceContainer }]} edges={["top"]}>
      {/* Search Header Bar matching Material search toolbar with back navigation */}
      <View style={[styles.headerBar, { backgroundColor: theme.surfaceContainer }]}>
        <TouchableOpacity
          onPress={handleBack}
          style={styles.backButton}
          accessibilityLabel="Back to podcasts"
          accessibilityRole="button"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialIcons name="arrow-back" size={24} color={theme.onSurface} />
        </TouchableOpacity>

        <View
          style={[
            styles.searchInputWrapper,
            { backgroundColor: theme.surface, borderColor: theme.outlineVariant }
          ]}
        >
          <MaterialIcons name="search" size={22} color={theme.onSurfaceVariant} style={styles.searchIcon} />
          <TextInput
            ref={textInputRef}
            style={[styles.searchInput, { color: theme.onSurface }]}
            placeholder="Search podcasts"
            placeholderTextColor={theme.onSurfaceVariant}
            value={searchQuery}
            onChangeText={handleSearchChange}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setIsSearchFocused(false)}
            onSubmitEditing={() => {
              const query = searchQuery.trim();
              if (query) {
                Preferences.addRecentPodcastSearch(query);
                setRecentSearches(Preferences.getRecentPodcastSearches());
              }
            }}
            autoFocus={!params.search}
            returnKeyType="search"
            clearButtonMode="never"
          />
          {searchQuery ? (
            <View style={styles.searchActions}>
              <TouchableOpacity
                onPress={handleOpenSaveSearch}
                style={styles.actionBtn}
                accessibilityLabel={isSearchSaved ? "Edit saved search" : "Save search"}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <MaterialIcons
                  name={isSearchSaved ? "star" : "star-border"}
                  size={22}
                  color={isSearchSaved ? theme.star : theme.onSurfaceVariant}
                />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleSearchChange("")}
                style={styles.actionBtn}
                accessibilityLabel="Clear search"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <MaterialIcons name="cancel" size={20} color={theme.onSurfaceVariant} />
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      </View>

      <OfflineBanner />
      <VpnBanner />

      {/* Main Content Area */}
      <FlatList
        data={resultItems}
        renderItem={renderResultItem}
        keyExtractor={(item) => item.key}
        extraData={listExtraData}
        ListHeaderComponent={
          <View>
            {/* Recent searches dropdown when search is empty */}
            {!isSearchActive && recentSearches.length > 0 ? (
              <View style={[styles.recentSection, { backgroundColor: theme.surface }]}>
                <View style={styles.recentHeader}>
                  <Text style={[styles.recentTitle, { color: theme.onSurfaceVariant }]}>Recent searches</Text>
                  <TouchableOpacity
                    onPress={() => {
                      Preferences.setSetting("pref_recent_podcast_searches", "[]");
                      setRecentSearches([]);
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={[styles.clearRecentText, { color: theme.primary }]}>Clear</Text>
                  </TouchableOpacity>
                </View>
                {recentSearches.map((search) => (
                  <TouchableOpacity
                    key={search}
                    style={[styles.recentRow, { borderBottomColor: theme.outlineVariant }]}
                    onPress={() => handleSelectQuery(search)}
                  >
                    <MaterialIcons name="history" size={20} color={theme.onSurfaceVariant} style={styles.recentIcon} />
                    <Text style={[styles.recentText, { color: theme.onSurface }]}>{search}</Text>
                    <MaterialIcons name="north-west" size={18} color={theme.outline} />
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}

            {/* Live suggestions when typing */}
            {isSearchFocused && isSearchActive && visibleSuggestions.length > 0 ? (
              <View style={[styles.suggestionsBox, { backgroundColor: theme.surface, borderColor: theme.outlineVariant }]}>
                {visibleSuggestions.map((suggestion, index) => (
                  <TouchableOpacity
                    key={suggestion.podcastId}
                    style={[
                      styles.suggestionRow,
                      index < visibleSuggestions.length - 1
                        ? [styles.suggestionDivider, { borderBottomColor: theme.outlineVariant }]
                        : null
                    ]}
                    onPress={() => handleSelectQuery(suggestion.title)}
                    accessibilityRole="button"
                    accessibilityLabel={`Search for ${suggestion.title}`}
                  >
                    {/* No leading magnifier and a trailing arrow: a leading
                        icon plus a single row is indistinguishable from the
                        search field above, which reads as a duplicated box. */}
                    <Text style={[styles.suggestionText, { color: theme.onSurface }]} numberOfLines={1}>
                      {suggestion.title}
                    </Text>
                    <MaterialIcons name="north-west" size={16} color={theme.outline} />
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}

            {/* Only shown while podcast names are still being resolved. Episode
                loading has its own indicator inside the Episodes section. */}
            {isSearchingPodcasts && (
              <View style={styles.searchLoadingBanner}>
                <ActivityIndicator size="small" color={theme.primary} />
                <Text style={[styles.searchLoadingText, { color: theme.onSurfaceVariant }]}>
                  Searching BBC podcasts...
                </Text>
              </View>
            )}

            {isSearchActive ? (
              <>
                <Text style={[styles.sectionHeading, { color: theme.onSurface }]}>
                  Podcasts {searchPodcastMatches.length > 0 ? `(${searchPodcastMatches.length})` : ""}
                </Text>

                {searchPodcastMatches.length === 0 && !isSearchingPodcasts ? (
                  <Text style={[styles.emptySectionText, { color: theme.onSurfaceVariant }]}>
                    No matching podcasts found.
                  </Text>
                ) : null}
              </>
            ) : null}
          </View>
        }
        ListEmptyComponent={null}
        contentContainerStyle={[styles.listContent, { paddingBottom: 120 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        removeClippedSubviews={false}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.6}
      />

      {/* Save Search Modal */}
      <Modal
        visible={saveSearchModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSaveSearchModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.dialogBackdrop}
          activeOpacity={1}
          onPress={() => setSaveSearchModalVisible(false)}
        >
          <View
            style={[styles.dialogCard, { backgroundColor: theme.surfaceContainer }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[styles.dialogTitle, { color: theme.onSurface }]}>
              {currentSavedSearch ? "Edit Saved Search" : "Save Search"}
            </Text>
            <Text style={[styles.dialogLabel, { color: theme.onSurfaceVariant }]}>Name</Text>
            <TextInput
              style={[
                styles.dialogInput,
                { color: theme.onSurface, borderColor: theme.outlineVariant, backgroundColor: theme.surface }
              ]}
              placeholder="Search name"
              placeholderTextColor={theme.onSurfaceVariant}
              value={saveSearchName}
              onChangeText={setSaveSearchName}
              autoFocus
            />

            <View style={styles.dialogSwitchRow}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text style={[styles.dialogSwitchLabel, { color: theme.onSurface }]}>New episode alerts</Text>
                <Text style={{ fontSize: 12, color: theme.onSurfaceVariant, marginTop: 2 }}>
                  Receive a notification when new episodes match this search
                </Text>
              </View>
              <Switch
                value={saveSearchNotify}
                onValueChange={setSaveSearchNotify}
                trackColor={{
                  false: isDark ? "#38353F" : "#E2E2E6",
                  true: isDark ? "#A078FF" : theme.primary
                }}
                thumbColor={saveSearchNotify ? "#FFFFFF" : isDark ? "#A5A0AD" : "#F4F3F7"}
              />
            </View>

            <View style={styles.dialogActions}>
              {currentSavedSearch ? (
                <TouchableOpacity
                  onPress={() => {
                    Preferences.removePodcastSearch(currentSavedSearch.id);
                    setSavedSearches(Preferences.getSavedPodcastSearches());
                    setSaveSearchModalVisible(false);
                  }}
                  style={[styles.dialogButton, { backgroundColor: "#BA1A1A18", marginRight: "auto" }]}
                >
                  <Text style={{ color: "#BA1A1A", fontWeight: "600" }}>Remove</Text>
                </TouchableOpacity>
              ) : null}

              <TouchableOpacity
                onPress={() => setSaveSearchModalVisible(false)}
                style={styles.dialogButton}
              >
                <Text style={{ color: theme.primary, fontWeight: "600" }}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={async () => {
                  const query = searchQuery.trim();
                  const name = saveSearchName.trim() || query;
                  if (!query) return;
                  if (saveSearchNotify) {
                    await ensureNotificationPermissions();
                  }
                  const latestDate = searchEpisodeMatches
                    .map((episode) => episode.pubDate)
                    .filter((date) => typeof date === "string" && Number.isFinite(Date.parse(date)))
                    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
                  if (currentSavedSearch) {
                    Preferences.updatePodcastSearch(currentSavedSearch.id, {
                      name,
                      query,
                      notificationsEnabled: saveSearchNotify,
                      ...(latestDate ? { latestResultDate: latestDate } : {})
                    });
                  } else {
                    Preferences.savePodcastSearch({
                      id: `search-${Date.now()}`,
                      name,
                      query,
                      notificationsEnabled: saveSearchNotify,
                      latestResultDate: latestDate
                    });
                  }
                  setSavedSearches(Preferences.getSavedPodcastSearches());
                  setSaveSearchModalVisible(false);
                }}
                style={[styles.dialogButton, { backgroundColor: theme.primary }]}
              >
                <Text style={{ color: theme.onPrimary, fontWeight: "700" }}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 8
  },
  backButton: {
    padding: 8,
    borderRadius: 20
  },
  searchInputWrapper: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 12
  },
  searchIcon: {
    marginRight: 8
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 0
  },
  searchActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4
  },
  actionBtn: {
    padding: 6
  },
  listContent: {
    paddingTop: 8
  },
  recentSection: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 16,
    borderRadius: 16,
    overflow: "hidden"
  },
  recentHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12
  },
  recentTitle: {
    fontSize: 14,
    fontWeight: "700"
  },
  clearRecentText: {
    fontSize: 13,
    fontWeight: "600"
  },
  recentRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  recentIcon: {
    marginRight: 12
  },
  recentText: {
    flex: 1,
    fontSize: 15
  },
  suggestionsBox: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden"
  },
  suggestionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12
  },
  suggestionDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  suggestionText: {
    fontSize: 15,
    flexShrink: 1
  },
  searchLoadingBanner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8
  },
  searchLoadingText: {
    fontSize: 13
  },
  inlineLoadingRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8
  },
  inlineLoadingText: {
    fontSize: 13
  },
  episodeResultPodcast: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 3
  },
  moreButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6
  },
  moreButtonText: {
    fontSize: 14,
    fontWeight: "600"
  },
  episodeTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 2,
    flexWrap: "wrap",
    gap: 6
  },
  sectionHeading: {
    fontSize: 17,
    fontWeight: "700",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6
  },
  emptySectionText: {
    fontSize: 14,
    paddingHorizontal: 16,
    paddingVertical: 12
  },
  podcastCard: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  artwork: {
    width: 80,
    height: 80,
    borderRadius: 10
  },
  artworkFallback: {
    width: 80,
    height: 80,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center"
  },
  cardContent: {
    flex: 1,
    marginLeft: 12,
    justifyContent: "center"
  },
  podcastTitle: {
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 2
  },
  podcastDesc: {
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 4
  },
  cardBottomRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4
  },
  ratingBadge: {
    fontSize: 10,
    fontWeight: "700",
    marginRight: 6
  },
  genresText: {
    fontSize: 10,
    flex: 1
  },
  cardActionIcon: {
    marginLeft: 8,
    alignSelf: "center",
    justifyContent: "center"
  },
  episodeResultCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: 1
  },
  episodeResultText: {
    flex: 1,
    marginRight: 10
  },
  episodeResultTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 2
  },
  episodeResultDate: {
    fontSize: 11,
    marginBottom: 2
  },
  episodeMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4
  },
  episodeResultDesc: {
    fontSize: 12,
    lineHeight: 15
  },
  episodePlayBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center"
  },
  dialogBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24
  },
  dialogCard: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 24,
    padding: 24,
    elevation: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.3,
    shadowRadius: 16
  },
  dialogTitle: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 8
  },
  dialogLabel: {
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 4
  },
  dialogInput: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    fontSize: 15,
    marginBottom: 16
  },
  dialogSwitchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
    paddingVertical: 4
  },
  dialogSwitchLabel: {
    fontSize: 14,
    fontWeight: "500"
  },
  dialogActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 8,
    marginTop: 8
  },
  dialogButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10
  },
  newBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 6,
    alignSelf: "center"
  },
  newBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5
  }
});
