import { create } from "zustand";
import { fetchShowInfo, getUpcomingShowFromSchedule, CurrentShow } from "../api/showInfo";

export interface StationShowItem {
  stationId: string;
  title: string;
  episodeTitle?: string;
  startTimeMs?: number;
  endTimeMs?: number;
  nextShowTitle?: string;
  imageUrl?: string;
  fetchedAtMs: number;
}

interface StationShowState {
  shows: Record<string, StationShowItem>;
  fetchShowsForStations: (stationIds: string[], force?: boolean) => Promise<void>;
  updateShow: (stationId: string, show: Partial<StationShowItem> & { title: string }) => void;
  checkAndAdvanceShows: () => void;
}

let boundaryTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
const inFlightFetches = new Set<string>();

export const useStationShowStore = create<StationShowState>((set, get) => ({
  shows: {},

  updateShow: (stationId: string, partial: Partial<StationShowItem> & { title: string }) => {
    const existing = get().shows[stationId];
    const updated: StationShowItem = {
      stationId,
      title: partial.title,
      episodeTitle: partial.episodeTitle ?? existing?.episodeTitle,
      startTimeMs: partial.startTimeMs ?? existing?.startTimeMs,
      endTimeMs: partial.endTimeMs ?? existing?.endTimeMs,
      nextShowTitle: partial.nextShowTitle ?? existing?.nextShowTitle,
      imageUrl: partial.imageUrl ?? existing?.imageUrl,
      fetchedAtMs: Date.now()
    };
    set((state) => ({
      shows: { ...state.shows, [stationId]: updated }
    }));
    scheduleNextBoundaryCheck();
  },

  checkAndAdvanceShows: () => {
    const now = Date.now();
    const { shows } = get();
    let hasChanges = false;
    const updatedShows = { ...shows };
    const expiredIds: string[] = [];

    for (const [stationId, show] of Object.entries(shows)) {
      if (show.endTimeMs && now >= show.endTimeMs) {
        // Show has ended - transition to next show immediately
        const nextFromSchedule = getUpcomingShowFromSchedule(stationId, now);
        if (nextFromSchedule && nextFromSchedule.title) {
          updatedShows[stationId] = {
            stationId,
            title: nextFromSchedule.title,
            episodeTitle: nextFromSchedule.episodeTitle,
            startTimeMs: nextFromSchedule.startTimeMs,
            endTimeMs: nextFromSchedule.endTimeMs,
            imageUrl: nextFromSchedule.imageUrl || show.imageUrl,
            fetchedAtMs: now
          };
          hasChanges = true;
        } else if (show.nextShowTitle && show.nextShowTitle !== show.title) {
          updatedShows[stationId] = {
            ...show,
            title: show.nextShowTitle,
            episodeTitle: undefined,
            startTimeMs: show.endTimeMs,
            endTimeMs: undefined,
            nextShowTitle: undefined,
            fetchedAtMs: now
          };
          hasChanges = true;
        }
        expiredIds.push(stationId);
      }
    }

    if (hasChanges) {
      set({ shows: updatedShows });
    }

    if (expiredIds.length > 0) {
      void get().fetchShowsForStations(expiredIds, true);
    } else {
      scheduleNextBoundaryCheck();
    }
  },

  fetchShowsForStations: async (stationIds: string[], force = false) => {
    const now = Date.now();
    const { shows } = get();
    const toFetch = stationIds.filter((id) => {
      if (inFlightFetches.has(id)) return false;
      if (force) return true;
      const current = shows[id];
      if (!current) return true;
      if (current.endTimeMs && now >= current.endTimeMs) return true;
      if (!current.endTimeMs && now - current.fetchedAtMs > 30 * 60 * 1000) return true;
      return false;
    });

    if (toFetch.length === 0) return;

    toFetch.forEach((id) => inFlightFetches.add(id));

    try {
      const CHUNK_SIZE = 5;
      for (let i = 0; i < toFetch.length; i += CHUNK_SIZE) {
        const chunk = toFetch.slice(i, i + CHUNK_SIZE);
        const results = await Promise.all(
          chunk.map(async (stationId) => {
            try {
              const info = await fetchShowInfo(stationId);
              return { stationId, info };
            } catch {
              return { stationId, info: null };
            }
          })
        );

        const newShows: Record<string, StationShowItem> = {};
        for (const res of results) {
          if (res.info && res.info.title && res.info.title !== "BBC Radio") {
            newShows[res.stationId] = {
              stationId: res.stationId,
              title: res.info.title,
              episodeTitle: res.info.episodeTitle,
              startTimeMs: res.info.startTimeMs,
              endTimeMs: res.info.endTimeMs,
              nextShowTitle: res.info.nextShowTitle,
              imageUrl: res.info.imageUrl,
              fetchedAtMs: Date.now()
            };
          }
        }

        if (Object.keys(newShows).length > 0) {
          set((state) => ({
            shows: { ...state.shows, ...newShows }
          }));
        }
      }
    } finally {
      toFetch.forEach((id) => inFlightFetches.delete(id));
      scheduleNextBoundaryCheck();
    }
  }
}));

function scheduleNextBoundaryCheck() {
  if (boundaryTimer) {
    clearTimeout(boundaryTimer);
    boundaryTimer = null;
  }
  const now = Date.now();
  const shows = useStationShowStore.getState().shows;
  const upcomingEndTimes = Object.values(shows)
    .map((s) => s.endTimeMs)
    .filter((t): t is number => typeof t === "number" && t > now);

  if (upcomingEndTimes.length > 0) {
    const earliestEnd = Math.min(...upcomingEndTimes);
    // Buffer by 500ms after the scheduled boundary to ensure now >= endTimeMs
    const delay = Math.max(500, Math.min(earliestEnd - now + 500, 3600000));
    boundaryTimer = setTimeout(() => {
      useStationShowStore.getState().checkAndAdvanceShows();
    }, delay);
  }
}

// Global 15s heartbeat to catch device wake-ups and missed timers
if (!heartbeatInterval) {
  heartbeatInterval = setInterval(() => {
    useStationShowStore.getState().checkAndAdvanceShows();
  }, 15000);
}
