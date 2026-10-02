import React from "react";
import { Redirect } from "expo-router";

/**
 * Fallback route for media notification taps (e.g. bbcradioplayer://notification.click).
 * Immediately redirects to the Now Playing screen.
 */
export default function NotificationClickRoute() {
  return <Redirect href="/modal/now-playing" />;
}
