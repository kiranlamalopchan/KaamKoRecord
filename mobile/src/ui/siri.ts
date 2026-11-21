/**
 * "Hey Siri, voice search in KaamKoRecord" (plugins/with-siri-voice-search.js).
 *
 * Siri opens the app and leaves the time in the app's UserDefaults under
 * `kkrVoiceSearchAt`. Here, once someone signed in is looking at the app, a
 * fresh note (under a minute old) is taken — cleared, so it is followed once —
 * and the app goes to Items, listening. Read through React Native's Settings,
 * which sees UserDefaults on iOS; it is checked on start, whenever the app
 * comes to the front, and when the note changes while the app is open.
 */
import { useEffect } from "react";
import { AppState, Platform } from "react-native";

export const SIRI_VOICE_KEY = "kkrVoiceSearchAt";
/** A note older than this is from a request that was never followed (signed out, say): ignored. */
const FRESH_SECONDS = 60;

type SettingsApi = { get(key: string): unknown; set(values: object): void; watchKeys(keys: string[], cb: () => void): number; clearWatch(id: number): void };

function settings(): SettingsApi | null {
  if (Platform.OS !== "ios") return null;
  try {
    return require("react-native").Settings as SettingsApi;
  } catch {
    return null;
  }
}

/** Takes a fresh note from Siri, if there is one. */
export function takeSiriVoiceSearch(now = Date.now() / 1000): boolean {
  const store = settings();
  if (!store) return false;
  const at = Number(store.get(SIRI_VOICE_KEY) || 0);
  if (!at) return false;
  store.set({ [SIRI_VOICE_KEY]: 0 });
  return now - at >= 0 && now - at < FRESH_SECONDS;
}

/** While `active` (signed in, past the splash), follows Siri's requests with `open`. */
export function useSiriVoiceSearch(active: boolean, open: () => void) {
  useEffect(() => {
    const store = settings();
    if (!active || !store) return;
    const check = () => { if (takeSiriVoiceSearch()) open(); };
    check();
    const watch = store.watchKeys([SIRI_VOICE_KEY], check);
    const sub = AppState.addEventListener("change", (state) => { if (state === "active") check(); });
    return () => { store.clearWatch(watch); sub.remove(); };
  }, [active, open]);
}
