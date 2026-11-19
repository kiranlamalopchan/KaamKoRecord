/**
 * Somebody typing, the way Messenger shows it: three dots that bounce one
 * after another, in a grey bubble with their face at the foot of the
 * conversation (inside the chat only — the Chats list keeps the last message).
 *
 * Who is typing comes from the realtime stream ("typing" events, sent about
 * every three seconds while they type). A name lasts six seconds after the
 * last one, and goes at once when a message lands in that conversation —
 * the dots turn into what they wrote.
 *
 * The dots run on the UI thread (Reanimated), so a busy screen can't stutter
 * them; with Reduce Motion they pulse gently in place instead of bouncing.
 */
import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation, Easing, FadeInDown, FadeOut, useAnimatedStyle, useReducedMotion, useSharedValue,
  withRepeat, withTiming, type SharedValue,
} from "react-native-reanimated";

import type { Person } from "@/api/types";
import { useT } from "@/i18n";
import { Avatar } from "@/ui";
import { useTheme } from "@/ui/theme";
import { onChatEvent } from "./realtime";

/** How long a name stays after its last typing event. */
export const TYPING_FOR_MS = 6000;
const BEAT_MS = 1200;

/** Three dots bouncing one after another. */
export function TypingDots({ color, size = 7 }: { color: string; size?: number }) {
  const calm = useReducedMotion();
  const beat = useSharedValue(0);
  useEffect(() => {
    beat.value = withRepeat(withTiming(1, { duration: BEAT_MS, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(beat);
  }, [beat]);
  return (
    <View style={[styles.dots, { gap: size * 0.55, height: size * 2.4 }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {[0, 1, 2].map((i) => <Dot key={i} beat={beat} index={i} size={size} color={color} calm={calm} />)}
    </View>
  );
}

function Dot({ beat, index, size, color, calm }: { beat: SharedValue<number>; index: number; size: number; color: string; calm: boolean }) {
  const style = useAnimatedStyle(() => {
    // Each dot's own hop: a third of a beat later than the one before, up and
    // back down in the first half of its turn, resting for the rest.
    let p = (beat.value - index * 0.16 + 1) % 1;
    p = p < 0.5 ? p / 0.5 : 1;
    const hop = p < 1 ? Math.sin(p * Math.PI) : 0;
    return calm
      ? { opacity: 0.45 + 0.55 * hop }
      : { opacity: 0.5 + 0.5 * hop, transform: [{ translateY: -size * 0.75 * hop }] };
  });
  return <Animated.View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]} />;
}

/** The grey bubble at the foot of a conversation, with the face of whoever is typing. */
export function TypingBubble({ people, names }: { people: Pick<Person, "initial" | "hue" | "photo" | "is_live">[]; names: string[] }) {
  const t = useTheme(), tr = useT();
  const label = names.length === 1 ? tr("{name} is typing…", { name: names[0] }) : tr("{n} people are typing…", { n: names.length });
  return (
    <Animated.View entering={FadeInDown.springify().damping(18).stiffness(220)} exiting={FadeOut.duration(160)}
      style={styles.row} accessible accessibilityLabel={label} accessibilityLiveRegion="polite" testID="typing-bubble">
      <View style={styles.faces}>
        {people.slice(0, 3).map((p, i) => (
          <View key={i} style={[styles.face, i > 0 && { marginLeft: -10 }, { borderColor: t.bg }]}>
            <Avatar person={p} size={28} live={false} />
          </View>
        ))}
      </View>
      <View style={[styles.bubble, { backgroundColor: t.surface, borderColor: t.line }]}>
        <TypingDots color={t.muted} />
      </View>
    </Animated.View>
  );
}

type Typers = Record<string, Record<string, { name: string; until: number }>>;

/**
 * Who is typing in each conversation: { conversation id: [{ username, name }] }.
 * Drops a name six seconds after its last event, and all of a conversation's
 * names the moment a message arrives there.
 */
export function useTyping(): Record<string, { username: string; name: string }[]> {
  const [typers, setTypers] = useState<Typers>({});
  useEffect(() => onChatEvent((event) => {
    const id = event.conversation_id;
    if (!id) return;
    if (event.type === "typing" && event.username) {
      const who = event.username;
      setTypers((was) => ({ ...was, [id]: { ...was[id], [who]: { name: event.name || who, until: Date.now() + TYPING_FOR_MS } } }));
    } else if (event.type === "message.created") {
      setTypers((was) => {
        if (!was[id]) return was;
        const next = { ...was }; delete next[id]; return next;
      });
    }
  }), []);
  // Expire names as their time runs out.
  useEffect(() => {
    const times = Object.values(typers).flatMap((c) => Object.values(c).map((v) => v.until));
    if (!times.length) return;
    const wait = Math.max(50, Math.min(...times) - Date.now());
    const timer = setTimeout(() => setTypers((was) => {
      const now = Date.now(), next: Typers = {};
      for (const [id, people] of Object.entries(was)) {
        const live = Object.fromEntries(Object.entries(people).filter(([, v]) => v.until > now));
        if (Object.keys(live).length) next[id] = live;
      }
      return next;
    }), wait);
    return () => clearTimeout(timer);
  }, [typers]);
  const out: Record<string, { username: string; name: string }[]> = {};
  for (const [id, people] of Object.entries(typers)) out[id] = Object.entries(people).map(([username, v]) => ({ username, name: v.name }));
  return out;
}

const styles = StyleSheet.create({
  dots: { flexDirection: "row", alignItems: "flex-end", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingVertical: 4, alignSelf: "flex-start" },
  faces: { flexDirection: "row" },
  face: { borderWidth: 2, borderRadius: 999 },
  bubble: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, minWidth: 62, alignItems: "center" },
});
