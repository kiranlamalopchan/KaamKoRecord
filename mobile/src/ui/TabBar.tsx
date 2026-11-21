/**
 * Android's bottom navigation: Home · Items · Work · Chats · Profile, as a
 * floating pill over the page. (iPhone keeps Apple's own bar — app/(tabs)/_layout.tsx.)
 *
 * Drawn by the app rather than the phone so it can move the way the top bar
 * does (ui/AppBar): scroll down a page and it slides down and fades out,
 * scroll up and it comes back (ui/chrome.ts) — the same spring, on the
 * native driver, nothing laid out again, so scrolling stays smooth. It also
 * steps aside while the keyboard is up, and every tab opens with it showing.
 *
 * Pages run the full height of the screen under it; the room to scroll the
 * last thing clear of it is `useLayout().bottom`.
 */
import React, { useEffect, useRef, useState } from "react";
import { Animated, Keyboard, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { BottomTabBarProps } from "expo-router/js-tabs";

import { useT } from "@/i18n";
import { useTabBarHidden } from "./chrome";
import { FrostBlur } from "./Frost";
import { tick } from "./haptics";
import { alpha, useTheme } from "./theme";

/** The pill's height, and how far it sits off the bottom of a phone with no home bar. */
export const TAB_BAR_H = 62;
const LIFT = 12;

/** Where the pill's foot sits above the bottom of the screen. */
export function tabBarFoot(insetBottom: number): number {
  return insetBottom > 0 ? Math.max(insetBottom - 6, LIFT) : LIFT;
}

export type TabIcon = { icon: keyof typeof Ionicons.glyphMap; selected: keyof typeof Ionicons.glyphMap };

export function TabBar({ state, descriptors, emitter, navigateToTab, insets, icons, badges }: BottomTabBarProps & {
  icons: Record<string, TabIcon>;
  badges?: Record<string, string | undefined>;
}) {
  const t = useTheme(), tr = useT();
  const foot = tabBarFoot(insets.bottom);

  const scrolledAway = useTabBarHidden();
  const keyboard = useKeyboardUp();
  const hidden = scrolledAway || keyboard;
  const away = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(away, { toValue: hidden ? 1 : 0, useNativeDriver: true, stiffness: 320, damping: 34, mass: 1, overshootClamping: true }).start();
  }, [hidden, away]);
  const slide = away.interpolate({ inputRange: [0, 1], outputRange: [0, TAB_BAR_H + foot + 12] });
  const shown = away.interpolate({ inputRange: [0, 0.6], outputRange: [1, 0], extrapolate: "clamp" });

  return (
    <Animated.View
      pointerEvents={hidden ? "none" : "box-none"}
      style={[styles.wrap, { bottom: foot, left: 16 + insets.left, right: 16 + insets.right, opacity: shown, transform: [{ translateY: slide }] }]}
      testID="tab-bar"
    >
      <View style={[styles.pill, { borderColor: alpha(t.line, t.dark ? 0.9 : 0.7) }]} accessibilityRole="tablist">
        {FrostBlur
          ? <FrostBlur intensity={70} tint={t.dark ? "systemChromeMaterialDark" : "systemChromeMaterialLight"} style={StyleSheet.absoluteFill} />
          : null}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: FrostBlur ? alpha(t.surface, 0.35) : t.surface }]} />
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const options = descriptors[route.key]?.options ?? {};
          const label = tr(String(options.title ?? route.name));
          const icon = icons[route.name];
          const badge = badges?.[route.name];
          const color = focused ? t.brand : t.muted;
          const press = () => {
            const event = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) {
              tick();
              navigateToTab(route.key);
            }
          };
          return (
            <Pressable
              key={route.key}
              onPress={press}
              onLongPress={() => emitter.emit({ type: "tabLongPress", target: route.key })}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={badge ? `${label}, ${badge}` : label}
              style={styles.item}
              testID={`tab-${route.name}`}
            >
              <View style={styles.spot}>
                <Highlight on={focused} color={alpha(t.brand, t.dark ? 0.18 : 0.1)} />
                <View>
                  <Ionicons name={icon ? (focused ? icon.selected : icon.icon) : "ellipse-outline"} size={24} color={color} />
                  {badge ? (
                    <View style={[styles.badge, { backgroundColor: t.danger, borderColor: t.surface }]}>
                      <Text style={[styles.badgeText, { color: t.dangerInk }]} numberOfLines={1}>{badge}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={[styles.label, { color, fontWeight: focused ? "700" : "600" }]} numberOfLines={1}>{label}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </Animated.View>
  );
}

/**
 * The rounded spot behind the open tab. Always drawn, only faded in and out:
 * Android dropped the round corners when a background colour was switched on
 * as the tab changed, and showed a square for a moment.
 */
function Highlight({ on, color }: { on: boolean; color: string }) {
  const shown = useRef(new Animated.Value(on ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(shown, { toValue: on ? 1 : 0, duration: 180, useNativeDriver: true }).start();
  }, [on, shown]);
  return <Animated.View pointerEvents="none" style={[styles.highlight, { backgroundColor: color, opacity: shown, transform: [{ scale: shown.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }] }]} />;
}

/** Whether the keyboard is showing (Android lifts the whole window, bar and all, without this). */
function useKeyboardUp(): boolean {
  const [up, setUp] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", () => setUp(true));
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setUp(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return up;
}

const styles = StyleSheet.create({
  // The shadow on the outside: the pill clips its glass to its round ends,
  // and on iOS that would clip a shadow drawn by the pill too.
  wrap: { position: "absolute", borderRadius: TAB_BAR_H / 2, shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 18, shadowOffset: { width: 0, height: 6 } },
  pill: {
    height: TAB_BAR_H, borderRadius: TAB_BAR_H / 2, overflow: "hidden", flexDirection: "row", alignItems: "center",
    paddingHorizontal: 6, borderWidth: StyleSheet.hairlineWidth, elevation: 10,
  },
  item: { flex: 1, height: "100%", alignItems: "center", justifyContent: "center" },
  spot: { alignItems: "center", justifyContent: "center", gap: 2, height: TAB_BAR_H - 12, minWidth: 58, paddingHorizontal: 8 },
  highlight: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, borderRadius: (TAB_BAR_H - 12) / 2 },
  label: { fontSize: 11 },
  badge: {
    position: "absolute", top: -4, left: 14, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4,
    alignItems: "center", justifyContent: "center", borderWidth: 1.5,
  },
  badgeText: { fontSize: 10, fontWeight: "800" },
});
