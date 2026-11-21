/**
 * "Did someone invite you?" — asked once, straight after a brand-new account
 * is made with Google or Apple (those skip the sign-up form, and with it the
 * "Who invited you?" box). The server says when to ask (`ask_invited_by`:
 * a new account with no invite code linked); the root layout opens the
 * question once the app is on screen.
 */
import { useEffect, useSyncExternalStore } from "react";

let pending = false;
const listeners = new Set<() => void>();

export function askInvitedByNext(ask: boolean) {
  if (pending === ask) return;
  pending = ask;
  listeners.forEach((l) => l());
}

function usePending() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => pending, () => false);
}

/** While `active` (signed in, past the splash), opens the question once if it is owed. */
export function useAskInvitedBy(active: boolean, open: () => void) {
  const owed = usePending();
  useEffect(() => {
    if (!active || !owed) return;
    // A moment after the app appears, so it slides in over Home rather than with
    // it. Marked asked only as it opens: clearing it first would end this very
    // effect (and its timer) before the question was ever shown.
    const timer = setTimeout(() => { askInvitedByNext(false); open(); }, 600);
    return () => clearTimeout(timer);
  }, [active, owed, open]);
}
