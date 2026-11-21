/**
 * Whether the top bar has stepped aside for the page: scroll down and it
 * slides away so the page has the whole screen, and it stays away until the
 * page is scrolled back up to its top.
 *
 * The page and its top bar share this flag across the navigation stack.
 */
import { useSyncExternalStore } from "react";

let hidden = false;
const listeners = new Set<() => void>();

export function setChromeHidden(next: boolean) {
  if (next === hidden) return;
  hidden = next;
  listeners.forEach((listener) => listener());
}

export function useChromeHidden() {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => hidden,
    () => false,
  );
}

// ---- the bottom navigation --------------------------------------------------
//
// The tab bar is quicker to come back than the top bar: scroll down and it
// slides away, scroll up even a little and it is back — the way to another
// tab is never more than a flick away. It also comes back at the top of a
// page and whenever the tab changes (app/(tabs)/_layout.tsx).

let tabsHidden = false;
const tabListeners = new Set<() => void>();

export function setTabBarHidden(next: boolean) {
  if (next === tabsHidden) return;
  tabsHidden = next;
  tabListeners.forEach((listener) => listener());
}

export function useTabBarHidden() {
  return useSyncExternalStore(
    (listener) => { tabListeners.add(listener); return () => { tabListeners.delete(listener); }; },
    () => tabsHidden,
    () => false,
  );
}

/** How far a scroll must keep going one way before the chrome follows it. */
export const CHROME_SLACK = 12;
/** Near the top of a page the chrome always shows. */
export const CHROME_TOP = 64;

/**
 * Feeds one vertical scroll event into the flag. `state` is the caller's own
 * memory of the last offset and the distance travelled the current way.
 */
export function followScroll(state: { y: number; run: number; view?: number }, e: { contentOffset: { y: number }; contentSize: { height: number }; layoutMeasurement: { height: number } }) {
  const end = Math.max(0, e.contentSize.height - e.layoutMeasurement.height);
  // The rubber band at either end moves the offset without anybody asking for
  // the chrome — and springing back from it would read as a scroll the other
  // way. Measured from inside the page's real range, it is no movement at all.
  const y = Math.min(Math.max(e.contentOffset.y, 0), end);
  const delta = y - state.y;
  state.y = y;
  // A resize can change the offset at the foot of the page without a scroll.
  const resized = state.view !== undefined && state.view !== e.layoutMeasurement.height;
  state.view = e.layoutMeasurement.height;
  if (delta === 0 || resized) return;

  if (y <= CHROME_TOP) { state.run = 0; setChromeHidden(false); setTabBarHidden(false); return; }
  // Out of the way for the rest of the page: scrolling back up keeps the top
  // bar hidden until the top, where the line above brings it home. The tab
  // bar follows the finger both ways.
  state.run = Math.sign(delta) === Math.sign(state.run) ? state.run + delta : delta;
  if (state.run > CHROME_SLACK) { setChromeHidden(true); setTabBarHidden(true); }
  else if (state.run < -CHROME_SLACK) setTabBarHidden(false);
}
