import { useWindowDimensions } from "react-native";
import { calculateResponsiveLayout, type ResponsiveLayout } from "./responsiveLayout";

export * from "./responsiveLayout";

export function useResponsiveLayout(): ResponsiveLayout {
  const { width, height } = useWindowDimensions();
  return calculateResponsiveLayout(width, height);
}
