import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ScrollView,
  Image,
  StyleSheet,
  ActivityIndicator,
  NativeSyntheticEvent,
  NativeScrollEvent
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { MaterialIcons } from "@expo/vector-icons";
import { useAppTheme } from "../../src/theme/colors";
import {
  Podcast,
  PopularEntry,
  NewPodcastEntry,
  PodcastRatingSummary,
  PodcastApi,
  decodeXmlEntities
} from "../../src/api/podcasts";
import { Preferences } from "../../src/storage/preferences";
import { applyLanguageFilter } from "../../src/podcasts/languageFilter";
import { OfflineBanner, VpnBanner } from "../../src/components/NetworkBanners";
import { NativeAndroid } from "../../src/native/nativeAndroid";

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
  // Comedy & Satire
  if (g.includes("comedy") || g.includes("satire") || g.includes("sitcom") || g.includes("sketch") || g.includes("standup") || g.includes("spoof")) return "mood";
  // Drama, Theatre, Soaps
  if (g.includes("drama") || g.includes("theat") || g.includes("soap")) return "theaters";
  // News & Bulletins
  if (g.includes("news") || g.includes("bulletin")) return "newspaper";
  // Politics
  if (g.includes("politic")) return "account-balance";
  // Music genres
  if (g.includes("pop") || g.includes("rock") || g.includes("rnb") || g.includes("hip hop") || g.includes("dancehall") || g.includes("soundtrack") || g.includes("album")) return "album";
  if (g.includes("music") || g.includes("classic") || g.includes("opera") || g.includes("folk") || g.includes("mixes") || g.includes("dance") || g.includes("electronica")) return "music-note";
  if (g.includes("easy listening")) return "headphones";
  // Sports
  if (g.includes("cricket")) return "sports-cricket";
  if (g.includes("football") || g.includes("soccer")) return "sports-soccer";
  if (g.includes("rugby")) return "sports-rugby";
  if (g.includes("tennis")) return "sports-tennis";
  if (g.includes("golf")) return "sports-golf";
  if (g.includes("motor") || g.includes("formula")) return "sports-motorsports";
  if (g.includes("boxing") || g.includes("wrestl")) return "sports-mma";
  if (g.includes("rowing") || g.includes("activit")) return "rowing";
  if (g.includes("sport") || g.includes("gaelic") || g.includes("shinty") || g.includes("snooker")) return "sports-soccer";
  if (g.includes("olympic") || g.includes("paralympic") || g.includes("world cup")) return "emoji-events";
  // Accessibility & Disability
  if (g.includes("disabilit")) return "accessible";
  // SciFi & Fantasy
  if (g.includes("scifi") || g.includes("sci-fi") || g.includes("fantasy")) return "rocket-launch";
  // Nature, Environment, Gardens
  if (g.includes("nature") || g.includes("environment") || g.includes("garden")) return "eco";
  // Homes
  if (g.includes("home")) return "home";
  // Horror & Supernatural
  if (g.includes("horror") || g.includes("supernatural") || g.includes("spooky") || g.includes("paranormal")) return "dark-mode";
  // Languages
  if (g.includes("language")) return "translate";
  // Learning, School, Education
  if (g.includes("learn") || g.includes("school") || g.includes("education") || g.includes("primary") || g.includes("secondary") || g.includes("adult")) return "school";
  // Life Stories, People, Biographies
  if (g.includes("life stor") || g.includes("real life") || g.includes("character") || g.includes("biograph")) return "face";
  // Magazines, Reviews, Articles
  if (g.includes("magazine") || g.includes("review") || g.includes("article")) return "rate-review";
  // Science & Tech
  if (g.includes("science") || g.includes("tech") || g.includes("biotech")) return "biotech";
  // History & Period
  if (g.includes("history") || g.includes("historical") || g.includes("period")) return "history-edu";
  // Crime, Law, Justice
  if (g.includes("crime") || g.includes("justice") || g.includes("investigat")) return "gavel";
  // Food & Cooking
  if (g.includes("food") || g.includes("drink") || g.includes("cook")) return "restaurant";
  // Health & Medical
  if (g.includes("health") || g.includes("wellbeing") || g.includes("medical")) return "health-and-safety";
  // Money & Consumer
  if (g.includes("money") || g.includes("consumer") || g.includes("financ")) return "savings";
  // Games, Quizzes, Panels
  if (g.includes("quiz") || g.includes("game") || g.includes("panel")) return "quiz";
  // Chat, Talk, Discussion, Phone-ins
  if (g.includes("chat") || g.includes("talk") || g.includes("discuss") || g.includes("phone-in")) return "forum";
  // Children & Kids
  if (g.includes("child") || g.includes("pre-school") || g.includes("kid")) return "child-care";
  // Documentary, Factual, Audiobooks
  if (g.includes("documentar") || g.includes("factual") || g.includes("audiobook")) return "menu-book";
  // Arts & Culture
  if (g.includes("art") || g.includes("culture") || g.includes("media")) return "palette";
  // Relationships & Family
  if (g.includes("relationship") || g.includes("famil") || g.includes("romance")) return "favorite";
  // Religion & Philosophy
  if (g.includes("religion") || g.includes("ethic") || g.includes("faith") || g.includes("spiritual")) return "self-improvement";
  // Action, Adventure, Travel
  if (g.includes("action") || g.includes("adventure") || g.includes("explore")) return "explore";
  if (g.includes("travel")) return "travel-explore";
  // Thriller & Mystery
  if (g.includes("thriller") || g.includes("mystery")) return "visibility";
  // War & Conflict
  if (g.includes("war") || g.includes("disaster") || g.includes("military")) return "shield";
  // World & Global
  if (g.includes("world") || g.includes("global") || g.includes("international")) return "public";
  // Entertainment & Variety
  if (g.includes("entertainment") || g.includes("variety") || g.includes("perform") || g.includes("event") || g.includes("celebrat")) return "celebration";
  if (g.includes("experiment") || g.includes("new")) return "auto-awesome";

  return "podcasts";
}



export default function PodcastsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ search?: string; savedSearchId?: string }>();
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const flatListRef = useRef<FlatList>(null);

  // Data state
  const [catalog, setCatalog] = useState<Podcast[]>([]);
  // Full unfiltered catalog, kept so the language filter can be toggled without refetching.
  const rawCatalogRef = useRef<Podcast[]>([]);
  const [popularRanks, setPopularRanks] = useState<Map<string, number>>(new Map());
  const [newPodcastsList, setNewPodcastsList] = useState<NewPodcastEntry[]>([]);
  const [subscribedIds, setSubscribedIds] = useState<string[]>([]);
  const [podcastRatings, setPodcastRatings] = useState<Record<string, PodcastRatingSummary>>(() =>
    Preferences.getCachedPodcastRatings()
  );
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(true);

  // Tab & Filter state
  const [activeTab, setActiveTab] = useState<TabId>("popular");
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);

  useEffect(() => {
    if (params.search) {
      router.replace({
        pathname: "/modal/podcast-search",
        params: { search: params.search, savedSearchId: params.savedSearchId }
      });
    }
  }, [params.search, params.savedSearchId, router]);

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

        rawCatalogRef.current = cats;
        setCatalog(applyLanguageFilter(cats));

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

        // Fetch star ratings for catalog podcasts
        const ids = cats.map((p) => p.id);
        PodcastApi.fetchRatings(ids).then((ratingsMap) => {
          if (mounted) setPodcastRatings(ratingsMap);
        }).catch(() => {});
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

  // Re-apply the language filter live when the Indexing preference changes.
  useEffect(() => {
    const subscription = Preferences.onChanged((key) => {
      if (key !== "pref_exclude_non_english") return;
      const raw = rawCatalogRef.current;
      if (raw.length > 0) setCatalog(applyLanguageFilter(raw));
    });
    return () => subscription.remove();
  }, []);

  // Compute all unique genres from the catalog
  const allGenres = useMemo(() => {
    const genreMap = new Map<string, number>();
    catalog.forEach((p) => {
      p.genres
        .filter((g) => !/^podcasts?$/i.test(g.trim()))
        .forEach((g) => {
          genreMap.set(g, (genreMap.get(g) || 0) + 1);
        });
    });
    return Array.from(genreMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [catalog]);


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

  // Shake-to-shuffle: mirrors the Kotlin accelerometer listener, active only while this
  // tab is focused and the preference is enabled.
  useFocusEffect(
    useCallback(() => {
      setSubscribedIds(Preferences.getSubscribedPodcasts());
      setPodcastRatings(Preferences.getCachedPodcastRatings());
      if (!Preferences.getSetting("pref_shake_random", false)) return undefined;
      const stop = NativeAndroid.startShakeDetection(() => handleShuffle());
      return stop;
    }, [handleShuffle])
  );
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

  // Sort and filter displayed podcasts for current tab
  const displayedPodcasts = useMemo(() => {
    let list = catalog;

    // Filter by genre if genre filter active
    if (selectedGenre) {
      list = list.filter((p) => p.genres.includes(selectedGenre));
    }

    switch (activeTab) {
      case "popular": {
        return list
          .filter((podcast) => popularRanks.has(podcast.id))
          .sort((a, b) => {
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
        const newIdsOrder = newPodcastsList.slice(0, 50).map((n) => n.id);
        const newSet = new Set(newIdsOrder);
        return list
          .filter((p) => newSet.has(p.id))
          .sort((a, b) => newIdsOrder.indexOf(a.id) - newIdsOrder.indexOf(b.id))
          .slice(0, 50);
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


  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.surfaceContainer }]} edges={["top"]}>
      {/* 56dp Top Toolbar matching podcasts_title_bar */}
      <View style={[styles.toolbar, { backgroundColor: theme.surfaceContainer }]}>
        <Text style={[styles.toolbarTitle, { color: theme.onSurface }]}>Podcasts</Text>
        <View style={styles.toolbarActions}>
          <TouchableOpacity
            style={styles.toolbarIconButton}
            onPress={() => router.push("/modal/podcast-search")}
            accessibilityLabel="Search podcasts"
            accessibilityRole="button"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialIcons name="search" size={24} color={theme.onSurface} />
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

      <OfflineBanner />
      <VpnBanner />

      {/* Tabs matching podcasts_sort_tabs: Popular, Last Updated, New Podcasts, Genre, A-Z */}
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

      {/* Active Genre Filter Indicator */}
      {selectedGenre && (
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
    const ratingSummary = podcastRatings[podcast.id];
    const displayGenres = podcast.genres
      .filter((g) => !/^podcasts?$/i.test(g.trim()))
      .slice(0, 2);

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
          <Text style={[styles.podcastTitle, { color: theme.onSurface }]} numberOfLines={2}>
            {decodeXmlEntities(podcast.title)}
          </Text>

          <Text style={[styles.podcastDesc, { color: theme.onSurfaceVariant }]} numberOfLines={3}>
            {decodeXmlEntities(podcast.description)}
          </Text>

          <View style={styles.cardBottomRow}>
            {ratingSummary && ratingSummary.count > 0 && ratingSummary.average > 0 ? (
              <Text style={[styles.ratingBadge, { color: theme.onSurfaceVariant }]}>
                {`★ ${ratingSummary.average.toFixed(1)}`}
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
  }
});
