import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useQueryClient } from "@tanstack/react-query";

import { chat, convo } from "@/api";
import { serverUrl } from "@/api/server";
import { useSession } from "@/auth/session";

export type ChatEvent = {
  type: "connected" | "clock.updated" | "message.created" | "message.updated" | "message.unsent" | "message.hidden" | "reaction.updated" | "receipt.updated" | "typing" | "conversation.updated";
  conversation_id?: string; message_id?: number; client_id?: string | null; username?: string; name?: string;
};

/** What the clock moving changes on screen. */
export const CLOCK_KEYS = ["clock", "timesheet", "calendar", "trend", "pay", "home"];

const listeners = new Set<(event: ChatEvent) => void>();
/** Screens that care (the open conversation, for typing) listen here. */
export function onChatEvent(listener: (event: ChatEvent) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
/** Whether the stream is up, for screens that poll more slowly when it is. */
export let realtimeConnected = false;

// ---- which conversation is on screen ----
// The server sends no notification for a message in a conversation you are
// looking at. The open conversation says so here; the stream tells the
// server now, again every VIEW_REFRESH_MS (the server forgets a mark after
// 45 s without one), and again after reconnecting. Leaving the screen says
// null; the app going to the background closes the stream, which clears it.
const VIEW_REFRESH_MS = 20_000;
let viewing: string | null = null;
let liveSocket: WebSocket | null = null;
let refresh: ReturnType<typeof setInterval> | null = null;
function sayViewing() {
  if (liveSocket?.readyState !== WebSocket.OPEN) return;
  try { liveSocket.send(JSON.stringify({ type: "viewing", conversation_id: viewing })); } catch { /* the next refresh will */ }
}
/** The conversation on screen (or null when none is). */
export function setViewing(conversationId: string | null) {
  if (viewing === conversationId) return;
  viewing = conversationId;
  sayViewing();
  if (refresh) { clearInterval(refresh); refresh = null; }
  if (viewing) refresh = setInterval(sayViewing, VIEW_REFRESH_MS);
}

/** Keeps chat caches fresh; normal query polling remains the degraded path. */
export function ChatRealtime() {
  const { me } = useSession();
  const username = me?.username;
  const client = useQueryClient();
  const stopped = useRef(false);

  useEffect(() => {
    stopped.current = false;
    if (!username) return;
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const connect = async () => {
      if (stopped.current || AppState.currentState !== "active") return;
      try {
        const { ticket, path } = await chat.realtimeTicket();
        const base = new URL(serverUrl());
        base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
        base.pathname = path;
        base.search = `?ticket=${encodeURIComponent(ticket)}`;
        socket = new WebSocket(base.toString());
        socket.onopen = () => { attempt = 0; realtimeConnected = true; liveSocket = socket; if (viewing) sayViewing(); };
        socket.onmessage = (raw) => {
          let event: ChatEvent;
          try { event = JSON.parse(String(raw.data)); } catch { return; }
          for (const listener of listeners) {
            try { listener(event); } catch { /* one screen's trouble isn't the stream's */ }
          }
          if (event.type === "typing") return;
          // Back on the stream after a gap (the app was away): anything that moved meanwhile.
          if (event.type === "connected") {
            for (const key of CLOCK_KEYS) void client.invalidateQueries({ queryKey: [key] });
            return;
          }
          // The clock moved on another device (the watch, the website): show it now.
          if (event.type === "clock.updated") {
            for (const key of CLOCK_KEYS) void client.invalidateQueries({ queryKey: [key] });
            return;
          }
          // The phone has it: tell the sender "delivered". The server ignores our own.
          if (event.type === "message.created" && event.message_id) void convo.delivered(event.message_id).catch(() => {});
          if (event.conversation_id) void client.invalidateQueries({ queryKey: ["chat", "convo", event.conversation_id] });
          void client.invalidateQueries({ queryKey: ["chat", "inbox"] });
          void client.invalidateQueries({ queryKey: ["chat", "threads"] });
          void client.invalidateQueries({ queryKey: ["chat-unread"] });
        };
        socket.onclose = () => {
          realtimeConnected = false;
          if (liveSocket === socket) liveSocket = null;
          if (stopped.current) return;
          const wait = Math.min(30_000, 1000 * 2 ** Math.min(attempt++, 5));
          timer = setTimeout(() => { void connect(); }, wait);
        };
        socket.onerror = () => socket?.close();
      } catch {
        if (stopped.current) return;
        const wait = Math.min(30_000, 1000 * 2 ** Math.min(attempt++, 5));
        timer = setTimeout(() => { void connect(); }, wait);
      }
    };
    const appState = AppState.addEventListener("change", state => {
      if (state === "active" && (!socket || socket.readyState > WebSocket.OPEN)) void connect();
      if (state !== "active") socket?.close();
    });
    void connect();
    return () => {
      stopped.current = true;
      if (timer) clearTimeout(timer);
      appState.remove();
      socket?.close();
    };
  }, [username, client]);

  return null;
}
