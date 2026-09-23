import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { usePathname, useRouter } from "expo-router";
import { MaterialIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppTheme } from "../theme/colors";

const tabs = [
  { path: "/favourites", label: "Favourites", icon: "star-border" as const },
  { path: "/", label: "All Stations", icon: "list" as const },
  { path: "/podcasts", label: "Podcasts", icon: "headphones" as const },
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
          paddingBottom: insets.bottom,
          height: 80 + insets.bottom
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
            <View style={[styles.iconIndicator, active && { backgroundColor: theme.navIndicator }]}>
              <MaterialIcons
                name={active && tab.icon === "star-border" ? "star" : tab.icon}
                size={24}
                color={active ? theme.navIndicatorIcon : theme.navInactiveIcon}
              />
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
    alignItems: "flex-start",
    justifyContent: "space-around",
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth
  },
  tab: {
    flex: 1,
    alignItems: "center"
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
    marginTop: 4
  }
});
