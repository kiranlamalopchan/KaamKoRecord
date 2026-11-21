/**
 * Asking for a rating: the phone's own popup (the App Store's stars on iOS,
 * Google Play's in-app review on Android), shown once somebody has used the
 * app for a while — never on the first opens, never twice for one version.
 *
 * What counts as opening the app: a cold start, or coming back after half an
 * hour or more away. Flicking to another app and back is the same visit.
 *
 * When it asks: when the app is opened, and — likelier to catch somebody
 * pleased with it — right after a good moment (askAtGoodMoment): a shift
 * clocked out and added up, a voice search that opened the very item asked
 * for, a payslip that matched the hours worked. Everybody is asked the same
 * way whatever they think of the app; only the moment is chosen. Either way,
 * the same rules: on the 5th open or later, at least 3 days after the first,
 * signed in, a few seconds after the screen has settled (not over the
 * splash). Then not again for 3 months, and only on a newer version — and
 * never more than three times in all. The stores never tell an app whether
 * somebody rated it (or tapped "Not Now"), so the app can't stop at "already
 * rated"; asking this rarely means somebody who rated is not nagged. Apple and
 * Google hold it back further on their own (Apple: 3 times a year at most,
 * and not for people who have just rated) and may show nothing at all.
 *
 * The popup itself is the store's, so the question can't be steered: no
 * "do you like us?" first, which both stores forbid.
 */
import { useEffect } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { inExpoGo, nativeOrNull } from "@/ui/native";
import { appVersion } from "@/ui/Version";

const KEY = "mywork.rating";
const MINUTE = 60_000, DAY = 24 * 60 * MINUTE;

export const OPENS_BEFORE_ASK = 5;
export const DAYS_BEFORE_ASK = 3;
export const DAYS_BETWEEN_ASKS = 90;
/** Never more than this many times in all, however many versions come out. */
export const MAX_ASKS = 3;

export type RatingRules = { opens: number; daysBefore: number; daysBetween: number; maxAsks: number };
/** What store builds use. */
export const STORE_RULES: RatingRules = { opens: OPENS_BEFORE_ASK, daysBefore: DAYS_BEFORE_ASK, daysBetween: DAYS_BETWEEN_ASKS, maxAsks: MAX_ASKS };
/**
 * A development build skips the waiting days, so the popup can be seen after
 * five opens on the day it is installed (still once per version). Apple shows
 * it every time in a development build; TestFlight never does.
 */
export const DEV_RULES: RatingRules = { opens: OPENS_BEFORE_ASK, daysBefore: 0, daysBetween: 0, maxAsks: MAX_ASKS };
const RULES = __DEV__ ? DEV_RULES : STORE_RULES;
/** Away this long, coming back counts as opening the app again. */
export const NEW_OPEN_AFTER_MS = 30 * MINUTE;
/** How long after the app is on screen the popup may come. */
export const SETTLE_MS = 4000;

/** `asks`: how many times it has asked in all (absent in what earlier versions saved: 1 if it asked, else 0). */
export type RatingState = { first: number; opens: number; asked: number | null; askedVersion: string | null; asks?: number };

type StoreReview = typeof import("expo-store-review");
const storeReview = () => nativeOrNull<StoreReview>(() => require("expo-store-review"));

export async function loadRating(): Promise<RatingState | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as RatingState) : null;
  } catch {
    return null;
  }
}

async function saveRating(state: RatingState): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* counted again from here next time */
  }
}

/** One more open of the app. Returns the state after it. */
export async function countOpen(now = Date.now()): Promise<RatingState> {
  const was = await loadRating();
  const state: RatingState = was
    ? { ...was, opens: was.opens + 1 }
    : { first: now, opens: 1, asked: null, askedVersion: null };
  await saveRating(state);
  return state;
}

/** Whether it is time to ask, by the rules at the top. */
export function due(state: RatingState, version: string, now = Date.now(), rules: RatingRules = RULES): boolean {
  if (state.opens < rules.opens) return false;
  if (now - state.first < rules.daysBefore * DAY) return false;
  if (state.asked !== null) {
    if ((state.asks ?? 1) >= rules.maxAsks) return false;
    if (state.askedVersion === version) return false;
    if (now - state.asked < rules.daysBetween * DAY) return false;
  }
  return true;
}

/** Show the store's popup if it is due. Never throws: a rating is never worth an error. */
export async function askIfDue(now = Date.now(), rules: RatingRules = RULES): Promise<boolean> {
  const state = await loadRating();
  const version = appVersion().version;
  if (!state || !due(state, version, now, rules)) return false;
  // Inside Expo Go the store's popup would ask for a rating of Expo Go itself.
  if (inExpoGo()) {
    if (__DEV__) console.log("[rating] due now — the store's popup would show here in a real build");
    return false;
  }
  const review = storeReview();
  try {
    if (!review || !(await review.isAvailableAsync()) || !(await review.hasAction())) return false;
    // Counted as asked before the popup: whatever the store decides to show,
    // the app does not try again on the next open.
    await saveRating({ ...state, asked: now, askedVersion: version, asks: (state.asks ?? (state.asked !== null ? 1 : 0)) + 1 });
    await review.requestReview();
    return true;
  } catch {
    return false;
  }
}

/** How long after a good moment the popup may come: the result is seen first. */
export const MOMENT_SETTLE_MS = 2000;

/**
 * Right after something went well: ask, if it is due, once the result has
 * been seen. Same rules as on opening (a moment never asks sooner or more).
 */
export function askAtGoodMoment(): void {
  setTimeout(() => {
    if (AppState.currentState !== "background" && AppState.currentState !== "inactive") void askIfDue();
  }, MOMENT_SETTLE_MS);
}

/**
 * Counts each open and asks when it is due. `active` is whether a signed-in
 * person is looking at the app (no splash, no forced-update screen).
 */
export function useRatingPrompt(active: boolean) {
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let leftAt: number | null = null;
    const open = () => {
      clearTimeout(timer);
      void countOpen().then(() => {
        timer = setTimeout(() => { void askIfDue(); }, SETTLE_MS);
      });
    };
    open();
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        if (leftAt !== null && Date.now() - leftAt >= NEW_OPEN_AFTER_MS) open();
        leftAt = null;
      } else if (leftAt === null) {
        // Gone to the background: no popup over the home screen.
        clearTimeout(timer);
        leftAt = Date.now();
      }
    });
    return () => { clearTimeout(timer); sub.remove(); };
  }, [active]);
}
