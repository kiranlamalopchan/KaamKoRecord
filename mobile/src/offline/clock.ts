import * as Crypto from "expo-crypto";
import { timesheet, type ClockActionMeta, type ClockState, type Duration } from "@/api";
import { ApiError } from "@/api/client";
import { readPrivate, writePrivate, usePrivateState } from "@/storage/private";

export type ClockActionKind = "clock_in" | "start_break" | "end_break" | "clock_out";
export type PendingClockAction = ClockActionMeta & { action: ClockActionKind; workplace?: number; error?: string; review?: boolean };
const KEY = "pending-clock-actions-v1";
const MAX_AUTOMATIC_AGE = 23 * 60 * 60 * 1000;
const locks = new Map<string, Promise<unknown>>();

function nowMeta(): ClockActionMeta {
  let client_tz = "";
  try { client_tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { /* no zone */ }
  return { client_id: Crypto.randomUUID(), client_time: new Date().toISOString(), client_tz };
}

export const makeClockAction = (action: ClockActionKind, workplace?: number): PendingClockAction => ({ ...nowMeta(), action, workplace });

async function change(scope: string, update: (rows: PendingClockAction[]) => PendingClockAction[]) {
  const task = (locks.get(scope) || Promise.resolve()).catch(() => {}).then(async () => {
    await writePrivate(scope, KEY, update(await readPrivate<PendingClockAction[]>(scope, KEY, [])));
  });
  locks.set(scope, task);
  try { await task; } finally { if (locks.get(scope) === task) locks.delete(scope); }
}

export const queueClockAction = (scope: string, action: PendingClockAction) => change(scope, rows => rows.some(row => row.client_id === action.client_id) ? rows : [...rows, action]);
export const removeClockActionsFrom = (scope: string, clientId: string) => change(scope, rows => {
  const index = rows.findIndex(row => row.client_id === clientId);
  return index < 0 ? rows : rows.slice(0, index);
});
export const usePendingClockActions = () => usePrivateState<PendingClockAction[]>(KEY, []);

export function sendClockAction(action: PendingClockAction): Promise<ClockState> {
  const meta: ClockActionMeta = { client_id: action.client_id, client_time: action.client_time, client_tz: action.client_tz };
  if (action.action === "clock_in") return timesheet.clockIn(action.workplace!, meta);
  if (action.action === "start_break") return timesheet.startBreak(meta);
  if (action.action === "end_break") return timesheet.endBreak(meta);
  return timesheet.clockOut(meta);
}

const emptyDuration = (seconds = 0): Duration => {
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600), minutes = Math.floor((safe % 3600) / 60), secs = safe % 60;
  return { seconds: safe, hm: hours ? `${hours}h ${minutes}m` : `${minutes}m`, hms: `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`, minutes: String(Math.floor(safe / 60)), decimal: (safe / 3600).toFixed(2) };
};

export function applyClockAction(state: ClockState, action: PendingClockAction): ClockState {
  const when = action.client_time;
  const at = new Date(when).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const message = "Saved offline · Syncing when connected";
  if (action.action === "clock_in") {
    const workplace = state.workplaces.find(row => row.id === action.workplace) || null;
    return { ...state, server_now: when, selected: action.workplace || state.selected, message, shift: { id: -Date.now(), status: "WORKING", status_label: "Working", workplace, clock_in: when, in_at: at, worked: emptyDuration(), total_break: emptyDuration(), banked_break_seconds: 0, running_break: null } };
  }
  if (!state.shift) return { ...state, message };
  if (action.action === "start_break") return { ...state, server_now: when, message, shift: { ...state.shift, status: "ON_BREAK", status_label: "On break", running_break: { start: when, start_at: at, duration: emptyDuration() } } };
  if (action.action === "end_break") {
    const added = state.shift.running_break ? Math.max(0, (Date.parse(when) - Date.parse(state.shift.running_break.start)) / 1000) : 0;
    const banked = state.shift.banked_break_seconds + added;
    return { ...state, server_now: when, message, shift: { ...state.shift, status: "WORKING", status_label: "Working", banked_break_seconds: banked, total_break: emptyDuration(banked), running_break: null } };
  }
  return { ...state, server_now: when, message, shift: null };
}

const syncing = new Set<string>();
export async function syncClockActions(scope: string, isCurrent: () => boolean) {
  if (syncing.has(scope)) return;
  syncing.add(scope);
  try {
    for (const action of await readPrivate<PendingClockAction[]>(scope, KEY, [])) {
      if (!isCurrent()) return;
      // Clock actions are one ordered sequence. Nothing after a conflict is
      // safe to apply to whichever shift the server currently has open.
      if (action.review) return;
      const recorded = Date.parse(action.client_time);
      if (!Number.isFinite(recorded) || Date.now() - recorded > MAX_AUTOMATIC_AGE) {
        await change(scope, rows => rows.map(row => row.client_id === action.client_id ? {
          ...row,
          review: true,
          error: "This offline clock entry is over 24 hours old. Add it as a past shift instead.",
        } : row));
        return;
      }
      try {
        await sendClockAction(action);
        await change(scope, rows => rows.filter(row => row.client_id !== action.client_id));
      } catch (error) {
        if (!(error instanceof ApiError) || error.status === 0 || error.status === 401 || error.status >= 500) return;
        await change(scope, rows => rows.map(row => row.client_id === action.client_id ? { ...row, review: true, error: error.message } : row));
        return;
      }
    }
  } finally { syncing.delete(scope); }
}
