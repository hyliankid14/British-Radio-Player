import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ScrollView,
  StyleSheet,
  ActivityIndicator
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { useAppTheme } from "../../src/theme/colors";
import { StationRepository } from "../../src/data/stations";
import {
  ScheduleEntry,
  fetchScheduleForDate,
  formatScheduleTime
} from "../../src/api/showInfo";
import { Podcast, PodcastApi } from "../../src/api/podcasts";

interface DateTab {
  dateStr: string; // YYYY-MM-DD
  label: string;   // "Today" or "EEE d"
  isToday: boolean;
}

const DAYS_EACH_WAY = 7; // -7 to +7 days = 15 tabs

export default function ScheduleModal() {
  const router = useRouter();
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ stationId: string; stationTitle?: string }>();

  const station = useMemo(() => {
    return params.stationId ? StationRepository.getById(params.stationId) : null;
  }, [params.stationId]);

  const stationTitle = station?.title || params.stationTitle || "Schedule";

  // Build 15 date tabs (-7 ... Today ... +7)
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
      const label = isToday ? "Today" : `${dayNames[d.getDay()]} ${d.getDate()}`;

      list.push({ dateStr, label, isToday });
    }

    return { tabs: list, todayIndex: DAYS_EACH_WAY };
  }, []);

  const [selectedTabIndex, setSelectedTabIndex] = useState(todayIndex);
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [podcastMap, setPodcastMap] = useState<Map<string, Podcast>>(new Map());

  const tabScrollRef = useRef<ScrollView>(null);

  // Center "Today" tab on mount
  useEffect(() => {
    setTimeout(() => {
      // Estimated tab width ~76dp
      const tabWidth = 76;
      const scrollX = Math.max(0, todayIndex * tabWidth - 140);
      tabScrollRef.current?.scrollTo({ x: scrollX, animated: false });
    }, 100);
  }, [todayIndex]);

  // Load live podcast catalog for podcast links
  useEffect(() => {
    async function loadCatalog() {
      try {
        const catalog = await PodcastApi.fetchLiveCatalog();
        const map = new Map<string, Podcast>();
        catalog.forEach((p) => {
          map.set(p.title.toLowerCase().trim(), p);
        });
        setPodcastMap(map);
      } catch {}
    }
    loadCatalog();
  }, []);

  // Fetch schedule whenever station or tab changes
  useEffect(() => {
    if (!params.stationId) return;
    const currentTab = tabs[selectedTabIndex];
    if (!currentTab) return;

    let mounted = true;
    async function load() {
      setIsLoading(true);
      const entries = await fetchScheduleForDate(params.stationId!, currentTab.dateStr);
      if (mounted) {
        setSchedule(entries);
        setIsLoading(false);
      }
    }
    load();

    return () => {
      mounted = false;
    };
  }, [params.stationId, selectedTabIndex, tabs]);

  const nowMs = Date.now();
  const isSelectedDateToday = tabs[selectedTabIndex]?.isToday ?? false;

  const renderScheduleItem = useCallback(
    ({ item }: { item: ScheduleEntry }) => {
      const isNow =
        isSelectedDateToday && nowMs >= item.startTimeMs && nowMs <= item.endTimeMs;

      // Check if this show has a matching podcast
      const matchedPodcast = podcastMap.get(item.title.toLowerCase().trim());

      return (
        <View
          style={[
            styles.entryRow,
            {
              borderBottomColor: theme.outlineVariant,
              backgroundColor: isNow ? theme.surfaceVariant + "40" : theme.surface
            }
          ]}
        >
          {/* Time column (60dp wide) */}
          <View style={styles.timeColumn}>
            <Text
              style={[
                styles.startTimeText,
                { color: isNow ? theme.primary : theme.onSurface }
              ]}
            >
              {formatScheduleTime(item.startTimeMs)}
            </Text>
            <Text
              style={[
                styles.endTimeText,
                { color: theme.onSurfaceVariant }
              ]}
            >
              {formatScheduleTime(item.endTimeMs)}
            </Text>
          </View>

          {/* Vertical divider line */}
          <View
            style={[
              styles.verticalDivider,
              { backgroundColor: isNow ? theme.primary : theme.outlineVariant }
            ]}
          />

          {/* Title & subtitle column */}
          <View style={styles.infoColumn}>
            <Text
              style={[
                styles.showTitle,
                { color: isNow ? theme.primary : theme.onSurface }
              ]}
              numberOfLines={2}
            >
              {item.title}
            </Text>
            {item.episodeTitle ? (
              <Text
                style={[styles.showSubtitle, { color: theme.onSurfaceVariant }]}
                numberOfLines={1}
              >
                {item.episodeTitle}
              </Text>
            ) : null}
          </View>

          {/* Live broadcast dot indicator */}
          {isNow && (
            <View style={styles.nowIndicatorContainer}>
              <View style={[styles.nowDot, { backgroundColor: theme.primary }]} />
              <Text style={[styles.nowText, { color: theme.primary }]}>NOW</Text>
            </View>
          )}

          {/* Podcast icon if matched */}
          {matchedPodcast && (
            <TouchableOpacity
              style={styles.podcastButton}
              onPress={() => {
                router.push({
                  pathname: "/modal/podcast-detail",
                  params: {
                    podcastId: matchedPodcast.id,
                    podcastData: JSON.stringify(matchedPodcast)
                  }
                });
              }}
            >
              <MaterialIcons name="podcasts" size={20} color={theme.primary} />
            </TouchableOpacity>
          )}
        </View>
      );
    },
    [isSelectedDateToday, nowMs, podcastMap, router, theme]
  );

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.surfaceContainer }]}
      edges={["top"]}
    >
      {/* 56dp Top App Bar */}
      <View style={[styles.appBar, { borderBottomColor: theme.outlineVariant }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialIcons name="arrow-back" size={24} color={theme.onSurface} />
        </TouchableOpacity>
        <Text style={[styles.appBarTitle, { color: theme.onSurface }]} numberOfLines={1}>
          {stationTitle} Schedule
        </Text>
      </View>

      {/* Horizontal Scrollable Date Tabs (-7 to +7 days) */}
      <View style={[styles.tabsContainer, { backgroundColor: theme.surfaceContainer }]}>
        <ScrollView
          ref={tabScrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabsScrollContent}
        >
          {tabs.map((tab, idx) => {
            const isSelected = selectedTabIndex === idx;
            return (
              <TouchableOpacity
                key={tab.dateStr}
                style={[
                  styles.tabItem,
                  isSelected && [
                    styles.tabItemSelected,
                    { borderBottomColor: theme.primary }
                  ]
                ]}
                onPress={() => setSelectedTabIndex(idx)}
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

      {/* Schedule Content */}
      {isLoading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={[styles.loadingText, { color: theme.onSurfaceVariant }]}>
            Loading schedule from BBC...
          </Text>
        </View>
      ) : schedule.length === 0 ? (
        <View style={styles.centerBox}>
          <MaterialIcons name="event-busy" size={48} color={theme.outline} />
          <Text style={[styles.emptyText, { color: theme.onSurfaceVariant }]}>
            No schedule available for this date.
          </Text>
        </View>
      ) : (
        <FlatList
          data={schedule}
          keyExtractor={(item, index) => `${item.startTimeMs}_${index}`}
          renderItem={renderScheduleItem}
          initialNumToRender={20}
          maxToRenderPerBatch={20}
          windowSize={7}
          contentContainerStyle={[styles.listContent, { paddingBottom: 60 + insets.bottom }]}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  appBar: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  backButton: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center"
  },
  appBarTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
    marginLeft: 8,
    marginRight: 16
  },
  tabsContainer: {
    height: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0,0,0,0.08)"
  },
  tabsScrollContent: {
    paddingHorizontal: 8,
    alignItems: "center"
  },
  tabItem: {
    paddingHorizontal: 14,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 3,
    borderBottomColor: "transparent"
  },
  tabItemSelected: {
    borderBottomWidth: 3
  },
  tabText: {
    fontSize: 14
  },
  centerBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 32
  },
  loadingText: {
    fontSize: 14
  },
  emptyText: {
    fontSize: 15,
    textAlign: "center"
  },
  listContent: {
    paddingVertical: 8
  },
  entryRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  timeColumn: {
    width: 60,
    alignItems: "flex-start"
  },
  startTimeText: {
    fontSize: 14,
    fontWeight: "700"
  },
  endTimeText: {
    fontSize: 12,
    marginTop: 2
  },
  verticalDivider: {
    width: 2,
    height: 36,
    marginHorizontal: 12,
    borderRadius: 1
  },
  infoColumn: {
    flex: 1
  },
  showTitle: {
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 20
  },
  showSubtitle: {
    fontSize: 12,
    marginTop: 2
  },
  nowIndicatorContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginLeft: 8
  },
  nowDot: {
    width: 8,
    height: 8,
    borderRadius: 4
  },
  nowText: {
    fontSize: 11,
    fontWeight: "700"
  },
  podcastButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8
  }
});
