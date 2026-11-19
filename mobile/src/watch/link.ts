/**
 * Keeps the Apple Watch and Wear OS apps signed in as the phone is.
 *
 * Whenever the token, the server or the language changes, the phone hands
 * all three to the watch (modules/watch-link). Signing out sends an empty
 * token, which signs the watch out too. The watch then talks to the server
 * itself, so it keeps working when the phone app is closed.
 */
import type { QueryClient } from "@tanstack/react-query";
import { WatchLink } from "../../modules/watch-link";
import type { ClockState } from "@/api/types";
import { serverUrl } from "@/api/server";
import { describeError, logError } from "@/api/errors";
import { getLang, onLangChange } from "@/i18n";
import { getToken, onTokenChange } from "@/auth/token";

let last = "";

export async function syncWatch(): Promise<void> {
  if (!WatchLink) return;
  try {
    const token = (await getToken()) || "";
    const server = token ? serverUrl() : "";
    const lang = getLang();
    const key = JSON.stringify([token, server, lang]);
    if (key === last) return;
    WatchLink.send(token, server, lang);
    last = key;
  } catch (error) {
    logError(describeError(error).report);
  }
}

/** Start following the phone. Returns the unsubscribe. */
export function startWatchSync(): () => void {
  if (!WatchLink) return () => {};
  void syncWatch();
  const offToken = onTokenChange(() => { void syncWatch(); });
  const offLang = onLangChange(() => { void syncWatch(); });
  return () => { offToken(); offLang(); };
}

/** What about the clock the watch face shows; the rest of a fresh reply is not news. */
export function clockKey(state: ClockState): string {
  const shift = state.shift;
  return JSON.stringify([
    shift?.status ?? null, shift?.clock_in ?? null, shift?.banked_break_seconds ?? null, shift?.running_break?.start ?? null,
    shift?.workplace?.id ?? null, state.selected, state.limit?.workplace?.id ?? null, state.limit?.cap?.seconds ?? null,
  ]);
}

/** Even with nothing new, the week's hours on the face are refreshed this often. */
const CLOCK_RESEND_MS = 15 * 60 * 1000;

/**
 * Hand the watch face every new clock the phone learns — a tap here, a
 * refresh, a tap on the watch coming back — so the face is right even when
 * the shift was started on the phone. Returns the unsubscribe.
 */
export function startClockSync(client: QueryClient): () => void {
  const link = WatchLink;
  if (!link || typeof link.sendClock !== "function") return () => {};  // an older build without it
  let lastKey = "", lastAt = 0;
  return client.getQueryCache().subscribe(event => {
    if (event.type !== "updated" || event.query.queryKey[0] !== "clock") return;
    const state = event.query.state.data as ClockState | undefined;
    if (!state || typeof state.server_now !== "string" || !Array.isArray(state.workplaces)) return;
    const key = clockKey(state), now = Date.now();
    if (key === lastKey && now - lastAt < CLOCK_RESEND_MS) return;
    try {
      link.sendClock(JSON.stringify(state));
      lastKey = key;
      lastAt = now;
    } catch (error) {
      logError(describeError(error).report);
    }
  });
}

/** The watch moved the clock: `fn` refreshes what the phone shows. */
export function onWatchClockChanged(fn: () => void): () => void {
  if (!WatchLink) return () => {};
  const subscription = WatchLink.addListener("onClockChanged", fn);
  return () => subscription.remove();
}
