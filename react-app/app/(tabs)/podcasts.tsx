import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ScrollView,
  Image,
  StyleSheet,
  ActivityIndicator,
  Alert,
  NativeSyntheticEvent,
  NativeScrollEvent
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { MaterialIcons } from "@expo/vector-icons";
import { useAppTheme } from "../../src/theme/colors";
import {
  Podcast,
  Episode,
  SearchPodcastResult,
  SearchEpisodeResult,
  PopularEntry,
  NewPodcastEntry,
  PodcastApi,
  decodeXmlEntities
} from "../../src/api/podcasts";
import { Preferences } from "../../src/storage/preferences";
import { usePlayerStore } from "../../src/store/playerStore";

const TABS = [
  { id: "popular", label: "Popular" },
  { id: "last_updated", label: "Last Updated" },
  { id: "new_podcasts", label: "New Podcasts" },
  { id: "genre", label: "Genre" },
  { id: "az", label: "A-Z" }
] as const;

type TabId = (typeof TABS)[number]["id"];

function getGenreIcon(genre: string): any {
  const g = genre.toLowerCase();
  if (g.includes("comedy")) return "mood";
  if (g.includes("drama") || g.includes("theat")) return "theaters";
  if (g.includes("news") || g.includes("politics") || g.includes("bulletin")) return "newspaper";
  if (g.includes("music") || g.includes("pop") || g.includes("rock") || g.includes("classical")) return "music-note";
  if (g.includes("sport") || g.includes("football") || g.includes("cricket") || g.includes("tennis")) return "sports-soccer";
  if (g.includes("science") || g.includes("tech") || g.includes("biotech")) return "biotech";
  if (g.includes("history") || g.includes("historical")) return "history-edu";
  if (g.includes("crime") || g.includes("justice")) return "gavel";
  if (g.includes("food") || g.includes("drink")) return "restaurant";
  if (g.includes("health") || g.includes("wellbeing") || g.includes("medical")) return "health-and-safety";
  if (g.includes("entertainment") || g.includes("chat") || g.includes("quiz")) return "celebration";
  if (g.includes("child") || g.includes("pre-school")) return "child-care";
  if (g.includes("documentar") || g.includes("factual")) return "menu-book";
  return "podcasts";
}

type BooleanSearchNode =
  | { type: "term"; value: string }
  | { type: "not"; child: BooleanSearchNode }
  | { type: "and" | "or"; left: BooleanSearchNode; right: BooleanSearchNode };

function parseBooleanSearch(query: string): BooleanSearchNode | null {
  const normalisedQuery = query.replace(/[“”]/g, '"');
  const tokens = normalisedQuery.match(/"[^"]+"|\(|\)|\bAND\b|\bOR\b|\bNOT\b|[^\s()]+/gi) || [];
  let index = 0;
  const peek = () => tokens[index]?.toUpperCase();
  const parsePrimary = (): BooleanSearchNode | null => {
    if (peek() === "NOT") {
      index++;
      const child = parsePrimary();
      return child ? { type: "not", child } : null;
    }
    if (tokens[index] === "(") {
      index++;
      const expression = parseOr();
      if (tokens[index] === ")") index++;
      return expression;
    }
    const token = tokens[index++];
    if (!token || /^(AND|OR|NOT)$/i.test(token)) return null;
    return { type: "term", value: token.replace(/^["“”]|["“”]$/g, "").toLowerCase() };
  };
  const parseAnd = (): BooleanSearchNode | null => {
    let left = parsePrimary();
    while (left && (peek() === "AND" || (tokens[index] && tokens[index] !== ")" && peek() !== "OR"))) {
      if (peek() === "AND") index++;
      const right = parsePrimary();
      if (!right) break;
      left = { type: "and", left, right };
    }
    return left;
  };
  const parseOr = (): BooleanSearchNode | null => {
    let left = parseAnd();
    while (left && peek() === "OR") {
      index++;
      const right = parseAnd();
      if (!right) break;
      left = { type: "or", left, right };
    }
    return left;
  };
  return parseOr();
}

function matchesBooleanSearch(query: string, text: string): boolean {
  const expression = parseBooleanSearch(query);
  if (!expression) return false;
  const haystack = text
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const evaluate = (node: BooleanSearchNode): boolean => {
    if (node.type === "term") {
      const term = node.value.replace(/\s+/g, " ").trim();
      return haystack.includes(term);
    }
    if (node.type === "not") return !evaluate(node.child);
    if (node.type === "and") return evaluate(node.left) && evaluate(node.right);
    return evaluate(node.left) || evaluate(node.right);
  };
  return evaluate(expression);
}

export default function PodcastsScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const flatListRef = useRef<FlatList>(null);

  // Data state
  const [catalog, setCatalog] = useState<Podcast[]>([]);
  const [popularRanks, setPopularRanks] = useState<Map<string, number>>(new Map());
  const [newPodcastsList, setNewPodcastsList] = useState<NewPodcastEntry[]>([]);
  const [subscribedIds, setSubscribedIds] = useState<string[]>([]);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(true);

  // Tab & Filter state
  const [activeTab, setActiveTab] = useState<TabId>("popular");
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);

  // Search state
  const [showSearchBar, setShowSearchBar] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchPodcastMatches, setSearchPodcastMatches] = useState<Podcast[]>([]);
  const [searchEpisodeMatches, setSearchEpisodeMatches] = useState<SearchEpisodeResult[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const searchDebounceTimer = useRef<any>(null);

  const { playEpisode } = usePlayerStore();

  useEffect(() => {
    setRecentSearches(Preferences.getRecentPodcastSearches());
  }, [showSearchBar]);

  // Load catalog and Pi metadata on mount
  useEffect(() => {
    let mounted = true;
    async function init() {
      setIsLoadingCatalog(true);
      setSubscribedIds(Preferences.getSubscribedPodcasts());

      try {
        // Parallel fetch: Live OPML catalog, Pi Popular snapshot, Pi New Podcasts snapshot
        const [cats, popEntries, newEntries] = await Promise.all([
          PodcastApi.fetchLiveCatalog(),
          PodcastApi.getPopularPodcastsFromPi(),
          PodcastApi.getNewPodcastsFromPi()
        ]);

        if (!mounted) return;

        setCatalog(cats);

        // Map popular ranks (1-based rank by play count)
        const ranks = new Map<string, number>();
        popEntries.forEach((entry, idx) => {
          ranks.set(entry.id, idx + 1);
        });
        setPopularRanks(ranks);
        setNewPodcastsList(newEntries);

        // Background prefetch episodes for top popular podcasts so opening them is 0ms instant
        const popularPodcasts = cats
          .filter((p) => ranks.has(p.id))
          .sort((a, b) => (ranks.get(a.id) || 999) - (ranks.get(b.id) || 999));
        PodcastApi.prefetchEpisodes(popularPodcasts.length > 0 ? popularPodcasts : cats, 25);
      } catch (err) {
        console.warn("Init podcasts error:", err);
      } finally {
        if (mounted) setIsLoadingCatalog(false);
      }
    }

    init();
    return () => {
      mounted = false;
    };
  }, []);

  // Compute all unique genres from the catalog
  const allGenres = useMemo(() => {
    const genreMap = new Map<string, number>();
    catalog.forEach((p) => {
      p.genres.forEach((g) => {
        genreMap.set(g, (genreMap.get(g) || 0) + 1);
      });
    });
    return Array.from(genreMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [catalog]);

  const saveSearch = useCallback(() => {
    const query = searchQuery.trim();
    if (!query) return;
    Alert.prompt("Save search", "Name this search", (name) => {
      const trimmedName = name.trim();
      if (!trimmedName) return;
      Alert.alert("Search alerts", "Receive an alert when new episodes match this search?", [
        {
          text: "Enable alerts",
          onPress: () => Preferences.savePodcastSearch({
            id: `search-${Date.now()}`,
            name: trimmedName,
            query,
            notificationsEnabled: true
          })
        },
        {
          text: "Not now",
          onPress: () => Preferences.savePodcastSearch({
            id: `search-${Date.now()}`,
            name: trimmedName,
            query,
            notificationsEnabled: false
          })
        }
      ]);
    }, "plain-text", searchQuery);
  }, [searchQuery]);

  // Handle Search Input querying the Raspberry Pi database
  const handleSearchChange = useCallback(
    (text: string) => {
      setSearchQuery(text);
      if (searchDebounceTimer.current) {
        clearTimeout(searchDebounceTimer.current);
      }

      const q = text.trim();
      if (!q) {
        setSearchPodcastMatches([]);
        setSearchEpisodeMatches([]);
        setIsSearching(false);
        return;
      }

      setIsSearching(true);
      searchDebounceTimer.current = setTimeout(async () => {
        try {
          // Query Raspberry Pi server for matching podcasts and episodes
          const [piPodcasts, piEpisodes] = await Promise.all([
            PodcastApi.searchPodcastsOnPi(q, 50),
            PodcastApi.searchEpisodesOnPi(q, 30)
          ]);

          // Enrich podcast matches with catalog artwork and genres
          const enriched = PodcastApi.enrichSearchResults(piPodcasts, catalog).filter((podcast) =>
            matchesBooleanSearch(q, `${podcast.title} ${podcast.description} ${podcast.genres.join(" ")}`)
          );

          // If Pi returned empty or is offline, fallback to in-memory filter
          if (enriched.length === 0 && catalog.length > 0) {
            const fallback = catalog.filter((p) =>
              matchesBooleanSearch(q, `${p.title} ${p.description} ${p.genres.join(" ")}`)
            );
            setSearchPodcastMatches(fallback);
          } else {
            setSearchPodcastMatches(enriched);
          }

          setSearchEpisodeMatches(
            piEpisodes.filter((episode) =>
              matchesBooleanSearch(q, `${episode.title} ${episode.description}`)
            )
          );
        } catch (err) {
          console.warn("Search failed:", err);
        } finally {
          setIsSearching(false);
        }
      }, 250);
    },
    [catalog]
  );

  // Shuffle button: Pick a random podcast and open its detail
  const handleShuffle = useCallback(() => {
    if (catalog.length === 0) return;
    const randomPod = catalog[Math.floor(Math.random() * catalog.length)];
    router.push({
      pathname: "/modal/podcast-detail",
      params: {
        podcastId: randomPod.id,
        podcastData: JSON.stringify(randomPod)
      }
    });
  }, [catalog, router]);

  // Open podcast detail
  const handleOpenPodcast = useCallback(
    (podcast: Podcast) => {
      // Start fetching immediately in background if not already cached
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

  const [resolvingEpisodeId, setResolvingEpisodeId] = useState<string | null>(null);

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

        if (resolved) {
          router.push({
            pathname: "/modal/episode-detail",
            params: {
              podcastData: JSON.stringify(parentPodcast),
              episodeData: JSON.stringify(resolved)
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

  // Play an episode directly from search results
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

        if (resolved && resolved.audioUrl) {
          await playEpisode(parentPodcast, resolved);
        } else {
          // Fallback: open podcast detail so the user can select an episode
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

  // Sort and filter displayed podcasts for current tab
  const displayedPodcasts = useMemo(() => {
    let list = catalog;

    // Filter by genre if genre filter active
    if (selectedGenre) {
      list = list.filter((p) => p.genres.includes(selectedGenre));
    }

    switch (activeTab) {
      case "popular": {
        return [...list].sort((a, b) => {
          const rankA = popularRanks.get(a.id) ?? 99999;
          const rankB = popularRanks.get(b.id) ?? 99999;
          return rankA - rankB;
        });
      }
      case "last_updated": {
        // Keep original OPML order or ID order
        return list;
      }
      case "new_podcasts": {
        const newIdsOrder = newPodcastsList.map((n) => n.id);
        const newSet = new Set(newIdsOrder);
        const newItems = list.filter((p) => newSet.has(p.id));
        const otherItems = list.filter((p) => !newSet.has(p.id));
        return [
          ...newItems.sort((a, b) => newIdsOrder.indexOf(a.id) - newIdsOrder.indexOf(b.id)),
          ...otherItems
        ];
      }
      case "az": {
        return [...list].sort((a, b) => a.title.localeCompare(b.title));
      }
      case "genre":
      default:
        return list;
    }
  }, [catalog, activeTab, selectedGenre, popularRanks, newPodcastsList]);

  // Scroll to top FAB
  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    setShowScrollTop(y > 300);
  };

  const scrollToTop = () => {
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
  };

  const isSearchActive = searchQuery.trim().length > 0;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.surfaceContainer }]} edges={["top"]}>
      {/* 56dp Top Toolbar matching podcasts_title_bar */}
      <View style={[styles.toolbar, { backgroundColor: theme.surfaceContainer }]}>
        <Text style={[styles.toolbarTitle, { color: theme.onSurface }]}>Podcasts</Text>
        <View style={styles.toolbarActions}>
          <TouchableOpacity
            style={styles.toolbarIconButton}
            onPress={() => setShowSearchBar(!showSearchBar)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialIcons
              name={showSearchBar ? "search-off" : "search"}
              size={24}
              color={theme.onSurface}
            />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.toolbarIconButton}
            onPress={handleShuffle}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialIcons name="shuffle" size={24} color={theme.onSurface} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Collapsible Search Input matching podcasts_search_bar */}
      {showSearchBar || isSearchActive ? (
        <View style={[styles.searchBarContainer, { backgroundColor: theme.surfaceContainer }]}>
          <View
            style={[
              styles.searchInputWrapper,
              { backgroundColor: theme.surface, borderColor: theme.outlineVariant }
            ]}
          >
            <MaterialIcons name="search" size={22} color={theme.onSurfaceVariant} style={styles.searchIcon} />
            <TextInput
              style={[styles.searchInput, { color: theme.onSurface }]}
              placeholder="Search podcasts"
              placeholderTextColor={theme.onSurfaceVariant}
              value={searchQuery}
              onChangeText={handleSearchChange}
              onSubmitEditing={() => {
                const query = searchQuery.trim();
                if (query) {
                  Preferences.addRecentPodcastSearch(query);
                  setRecentSearches(Preferences.getRecentPodcastSearches());
                }
              }}
              autoFocus={showSearchBar && !searchQuery}
              clearButtonMode="never"
            />
            {searchQuery ? (
              <View style={styles.searchActions}>
                <TouchableOpacity onPress={saveSearch} style={styles.clearSearchBtn} accessibilityLabel="Save search">
                  <MaterialIcons name="star-border" size={20} color={theme.onSurfaceVariant} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleSearchChange("")} style={styles.clearSearchBtn}>
                  <MaterialIcons name="cancel" size={20} color={theme.onSurfaceVariant} />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity onPress={handleShuffle} style={styles.clearSearchBtn}>
                <MaterialIcons name="shuffle" size={20} color={theme.onSurfaceVariant} />
              </TouchableOpacity>
            )}
          </View>
          {!searchQuery.trim() && recentSearches.length > 0 ? (
            <View style={[styles.recentSearches, { backgroundColor: theme.surface }]}>
              <Text style={[styles.recentSearchesTitle, { color: theme.onSurfaceVariant }]}>Recent searches</Text>
              {recentSearches.map((search) => (
                <TouchableOpacity
                  key={search}
                  style={styles.recentSearchRow}
                  onPress={() => handleSearchChange(search)}
                >
                  <MaterialIcons name="history" size={18} color={theme.onSurfaceVariant} />
                  <Text style={[styles.recentSearchText, { color: theme.onSurface }]}>{search}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Tabs matching podcasts_sort_tabs: Popular, Last Updated, New Podcasts, Genre, A-Z */}
      {!isSearchActive && (
        <View style={[styles.tabsContainer, { backgroundColor: theme.surfaceContainer }]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabsScrollContent}
          >
            {TABS.map((tab) => {
              const isSelected = activeTab === tab.id;
              return (
                <TouchableOpacity
                  key={tab.id}
                  onPress={() => {
                    setActiveTab(tab.id);
                    if (tab.id !== "genre") {
                      setSelectedGenre(null);
                    }
                  }}
                  style={[
                    styles.tabItem,
                    isSelected && { borderBottomColor: theme.primary, borderBottomWidth: 3 }
                  ]}
                >
                  <Text
                    style={[
                      styles.tabText,
                      {
                        color: isSelected ? theme.primary : theme.onSurfaceVariant,
                        fontWeight: isSelected ? "700" : "500"
                      }
                    ]}
                  >
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Active Genre Filter Indicator */}
      {selectedGenre && !isSearchActive && (
        <View style={[styles.activeGenreBanner, { backgroundColor: theme.surface }]}>
          <Text style={[styles.activeGenreText, { color: theme.onSurface }]}>
            Genre: <Text style={{ fontWeight: "700" }}>{selectedGenre}</Text> ({displayedPodcasts.length})
          </Text>
          <TouchableOpacity onPress={() => setSelectedGenre(null)} style={styles.clearGenreButton}>
            <MaterialIcons name="close" size={18} color={theme.primary} />
            <Text style={[styles.clearGenreText, { color: theme.primary }]}>All Genres</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Main Content Area */}
      {isLoadingCatalog ? (
        <View style={styles.centerLoading}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={[styles.loadingText, { color: theme.onSurfaceVariant }]}>
            Loading BBC Podcasts...
          </Text>
        </View>
      ) : isSearchActive ? (
        /* Live Search Results from Raspberry Pi */
        <ScrollView
          contentContainerStyle={[styles.listContent, { paddingBottom: 160 + insets.bottom }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {isSearching && (
            <View style={styles.searchLoadingBanner}>
              <ActivityIndicator size="small" color={theme.primary} />
              <Text style={[styles.searchLoadingText, { color: theme.onSurfaceVariant }]}>
                Searching podcasts...
              </Text>
            </View>
          )}

          {/* Matching Podcasts Header */}
          <Text style={[styles.sectionHeading, { color: theme.onSurface }]}>
            Podcasts {searchPodcastMatches.length > 0 ? `(${searchPodcastMatches.length})` : ""}
          </Text>

          {searchPodcastMatches.length === 0 && !isSearching ? (
            <Text style={[styles.emptySectionText, { color: theme.onSurfaceVariant }]}>
              No matching podcasts found.
            </Text>
          ) : (
            searchPodcastMatches.map((pod) => renderPodcastCard(pod))
          )}

          {/* Matching Episodes Header */}
          {searchEpisodeMatches.length > 0 && (
            <>
              <Text style={[styles.sectionHeading, { color: theme.onSurface, marginTop: 20 }]}>
                Episodes ({searchEpisodeMatches.length})
              </Text>
              {searchEpisodeMatches.map((ep) => {
                const parentPod = catalog.find((p) => p.id === ep.podcastId) || {
                  id: ep.podcastId,
                  title: "BBC Podcast",
                  description: "",
                  rssUrl: `https://podcasts.files.bbci.co.uk/${ep.podcastId}.rss`,
                  htmlUrl: "",
                  imageUrl: "",
                  genres: [],
                  typicalDurationMins: 0
                };
                const isResolving = resolvingEpisodeId === ep.episodeId;

                return (
                  <View
                    key={ep.episodeId}
                    style={[
                      styles.episodeResultCard,
                      { backgroundColor: theme.surface, borderColor: theme.outlineVariant }
                    ]}
                  >
                    <TouchableOpacity
                      style={styles.episodeResultText}
                      activeOpacity={0.7}
                      onPress={() => openSearchEpisode(ep)}
                    >
                      <Text style={[styles.episodeResultTitle, { color: theme.onSurface }]} numberOfLines={2}>
                        {decodeXmlEntities(ep.title)}
                      </Text>
                      {ep.pubDate ? (
                        <Text style={[styles.episodeResultDate, { color: theme.onSurfaceVariant }]}>
                          {ep.pubDate.split(" ").slice(0, 4).join(" ")}
                        </Text>
                      ) : null}
                      {ep.description ? (
                        <Text style={[styles.episodeResultDesc, { color: theme.onSurfaceVariant }]} numberOfLines={2}>
                          {decodeXmlEntities(ep.description)}
                        </Text>
                      ) : null}
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
              })}
            </>
          )}
        </ScrollView>
      ) : activeTab === "genre" && !selectedGenre ? (
        /* Genre List matching item_genre.xml */
        <FlatList
          ref={flatListRef}
          data={allGenres}
          keyExtractor={(item) => item.name}
          contentContainerStyle={[styles.listContent, { paddingBottom: 160 + insets.bottom }]}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.genreRow, { backgroundColor: theme.surface, borderBottomColor: theme.outlineVariant }]}
              onPress={() => setSelectedGenre(item.name)}
            >
              <MaterialIcons name={getGenreIcon(item.name)} size={24} color={theme.onSurface} style={styles.genreRowIcon} />
              <View style={styles.genreRowTextContainer}>
                <Text style={[styles.genreRowTitle, { color: theme.onSurface }]}>{item.name}</Text>
                <Text style={[styles.genreRowCount, { color: theme.onSurfaceVariant }]}>
                  {item.count} podcasts
                </Text>
              </View>
              <MaterialIcons name="chevron-right" size={22} color={theme.onSurfaceVariant} />
            </TouchableOpacity>
          )}
        />
      ) : (
        /* Regular Podcast List matching item_podcast.xml */
        <FlatList
          ref={flatListRef}
          data={displayedPodcasts}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.listContent, { paddingBottom: 160 + insets.bottom }]}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          initialNumToRender={15}
          maxToRenderPerBatch={20}
          windowSize={10}
          renderItem={({ item }) => renderPodcastCard(item)}
        />
      )}

      {/* Floating Action Button: Scroll To Top */}
      {showScrollTop && (
        <TouchableOpacity
          style={[styles.fab, { backgroundColor: theme.primary }]}
          onPress={scrollToTop}
          activeOpacity={0.85}
        >
          <MaterialIcons name="arrow-upward" size={24} color={theme.onPrimary} />
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );

  // Render individual podcast card matching item_podcast.xml (80x80 artwork)
  function renderPodcastCard(podcast: Podcast) {
    const isSub = subscribedIds.includes(podcast.id);
    return (
      <TouchableOpacity
        key={podcast.id}
        style={[styles.podcastCard, { backgroundColor: theme.surface, borderBottomColor: theme.outlineVariant }]}
        onPress={() => handleOpenPodcast(podcast)}
        activeOpacity={0.7}
      >
        {/* 80x80 Artwork */}
        {podcast.imageUrl ? (
          <Image source={{ uri: podcast.imageUrl }} style={styles.artwork} resizeMode="cover" />
        ) : (
          <View style={[styles.artworkFallback, { backgroundColor: theme.primaryContainer }]}>
            <MaterialIcons name="podcasts" size={40} color={theme.primary} />
          </View>
        )}

        {/* Content Column */}
        <View style={styles.cardContent}>
          <View style={styles.cardTitleRow}>
            <Text style={[styles.podcastTitle, { color: theme.onSurface }]} numberOfLines={2}>
              {decodeXmlEntities(podcast.title)}
            </Text>
            {isSub && (
              <MaterialIcons name="check-circle" size={16} color={theme.primary} style={{ marginLeft: 6 }} />
            )}
          </View>

          <Text style={[styles.podcastDesc, { color: theme.onSurfaceVariant }]} numberOfLines={3}>
            {decodeXmlEntities(podcast.description)}
          </Text>

          {podcast.genres.length > 0 && (
            <Text style={[styles.genresText, { color: theme.onSurfaceVariant }]} numberOfLines={1}>
              {decodeXmlEntities(podcast.genres.join(" • "))}
            </Text>
          )}
        </View>
      </TouchableOpacity>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  toolbar: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16
  },
  toolbarTitle: {
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.2
  },
  toolbarActions: {
    flexDirection: "row",
    alignItems: "center"
  },
  toolbarIconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 4
  },
  searchBarContainer: {
    paddingHorizontal: 12,
    paddingBottom: 8
  },
  searchInputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 24,
    paddingHorizontal: 14,
    height: 46,
    borderWidth: 1
  },
  searchIcon: {
    marginRight: 8
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 8
  },
  clearSearchBtn: {
    padding: 4
  },
  searchActions: {
    flexDirection: "row",
    alignItems: "center"
  },
  recentSearches: {
    marginTop: 4,
    paddingVertical: 8,
    borderRadius: 8
  },
  recentSearchesTitle: {
    fontSize: 12,
    fontWeight: "600",
    paddingHorizontal: 14,
    paddingVertical: 6
  },
  recentSearchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 9
  },
  recentSearchText: {
    fontSize: 14
  },
  tabsContainer: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0,0,0,0.08)"
  },
  tabsScrollContent: {
    paddingHorizontal: 8
  },
  tabItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 3,
    borderBottomColor: "transparent"
  },
  tabText: {
    fontSize: 14
  },
  activeGenreBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0,0,0,0.08)"
  },
  activeGenreText: {
    fontSize: 14
  },
  clearGenreButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4
  },
  clearGenreText: {
    fontSize: 13,
    fontWeight: "600"
  },
  centerLoading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12
  },
  loadingText: {
    fontSize: 14
  },
  listContent: {
    paddingTop: 4
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
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "center"
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
  genresText: {
    fontSize: 10,
    marginTop: 2
  },
  genreRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  genreRowIcon: {
    marginRight: 14
  },
  genreRowTextContainer: {
    flex: 1
  },
  genreRowTitle: {
    fontSize: 16,
    fontWeight: "600"
  },
  genreRowCount: {
    fontSize: 12,
    marginTop: 2
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
  fab: {
    position: "absolute",
    right: 16,
    bottom: 96,
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 4
  }
});
