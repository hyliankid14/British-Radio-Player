import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
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
  Podcast,
  SearchEpisodeResult,
  PodcastRatingSummary,
  PodcastApi,
  decodeXmlEntities,
  matchesBooleanSearch
} from "../../src/api/podcasts";
import { Preferences } from "../../src/storage/preferences";
import { applyLanguageFilter } from "../../src/podcasts/languageFilter";
import { usePlayerStore } from "../../src/store/playerStore";
import { OfflineBanner, VpnBanner } from "../../src/components/NetworkBanners";

export default function PodcastSearchScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ search?: string; savedSearchId?: string }>();
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
  const [isSearching, setIsSearching] = useState(false);
  const [searchPodcastMatches, setSearchPodcastMatches] = useState<Podcast[]>([]);
  const [searchEpisodeMatches, setSearchEpisodeMatches] = useState<SearchEpisodeResult[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<{ podcastId: string; title: string }[]>([]);

  const searchDebounceTimer = useRef<any>(null);
  const textInputRef = useRef<TextInput>(null);

  const [savedSearches, setSavedSearches] = useState(() => Preferences.getSavedPodcastSearches());
  const [saveSearchModalVisible, setSaveSearchModalVisible] = useState(false);
  const [saveSearchName, setSaveSearchName] = useState("");
  const [saveSearchNotify, setSaveSearchNotify] = useState(true);

  const { playEpisode } = usePlayerStore();
  const [resolvingEpisodeId, setResolvingEpisodeId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      setSavedSearches(Preferences.getSavedPodcastSearches());
      setSubscribedIds(Preferences.getSubscribedPodcasts());
      setPodcastRatings(Preferences.getCachedPodcastRatings());
      setRecentSearches(Preferences.getRecentPodcastSearches());
    }, [])
  );

  // Load catalog in background if not already cached
  useEffect(() => {
    let mounted = true;
    PodcastApi.fetchLiveCatalog().then((cats) => {
      if (!mounted) return;
      setCatalog(applyLanguageFilter(cats));
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

  const executeSearch = useCallback(
    (text: string) => {
      const q = text.trim();
      if (!q) {
        setSearchPodcastMatches([]);
        setSearchEpisodeMatches([]);
        setIsSearching(false);
        return;
      }

      setIsSearching(true);
      if (searchDebounceTimer.current) {
        clearTimeout(searchDebounceTimer.current);
      }

      searchDebounceTimer.current = setTimeout(async () => {
        try {
          const [piPodcasts, piEpisodes] = await Promise.all([
            PodcastApi.searchPodcastsOnPi(q, 50),
            PodcastApi.searchEpisodesOnPi(q, 30)
          ]);

          const enriched = applyLanguageFilter(
            PodcastApi.enrichSearchResults(piPodcasts, catalog).filter((podcast) =>
              matchesBooleanSearch(q, `${podcast.title} ${podcast.description} ${podcast.genres.join(" ")}`)
            )
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

          const matchingEpisodes = piEpisodes.filter((episode) =>
            matchesBooleanSearch(q, `${episode.title} ${episode.description}`)
          );
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
        } catch (err) {
          console.warn("Search failed:", err);
        } finally {
          setIsSearching(false);
        }
      }, 250);
    },
    [catalog, params.savedSearchId]
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

        if (resolved) {
          router.push({
            pathname: "/modal/now-playing",
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
      <ScrollView
        contentContainerStyle={[styles.listContent, { paddingBottom: 120 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
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
        {isSearchFocused && isSearchActive && suggestions.length > 0 ? (
          <View style={[styles.suggestionsBox, { backgroundColor: theme.surface, borderColor: theme.outlineVariant }]}>
            {suggestions.map((suggestion) => (
              <TouchableOpacity
                key={suggestion.podcastId}
                style={[styles.suggestionRow, { borderBottomColor: theme.outlineVariant }]}
                onPress={() => handleSelectQuery(suggestion.title)}
              >
                <MaterialIcons name="search" size={20} color={theme.onSurfaceVariant} style={styles.recentIcon} />
                <Text style={[styles.suggestionText, { color: theme.onSurface }]}>{suggestion.title}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        {/* Loading Indicator */}
        {isSearching && (
          <View style={styles.searchLoadingBanner}>
            <ActivityIndicator size="small" color={theme.primary} />
            <Text style={[styles.searchLoadingText, { color: theme.onSurfaceVariant }]}>
              Searching BBC podcasts...
            </Text>
          </View>
        )}

        {/* Active Search Results */}
        {isSearchActive && (
          <>
            {/* Podcasts Section */}
            <Text style={[styles.sectionHeading, { color: theme.onSurface }]}>
              Podcasts {searchPodcastMatches.length > 0 ? `(${searchPodcastMatches.length})` : ""}
            </Text>

            {searchPodcastMatches.length === 0 && !isSearching ? (
              <Text style={[styles.emptySectionText, { color: theme.onSurfaceVariant }]}>
                No matching podcasts found.
              </Text>
            ) : (
              searchPodcastMatches.map((pod) => {
                const isSub = subscribedIds.includes(pod.id);
                const ratingSummary = podcastRatings[pod.id];
                const displayGenres = pod.genres
                  .filter((g) => !/^podcasts?$/i.test(g.trim()))
                  .slice(0, 2);

                return (
                  <TouchableOpacity
                    key={pod.id}
                    style={[
                      styles.podcastCard,
                      { backgroundColor: theme.surface, borderBottomColor: theme.outlineVariant }
                    ]}
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
              })
            )}

            {/* Episodes Section */}
            {searchEpisodeMatches.length > 0 && (
              <>
                <Text style={[styles.sectionHeading, { color: theme.onSurface, marginTop: 24 }]}>
                  Episodes ({searchEpisodeMatches.length})
                </Text>
                {searchEpisodeMatches.map((ep) => {
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
                          <Text
                            style={[styles.episodeResultDesc, { color: theme.onSurfaceVariant }]}
                            numberOfLines={2}
                          >
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
          </>
        )}
      </ScrollView>

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
                onPress={() => {
                  const query = searchQuery.trim();
                  const name = saveSearchName.trim() || query;
                  if (!query) return;
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  suggestionText: {
    fontSize: 15
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
  }
});
