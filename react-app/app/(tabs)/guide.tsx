import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Modal,
  Platform,
  Dimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Animated
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { useAppTheme } from "../../src/theme/colors";
import { useResponsiveLayout } from "../../src/theme/responsive";
import { lockToLandscape, lockToPortrait, unlockOrientation } from "../../src/utils/orientation";
import { ScreenHeader, HeaderIconButton } from "../../src/components/ScreenHeader";
import { Station, StationCategory, StationRepository } from "../../src/data/stations";
import {
  ScheduleEntry,
  fetchScheduleForDate,
  formatScheduleTime
} from "../../src/api/showInfo";
import { Podcast, PodcastApi } from "../../src/api/podcasts";
import { usePlayerStore } from "../../src/store/playerStore";
import { StationLogo } from "../../src/components/StationLogo";
import { OfflineBanner } from "../../src/components/NetworkBanners";
import {
  generateTimeSlots,
  calculateScheduleBlockLayout,
  matchShowToPodcast,
  normalizeTitle,
  getGuideGridDimensions,
  PIXELS_PER_MINUTE,
  ROW_HEIGHT,
  STATION_COLUMN_WIDTH,
  TIMELINE_WIDTH,
  MINUTES_IN_DAY
} from "../../src/utils/scheduleGridUtils";

interface DateTab {
  dateStr: string;
  label: string;
  dayName: string;
  dayNum: string;
  isToday: boolean;
}

type GuideFilterCategory = "National" | "Favourites" | "Regions" | "Local" | "All";

const DAYS_EACH_WAY = 7; // -7 to +7 days = 15 tabs

export default function GuideScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const windowWidth = Dimensions.get("window").width;

  // Per-field selectors: this screen mounts every station row and every schedule block, so a
  // whole-store subscription rebuilt the entire grid on every store write.
  const currentStation = usePlayerStore((s) => s.currentStation);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const favorites = usePlayerStore((s) => s.favorites);
  const playStation = usePlayerStore((s) => s.playStation);
  const toggleFavorite = usePlayerStore((s) => s.toggleFavorite);
  const togglePlayPause = usePlayerStore((s) => s.togglePlayPause);

  const { isLandscape } = useResponsiveLayout();
  const {
    rowHeight,
    stationColumnWidth,
    pixelsPerMinute,
    timelineWidth,
    timeRulerHeight
  } = useMemo(() => getGuideGridDimensions(isLandscape), [isLandscape]);

  // Manage screen orientation for Guide: allow sensor rotation while focused,
  // restore portrait lock when leaving Guide tab.
  useFocusEffect(
    useCallback(() => {
      void unlockOrientation();
      return () => {
        if (Platform.OS !== "ios" || !Platform.isPad) {
          void lockToPortrait();
        }
      };
    }, [])
  );

  const toggleOrientation = useCallback(async () => {
    if (isLandscape) {
      await lockToPortrait();
    } else {
      await lockToLandscape();
    }
  }, [isLandscape]);

  // 15 date tabs (-7 ... Today ... +7)
  const { tabs, todayIndex } = useMemo(() => {
    const list: DateTab[] = [];
    const now = new Date();
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    for (let offset = -DAYS_EACH_WAY; offset <= DAYS_EACH_WAY; offset++) {
      const d = new Date();
      d.setDate(now.getDate() + offset);

      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const dateStr = `${year}-${month}-${day}`;

      const isToday = offset === 0;
      const dayName = isToday ? "Today" : dayNames[d.getDay()];
      const dayNum = String(d.getDate());
      const label = isToday ? "Today" : `${dayName} ${dayNum}`;

      list.push({ dateStr, label, dayName, dayNum, isToday });
    }

    return { tabs: list, todayIndex: DAYS_EACH_WAY };
  }, []);

  const [selectedTabIndex, setSelectedTabIndex] = useState(todayIndex);
  const canGoPrevDay = selectedTabIndex > 0;
  const canGoNextDay = selectedTabIndex < tabs.length - 1;

  const goToPrevDay = useCallback(() => {
    if (canGoPrevDay) setSelectedTabIndex((prev) => prev - 1);
  }, [canGoPrevDay]);

  const goToNextDay = useCallback(() => {
    if (canGoNextDay) setSelectedTabIndex((prev) => prev + 1);
  }, [canGoNextDay]);

  const goToToday = useCallback(() => {
    setSelectedTabIndex(todayIndex);
  }, [todayIndex]);

  const [activeCategory, setActiveCategory] = useState<GuideFilterCategory>("National");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [podcastMap, setPodcastMap] = useState<Map<string, Podcast>>(new Map());

  // Schedules state: stationId -> ScheduleEntry[]
  const [stationSchedules, setStationSchedules] = useState<Record<string, ScheduleEntry[]>>({});
  const [loadingStations, setLoadingStations] = useState<Record<string, boolean>>({});

  // Selected program for detail bottom sheet
  const [selectedProgram, setSelectedProgram] = useState<{
    entry: ScheduleEntry;
    station: Station;
    matchedPodcast?: Podcast;
    isNow: boolean;
  } | null>(null);

  // Scroll references
  const dateScrollRef = useRef<ScrollView>(null);
  const timeRulerScrollRef = useRef<ScrollView>(null);
  const mainHorizontalScrollRef = useRef<any>(null);
  const scrollX = useRef(new Animated.Value(0)).current;

  const selectedTab = tabs[selectedTabIndex] || tabs[todayIndex];
  const isSelectedDateToday = selectedTab.isToday;

  // Compute start of the selected day in ms
  const dayStartMs = useMemo(() => {
    const [year, month, day] = selectedTab.dateStr.split("-").map(Number);
    return new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
  }, [selectedTab.dateStr]);

  // Keep nowMs ticking every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  // Time slots for header ruler (48 half-hour slots)
  const timeSlots = useMemo(() => generateTimeSlots(), []);

  // Filter stations according to selected category
  const filteredStations = useMemo(() => {
    const all = StationRepository.getAll();
    if (activeCategory === "Favourites") {
      const favSet = new Set(favorites);
      return all.filter((s) => favSet.has(s.id));
    }
    if (activeCategory === "National") {
      return all.filter((s) => s.category === StationCategory.NATIONAL);
    }
    if (activeCategory === "Regions") {
      return all.filter((s) => s.category === StationCategory.REGIONS);
    }
    if (activeCategory === "Local") {
      return all.filter((s) => s.category === StationCategory.LOCAL);
    }
    return all;
  }, [activeCategory, favorites]);

  /**
   * Everything about a schedule block that does not depend on scroll position, theme or the
   * play state, resolved once per schedule load instead of once per render.
   *
   * This was the grid's dominant cost. `matchShowToPodcast` falls back to scanning the whole
   * podcast catalogue, so the render was doing O(blocks × catalogue) work on every single
   * render — and the grid renders on every store write and every 30s clock tick. It also
   * allocated a fresh `Animated` interpolation node per block per render, churning the
   * animated-node graph that the horizontal scroll drives.
   */
  const guideRows = useMemo(() => {
    return filteredStations.map((station) => {
      const scheduleKey = `${station.id}_${selectedTab.dateStr}`;
      const entries = stationSchedules[scheduleKey] || [];
      return {
        station,
        scheduleKey,
        blocks: entries.map((entry, index) => {
          const { left, width } = calculateScheduleBlockLayout(
            entry.startTimeMs,
            entry.endTimeMs,
            dayStartMs,
            pixelsPerMinute
          );
          const blockWidth = Math.max(20, width - 2);
          // Keep long titles in view as the user scrolls horizontally.
          const stickyContentWidth = Math.min(blockWidth - 8, blockWidth < 80 ? 70 : 160);
          const maxStickyOffset = Math.max(0, blockWidth - stickyContentWidth - 8);
          const stickyTranslateX =
            maxStickyOffset > 0
              ? scrollX.interpolate({
                  inputRange: [left, left + maxStickyOffset],
                  outputRange: [0, maxStickyOffset],
                  extrapolate: "clamp"
                })
              : 0;
          return {
            entry,
            index,
            left,
            blockWidth,
            stickyContentWidth,
            stickyTranslateX,
            // A slot with no programme name shows the station name, which identifies a network
            // rather than a show — matching it to a podcast would be arbitrary.
            matchedPodcast: entry.isUnnamed
              ? undefined
              : matchShowToPodcast(entry.title, entry.episodeTitle, podcastMap)
          };
        })
      };
    });
  }, [filteredStations, stationSchedules, selectedTab.dateStr, dayStartMs, podcastMap, scrollX, pixelsPerMinute]);

  // Fetch podcast catalog once on mount
  useEffect(() => {
    async function loadPodcasts() {
      try {
        const catalog = await PodcastApi.fetchLiveCatalog();
        const map = new Map<string, Podcast>();
        catalog.forEach((p) => {
          // Keyed the same way `matchShowToPodcast` normalises the show title, otherwise a
          // podcast title carrying punctuation ("Woman's Hour") can never match exactly.
          map.set(normalizeTitle(p.title), p);
        });
        setPodcastMap(map);
      } catch (err) {
        console.warn("Failed to load podcast catalog for Guide:", err);
      }
    }
    loadPodcasts();
  }, []);

  // Center date ribbon on mount
  useEffect(() => {
    setTimeout(() => {
      dateScrollRef.current?.scrollTo({
        x: Math.max(0, todayIndex * 70 - 120),
        animated: false
      });
    }, 120);
  }, [todayIndex]);

  // Center horizontal timeline on current time when "Today" is active
  const scrollToNow = useCallback(() => {
    if (!isSelectedDateToday) return;
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const targetX = Math.max(0, currentMinutes * pixelsPerMinute - (isLandscape ? 220 : 140));
    const scrollRef =
      mainHorizontalScrollRef.current?.scrollTo
        ? mainHorizontalScrollRef.current
        : mainHorizontalScrollRef.current?.getNode?.();
    scrollRef?.scrollTo({ x: targetX, animated: true });
    timeRulerScrollRef.current?.scrollTo({ x: targetX, animated: true });
  }, [isSelectedDateToday, pixelsPerMinute, isLandscape]);

  useEffect(() => {
    if (isSelectedDateToday) {
      setTimeout(scrollToNow, 250);
    }
  }, [isSelectedDateToday, scrollToNow]);

  const [isRefreshing, setIsRefreshing] = useState(false);

  const retryStation = useCallback(
    async (stationId: string) => {
      const dateStr = selectedTab.dateStr;
      setLoadingStations((prev) => ({ ...prev, [stationId]: true }));
      try {
        const entries = await fetchScheduleForDate(stationId, dateStr, true);
        if (entries.length > 0) {
          setStationSchedules((prev) => ({
            ...prev,
            [`${stationId}_${dateStr}`]: entries
          }));
        }
      } finally {
        setLoadingStations((prev) => {
          const next = { ...prev };
          delete next[stationId];
          return next;
        });
      }
    },
    [selectedTab.dateStr]
  );

  const refreshSchedules = useCallback(async () => {
    setIsRefreshing(true);
    const dateStr = selectedTab.dateStr;
    const CHUNK_SIZE = 4;
    try {
      for (let i = 0; i < filteredStations.length; i += CHUNK_SIZE) {
        const chunk = filteredStations.slice(i, i + CHUNK_SIZE);
        const results = await Promise.all(
          chunk.map(async (st) => {
            try {
              const entries = await fetchScheduleForDate(st.id, dateStr, true);
              return { stationId: st.id, entries };
            } catch {
              return { stationId: st.id, entries: [] };
            }
          })
        );
        setStationSchedules((prev) => {
          const next = { ...prev };
          results.forEach((r) => {
            if (r.entries.length > 0) {
              next[`${r.stationId}_${dateStr}`] = r.entries;
            }
          });
          return next;
        });
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [filteredStations, selectedTab.dateStr]);

  // Fetch schedules for visible stations when station list or date changes
  useEffect(() => {
    let cancelled = false;
    const dateStr = selectedTab.dateStr;

    async function loadSchedules() {
      const toFetch = filteredStations.filter((s) => {
        const key = `${s.id}_${dateStr}`;
        const cached = stationSchedules[key];
        return !cached || cached.length === 0;
      });

      if (toFetch.length === 0) return;

      // Mark as loading
      setLoadingStations((prev) => {
        const next = { ...prev };
        toFetch.forEach((s) => {
          next[s.id] = true;
        });
        return next;
      });

      // Chunk requests by 4 for mobile socket reliability
      const CHUNK_SIZE = 4;
      for (let i = 0; i < toFetch.length; i += CHUNK_SIZE) {
        if (cancelled) break;
        const chunk = toFetch.slice(i, i + CHUNK_SIZE);
        const results = await Promise.all(
          chunk.map(async (st) => {
            try {
              const entries = await fetchScheduleForDate(st.id, dateStr);
              return { stationId: st.id, entries };
            } catch {
              return { stationId: st.id, entries: [] };
            }
          })
        );

        if (cancelled) break;

        setStationSchedules((prev) => {
          const next = { ...prev };
          results.forEach((r) => {
            if (r.entries.length > 0) {
              next[`${r.stationId}_${dateStr}`] = r.entries;
            }
          });
          return next;
        });

        setLoadingStations((prev) => {
          const next = { ...prev };
          chunk.forEach((st) => {
            delete next[st.id];
          });
          return next;
        });
      }
    }

    loadSchedules();

    return () => {
      cancelled = true;
    };
  }, [filteredStations, selectedTab.dateStr]);

  // Synchronize horizontal scrolling between schedule grid and time ruler
  const onGridHorizontalScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = e.nativeEvent.contentOffset.x;
      timeRulerScrollRef.current?.scrollTo({ x, animated: false });
    },
    []
  );

  const onHorizontalScrollEvent = useMemo(
    () =>
      Animated.event(
        [{ nativeEvent: { contentOffset: { x: scrollX } } }],
        {
          useNativeDriver: true,
          listener: onGridHorizontalScroll
        }
      ),
    [onGridHorizontalScroll, scrollX]
  );

  // Compute position of the "NOW" vertical indicator
  const nowIndicatorLeft = useMemo(() => {
    if (!isSelectedDateToday) return null;
    const d = new Date(nowMs);
    const minute = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
    return Math.round(minute * pixelsPerMinute);
  }, [isSelectedDateToday, nowMs, pixelsPerMinute]);

  // Handle playing a show
  const handlePlayStation = async (station: Station) => {
    try {
      await playStation(station);
    } catch (e) {
      console.warn("Failed to play station:", e);
    }
  };

  // Open podcast detail
  const handleOpenPodcast = (podcast: Podcast) => {
    setSelectedProgram(null);
    router.push({
      pathname: "/modal/podcast-detail",
      params: {
        podcastId: podcast.id,
        podcastData: JSON.stringify(podcast)
      }
    });
  };

  return (
    <View
      style={[styles.container, { backgroundColor: theme.surfaceContainer }]}
    >
      {!isLandscape ? (
        <>
          <ScreenHeader
            title="Guide"
            rightActions={
              <>
                <HeaderIconButton
                  icon="refresh"
                  accessibilityLabel="Refresh schedules"
                  disabled={isRefreshing}
                  onPress={() => void refreshSchedules()}
                >
                  {isRefreshing ? (
                    <ActivityIndicator size="small" color={theme.primary} />
                  ) : (
                    <MaterialIcons name="refresh" size={24} color={theme.onSurface} />
                  )}
                </HeaderIconButton>

                {isSelectedDateToday && (
                  <TouchableOpacity
                    style={[styles.nowButton, { backgroundColor: theme.primaryContainer }]}
                    onPress={scrollToNow}
                    activeOpacity={0.7}
                    accessibilityLabel="Scroll to now"
                  >
                    <MaterialIcons name="my-location" size={16} color={theme.onPrimaryContainer} />
                    <Text style={[styles.nowButtonText, { color: theme.onPrimaryContainer }]}>
                      Now
                    </Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={[styles.orientationButton, { backgroundColor: theme.surfaceVariant }]}
                  onPress={toggleOrientation}
                  activeOpacity={0.7}
                  accessibilityLabel="Switch to landscape guide mode"
                >
                  <MaterialIcons name="screen-rotation" size={16} color={theme.onSurface} />
                  <Text style={[styles.orientationButtonText, { color: theme.onSurface }]}>
                    Landscape
                  </Text>
                </TouchableOpacity>
              </>
            }
          />

          <OfflineBanner />

          {/* Date Ribbon (-7 to +7 days) */}
          <View style={[styles.dateRibbonContainer, { backgroundColor: theme.surface }]}>
            <ScrollView
              ref={dateScrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.dateRibbonScroll}
            >
              {tabs.map((tab, idx) => {
                const isSelected = idx === selectedTabIndex;
                return (
                  <TouchableOpacity
                    key={tab.dateStr}
                    style={[
                      styles.dateTab,
                      isSelected && {
                        backgroundColor: theme.primary,
                        borderColor: theme.primary
                      }
                    ]}
                    onPress={() => setSelectedTabIndex(idx)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.dateTabDayName,
                        { color: isSelected ? theme.onPrimary : theme.onSurfaceVariant }
                      ]}
                    >
                      {tab.dayName}
                    </Text>
                    {!tab.isToday && (
                      <Text
                        style={[
                          styles.dateTabDayNum,
                          { color: isSelected ? theme.onPrimary : theme.onSurface }
                        ]}
                      >
                        {tab.dayNum}
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          {/* Category Filter Pills */}
          <View style={[styles.categoryFilterBar, { backgroundColor: theme.surface }]}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.categoryFilterScroll}
            >
              {(["National", "Favourites", "Regions", "Local", "All"] as GuideFilterCategory[]).map(
                (cat) => {
                  const isSelected = activeCategory === cat;
                  return (
                    <TouchableOpacity
                      key={cat}
                      style={[
                        styles.filterPill,
                        isSelected
                          ? { backgroundColor: theme.secondaryContainer, borderColor: theme.primary }
                          : { backgroundColor: theme.surfaceContainer, borderColor: theme.outlineVariant }
                      ]}
                      onPress={() => setActiveCategory(cat)}
                      activeOpacity={0.7}
                    >
                      {cat === "Favourites" && (
                        <MaterialIcons
                          name="star"
                          size={14}
                          color={isSelected ? theme.onSecondaryContainer : theme.star}
                          style={{ marginRight: 4 }}
                        />
                      )}
                      <Text
                        style={[
                          styles.filterPillText,
                          {
                            color: isSelected ? theme.onSecondaryContainer : theme.onSurfaceVariant,
                            fontWeight: isSelected ? "700" : "500"
                          }
                        ]}
                      >
                        {cat}
                      </Text>
                    </TouchableOpacity>
                  );
                }
              )}
            </ScrollView>
          </View>
        </>
      ) : (
        /* Unified Landscape Mode Toolbar */
        <View
          style={[
            styles.landscapeToolbar,
            {
              backgroundColor: theme.surface,
              borderBottomColor: theme.outlineVariant,
              paddingLeft: Math.max(10, insets.left),
              paddingRight: Math.max(10, insets.right),
              paddingTop: Math.max(2, insets.top)
            }
          ]}
        >
          {/* Left: Category filter pills */}
          <View style={styles.landscapeCategoriesContainer}>
            {(["National", "Favourites", "Regions", "Local", "All"] as GuideFilterCategory[]).map(
              (cat) => {
                const isSelected = activeCategory === cat;
                return (
                  <TouchableOpacity
                    key={cat}
                    style={[
                      styles.landscapeCategoryPill,
                      isSelected
                        ? { backgroundColor: theme.secondaryContainer, borderColor: theme.primary }
                        : { backgroundColor: theme.surfaceContainer, borderColor: theme.outlineVariant }
                    ]}
                    onPress={() => setActiveCategory(cat)}
                    activeOpacity={0.7}
                  >
                    {cat === "Favourites" && (
                      <MaterialIcons
                        name="star"
                        size={12}
                        color={isSelected ? theme.onSecondaryContainer : theme.star}
                        style={{ marginRight: 3 }}
                      />
                    )}
                    <Text
                      style={[
                        styles.landscapeCategoryPillText,
                        {
                          color: isSelected ? theme.onSecondaryContainer : theme.onSurfaceVariant,
                          fontWeight: isSelected ? "700" : "500"
                        }
                      ]}
                    >
                      {cat}
                    </Text>
                  </TouchableOpacity>
                );
              }
            )}
          </View>

          {/* Center: Date Stepper (< Today · Tue 12 Oct >) */}
          <View style={styles.landscapeDateStepper}>
            <TouchableOpacity
              style={[styles.stepperArrow, !canGoPrevDay && styles.stepperArrowDisabled]}
              disabled={!canGoPrevDay}
              onPress={goToPrevDay}
              accessibilityLabel="Previous day"
            >
              <MaterialIcons
                name="chevron-left"
                size={20}
                color={canGoPrevDay ? theme.onSurface : theme.onSurfaceVariant + "55"}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.landscapeDateLabelPill,
                selectedTab.isToday
                  ? { backgroundColor: theme.primaryContainer }
                  : { backgroundColor: theme.surfaceContainer }
              ]}
              onPress={() => {
                if (!selectedTab.isToday) goToToday();
              }}
            >
              <MaterialIcons
                name="event"
                size={14}
                color={selectedTab.isToday ? theme.onPrimaryContainer : theme.primary}
              />
              <Text
                style={[
                  styles.landscapeDateLabelText,
                  {
                    color: selectedTab.isToday ? theme.onPrimaryContainer : theme.onSurface,
                    fontWeight: "700"
                  }
                ]}
              >
                {selectedTab.label}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.stepperArrow, !canGoNextDay && styles.stepperArrowDisabled]}
              disabled={!canGoNextDay}
              onPress={goToNextDay}
              accessibilityLabel="Next day"
            >
              <MaterialIcons
                name="chevron-right"
                size={20}
                color={canGoNextDay ? theme.onSurface : theme.onSurfaceVariant + "55"}
              />
            </TouchableOpacity>

            {!selectedTab.isToday && (
              <TouchableOpacity
                style={[styles.landscapeTodayJumpButton, { backgroundColor: theme.primary }]}
                onPress={goToToday}
                accessibilityLabel="Jump to today"
              >
                <Text style={[styles.landscapeTodayJumpText, { color: theme.onPrimary }]}>Today</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Right: Actions (Now, Refresh, Live Audio pill, Portrait toggle) */}
          <View style={styles.landscapeRightActions}>
            {currentStation && (
              <TouchableOpacity
                style={[styles.landscapePlaybackPill, { backgroundColor: theme.surfaceVariant }]}
                onPress={() => void togglePlayPause()}
                accessibilityLabel={`${isPlaying ? "Pause" : "Play"} ${currentStation.title}`}
              >
                <StationLogo stationId={currentStation.id} size={20} borderRadius={4} />
                <MaterialIcons
                  name={isPlaying ? "pause" : "play-arrow"}
                  size={16}
                  color={theme.primary}
                />
              </TouchableOpacity>
            )}

            {isSelectedDateToday && (
              <TouchableOpacity
                style={[styles.landscapeNowButton, { backgroundColor: theme.primaryContainer }]}
                onPress={scrollToNow}
                accessibilityLabel="Scroll to now"
              >
                <MaterialIcons name="my-location" size={14} color={theme.onPrimaryContainer} />
                <Text style={[styles.landscapeNowButtonText, { color: theme.onPrimaryContainer }]}>
                  Now
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.landscapeIconButton}
              disabled={isRefreshing}
              onPress={() => void refreshSchedules()}
              accessibilityLabel="Refresh schedules"
            >
              {isRefreshing ? (
                <ActivityIndicator size="small" color={theme.primary} />
              ) : (
                <MaterialIcons name="refresh" size={20} color={theme.onSurface} />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.landscapePortraitButton, { backgroundColor: theme.surfaceVariant }]}
              onPress={toggleOrientation}
              accessibilityLabel="Exit landscape mode"
            >
              <MaterialIcons name="screen-rotation" size={16} color={theme.onSurface} />
              <Text style={[styles.landscapePortraitButtonText, { color: theme.onSurface }]}>
                Portrait
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Grid Container */}
      <View style={[styles.gridContainer, { backgroundColor: theme.surface }]}>
        {/* Sticky Top Time Ruler Row */}
        <View
          style={[
            styles.stickyHeaderRow,
            {
              height: timeRulerHeight,
              borderBottomColor: theme.outlineVariant,
              paddingLeft: insets.left
            }
          ]}
        >
          {/* Pinned top-left corner */}
          <View
            style={[
              styles.cornerBox,
              {
                width: stationColumnWidth,
                height: timeRulerHeight,
                borderRightColor: theme.outlineVariant
              }
            ]}
          >
            <Text
              style={[
                styles.cornerText,
                { color: theme.onSurfaceVariant, fontSize: isLandscape ? 10 : 11 }
              ]}
            >
              STATIONS
            </Text>
          </View>

          {/* Horizontally scrolling Time Ruler */}
          <ScrollView
            ref={timeRulerScrollRef}
            horizontal
            scrollEnabled={false}
            showsHorizontalScrollIndicator={false}
            style={styles.timeRulerScroll}
          >
            <View style={{ width: timelineWidth, height: timeRulerHeight, flexDirection: "row" }}>
              {timeSlots.map((slot) => (
                <View
                  key={slot.minuteOffset}
                  style={[
                    styles.timeSlotCell,
                    {
                      width: 30 * pixelsPerMinute,
                      height: timeRulerHeight,
                      borderLeftColor: theme.outlineVariant
                    }
                  ]}
                >
                  <Text
                    style={[
                      styles.timeSlotText,
                      { color: theme.onSurfaceVariant, fontSize: isLandscape ? 10 : 11 }
                    ]}
                  >
                    {slot.label}
                  </Text>
                </View>
              ))}

              {/* Marker for NOW on the ruler */}
              {nowIndicatorLeft !== null && (
                <View
                  style={[
                    styles.nowRulerPointer,
                    { left: nowIndicatorLeft - 6, borderTopColor: "#E53935" }
                  ]}
                />
              )}
            </View>
          </ScrollView>
        </View>

        {/* Outer Vertical ScrollView for all Stations & Program Rows */}
        <ScrollView
          style={styles.mainVerticalScroll}
          contentContainerStyle={{
            paddingBottom: isLandscape ? 20 + insets.bottom : 160 + insets.bottom
          }}
          showsVerticalScrollIndicator={true}
        >
          <View style={[styles.gridBodyRow, { paddingLeft: insets.left }]}>
            {/* Pinned Left Station Column */}
            <View
              style={[
                styles.stationColumn,
                { width: stationColumnWidth, borderRightColor: theme.outlineVariant }
              ]}
            >
              {filteredStations.map((station) => {
                const isStationCurrent = currentStation?.id === station.id;
                const isFav = favorites.includes(station.id);

                return (
                  <View
                    key={station.id}
                    style={[
                      styles.stationCell,
                      {
                        height: rowHeight,
                        borderBottomColor: theme.outlineVariant,
                        backgroundColor: isStationCurrent ? theme.primaryContainer : theme.surface
                      }
                    ]}
                  >
                    <StationLogo
                      stationId={station.id}
                      size={isLandscape ? 28 : 36}
                      borderRadius={isLandscape ? 6 : 8}
                    />
                    <Text
                      style={[
                        styles.stationCellTitle,
                        {
                          color: isStationCurrent ? theme.onPrimaryContainer : theme.onSurface,
                          fontSize: isLandscape ? 10 : 11
                        }
                      ]}
                      numberOfLines={1}
                    >
                      {station.title}
                    </Text>

                    {/* Quick favorite star */}
                    <TouchableOpacity
                      style={styles.stationFavButton}
                      onPress={() => toggleFavorite(station.id)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <MaterialIcons
                        name={isFav ? "star" : "star-border"}
                        size={16}
                        color={isFav ? theme.star : theme.starInactive}
                      />
                    </TouchableOpacity>
                  </View>
                );
              })}

              {filteredStations.length === 0 && (
                <View style={styles.emptyStationsContainer}>
                  <Text style={[styles.emptyText, { color: theme.onSurfaceVariant }]}>
                    No stations found
                  </Text>
                </View>
              )}
            </View>

            {/* Horizontally Scrollable Timeline Body */}
            <Animated.ScrollView
              ref={mainHorizontalScrollRef}
              horizontal
              onScroll={onHorizontalScrollEvent}
              scrollEventThrottle={16}
              showsHorizontalScrollIndicator={true}
              style={styles.timelineHorizontalScroll}
            >
              <View style={{ width: timelineWidth }}>
                {guideRows.map((row) => {
                  const { station, blocks } = row;
                  const isLoading = loadingStations[station.id];
                  const isStationPlaying = currentStation?.id === station.id && isPlaying;

                  return (
                    <View
                      key={station.id}
                      style={[
                        styles.stationScheduleRow,
                        {
                          height: rowHeight,
                          borderBottomColor: theme.outlineVariant
                        }
                      ]}
                    >
                      {/* Grid background 30-min division lines */}
                      {timeSlots.map((slot) => (
                        <View
                          key={slot.minuteOffset}
                          style={[
                            styles.backgroundTimeDivider,
                            {
                              left: slot.minuteOffset * pixelsPerMinute,
                              borderLeftColor: theme.outlineVariant
                            }
                          ]}
                        />
                      ))}

                      {/* Schedule Blocks */}
                      {blocks.map((block) => {
                        const { entry, index, left, blockWidth, matchedPodcast } = block;
                        const isNow =
                          isSelectedDateToday &&
                          nowMs >= entry.startTimeMs &&
                          nowMs < entry.endTimeMs;

                        const isVeryNarrow = blockWidth < 50;
                        const isNarrow = blockWidth < 80;
                        const showPodcastBadge = Boolean(matchedPodcast) && blockWidth >= 60;
                        const showTime = !isVeryNarrow;
                        const { stickyContentWidth, stickyTranslateX } = block;

                        return (
                          <TouchableOpacity
                            key={`${entry.startTimeMs}_${index}`}
                            style={[
                              styles.programBlock,
                              {
                                left,
                                width: blockWidth,
                                height: rowHeight - 6,
                                top: 3,
                                paddingHorizontal: isVeryNarrow ? 4 : isNarrow ? 6 : 8,
                                paddingVertical: isLandscape ? 2 : 4,
                                backgroundColor: isNow
                                  ? theme.primaryContainer
                                  : theme.surfaceVariant,
                                borderColor: isNow ? theme.primary : theme.outlineVariant
                              }
                            ]}
                            activeOpacity={0.7}
                            onPress={() => {
                              if (isNow) {
                                void handlePlayStation(station);
                              } else {
                                setSelectedProgram({
                                  entry,
                                  station,
                                  matchedPodcast,
                                  isNow
                                });
                              }
                            }}
                          >
                            <Animated.View
                              style={[
                                styles.blockContent,
                                {
                                  maxWidth: stickyContentWidth,
                                  transform: [{ translateX: stickyTranslateX }]
                                }
                              ]}
                            >
                              <View style={styles.blockTitleRow}>
                                {/* Prominent Red Play Button for currently airing shows (Freeview inspired) */}
                                {isNow && (
                                  <TouchableOpacity
                                    style={styles.blockPlayButton}
                                    onPress={() => void handlePlayStation(station)}
                                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                  >
                                    <MaterialIcons
                                      name={
                                        isStationPlaying
                                          ? "volume-up"
                                          : "play-circle-filled"
                                      }
                                      size={isVeryNarrow ? 14 : isNarrow ? 16 : isLandscape ? 18 : 22}
                                      color="#E53935"
                                    />
                                  </TouchableOpacity>
                                )}

                                <Text
                                  style={[
                                    styles.blockTitle,
                                    {
                                      color: isNow
                                        ? theme.onPrimaryContainer
                                        : theme.onSurfaceVariant,
                                      fontWeight: isNow ? "700" : "600",
                                      fontSize: isVeryNarrow ? 9.5 : isNarrow ? 10.5 : isLandscape ? 11 : 12,
                                      lineHeight: isVeryNarrow ? 12 : isNarrow ? 13 : isLandscape ? 14 : 16,
                                      flex: 1,
                                      paddingRight: showPodcastBadge ? 18 : 0
                                    }
                                  ]}
                                  numberOfLines={2}
                                >
                                  {entry.title}
                                </Text>
                              </View>

                              {showTime && (
                                <Text
                                  style={[
                                    styles.blockTime,
                                    {
                                      color: isNow
                                        ? theme.onPrimaryContainer
                                        : theme.onSurfaceVariant,
                                      fontSize: isNarrow ? 8.5 : isLandscape ? 9 : 10,
                                      marginTop: isLandscape ? 1 : 2
                                    }
                                  ]}
                                  numberOfLines={1}
                                >
                                  {formatScheduleTime(entry.startTimeMs)}
                                </Text>
                              )}

                              {/* Podcast Badge Icon in corner if matching podcast exists and space permits */}
                              {showPodcastBadge && (
                                <TouchableOpacity
                                  style={styles.blockPodcastBadge}
                                  onPress={() => handleOpenPodcast(matchedPodcast!)}
                                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                >
                                  <MaterialIcons
                                    name="podcasts"
                                    size={isNarrow ? 13 : isLandscape ? 14 : 16}
                                    color={theme.primary}
                                  />
                                </TouchableOpacity>
                              )}
                            </Animated.View>
                          </TouchableOpacity>
                        );
                      })}

                      {/* Loading placeholder if station schedule is in-flight */}
                      {isLoading && blocks.length === 0 && (
                        <View style={styles.loadingRowContainer}>
                          <ActivityIndicator size="small" color={theme.primary} />
                          <Text
                            style={[
                              styles.loadingRowText,
                              { color: theme.onSurfaceVariant }
                            ]}
                          >
                            Loading schedule...
                          </Text>
                        </View>
                      )}

                      {/* Retry row if station schedule failed to load */}
                      {!isLoading && blocks.length === 0 && (
                        <TouchableOpacity
                          style={styles.retryRowContainer}
                          onPress={() => void retryStation(station.id)}
                          activeOpacity={0.7}
                        >
                          <MaterialIcons name="refresh" size={16} color={theme.primary} />
                          <Text style={[styles.loadingRowText, { color: theme.primary }]}>
                            Schedule unavailable · Tap to retry
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}

                {/* Vertical "NOW" indicator line extending down across all stations */}
                {nowIndicatorLeft !== null && (
                  <View
                    pointerEvents="none"
                    style={[
                      styles.verticalNowLine,
                      {
                        left: nowIndicatorLeft,
                        height: Math.max(100, filteredStations.length * rowHeight),
                        backgroundColor: "#E53935"
                      }
                    ]}
                  />
                )}
              </View>
            </Animated.ScrollView>
          </View>
        </ScrollView>
      </View>

      {/* Program Detail Modal */}
      {selectedProgram && (
        <Modal
          visible={true}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setSelectedProgram(null)}
        >
          <View style={styles.modalOverlay}>
            <View
              style={[
                styles.modalCard,
                isLandscape && styles.modalCardLandscape,
                { backgroundColor: theme.surface, borderColor: theme.outlineVariant }
              ]}
            >
              <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
                <View style={styles.modalHeader}>
                  <View style={styles.modalStationHeader}>
                    <StationLogo
                      stationId={selectedProgram.station.id}
                      size={32}
                      borderRadius={6}
                    />
                    <Text style={[styles.modalStationTitle, { color: theme.onSurface }]}>
                      {selectedProgram.station.title}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => setSelectedProgram(null)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <MaterialIcons name="close" size={24} color={theme.onSurfaceVariant} />
                  </TouchableOpacity>
                </View>

                <Text style={[styles.modalProgramTitle, { color: theme.onSurface }]}>
                  {selectedProgram.entry.title}
                </Text>

                {selectedProgram.entry.episodeTitle && (
                  <Text
                    style={[styles.modalEpisodeSubtitle, { color: theme.onSurfaceVariant }]}
                  >
                    {selectedProgram.entry.episodeTitle}
                  </Text>
                )}

                <View style={styles.modalTimeRow}>
                  <MaterialIcons
                    name="schedule"
                    size={16}
                    color={theme.primary}
                    style={{ marginRight: 6 }}
                  />
                  <Text style={[styles.modalTimeText, { color: theme.onSurfaceVariant }]}>
                    {formatScheduleTime(selectedProgram.entry.startTimeMs)} –{" "}
                    {formatScheduleTime(selectedProgram.entry.endTimeMs)}
                  </Text>
                </View>

                {/* Action buttons */}
                <View style={styles.modalActionButtons}>
                  {selectedProgram.isNow && (
                    <TouchableOpacity
                      style={[styles.modalActionButton, { backgroundColor: theme.primary }]}
                      onPress={() => {
                        void handlePlayStation(selectedProgram.station);
                        setSelectedProgram(null);
                      }}
                    >
                      <MaterialIcons name="play-arrow" size={20} color={theme.onPrimary} />
                      <Text
                        style={[styles.modalActionButtonText, { color: theme.onPrimary }]}
                      >
                        Listen Live
                      </Text>
                    </TouchableOpacity>
                  )}

                  {selectedProgram.matchedPodcast && (
                    <TouchableOpacity
                      style={[
                        styles.modalActionButton,
                        {
                          backgroundColor: theme.secondaryContainer,
                          borderColor: theme.primary,
                          borderWidth: 1
                        }
                      ]}
                      onPress={() => handleOpenPodcast(selectedProgram.matchedPodcast!)}
                    >
                      <MaterialIcons
                        name="podcasts"
                        size={20}
                        color={theme.onSecondaryContainer}
                      />
                      <Text
                        style={[
                          styles.modalActionButtonText,
                          { color: theme.onSecondaryContainer }
                        ]}
                      >
                        Open Podcast
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  nowButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 4
  },
  nowButtonText: {
    fontSize: 13,
    fontWeight: "700"
  },
  orientationButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 5
  },
  orientationButtonText: {
    fontSize: 12,
    fontWeight: "600"
  },
  landscapeToolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 46,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 4,
    gap: 8
  },
  landscapeCategoriesContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5
  },
  landscapeCategoryPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1
  },
  landscapeCategoryPillText: {
    fontSize: 11
  },
  landscapeDateStepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4
  },
  stepperArrow: {
    padding: 3,
    borderRadius: 12
  },
  stepperArrowDisabled: {
    opacity: 0.3
  },
  landscapeDateLabelPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12
  },
  landscapeDateLabelText: {
    fontSize: 11.5
  },
  landscapeTodayJumpButton: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    marginLeft: 2
  },
  landscapeTodayJumpText: {
    fontSize: 10.5,
    fontWeight: "700"
  },
  landscapeRightActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6
  },
  landscapePlaybackPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 14,
    gap: 5
  },
  landscapeNowButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 3
  },
  landscapeNowButtonText: {
    fontSize: 11,
    fontWeight: "700"
  },
  landscapeIconButton: {
    padding: 5,
    borderRadius: 12
  },
  landscapePortraitButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4
  },
  landscapePortraitButtonText: {
    fontSize: 11,
    fontWeight: "600"
  },
  dateRibbonContainer: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0,0,0,0.1)"
  },
  dateRibbonScroll: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8
  },
  dateTab: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 64,
    borderWidth: 1,
    borderColor: "transparent"
  },
  dateTabDayName: {
    fontSize: 13,
    fontWeight: "700"
  },
  dateTabDayNum: {
    fontSize: 11,
    fontWeight: "500",
    marginTop: 1
  },
  categoryFilterBar: {
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0,0,0,0.08)"
  },
  categoryFilterScroll: {
    paddingHorizontal: 14,
    gap: 8
  },
  filterPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1
  },
  filterPillText: {
    fontSize: 12
  },
  gridContainer: {
    flex: 1
  },
  stickyHeaderRow: {
    height: 38,
    flexDirection: "row",
    borderBottomWidth: 1
  },
  cornerBox: {
    alignItems: "center",
    justifyContent: "center",
    borderRightWidth: 1
  },
  cornerText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5
  },
  timeRulerScroll: {
    flex: 1
  },
  timeSlotCell: {
    height: 38,
    borderLeftWidth: StyleSheet.hairlineWidth,
    paddingLeft: 6,
    justifyContent: "center"
  },
  timeSlotText: {
    fontSize: 11,
    fontWeight: "600"
  },
  nowRulerPointer: {
    position: "absolute",
    top: 0,
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 8,
    borderLeftColor: "transparent",
    borderRightColor: "transparent"
  },
  mainVerticalScroll: {
    flex: 1
  },
  gridBodyRow: {
    flexDirection: "row"
  },
  stationColumn: {
    borderRightWidth: 1
  },
  stationCell: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderBottomWidth: 1
  },
  stationCellTitle: {
    fontSize: 11,
    fontWeight: "700",
    marginTop: 3,
    textAlign: "center"
  },
  stationFavButton: {
    position: "absolute",
    top: 4,
    right: 4
  },
  emptyStationsContainer: {
    padding: 16,
    alignItems: "center"
  },
  emptyText: {
    fontSize: 12
  },
  timelineHorizontalScroll: {
    flex: 1
  },
  stationScheduleRow: {
    position: "relative",
    borderBottomWidth: 1
  },
  backgroundTimeDivider: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 1,
    borderLeftWidth: StyleSheet.hairlineWidth
  },
  programBlock: {
    position: "absolute",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    overflow: "hidden"
  },
  blockContent: {
    flex: 1,
    justifyContent: "center"
  },
  blockTitleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 3
  },
  blockPlayButton: {
    marginTop: 1,
    marginRight: 2
  },
  blockTitle: {
    fontWeight: "600"
  },
  blockTime: {
    opacity: 0.85
  },
  blockPodcastBadge: {
    position: "absolute",
    top: -2,
    right: -2,
    padding: 2,
    borderRadius: 8
  },
  loadingRowContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 20,
    height: "100%",
    gap: 8
  },
  loadingRowText: {
    fontSize: 11,
    fontStyle: "italic"
  },
  retryRowContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 20,
    height: "100%",
    gap: 6
  },
  verticalNowLine: {
    position: "absolute",
    top: 0,
    width: 2,
    zIndex: 10
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24
  },
  modalCard: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    elevation: 8,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 }
  },
  modalCardLandscape: {
    maxWidth: 520,
    maxHeight: "90%",
    padding: 16
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12
  },
  modalStationHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  modalStationTitle: {
    fontSize: 15,
    fontWeight: "700"
  },
  modalProgramTitle: {
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 4
  },
  modalEpisodeSubtitle: {
    fontSize: 14,
    marginBottom: 10
  },
  modalTimeRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 18
  },
  modalTimeText: {
    fontSize: 13,
    fontWeight: "500"
  },
  modalActionButtons: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "flex-end"
  },
  modalActionButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    gap: 6
  },
  modalActionButtonText: {
    fontSize: 14,
    fontWeight: "700"
  }
});
