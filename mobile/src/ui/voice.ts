/**
 * Searching by voice: tap the mic in the search box, say an item's name or
 * its code, and what you say fills the box as you speak.
 *
 * It is the phone's own speech recognition (Apple's or Google's), through
 * expo-speech-recognition — a native module, so not in Expo Go or in builds
 * from before it, where the mic simply isn't offered. It listens in the app's
 * language (Nepali when the app is in Nepali, falling back to the phone's own
 * where Nepali isn't installed), and is told the catalogue's own item names so
 * it hears them better.
 *
 * A spoken code comes out as a code: "four zero one one", "40 11" and
 * "चार शून्य एक एक" all search for 4011.
 *
 * Problems are said in words (never a code): no permission, nothing heard, no
 * connection. Anything unexpected is logged as a redacted report.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";

import { logError } from "@/api/errors";
import { getLang, tr } from "@/i18n";
import { inExpoGo, nativeOrNull } from "./native";

type Speech = typeof import("expo-speech-recognition").ExpoSpeechRecognitionModule;
type ErrorCode = import("expo-speech-recognition").ExpoSpeechRecognitionErrorCode;

function speech(): Speech | null {
  // Asked without loading the package: loading it in a build that lacks the
  // native side (Expo Go, a build from before voice search) throws while the
  // module loads, and a development build shows that as a red error screen
  // even though it is caught here.
  if (inExpoGo() || !requireOptionalNativeModule("ExpoSpeechRecognition")) return null;
  return nativeOrNull(() => require("expo-speech-recognition").ExpoSpeechRecognitionModule as Speech);
}

const DIGIT_WORDS: Record<string, string> = {
  zero: "0", oh: "0", o: "0", nil: "0", nought: "0", one: "1", two: "2", to: "2", too: "2", three: "3", four: "4", for: "4",
  five: "5", six: "6", seven: "7", eight: "8", nine: "9",
  शून्य: "0", सुन्ना: "0", एक: "1", दुई: "2", तीन: "3", चार: "4", पाँच: "5", पांच: "5", छ: "6", सात: "7", आठ: "8", नौ: "9",
};
const NEPALI_DIGITS = "०१२३४५६७८९";

/**
 * What was said, as a search. A run of digits and digit words ("four zero one
 * one", "40 11", "double four") becomes the code; anything else is kept as
 * said, without the full stop a recogniser may add.
 */
export function spokenToQuery(said: string): string {
  const text = said.trim().replace(/[०-९]/g, (d) => String(NEPALI_DIGITS.indexOf(d))).replace(/[.!?।]+$/u, "").trim();
  const words = text.toLowerCase().split(/[\s,-]+/).filter(Boolean);
  if (!words.length) return "";
  let digits = "", repeat = 1;
  for (const word of words) {
    if (word === "double") { repeat = 2; continue; }
    if (word === "triple") { repeat = 3; continue; }
    const digit = /^\d+$/.test(word) ? word : DIGIT_WORDS[word];
    if (digit === undefined) return text;
    digits += digit.repeat(repeat);
    repeat = 1;
  }
  return repeat === 1 && digits ? digits : text;
}

/** Lower case, no punctuation, single spaces: how two names are compared. */
function plain(text: string): string {
  return text.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}\p{M}]+/gu, " ").trim();
}

/**
 * After a spoken search, the one item it clearly meant, or null: an item with
 * exactly the code that was said, else one with exactly the name, else the
 * only result there is. Several near matches are left to the person to pick.
 */
export function spokenMatch<T extends { code?: string; title?: string; description?: string }>(query: string, results: T[], count: number): T | null {
  const said = plain(query);
  if (!said || !results.length) return null;
  const byCode = results.filter((item) => item.code && plain(item.code) === said);
  if (byCode.length === 1) return byCode[0];
  const byName = results.filter((item) => [item.title, item.description].some((name) => name && plain(name) === said));
  if (byName.length === 1) return byName[0];
  return count === 1 && results.length === 1 ? results[0] : null;
}

/** The words for a problem, or null when there is nothing to tell (the person stopped it). */
export function voiceProblem(code: ErrorCode | string): string | null {
  switch (code) {
    case "aborted":
      return null;
    case "not-allowed":
      return tr("To search by voice, allow the microphone and speech recognition for KaamKoRecord in Settings.");
    case "no-speech":
    case "speech-timeout":
      return tr("We didn't catch that. Tap the mic and try again.");
    case "network":
      return tr("We couldn't connect. Check your internet and try again.");
    case "busy":
    case "too-many-requests":
      return tr("Voice search is busy. Wait a moment, then try again.");
    default:
      return tr("Voice search isn't available right now. You can type instead.");
  }
}

export type VoiceSearch = {
  /** Whether this phone and build can search by voice at all. */
  available: boolean;
  listening: boolean;
  /** A problem to show, in words, or null. */
  problem: string | null;
  start: () => Promise<void>;
  stop: () => void;
};

/**
 * `onText(query, final)` gets what has been heard so far, ready to search.
 * `hints`: words the recogniser should expect (item names).
 */
export function useVoiceSearch(onText: (query: string, final: boolean) => void, hints: string[] = []): VoiceSearch {
  const [module] = useState(speech);
  const available = !!module && (() => { try { return module.isRecognitionAvailable(); } catch { return false; } })();
  const [listening, setListening] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const latest = useRef(onText);
  latest.current = onText;
  const hinted = useRef(hints);
  hinted.current = hints;
  // Nepali first when the app is in Nepali; if the phone has no Nepali, once more in its own language.
  const fellBack = useRef(false);

  const begin = useCallback((lang: string | undefined) => {
    if (!module) return;
    module.start({
      lang, interimResults: true, continuous: false, addsPunctuation: false,
      contextualStrings: hinted.current.slice(0, 100),
      ...(Platform.OS === "ios" ? { iosTaskHint: "search" as const } : null),
    });
  }, [module]);

  useEffect(() => {
    if (!module) return;
    const subs = [
      module.addListener("start", () => { setListening(true); setProblem(null); }),
      module.addListener("end", () => setListening(false)),
      module.addListener("result", (event) => {
        const said = event.results[0]?.transcript ?? "";
        const query = spokenToQuery(said);
        if (query) latest.current(query, event.isFinal);
      }),
      module.addListener("error", (event) => {
        setListening(false);
        if (event.error === "language-not-supported" && !fellBack.current) {
          fellBack.current = true;
          begin(undefined);
          return;
        }
        const words = voiceProblem(event.error);
        setProblem(words);
        if (words && !["not-allowed", "no-speech", "speech-timeout", "network"].includes(event.error)) {
          logError({ kind: "app", name: "VoiceSearchError", message: `speech recognition: ${event.error}`, at: new Date().toISOString(), app: "KaamKoRecord", platform: Platform.OS });
        }
      }),
    ];
    return () => { subs.forEach((s) => s.remove()); try { module.abort(); } catch { /* nothing was listening */ } };
  }, [module, begin]);

  const start = useCallback(async () => {
    if (!module) return;
    setProblem(null);
    try {
      const permission = await module.requestPermissionsAsync();
      if (!permission.granted) { setProblem(voiceProblem("not-allowed")); return; }
      fellBack.current = getLang() !== "ne";
      begin(getLang() === "ne" ? "ne-NP" : undefined);
    } catch (error) {
      setProblem(voiceProblem("client"));
      logError({ kind: "app", name: (error as Error)?.name || "Error", message: "speech recognition failed to start", at: new Date().toISOString(), app: "KaamKoRecord", platform: Platform.OS });
    }
  }, [module, begin]);

  const stop = useCallback(() => { try { module?.stop(); } catch { /* already stopped */ } }, [module]);

  return { available, listening, problem, start, stop };
}
