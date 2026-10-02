import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StyleProp,
  ViewStyle,
  TextStyle
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Platform, StatusBar as RNStatusBar } from "react-native";
import { useAppTheme } from "../theme/colors";

export interface HeaderIconButtonProps {
  icon?: React.ComponentProps<typeof MaterialIcons>["name"];
  onPress: () => void;
  accessibilityLabel: string;
  accessibilityRole?: "button";
  disabled?: boolean;
  color?: string;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function HeaderIconButton({
  icon,
  onPress,
  accessibilityLabel,
  disabled,
  color,
  children,
  style
}: HeaderIconButtonProps) {
  const theme = useAppTheme();
  return (
    <TouchableOpacity
      style={[styles.iconButton, style]}
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      activeOpacity={0.7}
    >
      {children ?? (icon ? <MaterialIcons name={icon} size={24} color={color ?? theme.onSurface} /> : null)}
    </TouchableOpacity>
  );
}

export interface ScreenHeaderAction {
  icon: React.ComponentProps<typeof MaterialIcons>["name"];
  label: string;
  onPress: () => void;
  disabled?: boolean;
  color?: string;
}

export interface ScreenHeaderProps {
  title: string;
  navigationAction?: {
    icon?: React.ComponentProps<typeof MaterialIcons>["name"];
    label: string;
    onPress: () => void;
    color?: string;
  };
  /** Declarative trailing buttons. Ignored when `rightActions` is supplied. */
  actions?: ScreenHeaderAction[];
  rightActions?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  titleStyle?: StyleProp<TextStyle>;
  safeArea?: boolean;
}

export function ScreenHeader({
  title,
  navigationAction,
  actions,
  rightActions,
  style,
  titleStyle,
  safeArea = true
}: ScreenHeaderProps) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const topInset = safeArea
    ? Math.max(
        insets.top,
        Platform.OS === "android" ? (RNStatusBar.currentHeight ?? 0) : 0
      )
    : 0;

  return (
    <View
      style={[
        styles.header,
        {
          backgroundColor: theme.surfaceContainer,
          paddingTop: topInset,
          height: 56 + topInset
        },
        style
      ]}
    >
      <View style={styles.titleContainer}>
        {navigationAction ? (
          <TouchableOpacity
            style={styles.navButton}
            onPress={navigationAction.onPress}
            accessibilityLabel={navigationAction.label}
            accessibilityRole="button"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.7}
          >
            <MaterialIcons
              name={navigationAction.icon ?? "arrow-back"}
              size={24}
              color={navigationAction.color ?? theme.onSurface}
            />
          </TouchableOpacity>
        ) : null}
        <Text
          style={[styles.title, { color: theme.onSurface }, titleStyle]}
          numberOfLines={1}
        >
          {title}
        </Text>
      </View>
      {actions || rightActions ? (
        <View style={styles.actionsContainer}>
          {actions?.map((action) => (
            <HeaderIconButton
              key={action.label}
              icon={action.icon}
              onPress={action.onPress}
              accessibilityLabel={action.label}
              disabled={action.disabled}
              color={action.color}
            />
          ))}
          {rightActions}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16
  },
  titleContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    marginRight: 8
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.2
  },
  navButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 4,
    marginLeft: -4
  },
  actionsContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center"
  }
});
