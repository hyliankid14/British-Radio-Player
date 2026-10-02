import { resolveAppNavigation } from "../src/utils/navigationUtils.ts";

export function redirectSystemPath({
  path,
  initial
}: {
  path: string;
  initial: boolean;
}): string {
  if (!path || typeof path !== "string") {
    return "/(tabs)";
  }

  // Handle media playback notification click (trackplayer://notification.click or bbcradioplayer://notification.click)
  if (path.includes("notification.click")) {
    return "/modal/now-playing";
  }

  const target = resolveAppNavigation(path);
  if (target) {
    if (target.pathname === "/" || target.pathname === "") {
      return "/(tabs)";
    }
    const searchParams = new URLSearchParams(target.params);
    const queryString = searchParams.toString();
    return queryString ? `${target.pathname}?${queryString}` : target.pathname;
  }

  return path;
}

