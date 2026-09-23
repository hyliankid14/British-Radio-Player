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

const MENU_MAX_HEIGHT = 320;
const OPTION_HEIGHT = 56;

/**
 * Material-style select control. Collapses long option lists into a single row and
 * opens a compact menu anchored to the field (not a full-screen picker).
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
  const showAbove = anchor ? anchor.y + anchor.height + menuHeight > windowHeight - 16 : false;
  const menuTop = anchor
    ? Math.max(8, showAbove ? anchor.y - menuHeight - 4 : anchor.y + anchor.height + 4)
    : 0;
  const menuLeft = anchor ? Math.max(8, Math.min(anchor.x, windowWidth - anchor.width - 8)) : 0;

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
            { borderColor: theme.outline, backgroundColor: theme.surfaceContainer },
            disabled && styles.disabled
          ]}
          onPress={open}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityState={{ expanded: visible, disabled }}
        >
          {selected && renderLeading ? (
            <View style={styles.fieldLeading}>{renderLeading(selected)}</View>
          ) : null}
          <Text
            style={[
              styles.fieldText,
              { color: selected ? theme.onSurface : theme.onSurfaceVariant }
            ]}
            numberOfLines={1}
          >
            {selected?.label ?? placeholder}
          </Text>
          <MaterialIcons name="arrow-drop-down" size={24} color={theme.onSurfaceVariant} />
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
                  borderColor: theme.outlineVariant
                }
              ]}
              onPress={() => {}}
            >
              <ScrollView
                keyboardShouldPersistTaps="handled"
                bounces={false}
                showsVerticalScrollIndicator={options.length * OPTION_HEIGHT > MENU_MAX_HEIGHT}
              >
                {options.map((option) => {
                  const active = option.value === value;
                  return (
                    <TouchableOpacity
                      key={String(option.value)}
                      style={[styles.option, { borderBottomColor: theme.outlineVariant }]}
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
                        <Text style={[styles.optionLabel, { color: theme.onSurface }]}>
                          {option.label}
                        </Text>
                        {option.description ? (
                          <Text
                            style={[styles.optionDescription, { color: theme.onSurfaceVariant }]}
                          >
                            {option.description}
                          </Text>
                        ) : null}
                      </View>
                      {active && <MaterialIcons name="check" size={22} color={theme.primary} />}
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
  label: { fontSize: 14, fontWeight: "600", marginTop: 18, marginBottom: 4 },
  field: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginVertical: 8
  },
  disabled: { opacity: 0.5 },
  fieldText: { fontSize: 16, flex: 1, marginRight: 8 },
  fieldLeading: { marginRight: 12 },
  optionLeading: { marginRight: 12 },
  backdrop: { flex: 1 },
  menu: {
    position: "absolute",
    borderWidth: 1,
    borderRadius: 8,
    overflow: "hidden",
    elevation: 8,
    shadowColor: "#000000",
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 }
  },
  option: {
    minHeight: OPTION_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  optionText: { flex: 1, marginRight: 12 },
  optionLabel: { fontSize: 16 },
  optionDescription: { fontSize: 13, marginTop: 2 }
});
