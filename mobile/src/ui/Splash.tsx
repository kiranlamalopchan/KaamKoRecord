/**
 * The way in. It starts exactly where the phone's own splash leaves off —
 * the same clock, the same size, dead centre on the same navy — so the hand
 * over is invisible. Then the hand sweeps one full turn back to its rest,
 * soft mint rings pulse out from the dial, the clock glides up and the name
 * rises in letter by letter, with the tagline after it and "Powered by
 * PeakSuperTech" at the foot; a tap anywhere skips ahead. After about four
 * seconds the clock zooms up at the eye until it fills the screen and the
 * navy clears over the app — five seconds in all (longer only if the keychain
 * or the server is slower still, while the hand keeps turning).
 *
 * Smoothness: every movement is a Reanimated timing or spring running on the
 * UI thread, so the app mounting underneath (busy JS) can't stutter it. The
 * styles are arithmetic on shared values only — no helper is called inside
 * a worklet. Nothing re-renders while it moves: the SVGs are drawn once and
 * only their views are transformed, and the native still is let go only
 * after this layer has painted its first frame — no white flash, no jump.
 */
import React, { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from "react-native-svg";

import { nativeOrNull } from "@/ui/native";

// The drawing, in its own 150-unit box (the same mark as the icon).
const BOX = 150;
const C = BOX / 2;
const R = 46;
const RING_W = 7;
const PIN = 5.5;
const HAND_LEN = 26;
const HAND_W = 5;
const REST = 32.5;
const RING_OUTER = 2 * R + RING_W; // 99 units across the dial

// On screen. The phone's still draws the dial this wide (splash-icon.png:
// 234 of its 400 px, shown 180 pt wide on iOS; the Android foreground: 593
// of 1024 px at 156 dp), so the animation starts at exactly that size and
// settles at ours.
const DIAL = 112;
const NATIVE_DIAL = Platform.OS === "android" ? 90 : 105;
const SIZE = (BOX * DIAL) / RING_OUTER;
const LIFT = 46;

const NAVY = "#121c2d";
const MINT = "#40e7a0";
const MINT_DEEP = "#24bd82";
const INK = "#f1f3f8";
const MUTED = "#8a97ad";

const NAME = "KaamKoRecord";
const TAGLINE = "Clock in. Add it up.";
const BRAND = "Powered by PeakSuperTech";

// The timeline, in ms from the first frame: about five seconds in all —
// the intro over four, then the zoom into the app. If the keychain or the
// server is slower still, the hand keeps turning and the rings breathe.
const SWEEP_MS = 1800;
const TURN_MS = 9000;    // one slow turn of the hand, only while waiting
const LIFT_AT = 1250;
const LIFT_MS = 1000;
const NAME_AT = 1600;
const NAME_MS = 1200;
const TAG_AT = 2550;
const BRAND_AT = 2900;
const INTRO_MS = 4100;
const RIPPLE_MS = 2000;
const EXIT_MS = 900;
const START_CAP_MS = 2500;

// The dial is four arcs with a gap at twelve, three, six and nine. Drawn as
// arcs rather than a ring under a mask: Android scaled the mask wrongly
// inside a viewBox and cut the ring flat on all four sides.
const GAP = (Math.asin(2.2 / R) * 180) / Math.PI;
const ARCS = [0, 90, 180, 270].map((at) => {
  const a = ((at - 90 + GAP) * Math.PI) / 180, b = ((at - GAP) * Math.PI) / 180;
  const [x1, y1, x2, y2] = [C + R * Math.cos(a), C + R * Math.sin(a), C + R * Math.cos(b), C + R * Math.sin(b)];
  return `M${x1.toFixed(2)} ${y1.toFixed(2)}A${R} ${R} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
});

const glide = Easing.bezier(0.22, 1, 0.36, 1);      // fast start, long soft landing
const sweepEase = Easing.bezier(0.65, 0, 0.25, 1);  // wind up, sweep, ease to rest

export function Splash({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const calm = useReducedMotion();
  const sweep = useSharedValue(0);  // the hand's extra turn, 0 → 1
  const lift = useSharedValue(0);   // the clock gliding up to make room
  const grow = useSharedValue(0);   // from the still's size to ours
  const name = useSharedValue(0);   // the letters, 0 → 1 across the word
  const tag = useSharedValue(0);
  const brand = useSharedValue(0); // the line at the bottom
  const ripple = useSharedValue(0); // loops 0 → 1 while we are here
  const ripple2 = useSharedValue(0); // the same, half a beat behind
  const out = useSharedValue(0);    // the exit
  const [shown, setShown] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const insets = useSafeAreaInsets();
  const [go, setGo] = useState(false);

  // Don't move while the app is being built underneath. Signing in decides
  // which screens mount, and mounting them (Home, the tabs, their first
  // data) takes the same frames the animation needs — that was the hitch at
  // the start. So: wait for `ready`, let that mount finish, give it two more
  // frames, and only then start. The phone's still stays up all that time and
  // looks exactly like our first frame, so the wait doesn't show. A slow
  // phone still starts after START_CAP_MS rather than holding the still.
  useEffect(() => {
    if (go) return;
    let raf = 0, cancelled = false;
    const start = () => { if (!cancelled) raf = requestAnimationFrame(() => { raf = requestAnimationFrame(() => setGo(true)); }); };
    const cap = setTimeout(() => setGo(true), START_CAP_MS);
    // The first moment the JS thread is idle after `ready` — the mount done.
    const idle = ready ? requestIdleCallback(start, { timeout: 1200 }) : null;
    return () => { cancelled = true; cancelAnimationFrame(raf); clearTimeout(cap); if (idle !== null) cancelIdleCallback(idle); };
  }, [ready, go]);

  useEffect(() => {
    if (!go) return;
    let started = false;
    // Let the still go now that ours is on screen and the app below is
    // built, and start moving on the frame after.
    const first = requestAnimationFrame(() => {
      nativeOrNull(() => require("expo-splash-screen"))?.hideAsync?.()?.catch?.(() => {});
      started = true;
      if (calm) {
        grow.value = 1; lift.value = 1;
        name.value = withTiming(1, { duration: 400 });
        tag.value = withTiming(1, { duration: 400 });
        brand.value = withTiming(1, { duration: 400 });
        return;
      }
      grow.value = withSpring(1, { damping: 16, stiffness: 120, mass: 0.9 });
      // One sweep to rest, then on round steadily; each later turn ends where
      // the next begins (a whole turn), so the repeat never shows a seam.
      sweep.value = withSequence(
        withTiming(1, { duration: SWEEP_MS, easing: sweepEase }),
        withRepeat(withTiming(2, { duration: TURN_MS, easing: Easing.linear }), -1, false),
      );
      const pulse = () => withRepeat(withTiming(1, { duration: RIPPLE_MS, easing: Easing.out(Easing.cubic) }), -1, false);
      ripple.value = withDelay(120, pulse());
      ripple2.value = withDelay(120 + RIPPLE_MS / 2, pulse());
      lift.value = withDelay(LIFT_AT, withTiming(1, { duration: LIFT_MS, easing: glide }));
      name.value = withDelay(NAME_AT, withTiming(1, { duration: NAME_MS, easing: Easing.linear }));
      tag.value = withDelay(TAG_AT, withTiming(1, { duration: 800, easing: glide }));
      brand.value = withDelay(BRAND_AT, withTiming(1, { duration: 900, easing: glide }));
    });
    const held = setTimeout(() => setShown(true), calm ? 500 : INTRO_MS);
    return () => {
      cancelAnimationFrame(first); clearTimeout(held);
      if (started) [sweep, lift, grow, name, tag, brand, ripple, ripple2].forEach((v) => cancelAnimation(v));
    };
  }, [calm, go]);

  useEffect(() => {
    if (!shown || !ready) return;
    nativeOrNull(() => require("expo-splash-screen"))?.hideAsync?.()?.catch?.(() => {});
    setLeaving(true);
    // The zoom: the clock flies up at the eye until it fills the screen,
    // and the app shows through as the navy clears.
    out.value = withTiming(1, { duration: calm ? 300 : EXIT_MS, easing: Easing.bezier(0.55, 0, 0.35, 1) }, (finished) => {
      if (finished) runOnJS(onDone)();
    });
  }, [shown, ready]);

  const start = NATIVE_DIAL / DIAL;
  const mark = useAnimatedStyle(() => ({
    transform: [
      { translateY: -LIFT * lift.value },
      { scale: (start + (1 - start) * grow.value) * (calm ? 1 : 1 + 13 * out.value * out.value) },
    ],
    opacity: interpolate(out.value, [0.55, 1], [1, 0], Extrapolation.CLAMP),
  }));
  const hand = useAnimatedStyle(() => ({ transform: [{ rotate: `${360 * sweep.value}deg` }] }));
  const words = useAnimatedStyle(() => ({
    opacity: interpolate(out.value, [0, 0.3], [1, 0], Extrapolation.CLAMP),
    transform: [{ translateY: 30 * out.value }, { scale: 1 + 0.15 * out.value }],
  }));
  const footer = useAnimatedStyle(() => ({
    opacity: brand.value * interpolate(out.value, [0, 0.25], [1, 0], Extrapolation.CLAMP),
    transform: [{ translateY: 10 * (1 - brand.value) }],
  }));
  const tagline = useAnimatedStyle(() => ({
    opacity: tag.value,
    transform: [{ translateY: 8 * (1 - tag.value) }],
  }));
  // The navy holds while the zoom starts, then clears over the app.
  const layer = useAnimatedStyle(() => ({ opacity: interpolate(out.value, [0.4, 1], [1, 0], Extrapolation.CLAMP) }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.stage, layer]} testID="splash" pointerEvents={leaving ? "none" : "auto"}>
      {/* A tap goes straight in: nobody has to sit through the whole thirty seconds. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={() => setShown(true)} accessibilityRole="button" accessibilityLabel="Skip" testID="splash-skip" />
      <Animated.View style={[styles.center, mark]}>
        <Ripple progress={ripple} />
        <Ripple progress={ripple2} />
        <View style={styles.glow} />
        <View style={styles.layer}>
          <Dial />
        </View>
        <Animated.View style={[styles.layer, hand]}>
          <Hand />
        </Animated.View>
      </Animated.View>

      <Animated.View style={[styles.words, words]}>
        <View style={styles.nameRow} accessible accessibilityLabel={NAME}>
          {NAME.split("").map((ch, i) => <Letter key={i} ch={ch} index={i} progress={name} />)}
        </View>
        <Animated.Text style={[styles.tagline, tagline]}>{TAGLINE}</Animated.Text>
      </Animated.View>

      <Animated.View style={[styles.footer, { bottom: insets.bottom + 24 }, footer]} pointerEvents="none">
        <Text style={styles.powered} accessibilityLabel={BRAND}>Powered by <Text style={styles.brand}>PeakSuperTech</Text></Text>
      </Animated.View>
    </Animated.View>
  );
}

/** One letter of the name: rises and sharpens in its own slice of the word's time. */
function Letter({ ch, index, progress }: { ch: string; index: number; progress: SharedValue<number> }) {
  const from = (index / NAME.length) * 0.55;
  const style = useAnimatedStyle(() => {
    const p = interpolate(progress.value, [from, from + 0.45], [0, 1], Extrapolation.CLAMP);
    // ease-out cubic, by hand (no helper calls inside a worklet)
    const e = 1 - (1 - p) * (1 - p) * (1 - p);
    return { opacity: e, transform: [{ translateY: 16 * (1 - e) }, { scale: 0.92 + 0.08 * e }] };
  });
  return <Animated.Text style={[styles.name, style]}>{ch}</Animated.Text>;
}

/** A soft mint ring that widens out of the dial and fades; two, half a beat apart. */
function Ripple({ progress }: { progress: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const p = progress.value;
    // Fades in over the first sixth so it never pops, out over the rest.
    return { opacity: 0.45 * (1 - p) * Math.min(1, p * 6), transform: [{ scale: 1 + 0.9 * p }] };
  });
  return <Animated.View style={[styles.ripple, style]} pointerEvents="none" />;
}

/** The dial — still. */
function Dial() {
  return (
    <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${BOX} ${BOX}`}>
      <Defs>
        <LinearGradient id="splash-mark" x1="0" y1="0" x2={BOX} y2={BOX} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={MINT} />
          <Stop offset="1" stopColor={MINT_DEEP} />
        </LinearGradient>
      </Defs>
      {ARCS.map((d, i) => <Path key={i} d={d} fill="none" stroke="url(#splash-mark)" strokeWidth={RING_W} />)}
    </Svg>
  );
}

/** The hand at its resting angle; the layer around it turns. */
function Hand() {
  const hx = C + Math.cos((REST * Math.PI) / 180) * HAND_LEN;
  const hy = C + Math.sin((REST * Math.PI) / 180) * HAND_LEN;
  return (
    <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${BOX} ${BOX}`}>
      <Defs>
        <LinearGradient id="splash-hand" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={MINT} />
          <Stop offset="1" stopColor={MINT_DEEP} />
        </LinearGradient>
      </Defs>
      <Path d={`M${C} ${C}L${hx} ${hy}`} stroke="url(#splash-hand)" strokeWidth={HAND_W} strokeLinecap="round" />
      <Circle cx={C} cy={C} r={PIN} fill="url(#splash-hand)" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  stage: { backgroundColor: NAVY, alignItems: "center", justifyContent: "center", zIndex: 10 },
  // The clock sits dead centre, where the phone's still drew it.
  center: { width: SIZE, height: SIZE, alignItems: "center", justifyContent: "center" },
  layer: { position: "absolute", width: SIZE, height: SIZE },
  ripple: { position: "absolute", width: DIAL, height: DIAL, borderRadius: DIAL / 2, borderWidth: 2, borderColor: MINT },
  glow: { position: "absolute", width: DIAL * 0.8, height: DIAL * 0.8, borderRadius: DIAL, backgroundColor: "rgba(64,231,160,0.07)" },
  // Below the centre, so the clock alone decides where the middle is.
  words: { position: "absolute", top: "50%", marginTop: DIAL / 2 - LIFT + 30, alignItems: "center" },
  nameRow: { flexDirection: "row" },
  name: { color: INK, fontSize: 30, fontWeight: "800", letterSpacing: -0.4 },
  footer: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  powered: { color: MUTED, fontSize: 13, fontWeight: "500", letterSpacing: 0.4 },
  brand: { color: INK, fontWeight: "700" },
  tagline: { color: MUTED, fontSize: 14.5, fontWeight: "600", letterSpacing: 0.3, marginTop: 10 },
});
