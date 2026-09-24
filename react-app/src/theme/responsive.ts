import { useWindowDimensions } from "react-native";

export interface ResponsiveLayout {
  width: number;
  height: number;
  isLandscape: boolean;
  /** True for foldables unfolded or tablets (equivalent to sw600dp or width >= 600dp). */
  isTablet: boolean;
  /** True for large tablets (equivalent to sw800dp). */
  isLargeTablet: boolean;
  /** Artwork dimension for the Now Playing screen matching Kotlin dimens. */
  nowPlayingArtworkSize: number;
  /** MiniPlayer artwork dimension (80dp on tablet, 72dp on phone). */
  miniPlayerArtworkSize: number;
  /** MiniPlayer button touch target size (64dp on tablet, 44dp on phone). */
  miniPlayerButtonSize: number;
  /** MiniPlayer button padding (12dp on tablet, 6dp on phone). */
  miniPlayerButtonPadding: number;
}

export function calculateResponsiveLayout(width: number, height: number): ResponsiveLayout {
  const isLandscape = width > height;
  const shortestDimension = Math.min(width, height);
  const isTablet = shortestDimension >= 600 || width >= 600;
  const isLargeTablet = shortestDimension >= 800 || width >= 800;

  // Artwork sizes matching Kotlin dimens.xml:
  // values-sw800dp/dimens.xml: 220dp
  // values-sw600dp-land/dimens.xml & values-land/dimens.xml: 250dp
  // values-sw600dp/dimens.xml: 240dp
  // values/dimens.xml: phone scaling up to 300dp
  let nowPlayingArtworkSize: number;
  if (isLargeTablet) {
    nowPlayingArtworkSize = 220;
  } else if (isLandscape && (isTablet || width >= 600)) {
    nowPlayingArtworkSize = 250;
  } else if (isTablet) {
    nowPlayingArtworkSize = 240;
  } else {
    nowPlayingArtworkSize = Math.min(width - 64, 300);
  }

  const miniPlayerArtworkSize = isTablet ? 80 : 72;
  const miniPlayerButtonSize = isTablet ? 64 : 44;
  const miniPlayerButtonPadding = isTablet ? 12 : 6;

  return {
    width,
    height,
    isLandscape,
    isTablet,
    isLargeTablet,
    nowPlayingArtworkSize,
    miniPlayerArtworkSize,
    miniPlayerButtonSize,
    miniPlayerButtonPadding
  };
}

export function useResponsiveLayout(): ResponsiveLayout {
  const { width, height } = useWindowDimensions();
  return calculateResponsiveLayout(width, height);
}
