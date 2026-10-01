import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { usePathname, useRouter } from "expo-router";
import { MaterialIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppTheme } from "../theme/colors";

const tabs = [
  { path: "/favourites", label: "Favourites", icon: "star-border" as const },
  { path: "/", label: "All Stations", icon: "list" as const },
  { path: "/guide", label: "Guide", icon: "calendar-view-week" as const },
  { path: "/podcasts", label: "Podcasts", icon: "podcasts" as const },
  { path: "/settings", label: "Settings", icon: "settings" as const }
];

export function AppNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: theme.surfaceContainer,
          borderTopColor: theme.divider,
          // These mirror the real tab bar in app/(tabs)/_layout.tsx exactly, so the bar
          // does not jump when a drill-down replaces the tabs. Any change here must be
          // made there too.
          height: 80 + insets.bottom,
          paddingBottom: 8 + insets.bottom,
          paddingHorizontal: Math.max(insets.left, insets.right)
        }
      ]}
    >
      {tabs.map((tab) => {
        const active = tab.path === "/podcasts"
          ? pathname.includes("podcasts")
          : tab.path === "/"
            ? pathname === "/" || pathname.includes("/index")
            : pathname.includes(tab.path.slice(1));
        return (
          <TouchableOpacity
            key={tab.path}
            style={styles.tab}
            onPress={() => router.replace(tab.path)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
          >
            <View style={styles.iconSlot}>
              <View style={[styles.iconIndicator, active && { backgroundColor: theme.navIndicator }]}>
                <MaterialIcons
                  name={active && tab.icon === "star-border" ? "star" : tab.icon}
                  size={24}
                  color={active ? theme.navIndicatorIcon : theme.navInactiveIcon}
                />
              </View>
            </View>
            <Text style={[styles.label, { color: active ? theme.onSurface : theme.navInactiveIcon }]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 80,
    flexDirection: "row",
    justifyContent: "flex-start",
    paddingTop: 8,
    elevation: 4,
    borderTopWidth: StyleSheet.hairlineWidth
  },
  // Matches the item column BottomTabBar builds: the outer item carries paddingTop 4 and
  // the button inside it padding 5, so the content column starts 9 down and is
  // top-aligned. Centring it instead pushed the labels a few dp too low.
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 9,
    paddingHorizontal: 5
  },
  // The real bar sizes the icon wrapper to 28 (ICON_SIZE_TALL in TabBarIcon) and centres
  // the pill inside it, so the label always sits 28 + 4 below the top of the slot.
  iconSlot: {
    height: 28,
    alignItems: "center",
    justifyContent: "center"
  },
  iconIndicator: {
    width: 64,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center"
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 4
  }
});
