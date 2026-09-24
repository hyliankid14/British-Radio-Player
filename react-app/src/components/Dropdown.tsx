import React, { useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { useAppTheme } from "../theme/colors";

export interface DropdownOption<T extends string | number> {
  value: T;
  label: string;
  description?: string;
}

interface DropdownProps<T extends string | number> {
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  renderLeading?: (option: DropdownOption<T>) => React.ReactNode;
}

const MENU_MAX_HEIGHT = 340;
const OPTION_HEIGHT = 54;

/**
 * Modern Material 3 / iOS styled select control.
 * Features a rounded surface container with smooth popover anchoring.
 */
export function Dropdown<T extends string | number>({
  value,
  options,
  onChange,
  placeholder = "Select an option",
  label,
  disabled = false,
  renderLeading
}: DropdownProps<T>) {
  const theme = useAppTheme();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const [visible, setVisible] = useState(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const fieldRef = useRef<View>(null);
  const selected = options.find((option) => option.value === value);

  const menuHeight = Math.min(options.length * OPTION_HEIGHT, MENU_MAX_HEIGHT);
  const showAbove = anchor ? anchor.y + anchor.height + menuHeight > windowHeight - 24 : false;
  const menuTop = anchor
    ? Math.max(12, showAbove ? anchor.y - menuHeight - 6 : anchor.y + anchor.height + 6)
    : 0;
  const menuLeft = anchor ? Math.max(12, Math.min(anchor.x, windowWidth - anchor.width - 12)) : 0;

  const close = () => setVisible(false);

  const open = () => {
    if (disabled) return;
    fieldRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height });
      setVisible(true);
    });
  };

  return (
    <>
      {label ? (
        <Text style={[styles.label, { color: theme.onSurfaceVariant }]}>{label}</Text>
      ) : null}
      <View ref={fieldRef} collapsable={false}>
        <TouchableOpacity
          style={[
            styles.field,
            {
              borderColor: visible ? theme.primary : theme.outlineVariant + "45",
              backgroundColor: theme.surfaceVariant
            },
            disabled && styles.disabled
          ]}
          onPress={open}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityState={{ expanded: visible, disabled }}
        >
          {selected && renderLeading ? (
            <View style={styles.fieldLeading}>{renderLeading(selected)}</View>
          ) : null}
          <Text
            style={[
              styles.fieldText,
              {
                color: selected ? theme.onSurface : theme.onSurfaceVariant,
                fontWeight: selected ? "500" : "400"
              }
            ]}
            numberOfLines={1}
          >
            {selected?.label ?? placeholder}
          </Text>
          <MaterialIcons
            name={visible ? "keyboard-arrow-up" : "keyboard-arrow-down"}
            size={22}
            color={visible ? theme.primary : theme.onSurfaceVariant}
          />
        </TouchableOpacity>
      </View>

      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={close}
        statusBarTranslucent
      >
        <Pressable style={styles.backdrop} onPress={close}>
          {anchor ? (
            <Pressable
              style={[
                styles.menu,
                {
                  top: menuTop,
                  left: menuLeft,
                  width: anchor.width,
                  height: menuHeight,
                  backgroundColor: theme.surfaceContainer,
                  borderColor: theme.outlineVariant + "40"
                }
              ]}
              onPress={() => {}}
            >
              <ScrollView
                keyboardShouldPersistTaps="handled"
                bounces={false}
                showsVerticalScrollIndicator={options.length * OPTION_HEIGHT > MENU_MAX_HEIGHT}
              >
                {options.map((option, index) => {
                  const active = option.value === value;
                  const isLast = index === options.length - 1;
                  return (
                    <TouchableOpacity
                      key={String(option.value)}
                      style={[
                        styles.option,
                        active && { backgroundColor: theme.primaryContainer + "30" },
                        !isLast && { borderBottomColor: theme.outlineVariant + "25", borderBottomWidth: StyleSheet.hairlineWidth }
                      ]}
                      onPress={() => {
                        onChange(option.value);
                        close();
                      }}
                      activeOpacity={0.7}
                    >
                      {renderLeading ? (
                        <View style={styles.optionLeading}>{renderLeading(option)}</View>
                      ) : null}
                      <View style={styles.optionText}>
                        <Text
                          style={[
                            styles.optionLabel,
                            {
                              color: active ? theme.primary : theme.onSurface,
                              fontWeight: active ? "600" : "400"
                            }
                          ]}
                          numberOfLines={1}
                        >
                          {option.label}
                        </Text>
                        {option.description ? (
                          <Text
                            style={[styles.optionDescription, { color: theme.onSurfaceVariant }]}
                            numberOfLines={1}
                          >
                            {option.description}
                          </Text>
                        ) : null}
                      </View>
                      {active && (
                        <MaterialIcons name="check" size={20} color={theme.primary} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </Pressable>
          ) : null}
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: "600", marginTop: 14, marginBottom: 6, letterSpacing: 0.2 },
  field: {
    minHeight: 50,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginVertical: 6
  },
  disabled: { opacity: 0.45 },
  fieldText: { fontSize: 15, flex: 1, marginRight: 8 },
  fieldLeading: { marginRight: 12 },
  optionLeading: { marginRight: 12 },
  backdrop: { flex: 1, backgroundColor: "rgba(0, 0, 0, 0.25)" },
  menu: {
    position: "absolute",
    borderWidth: 1,
    borderRadius: 18,
    overflow: "hidden",
    elevation: 10,
    shadowColor: "#000000",
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 }
  },
  option: {
    minHeight: OPTION_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  optionText: { flex: 1, marginRight: 12 },
  optionLabel: { fontSize: 15 },
  optionDescription: { fontSize: 12, marginTop: 2 }
});
