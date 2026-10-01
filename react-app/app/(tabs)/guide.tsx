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
  NativeScrollEvent
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAppTheme } from "../../src/theme/colors";
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

  const {
    currentStation,
    isPlaying,
    playStation,
    favorites,
    toggleFavorite
  } = usePlayerStore();

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
  const mainHorizontalScrollRef = useRef<ScrollView>(null);

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

  // Fetch podcast catalog once on mount
  useEffect(() => {
    async function loadPodcasts() {
      try {
        const catalog = await PodcastApi.fetchLiveCatalog();
        const map = new Map<string, Podcast>();
        catalog.forEach((p) => {
          map.set(p.title.toLowerCase().trim(), p);
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
    const targetX = Math.max(0, currentMinutes * PIXELS_PER_MINUTE - 140);
    mainHorizontalScrollRef.current?.scrollTo({ x: targetX, animated: true });
    timeRulerScrollRef.current?.scrollTo({ x: targetX, animated: true });
  }, [isSelectedDateToday]);

  useEffect(() => {
    if (isSelectedDateToday) {
      setTimeout(scrollToNow, 250);
    }
  }, [isSelectedDateToday, scrollToNow]);

  // Fetch schedules for visible stations when station list or date changes
  useEffect(() => {
    let cancelled = false;
    const dateStr = selectedTab.dateStr;

    async function loadSchedules() {
      const toFetch = filteredStations.filter((s) => {
        const key = `${s.id}_${dateStr}`;
        return !stationSchedules[key];
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

      // Chunk requests by 5
      const CHUNK_SIZE = 5;
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
            next[`${r.stationId}_${dateStr}`] = r.entries;
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

  // Compute position of the "NOW" vertical indicator
  const nowIndicatorLeft = useMemo(() => {
    if (!isSelectedDateToday) return null;
    const d = new Date(nowMs);
    const minute = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
    return Math.round(minute * PIXELS_PER_MINUTE);
  }, [isSelectedDateToday, nowMs]);

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
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.surfaceContainer }]}
      edges={["top"]}
    >
      {/* Top Header Bar */}
      <View style={[styles.headerBar, { backgroundColor: theme.surfaceContainer }]}>
        <View style={styles.headerTitleRow}>
          <MaterialIcons name="radio" size={24} color={theme.primary} style={{ marginRight: 8 }} />
          <Text style={[styles.headerTitle, { color: theme.onSurface }]}>Guide</Text>
        </View>

        {isSelectedDateToday && (
          <TouchableOpacity
            style={[styles.nowButton, { backgroundColor: theme.primaryContainer }]}
            onPress={scrollToNow}
            activeOpacity={0.7}
          >
            <MaterialIcons name="my-location" size={16} color={theme.onPrimaryContainer} />
            <Text style={[styles.nowButtonText, { color: theme.onPrimaryContainer }]}>
              Now
            </Text>
          </TouchableOpacity>
        )}
      </View>

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

      {/* Grid Container */}
      <View style={[styles.gridContainer, { backgroundColor: theme.surface }]}>
        {/* Sticky Top Time Ruler Row */}
        <View style={[styles.stickyHeaderRow, { borderBottomColor: theme.outlineVariant }]}>
          {/* Pinned top-left corner */}
          <View
            style={[
              styles.cornerBox,
              { width: STATION_COLUMN_WIDTH, borderRightColor: theme.outlineVariant }
            ]}
          >
            <Text style={[styles.cornerText, { color: theme.onSurfaceVariant }]}>STATIONS</Text>
          </View>

          {/* Horizontally scrolling Time Ruler */}
          <ScrollView
            ref={timeRulerScrollRef}
            horizontal
            scrollEnabled={false}
            showsHorizontalScrollIndicator={false}
            style={styles.timeRulerScroll}
          >
            <View style={{ width: TIMELINE_WIDTH, height: 38, flexDirection: "row" }}>
              {timeSlots.map((slot) => (
                <View
                  key={slot.minuteOffset}
                  style={[
                    styles.timeSlotCell,
                    {
                      width: 30 * PIXELS_PER_MINUTE,
                      borderLeftColor: theme.outlineVariant
                    }
                  ]}
                >
                  <Text style={[styles.timeSlotText, { color: theme.onSurfaceVariant }]}>
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
            paddingBottom: 160 + insets.bottom
          }}
          showsVerticalScrollIndicator={true}
        >
          <View style={styles.gridBodyRow}>
            {/* Pinned Left Station Column */}
            <View
              style={[
                styles.stationColumn,
                { width: STATION_COLUMN_WIDTH, borderRightColor: theme.outlineVariant }
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
                        height: ROW_HEIGHT,
                        borderBottomColor: theme.outlineVariant,
                        backgroundColor: isStationCurrent ? theme.primaryContainer : theme.surface
                      }
                    ]}
                  >
                    <StationLogo stationId={station.id} size={36} borderRadius={8} />
                    <Text
                      style={[
                        styles.stationCellTitle,
                        { color: isStationCurrent ? theme.onPrimaryContainer : theme.onSurface }
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
            <ScrollView
              ref={mainHorizontalScrollRef}
              horizontal
              onScroll={onGridHorizontalScroll}
              scrollEventThrottle={16}
              showsHorizontalScrollIndicator={true}
              style={styles.timelineHorizontalScroll}
            >
              <View style={{ width: TIMELINE_WIDTH }}>
                {filteredStations.map((station) => {
                  const scheduleKey = `${station.id}_${selectedTab.dateStr}`;
                  const entries = stationSchedules[scheduleKey] || [];
                  const isLoading = loadingStations[station.id];
                  const isStationPlaying = currentStation?.id === station.id && isPlaying;

                  return (
                    <View
                      key={station.id}
                      style={[
                        styles.stationScheduleRow,
                        {
                          height: ROW_HEIGHT,
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
                              left: slot.minuteOffset * PIXELS_PER_MINUTE,
                              borderLeftColor: theme.outlineVariant
                            }
                          ]}
                        />
                      ))}

                      {/* Schedule Blocks */}
                      {entries.map((entry, index) => {
                        const { left, width } = calculateScheduleBlockLayout(
                          entry.startTimeMs,
                          entry.endTimeMs,
                          dayStartMs,
                          PIXELS_PER_MINUTE
                        );

                        const isNow =
                          isSelectedDateToday &&
                          nowMs >= entry.startTimeMs &&
                          nowMs < entry.endTimeMs;

                        const matchedPodcast = matchShowToPodcast(
                          entry.title,
                          entry.episodeTitle,
                          podcastMap
                        );

                        const blockWidth = Math.max(20, width - 2);
                        const isVeryNarrow = blockWidth < 50;
                        const isNarrow = blockWidth < 80;
                        const showPodcastBadge = Boolean(matchedPodcast) && blockWidth >= 60;
                        const showTime = !isVeryNarrow;

                        return (
                          <TouchableOpacity
                            key={`${entry.startTimeMs}_${index}`}
                            style={[
                              styles.programBlock,
                              {
                                left,
                                width: blockWidth,
                                height: ROW_HEIGHT - 6,
                                top: 3,
                                paddingHorizontal: isVeryNarrow ? 4 : isNarrow ? 6 : 8,
                                paddingVertical: 4,
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
                            <View style={styles.blockContent}>
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
                                      size={isVeryNarrow ? 15 : isNarrow ? 18 : 22}
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
                                      fontSize: isVeryNarrow ? 10 : isNarrow ? 11 : 12,
                                      lineHeight: isVeryNarrow ? 12 : isNarrow ? 14 : 16,
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
                                      fontSize: isNarrow ? 9 : 10,
                                      marginTop: 2
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
                                    size={isNarrow ? 14 : 16}
                                    color={theme.primary}
                                  />
                                </TouchableOpacity>
                              )}
                            </View>
                          </TouchableOpacity>
                        );
                      })}

                      {/* Loading placeholder if station schedule is in-flight */}
                      {isLoading && entries.length === 0 && (
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
                        height: Math.max(100, filteredStations.length * ROW_HEIGHT),
                        backgroundColor: "#E53935"
                      }
                    ]}
                  />
                )}
              </View>
            </ScrollView>
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
                { backgroundColor: theme.surface, borderColor: theme.outlineVariant }
              ]}
            >
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
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  headerBar: {
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16
  },
  headerTitleRow: {
    flexDirection: "row",
    alignItems: "center"
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "800"
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
