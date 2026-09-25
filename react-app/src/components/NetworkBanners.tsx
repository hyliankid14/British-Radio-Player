import React, { useState, useEffect, useCallback, useId } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { create } from "zustand";
import { useAppTheme } from "../theme/colors";
import { useNetworkStatus } from "../store/networkStore";

/**
 * Session-scoped store ensuring the VPN warning banner appears at most once per user session,
 * mirroring Kotlin's session-level `vpnWarningDismissed` state in MainActivity.
 */
interface VpnBannerSessionStore {
  hasAppeared: boolean;
  dismissed: boolean;
  activeId: string | null;
  claimBanner: (id: string) => boolean;
  dismissBanner: () => void;
  releaseBanner: (id: string) => void;
}

export const useVpnBannerStore = create<VpnBannerSessionStore>((set, get) => ({
  hasAppeared: false,
  dismissed: false,
  activeId: null,
  claimBanner: (id: string) => {
    const state = get();
    if (state.dismissed) return false;
    if (state.activeId === id) return true;
    if (!state.hasAppeared && state.activeId === null) {
      set({ hasAppeared: true, activeId: id });
      return true;
    }
    return false;
  },
  dismissBanner: () => {
    set({ dismissed: true, activeId: null });
  },
  releaseBanner: (id: string) => {
    const { activeId } = get();
    if (activeId === id) {
      // The screen that displayed the banner has unmounted or navigated away.
      // Mark as dismissed so the banner does not reappear on subsequent screens in this session.
      set({ dismissed: true, activeId: null });
    }
  }
}));

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
 * Dismissible VPN warning banner, mirroring the Kotlin `vpn_warning_banner`.
 * Appears at most once during the user's session when a VPN connection is detected,
 * and does not reappear across screens or tab switches once shown or dismissed.
 */
export function VpnBanner() {
  const theme = useAppTheme();
  const { isVpn } = useNetworkStatus();
  const instanceId = useId();
  const dismissed = useVpnBannerStore((state) => state.dismissed);
  const activeId = useVpnBannerStore((state) => state.activeId);
  const claimBanner = useVpnBannerStore((state) => state.claimBanner);
  const dismissBanner = useVpnBannerStore((state) => state.dismissBanner);
  const releaseBanner = useVpnBannerStore((state) => state.releaseBanner);

  // Claim banner when this screen is focused if VPN is active
  useFocusEffect(
    useCallback(() => {
      if (isVpn && !dismissed) {
        claimBanner(instanceId);
      }
      return () => {
        releaseBanner(instanceId);
      };
    }, [isVpn, dismissed, instanceId, claimBanner, releaseBanner])
  );

  // Also listen for mid-session VPN activation while the screen is already mounted
  useEffect(() => {
    if (isVpn && !dismissed && activeId === null && !useVpnBannerStore.getState().hasAppeared) {
      claimBanner(instanceId);
    }
  }, [isVpn, dismissed, activeId, instanceId, claimBanner]);

  useEffect(() => {
    return () => {
      releaseBanner(instanceId);
    };
  }, [instanceId, releaseBanner]);

  if (!isVpn || dismissed || activeId !== instanceId) return null;

  return (
    <View style={[styles.vpnBanner, { backgroundColor: theme.secondaryContainer }]}>
      <Text style={[styles.vpnText, { color: theme.onSecondaryContainer }]}>
        BBC may block some traffic routed through VPNs or proxies. Live sports streams may also be unavailable outside the UK.
      </Text>
      <TouchableOpacity
        onPress={dismissBanner}
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
