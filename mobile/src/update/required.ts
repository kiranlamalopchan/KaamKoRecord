/**
 * Whether this copy of the app is too old to be used.
 *
 * The server names the oldest version still allowed to run (a release ticked
 * "everyone must update" in Django admin → `minimum_version` on
 * `mobile/release/`). It is asked at start and every time the app comes back
 * to the front. Anything that goes wrong — no connection, an old server
 * without the field, a version the phone can't read — lets the app run:
 * locking somebody out of their shift over a failed check would be worse
 * than one more day on an old version.
 */
import { useEffect, useState } from "react";
import { AppState } from "react-native";

import { api } from "@/api/client";
import { appVersion } from "@/ui/Version";

/** Below `minimum`, compared as numbers: 1.4.10 is newer than 1.4.9. */
export function isOlder(current: string, minimum: string): boolean {
  if (!current || !minimum) return false;
  const parse = (v: string) => v.trim().split(".").map((part) => parseInt(part.replace(/\D/g, ""), 10) || 0);
  const a = parse(current);
  const b = parse(minimum);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

export type UpdateState = { required: false } | { required: true; current: string; latest: string };

export async function checkForRequiredUpdate(): Promise<UpdateState> {
  const current = appVersion().version;
  try {
    const release = await api<{ version?: string; minimum_version?: string }>("mobile/release/", { anonymous: true });
    const minimum = release.minimum_version || "";
    if (!isOlder(current, minimum)) return { required: false };
    return { required: true, current, latest: release.version || minimum };
  } catch {
    return { required: false };
  }
}

export function useRequiredUpdate(): UpdateState {
  const [state, setState] = useState<UpdateState>({ required: false });
  useEffect(() => {
    let live = true;
    const check = () => { void checkForRequiredUpdate().then((next) => { if (live) setState(next); }); };
    check();
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") check(); });
    return () => { live = false; sub.remove(); };
  }, []);
  return state;
}
