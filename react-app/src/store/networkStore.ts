import { useEffect, useState } from "react";
import NetInfo, { NetInfoState } from "@react-native-community/netinfo";
import { NativeAndroid } from "../native/nativeAndroid";

export interface NetworkStatus {
  isOnline: boolean;
  isVpn: boolean;
  isWifi: boolean;
}

const DEFAULT_STATUS: NetworkStatus = {
  isOnline: true,
  isVpn: false,
  isWifi: false
};

function toStatus(state: NetInfoState): NetworkStatus {
  return {
    isOnline: state.isConnected === true && state.isInternetReachable !== false,
    isVpn: NativeAndroid.isVpnActive(),
    isWifi: state.type === "wifi"
  };
}

let cached: NetworkStatus = DEFAULT_STATUS;
let subscription: (() => void) | null = null;
const listeners = new Set<(status: NetworkStatus) => void>();

function emit(status: NetworkStatus): void {
  cached = status;
  listeners.forEach((listener) => listener(cached));
}

function ensureSubscribed(): void {
  if (subscription) return;
  subscription = NetInfo.addEventListener((state) => {
    emit(toStatus(state));
  });
  // VPN state is not surfaced by NetInfo, so refresh it on a slow poll.
  setInterval(() => {
    const vpn = NativeAndroid.isVpnActive();
    if (vpn !== cached.isVpn) emit({ ...cached, isVpn: vpn });
  }, 15000);
}

/** Imperative read of the last known connectivity, mirroring Kotlin's `NetworkQualityDetector.isOnline`. */
export function isOnline(): boolean {
  ensureSubscribed();
  return cached.isOnline;
}

/** Subscribes to connectivity changes; returns an unsubscribe function. */
export function subscribeNetwork(listener: (status: NetworkStatus) => void): () => void {
  ensureSubscribed();
  listeners.add(listener);
  listener(cached);
  return () => listeners.delete(listener);
}

/** React hook exposing live connectivity state. */
export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>(cached);
  useEffect(() => subscribeNetwork(setStatus), []);
  return status;
}
