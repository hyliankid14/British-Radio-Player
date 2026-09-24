import React, { useEffect, useRef } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { LastFmApi } from "../src/api/lastfm";
import { Preferences } from "../src/storage/preferences";
import { useAppTheme } from "../src/theme/colors";

export default function LastFmAuthScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const router = useRouter();
  const theme = useAppTheme();
  const executedRef = useRef(false);

  useEffect(() => {
    if (executedRef.current) return;
    executedRef.current = true;

    async function finish() {
      if (!token) {
        router.replace({
          pathname: "/modal/settings-detail",
          params: { section: "lastfm" }
        });
        return;
      }

      try {
        const session = await LastFmApi.exchangeToken(token);
        Preferences.setLastFmSession(session.username, session.sessionKey);
        Alert.alert("Last.fm connected", `Connected as ${session.username}.`);
      } catch (error) {
        Alert.alert(
          "Last.fm connection failed",
          error instanceof Error ? error.message : "Could not connect to Last.fm."
        );
      } finally {
        router.replace({
          pathname: "/modal/settings-detail",
          params: { section: "lastfm" }
        });
      }
    }

    void finish();
  }, [token, router]);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ActivityIndicator size="large" color={theme.primary} />
      <Text style={[styles.text, { color: theme.onSurface }]}>Connecting to Last.fm...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16
  },
  text: {
    fontSize: 16,
    fontWeight: "500"
  }
});
