import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useQueryClient } from "@tanstack/react-query";

import { chat, convo } from "@/api";
import { serverUrl } from "@/api/server";
import { useSession } from "@/auth/session";

export type ChatEvent = {
  type: "connected" | "message.created" | "message.updated" | "message.unsent" | "message.hidden" | "reaction.updated" | "receipt.updated" | "typing" | "conversation.updated";
  conversation_id?: string; message_id?: number; client_id?: string | null; username?: string; name?: string;
};

const listeners = new Set<(event: ChatEvent) => void>();
/** Screens that care (the open conversation, for typing) listen here. */
export function onChatEvent(listener: (event: ChatEvent) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
/** Whether the stream is up, for screens that poll more slowly when it is. */
export let realtimeConnected = false;

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
        socket.onopen = () => { attempt = 0; realtimeConnected = true; };
        socket.onmessage = (raw) => {
          let event: ChatEvent;
          try { event = JSON.parse(String(raw.data)); } catch { return; }
          for (const listener of listeners) {
            try { listener(event); } catch { /* one screen's trouble isn't the stream's */ }
          }
          if (event.type === "typing" || event.type === "connected") return;
          // The phone has it: tell the sender "delivered". The server ignores our own.
          if (event.type === "message.created" && event.message_id) void convo.delivered(event.message_id).catch(() => {});
          if (event.conversation_id) void client.invalidateQueries({ queryKey: ["chat", "convo", event.conversation_id] });
          void client.invalidateQueries({ queryKey: ["chat", "inbox"] });
          void client.invalidateQueries({ queryKey: ["chat", "threads"] });
          void client.invalidateQueries({ queryKey: ["chat-unread"] });
        };
        socket.onclose = () => {
          realtimeConnected = false;
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
