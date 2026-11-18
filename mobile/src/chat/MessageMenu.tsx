/**
 * What holding a message opens: the screen dims, the message lifts a
 * little where it was, a row of reactions pops up above it one after
 * another, and its actions sit underneath. Tapping a reaction bounces it
 * and sends it; tapping anywhere else puts everything back.
 *
 * When there is not room above or below (a message at the very top or
 * bottom of the screen, or a tall photo) the whole group slides to fit.
 * Opened without a position (VoiceOver's "Message options"), the menu is
 * centred and everything in it is a plain button.
 */
import React, { useEffect } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useT } from "@/i18n";
import { tap } from "@/ui/haptics";
import { useTheme } from "@/ui/theme";
import type { Rect } from "./Bubble";

export const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

export type MenuAction = { label: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void; destructive?: boolean };

const BAR_H = 56, GAP = 8, ROW_H = 48, MENU_W = 230;

function Reaction({ emoji, index, chosen, onPick }: { emoji: string; index: number; chosen: boolean; onPick: (emoji: string) => void }) {
  const t = useTheme(), tr = useT();
  const scale = useSharedValue(0);
  useEffect(() => {
    scale.value = withDelay(40 + index * 35, withSpring(1, { damping: 9, stiffness: 240 }));
  }, [index, scale]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }, { translateY: (1 - scale.value) * 10 }] }));
  const pick = () => {
    tap("light");
    scale.value = withSequence(withTiming(1.55, { duration: 110 }), withSpring(1, { damping: 7, stiffness: 260 }));
    // Let the bounce be seen before the menu goes.
    setTimeout(() => onPick(emoji), 170);
  };
  return (
    <Pressable onPress={pick} accessibilityRole="button" accessibilityLabel={tr("React {emoji}", { emoji })} accessibilityState={{ selected: chosen }} hitSlop={4} testID={`react-${emoji}`}>
      <Animated.View style={[styles.emoji, chosen && { backgroundColor: t.surface2 }, style]}>
        <Text style={{ fontSize: 28 }}>{emoji}</Text>
      </Animated.View>
    </Pressable>
  );
}

export function MessageMenu({ rect, mine, chosen, canReact, actions, onReact, onClose, children }: {
  rect?: Rect; mine: boolean; chosen?: string | null; canReact: boolean;
  actions: MenuAction[]; onReact: (emoji: string) => void; onClose: () => void;
  /** The held message, drawn again on top of the dimmed screen. */
  children?: React.ReactNode;
}) {
  const t = useTheme(), tr = useT();
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const dim = useSharedValue(0), lift = useSharedValue(1), bar = useSharedValue(0), list = useSharedValue(0);

  // Where everything goes: the bar above the message, the actions under it, all moved as one to fit.
  const actionsH = Math.min(actions.length * ROW_H, H * 0.45);
  const top = insets.top + 12, bottom = H - insets.bottom - 12;
  const msg = rect ?? { x: 16, y: (H - 60) / 2, width: W - 32, height: 0 };
  const above = canReact ? BAR_H + GAP : 0;
  let shift = 0;
  if (msg.y - above < top) shift = top - (msg.y - above);
  if (msg.y + shift + msg.height + GAP + actionsH > bottom) shift = bottom - (msg.y + msg.height + GAP + actionsH);
  // A message taller than the screen: keep the reactions on screen and let the list scroll.
  if (msg.y + shift - above < top) shift = top - (msg.y - above);
  const side = mine ? { right: Math.max(12, W - (msg.x + msg.width)) } : { left: Math.max(12, msg.x) };

  useEffect(() => {
    tap("medium");
    dim.value = withTiming(1, { duration: 160 });
    lift.value = withSequence(withTiming(1.035, { duration: 140 }), withSpring(1.02, { damping: 12 }));
    bar.value = withSpring(1, { damping: 13, stiffness: 220 });
    list.value = withDelay(60, withSpring(1, { damping: 15, stiffness: 220 }));
  }, [dim, lift, bar, list]);

  const dimStyle = useAnimatedStyle(() => ({ opacity: dim.value }));
  const msgStyle = useAnimatedStyle(() => ({ transform: [{ translateY: shift * dim.value }, { scale: lift.value }] }));
  const barStyle = useAnimatedStyle(() => ({ opacity: bar.value, transform: [{ translateY: shift + (1 - bar.value) * 14 }, { scale: 0.85 + bar.value * 0.15 }] }));
  const listStyle = useAnimatedStyle(() => ({ opacity: list.value, transform: [{ translateY: shift + (1 - list.value) * -10 }, { scale: 0.92 + list.value * 0.08 }] }));

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent supportedOrientations={["portrait", "landscape"]}>
      {/* A Modal is outside the app's gesture root on Android; the held message (which can be swiped) needs one. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: t.dark ? "rgba(0,0,0,0.6)" : "rgba(0,0,0,0.42)" }, dimStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel={tr("Close")} testID="menu-backdrop" />
      </Animated.View>

      {rect && children ? (
        <Animated.View pointerEvents="none" style={[{ position: "absolute", top: rect.y, left: rect.x, width: rect.width }, msgStyle]}>
          {children}
        </Animated.View>
      ) : null}

      {canReact ? (
        <Animated.View style={[styles.bar, { top: msg.y - BAR_H - GAP, backgroundColor: t.surface, borderColor: t.line }, side, barStyle]} accessibilityLabel={tr("Choose a reaction")}>
          {REACTIONS.map((emoji, i) => <Reaction key={emoji} emoji={emoji} index={i} chosen={chosen === emoji} onPick={onReact} />)}
        </Animated.View>
      ) : null}

      <Animated.View style={[styles.list, { top: msg.y + msg.height + GAP, maxHeight: actionsH, backgroundColor: t.surface, borderColor: t.line }, side, listStyle]}>
        <ScrollView bounces={false} scrollEnabled={actions.length * ROW_H > actionsH}>
          {actions.map((action, i) => (
            <Pressable key={action.label} onPress={() => { onClose(); action.onPress(); }} accessibilityRole="button"
              style={({ pressed }) => [styles.row, { backgroundColor: pressed ? t.surface2 : "transparent", borderBottomColor: t.line, borderBottomWidth: i === actions.length - 1 ? 0 : StyleSheet.hairlineWidth }]}>
              <Text style={{ color: action.destructive ? t.danger : t.text, fontSize: 16, flex: 1 }} numberOfLines={1}>{action.label}</Text>
              <Ionicons name={action.icon} size={20} color={action.destructive ? t.danger : t.text2} />
            </Pressable>
          ))}
        </ScrollView>
      </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bar: { position: "absolute", height: BAR_H, flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 6, borderRadius: BAR_H / 2, borderWidth: StyleSheet.hairlineWidth, shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  emoji: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  list: { position: "absolute", width: MENU_W, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.16, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  row: { minHeight: ROW_H, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16 },
});
