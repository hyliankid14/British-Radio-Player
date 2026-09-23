import { useColorScheme } from "react-native";
import { create } from "zustand";
import { Preferences } from "../storage/preferences";

export type ThemeMode = "system" | "dark" | "light";

export const M3Colors = {
  light: {
    primary: "#6200EE",
    onPrimary: "#FFFFFF",
    primaryContainer: "#EADDFF",
    onPrimaryContainer: "#21005D",

    secondary: "#625B71",
    onSecondary: "#FFFFFF",
    secondaryContainer: "#E8DEF8",
    onSecondaryContainer: "#1D192B",

    background: "#FFFBFE",
    surface: "#FFFBFE",
    onSurface: "#1C1B1F",
    surfaceVariant: "#E7E0EC",
    onSurfaceVariant: "#49454E",
    surfaceContainer: "#F3EDF7",
    outline: "#79747E",
    outlineVariant: "#CAC4D0",
    pillActiveBg: "#E8DEF8",

    star: "#6200EE",
    starInactive: "#49454E",
    miniPlayerBg: "#F3EDF7",
    miniPlayerIconTint: "#424242",
    navIndicator: "#E8DEF8",
    navIndicatorIcon: "#21005D",
    navInactiveIcon: "#49454E",
    divider: "#E7E0EC",
    tabBarBg: "#F3EDF7"
  },
  dark: {
    primary: "#D0BCFF",
    onPrimary: "#370B1E",
    primaryContainer: "#4F378A",
    onPrimaryContainer: "#EADDFF",

    secondary: "#CCC2DC",
    onSecondary: "#332D41",
    secondaryContainer: "#4A4458",
    onSecondaryContainer: "#E8DEF8",

    background: "#1C1B1F",
    surface: "#1C1B1F",
    onSurface: "#E6E1E5",
    surfaceVariant: "#49454E",
    onSurfaceVariant: "#CAC7D0",
    surfaceContainer: "#211F26",
    outline: "#938F99",
    outlineVariant: "#49454F",
    pillActiveBg: "#4F378A",

    star: "#D0BCFF",
    starInactive: "#938F99",
    miniPlayerBg: "#211F26",
    miniPlayerIconTint: "#FFFFFF",
    navIndicator: "#4F378A",
    navIndicatorIcon: "#EADDFF",
    navInactiveIcon: "#CAC7D0",
    divider: "#322E3E",
    tabBarBg: "#211F26"
  }
};

export type ThemeColors = typeof M3Colors.light;

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

/**
 * Holds the selected theme mode so that changing it re-renders the whole app.
 * Preference writes go through the store; external writes (e.g. backup import)
 * are picked up by the MMKV change listener below.
 */
export const useThemeStore = create<ThemeState>((set) => ({
  mode: Preferences.getTheme(),
  setMode: (mode) => {
    Preferences.setTheme(mode);
    set({ mode });
  }
}));

if (typeof Preferences.onChanged === "function") {
  Preferences.onChanged((key) => {
    if (key !== "pref_theme_mode") return;
    const mode = Preferences.getTheme();
    if (useThemeStore.getState().mode !== mode) useThemeStore.setState({ mode });
  });
}

/** Programmatically change the theme (also persists it). */
export function setAppTheme(mode: ThemeMode): void {
  useThemeStore.getState().setMode(mode);
}

/** Reactive read of the selected theme mode. */
export function useThemeMode(): ThemeMode {
  return useThemeStore((state) => state.mode);
}

export function useAppTheme(): ThemeColors {
  const systemScheme = useColorScheme();
  const themePref = useThemeStore((state) => state.mode);

  if (themePref === "dark") return M3Colors.dark;
  if (themePref === "light") return M3Colors.light;
  return systemScheme === "dark" ? M3Colors.dark : M3Colors.light;
}

/** Reactive dark-mode flag for status bar and navigation chrome. */
export function useIsDarkTheme(): boolean {
  const systemScheme = useColorScheme();
  const themePref = useThemeStore((state) => state.mode);
  if (themePref === "dark") return true;
  if (themePref === "light") return false;
  return systemScheme === "dark";
}
