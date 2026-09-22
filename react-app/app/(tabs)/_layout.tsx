import React from "react";
import { View, StyleSheet, Text, ToastAndroid, Platform, Alert } from "react-native";
import { Tabs, useRouter } from "expo-router";
import { MaterialIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MiniPlayer } from "../../src/components/MiniPlayer";
import { useAppTheme } from "../../src/theme/colors";
import { useNetworkStatus } from "../../src/store/networkStore";
import { Preferences } from "../../src/storage/preferences";

function notifyOffline(message: string) {
  if (Platform.OS === "android") {
    ToastAndroid.show(message, ToastAndroid.SHORT);
  } else {
    Alert.alert("Offline", message);
  }
}

export default function TabLayout() {
  const theme = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isOnline } = useNetworkStatus();
  const navHeight = 80 + insets.bottom;
  const startupApplied = React.useRef(false);

  // Honour the user's "Startup page" preference on first mount, mirroring the Kotlin app.
  React.useEffect(() => {
    if (startupApplied.current) return;
    startupApplied.current = true;
    const startup = Preferences.getStartupPage();
    if (startup === "all_stations") return;
    const timer = setTimeout(() => {
      try {
        if (startup === "favourites") {
          router.navigate("/(tabs)/favourites");
        } else if (startup === "subscribed_podcasts") {
          router.navigate({ pathname: "/(tabs)/favourites", params: { category: "Subscribed" } });
        } else if (startup === "playlists") {
          router.navigate({ pathname: "/(tabs)/favourites", params: { category: "Playlists" } });
        }
      } catch {
        // Navigation is best-effort on first mount.
      }
    }, 60);
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <View style={[styles.container, { backgroundColor: theme.surface }]}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: [
            styles.tabBar,
            {
              backgroundColor: theme.surfaceContainer,
              borderTopColor: theme.divider,
              height: navHeight,
              paddingBottom: 8 + insets.bottom
            }
          ],
          tabBarActiveTintColor: theme.onSurface,
          tabBarInactiveTintColor: theme.navInactiveIcon,
          tabBarLabelStyle: styles.tabLabel
        }}
      >
        <Tabs.Screen
          name="favourites"
          options={{
            title: "Favourites",
            tabBarIcon: ({ focused, color }) => (
              <View
                style={[
                  styles.iconIndicator,
                  focused && { backgroundColor: theme.navIndicator }
                ]}
              >
                <MaterialIcons
                  name={focused ? "star" : "star-border"}
                  size={24}
                  color={focused ? theme.navIndicatorIcon : theme.navInactiveIcon}
                />
              </View>
            )
          }}
        />
        <Tabs.Screen
          name="index"
          options={{
            title: "All Stations",
            tabBarIcon: ({ focused }) => (
              <View
                style={[
                  styles.iconIndicator,
                  focused && { backgroundColor: theme.navIndicator }
                ]}
              >
                <MaterialIcons
                  name="list"
                  size={24}
                  color={focused ? theme.navIndicatorIcon : theme.navInactiveIcon}
                />
              </View>
            )
          }}
          listeners={{
            tabPress: (event) => {
              if (!isOnline) {
                event.preventDefault();
                notifyOffline(
                  "Live radio is not available while offline. Showing downloaded content."
                );
              }
            }
          }}
        />
        <Tabs.Screen
          name="podcasts"
          options={{
            title: "Podcasts",
            tabBarIcon: ({ focused }) => (
              <View
                style={[
                  styles.iconIndicator,
                  focused && { backgroundColor: theme.navIndicator }
                ]}
              >
                <MaterialIcons
                  name="headphones"
                  size={24}
                  color={focused ? theme.navIndicatorIcon : theme.navInactiveIcon}
                />
              </View>
            )
          }}
          listeners={{
            tabPress: (event) => {
              if (!isOnline) {
                event.preventDefault();
                notifyOffline(
                  "Podcast directory is not available while offline. Showing downloaded content."
                );
              }
            }
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: "Settings",
            tabBarIcon: ({ focused }) => (
              <View
                style={[
                  styles.iconIndicator,
                  focused && { backgroundColor: theme.navIndicator }
                ]}
              >
                <MaterialIcons
                  name="settings"
                  size={24}
                  color={focused ? theme.navIndicatorIcon : theme.navInactiveIcon}
                />
              </View>
            )
          }}
        />
        <Tabs.Screen
          name="library"
          options={{
            href: null
          }}
        />
      </Tabs>

      {/* Mini player anchored directly above bottom navigation */}
      <View style={[styles.miniPlayerWrapper, { bottom: navHeight }]}>
        <MiniPlayer />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  miniPlayerWrapper: {
    position: "absolute",
    bottom: 80, // Height of M3 bottom nav
    left: 0,
    right: 0
  },
  tabBar: {
    height: 80,
    paddingTop: 8,
    paddingBottom: 10,
    elevation: 4
  },
  iconIndicator: {
    width: 64,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center"
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: "600",
    marginTop: 4
  }
});
