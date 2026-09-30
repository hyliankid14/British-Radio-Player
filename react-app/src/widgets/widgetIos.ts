import { Directory, File, Paths } from "expo-file-system";
import { Platform, Settings } from "react-native";
import { StationRepository } from "../data/stations";
import type { WidgetLiveState } from "./widgetSync";

/**
 * Feeds the iOS home screen widget.
 *
 * A WidgetKit extension runs in its own process and cannot read the app's storage, so the
 * state is written to a file the native bridge mirrors into the shared App Group container
 * (plugins/ios-widget/Shared/WidgetStateBridge.swift). The revision counter in
 * `NSUserDefaults` is what tells the native side to re-read it, for the same reason the
 * CarPlay snapshot uses one: the file can be large and pulling it through the React Native
 * bridge on every write would be wasteful.
 *
 * Every method is a no-op off iOS, so callers need no platform checks.
 */
const WIDGET_DIRECTORY = "widget";
const STATE_FILE = "state.json";
const CATALOGUE_FILE = "catalogue.json";
const REVISION_KEY = "widget_snapshot_revision";

function directory(): Directory | null {
  if (Platform.OS !== "ios") return null;
  try {
    const dir = new Directory(Paths.cache, WIDGET_DIRECTORY);
    dir.create({ intermediates: true, idempotent: true });
    return dir;
  } catch {
    return null;
  }
}

function write(fileName: string, contents: string): boolean {
  const dir = directory();
  if (!dir) return false;
  try {
    const file = new File(dir, fileName);
    file.create({ intermediates: true, overwrite: true });
    file.write(contents);
    return true;
  } catch {
    return false;
  }
}

/** Bumps the counter the native bridge watches. The file itself stays authoritative. */
function bumpRevision(): void {
  try {
    const current = Number(Settings.get(REVISION_KEY) ?? 0);
    Settings.set({ [REVISION_KEY]: (Number.isFinite(current) ? current : 0) + 1 });
  } catch {
    // The counter is an optimisation; the next write will be picked up anyway.
  }
}

/** The catalogue behind the widget's station picker. Written once per launch. */
let catalogueWritten = false;

function syncCatalogue(): void {
  if (catalogueWritten) return;
  const stations = StationRepository.getAll().map((station) => ({
    id: station.id,
    title: station.title,
    category: station.category
  }));
  if (!write(CATALOGUE_FILE, JSON.stringify(stations))) return;
  catalogueWritten = true;
}

/** The current playback state the widgets render. */
export function syncIosWidgetState(state: WidgetLiveState): boolean {
  if (Platform.OS !== "ios") return false;
  if (!directory()) return false;
  syncCatalogue();
  const written = write(STATE_FILE, JSON.stringify(state));
  if (written) bumpRevision();
  return written;
}
