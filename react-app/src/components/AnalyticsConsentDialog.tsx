import React from "react";
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useAppTheme } from "../theme/colors";

interface AnalyticsConsentDialogProps {
  visible: boolean;
  onApprove: () => void;
  onDecline: () => void;
}

/** First-launch opt-in dialog, mirroring the Kotlin `AnalyticsOptInDialog`. */
export function AnalyticsConsentDialog({ visible, onApprove, onDecline }: AnalyticsConsentDialogProps) {
  const theme = useAppTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => {}}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: theme.surfaceContainer }]}>
          <Text style={[styles.title, { color: theme.onSurface }]}>
            Help Improve British Radio Player
          </Text>
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            <Text style={[styles.text, { color: theme.onSurfaceVariant }]}>
              Help improve British Radio Player by sharing anonymous analytics.
              {"\n\n"}
              This data is only used to track the most popular stations, podcasts, and episodes.
              {"\n\n"}
              What we collect:
              {"\n"}• Station, podcast and episode plays
              {"\n"}• App version and date
              {"\n\n"}
              What we don't collect:
              {"\n"}• No user IDs or device identifiers
              {"\n"}• No personal information
              {"\n"}• No location data
              {"\n"}• No IP addresses
              {"\n\n"}
              You can disable analytics any time in Settings → Privacy.
            </Text>
          </ScrollView>
          <View style={styles.actions}>
            <TouchableOpacity style={styles.button} onPress={onDecline} accessibilityRole="button">
              <Text style={[styles.buttonText, { color: theme.primary }]}>Maybe Later</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={onApprove} accessibilityRole="button">
              <Text style={[styles.buttonText, { color: theme.primary }]}>Approve</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24
  },
  card: { width: "100%", maxWidth: 420, maxHeight: "80%", borderRadius: 24, padding: 24 },
  title: { fontSize: 20, fontWeight: "600", marginBottom: 12 },
  body: { flexGrow: 0 },
  bodyContent: { paddingBottom: 8 },
  text: { fontSize: 14, lineHeight: 21 },
  actions: { flexDirection: "row", justifyContent: "flex-end", marginTop: 16 },
  button: { minHeight: 44, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  buttonText: { fontSize: 15, fontWeight: "600" }
});
