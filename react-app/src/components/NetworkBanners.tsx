import React, { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { useAppTheme } from "../theme/colors";
import { useNetworkStatus } from "../store/networkStore";

/**
 * Red offline warning banner, matching the legacy Kotlin layout. Shown at the top of every
 * screen when the device has no connectivity so users understand why live content is missing.
 */
export function OfflineBanner() {
  const { isOnline } = useNetworkStatus();
  if (isOnline) return null;
  return (
    <View style={styles.offlineBanner}>
      <MaterialIcons name="error-outline" size={20} color="#FFFFFF" />
      <Text style={styles.offlineText}>You're offline. Showing downloaded files.</Text>
    </View>
  );
}

/**
 * Dismissible VPN warning banner, mirroring the Kotlin `vpn_warning_banner`. Displayed when
 * a VPN connection is detected because live BBC streams may be geo-restricted.
 */
export function VpnBanner() {
  const theme = useAppTheme();
  const { isVpn } = useNetworkStatus();
  const [dismissed, setDismissed] = useState(false);
  if (!isVpn || dismissed) return null;
  return (
    <View style={[styles.vpnBanner, { backgroundColor: theme.secondaryContainer }]}>
      <Text style={[styles.vpnText, { color: theme.onSecondaryContainer }]}>
        A VPN appears to be active. Some live stations may be unavailable.
      </Text>
      <TouchableOpacity
        onPress={() => setDismissed(true)}
        style={styles.vpnDismiss}
        accessibilityLabel="Dismiss VPN warning"
      >
        <MaterialIcons name="close" size={20} color={theme.onSecondaryContainer} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  offlineBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#D32F2F",
    paddingHorizontal: 16,
    paddingVertical: 10,
    elevation: 8
  },
  offlineText: {
    flex: 1,
    marginLeft: 10,
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "bold"
  },
  vpnBanner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8
  },
  vpnText: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 4
  },
  vpnDismiss: {
    padding: 8
  }
});
