/**
 * One choice from a short list. The field is the same on both phones: the
 * value, and the ⇅ chevron at its end.
 *
 * iOS opens the system action sheet (ActionSheetIOS, from React Native
 * itself), the one you are on ticked. Android has no action sheet, and its
 * own dropdown drew a grey block and clipped the words, so the field looked
 * nothing like the iPhone's; it opens a sheet of ours instead, from the
 * bottom, with the same rows, the same tick and Cancel at the end.
 */
import React, { useState } from "react";
import { ActionSheetIOS, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { rowValue, sheetRows, type Option } from "./choose";
import { tick } from "./haptics";
import { radius, sp, useTheme } from "./theme";
import { useT } from "@/i18n";

export type { Option } from "./choose";

export function Select({ value, options, onChange, label, testID }: { value: string; options: Option[]; onChange: (value: string) => void; label?: string; testID?: string }) {
  const t = useTheme();
  const [sheet, setSheet] = useState(false);
  const chosen = options.find((o) => o.value === value);
  const pick = (next: string) => { if (next !== value) { tick(); onChange(next); } };

  const open = () => {
    tick();
    if (Platform.OS !== "ios") { setSheet(true); return; }
    // An action sheet has no idea which row is the current one, so the tick
    // is ours — without it the list is eight names and no answer.
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: label,
        options: sheetRows(options, value),
        cancelButtonIndex: options.length,
        userInterfaceStyle: t.dark ? "dark" : "light",
      },
      (index) => { const next = rowValue(options, index); if (next !== null) pick(next); },
    );
  };

  return (
    <>
      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityHint="Opens a list to choose from"
        accessibilityLabel={label ? `${label}: ${chosen?.label ?? value}` : chosen?.label ?? value}
        testID={testID}
        style={({ pressed }) => [styles.field, { backgroundColor: t.field, borderColor: t.fieldLine, opacity: pressed ? 0.8 : 1 }]}
      >
        <Text style={[styles.value, { color: t.text }]} numberOfLines={1}>{chosen?.label ?? value}</Text>
        <Ionicons name="chevron-expand-outline" size={18} color={t.muted} />
      </Pressable>
      {Platform.OS !== "ios" ? (
        <ChoiceSheet visible={sheet} title={label} options={options} value={value}
          onPick={(next) => { setSheet(false); pick(next); }} onClose={() => setSheet(false)} />
      ) : null}
    </>
  );
}

/** Android's list: a sheet from the bottom, as the iPhone's action sheet looks. */
function ChoiceSheet({ visible, title, options, value, onPick, onClose }: {
  visible: boolean; title?: string; options: Option[]; value: string; onPick: (value: string) => void; onClose: () => void;
}) {
  const t = useTheme(), tr = useT();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel={tr("Cancel")} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + sp[3] }]}>
        <View style={[styles.group, { backgroundColor: t.surface, maxHeight: height * 0.6 }]}>
          {title ? <Text style={[styles.title, { color: t.muted, borderBottomColor: t.line }]}>{title}</Text> : null}
          <ScrollView bounces={false}>
            {options.map((o, i) => {
              const on = o.value === value;
              return (
                <Pressable key={o.value} onPress={() => onPick(o.value)} accessibilityRole="button" accessibilityState={{ selected: on }}
                  style={({ pressed }) => [styles.row, { backgroundColor: pressed ? t.surface2 : "transparent" },
                    i < options.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line }]}>
                  <Text style={[styles.rowText, { color: on ? t.brand : t.text, fontWeight: on ? "700" : "500" }]} numberOfLines={2}>{o.label}</Text>
                  {on ? <Ionicons name="checkmark" size={20} color={t.brand} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
        <Pressable onPress={onClose} accessibilityRole="button"
          style={({ pressed }) => [styles.group, styles.cancel, { backgroundColor: pressed ? t.surface2 : t.surface }]}>
          <Text style={{ color: t.brand, fontSize: 17, fontWeight: "700" }}>{tr("Cancel")}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  field: { minHeight: 50, borderRadius: radius.md, borderWidth: 1.5, paddingHorizontal: sp[4], flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: sp[2] },
  value: { fontSize: 16, fontWeight: "600", flex: 1 },
  scrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: sp[3], gap: sp[2] },
  group: { borderRadius: radius.lg, overflow: "hidden" },
  title: { textAlign: "center", fontSize: 13.5, fontWeight: "600", paddingVertical: sp[3], borderBottomWidth: StyleSheet.hairlineWidth },
  row: { minHeight: 56, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: sp[2], paddingHorizontal: sp[5] },
  rowText: { fontSize: 17, textAlign: "center", flexShrink: 1 },
  cancel: { minHeight: 56, alignItems: "center", justifyContent: "center" },
});
