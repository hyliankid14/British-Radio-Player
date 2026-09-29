/**
 * Pure app-version helpers, shared by the About page and analytics.
 *
 * A debug build reports the next patch version so a sideloaded build is always distinguishable
 * from the release it was built on top of (release 2.0.0 -> debug 2.0.1).
 */

export const FALLBACK_APP_VERSION = "2.0.0";

/** Returns `version` with its patch component incremented, or `version` unchanged when not semver. */
export function bumpPatchVersion(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) return version;
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

/** The version a build reports: debug builds are one patch ahead of the release version. */
export function resolveAppVersion(releaseVersion: string, isDebugBuild: boolean): string {
  return isDebugBuild ? bumpPatchVersion(releaseVersion) : releaseVersion;
}

/** Analytics and User-Agent tag: debug builds carry a `-debug` suffix. */
export function debugVersionTag(version: string, isDebugBuild: boolean): string {
  if (!isDebugBuild || version.endsWith("-debug")) return version;
  return `${version}-debug`;
}
