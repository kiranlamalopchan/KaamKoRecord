/**
 * One conversation, direct or group, by its stable id.
 *
 * The list is drawn upside down (newest at the foot, by the box you write
 * in) and only what is on screen is rendered; older pages load as it is
 * scrolled up. What you send shows at once and carries a client id made
 * when it was written, kept through every retry, so a send whose answer
 * was lost never lands twice. Text and media go in two lanes, each in
 * order, so a message typed while a video uploads isn't stuck behind it.
 * A send that fails stays where it was with Retry and Discard; one that
 * failed for want of a connection is retried when the connection is back.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Clipboard from "expo-clipboard";
import * as Crypto from "expo-crypto";

import { ApiError, chat, convo, useChatChanged, useConvo, useChatInbox, type ChatAttachment, type ChatLimits, type ConvoMessage, type ConvoPage } from "@/api";
import { errorMessage } from "@/api/errors";
import { useT } from "@/i18n";
import { Avatar, Empty, ErrorBanner, Screen } from "@/ui";
import { choose, confirm } from "@/ui/confirm";
import { WithDepth } from "@/ui/depth";
import { fail, tap } from "@/ui/haptics";
import { useLayout } from "@/ui/layout";
import { radius, sp, useTheme } from "@/ui/theme";
import { Bubble, type Line, type Rect } from "./Bubble";
import { MessageMenu, type MenuAction } from "./MessageMenu";
import { loadDraft, saveDraft } from "./drafts";
import { capture, pickDocument, pickFromLibrary, pickVideoToTrim, TooBig, type Picked } from "./pick";
import { onChatEvent, setViewing } from "./realtime";
import { TypingBubble, useTyping } from "./Typing";
import { sendOutgoing, type Outgoing, type OutgoingKind } from "./send";
import { MediaViewer, saveOrShare } from "./Viewer";
import { canRecord, VoiceRecorder, type Recording } from "./Voice";

const EMOJI = "😀 😁 😂 🤣 😊 😍 😘 😎 🤔 😴 😅 😉 🙂 🙃 😇 🥳 😢 😭 😡 😱 🤗 🤝 👍 👎 👏 🙏 💪 👋 ✌️ 👌 🤞 ❤️ 🧡 💛 💚 💙 💜 🖤 💯 🔥 ✨ 🎉 🎂 ☕ 🍕 🍜 🍺 🚗 🚌 🏠 🏢 ⏰ 📅 📌 ✅ ❌ ⚠️ 💼 💰 🧾 📦 🛒 🧹 🍳 🥗 🌙 ☀️ 🌧️ ⛔ 🆗 🙌 😬 🤷 🙈".split(" ");
const DEFAULT_LIMITS: ChatLimits = { photo_max_bytes: 25 << 20, photo_batch: 10, video_max_bytes: 100 << 20, video_max_seconds: 300, audio_max_seconds: 600, audio_max_bytes: 10 << 20, file_max_bytes: 100 << 20, file_types: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "zip"] };
const RUN_GAP = 5 * 60_000;

type Draft = Picked & { quality: "standard" | "hd" };

function sameRun(a: Line | undefined, b: Line | undefined) {
  if (!a || !b || a.event || b.event) return false;
  if (a.sender?.username !== b.sender?.username || a.day !== b.day) return false;
  return Math.abs(new Date(a.at).getTime() - new Date(b.at).getTime()) < RUN_GAP;
}

export function Conversation({ id }: { id: string }) {
  const t = useTheme(), tr = useT();
  const router = useRouter();
  const layout = useLayout();
  const changed = useChatChanged();
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  // On screen: the server sends no notification for messages here (realtime.tsx).
  useEffect(() => {
    if (!focused) return;
    setViewing(id);
    return () => setViewing(null);
  }, [focused, id]);
  const q = useConvo(id, focused);
  const page = q.data;
  const limits = page?.limits ?? DEFAULT_LIMITS;
  const isGroup = page?.conversation.kind === "group";

  const [older, setOlder] = useState<ConvoMessage[]>([]);
  const [more, setMore] = useState<boolean | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<unknown>(null);
  const [outgoing, setOutgoing] = useState<Outgoing[]>([]);
  const [settled, setSettled] = useState<ConvoMessage[]>([]);
  const [text, setText] = useState("");
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [notice, setNotice] = useState<string | null>(null);
  const [replying, setReplying] = useState<Line | null>(null);
  const [editing, setEditing] = useState<Line | null>(null);
  const [menu, setMenu] = useState<{ line: Line; rect?: Rect; first: boolean; last: boolean } | null>(null);
  // A reaction shows the moment it's chosen; the server's answer then replaces it.
  const [reacted, setReacted] = useState<Record<number, { reactions: Line["reactions"]; my_reaction: string | null }>>({});
  const [forwarding, setForwarding] = useState<Line | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [viewer, setViewer] = useState<{ items: ChatAttachment[]; index: number } | null>(null);
  const [farFromFoot, setFarFromFoot] = useState(false);
  const list = useRef<FlatList<Line>>(null);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  const nextKey = useRef(-1);
  const lastTyping = useRef(0);
  const draftReady = useRef(false);
  const firstUnread = useRef<number | null | undefined>(undefined);
  const lanes = useRef({ text: false, media: false });
  const draftKey = `c-${id}`;

  // ---- the draft survives leaving the screen and the app ----
  useEffect(() => {
    let active = true;
    draftReady.current = false;
    loadDraft(draftKey).then(saved => { if (active) setText(current => current || saved); draftReady.current = true; });
    return () => { active = false; };
  }, [draftKey]);
  useEffect(() => {
    if (!draftReady.current) return;
    const timer = setTimeout(() => { void saveDraft(draftKey, editing ? "" : text); }, 350);
    return () => clearTimeout(timer);
  }, [draftKey, text, editing]);

  // The unread line stays where it was when the conversation was opened.
  useEffect(() => { if (page && firstUnread.current === undefined) firstUnread.current = page.first_unread; }, [page]);
  const newest = page?.messages.at(-1)?.id;
  useEffect(() => { if (focused && newest) changed(); }, [focused, newest, changed]);

  // ---- typing, from the realtime stream (gone the moment their message lands) ----
  const typers = useTyping()[id] ?? [];
  const typing = typers.map(v => v.name);
  /** A typer's face: from one of their messages on screen, else their initial. */
  const faceOf = (username: string, name: string) =>
    [...(page?.messages ?? []), ...older].find(m => m.sender?.username === username)?.sender
    ?? { initial: (name || username).charAt(0).toUpperCase(), hue: 160, photo: null, is_live: false };

  // ---- the lines on screen: older pages, the newest page, what's on its way ----
  useEffect(() => {
    const fresh = new Set((page?.messages ?? []).map(m => m.id));
    if (fresh.size) setSettled(was => was.filter(m => !fresh.has(m.id)));
  }, [page?.messages]);

  const me = useMemo(() => page?.messages.find(m => m.mine)?.sender, [page?.messages]);
  const lines: Line[] = useMemo(() => {
    const known = new Map<number, Line>();
    for (const m of older) known.set(m.id, m);
    for (const m of settled) known.set(m.id, m);
    for (const m of page?.messages ?? []) known.set(m.id, m);
    for (const [key, value] of Object.entries(reacted)) {
      const line = known.get(Number(key));
      if (line) known.set(line.id, { ...line, ...value });
    }
    const server = [...known.values()].sort((a, b) => a.id - b.id);
    const sentIds = new Set(server.map(m => m.client_id).filter(Boolean));
    const now = new Date();
    const local: Line[] = outgoing.filter(o => !sentIds.has(o.clientId)).map(o => ({
      id: o.key, localKey: o.key, client_id: o.clientId, conversation_id: id, body: o.body, mine: true,
      at: o.createdAt, day: server.at(-1)?.day || "", time: now.toTimeString().slice(0, 5), read: false,
      sender: me || { username: "", name: tr("You"), initial: "", hue: 0, photo: null, is_live: false, is_me: true, is_admin: false } as never,
      attachments: [], forwarded: false, event: null, pinned: false, reactions: [], status: o.state === "failed" ? "failed" : "sending",
      reply: null, progress: o.progress, failed: o.state === "failed", error: o.error ? errorMessage(o.error) : undefined,
      localFiles: o.files.map(f => ({ uri: f.uri, kind: o.kind === "photos" ? "photo" : o.kind })),
    }));
    return [...server, ...local].reverse();
  }, [older, settled, page?.messages, outgoing, id, me, tr, reacted]);

  const hasMore = more ?? page?.more ?? false;
  const loadOlder = async () => {
    const oldest = lines.filter(m => m.localKey === undefined).at(-1);
    if (!hasMore || loadingOlder || !oldest) return;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const earlier = await convo.page(id, { before: oldest.id });
      setOlder(was => [...earlier.messages, ...was]);
      setMore(!!earlier.more);
    } catch (error) { setOlderError(error); } finally { setLoadingOlder(false); }
  };

  // ---- sending ----
  const update = (key: number, change: Partial<Outgoing>) =>
    setOutgoing(was => was.map(o => (o.key === key ? { ...o, ...change } : o)));

  const pump = useCallback(async (lane: "text" | "media", queue: Outgoing[]) => {
    if (lanes.current[lane]) return;
    const next = queue.find(o => o.state === "pending" && (o.kind === "text") === (lane === "text"));
    if (!next) return;
    lanes.current[lane] = true;
    update(next.key, { state: "sending" });
    try {
      let sent: ConvoMessage;
      const go = () => sendOutgoing(next, fraction => update(next.key, { progress: fraction }), uploadId => update(next.key, { uploadId }));
      try { sent = await go(); }
      catch (error) {
        // One quiet retry for a blip; the client id makes it safe.
        if (!(error instanceof ApiError) || error.status !== 0) throw error;
        await new Promise(resolve => setTimeout(resolve, 600));
        sent = await go();
      }
      setSettled(was => [...was.filter(m => m.id !== sent.id), sent]);
      setOutgoing(was => was.filter(o => o.key !== next.key));
      changed();
    } catch (error) {
      fail();
      update(next.key, { state: "failed", error });
    } finally {
      lanes.current[lane] = false;
    }
  }, [changed]);

  useEffect(() => {
    void pump("text", outgoing);
    void pump("media", outgoing);
  }, [outgoing, pump]);

  // Back online: what failed for want of a connection goes again.
  const retryOffline = useCallback(() => {
    setOutgoing(was => was.map(o => (o.state === "failed" && o.error instanceof ApiError && o.error.status === 0 ? { ...o, state: "pending", error: undefined } : o)));
  }, []);
  useEffect(() => onChatEvent(event => { if (event.type === "connected") retryOffline(); }), [retryOffline]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", state => { if (state === "active") retryOffline(); });
    return () => sub.remove();
  }, [retryOffline]);

  const enqueue = (kind: OutgoingKind, body: string, files: Outgoing["files"], extra: Partial<Outgoing> = {}) => {
    const key = nextKey.current--;
    setOutgoing(was => [...was, {
      key, clientId: Crypto.randomUUID(), conversationId: id, body, kind, files, quality: "standard",
      replyTo: replying?.id, state: "pending", progress: 0, createdAt: new Date().toISOString(), ...extra,
    }]);
    setReplying(null);
    requestAnimationFrame(() => list.current?.scrollToOffset({ offset: 0, animated: true }));
  };

  const submit = async () => {
    const body = text.trim();
    setNotice(null);
    if (editing) {
      if (!body) return;
      try {
        await chat.edit(editing.id, body);
        setText(""); setEditing(null);
        await saveDraft(draftKey, "");
        await q.refetch();
      } catch (error) { fail(); setNotice(errorMessage(error)); }
      return;
    }
    if (draft) {
      tap("light");
      const kind: OutgoingKind = draft.kind === "photos" ? "photos" : draft.kind;
      enqueue(kind, body, draft.files, { quality: draft.quality });
      setDraft(null);
    } else {
      if (!body) return;
      tap("light");
      enqueue("text", body, []);
    }
    setText("");
    setEmojiOpen(false);
    await saveDraft(draftKey, "");
  };

  const sendVoice = (rec: Recording) => {
    if (rec.duration > limits.audio_max_seconds + 0.5) { setNotice(tr("Voice messages can be up to {n} minutes.", { n: Math.round(limits.audio_max_seconds / 60) })); return; }
    enqueue("audio", "", [rec.file], { waveform: rec.waveform, duration: rec.duration });
  };

  const retry = (line: Line) => setOutgoing(was => was.map(o => (o.key === line.localKey ? { ...o, state: "pending", error: undefined, progress: 0 } : o)));
  const discard = (line: Line) => setOutgoing(was => was.filter(o => o.key !== line.localKey));

  const attach = async (how: "library" | "camera" | "video" | "file") => {
    setNotice(null);
    try {
      const picked = how === "library" ? await pickFromLibrary(limits) : how === "camera" ? await capture(limits) : how === "video" ? await pickVideoToTrim(limits) : await pickDocument(limits);
      if (picked) setDraft({ ...picked, quality: "standard" });
    } catch (error) {
      fail();
      setNotice(error instanceof TooBig ? error.message : errorMessage(error));
    }
  };
  const attachMenu = () => choose(tr("Send"), [
    { label: tr("Photos and videos"), onPress: () => { void attach("library"); } },
    { label: tr("Camera"), onPress: () => { void attach("camera"); } },
    { label: tr("Video (trim first)"), onPress: () => { void attach("video"); } },
    { label: tr("Document"), onPress: () => { void attach("file"); } },
  ]);

  const type = (value: string) => {
    setText(value);
    const now = Date.now();
    if (value.trim() && now - lastTyping.current > 3000) {
      lastTyping.current = now;
      void convo.typing(id).catch(() => {});
    }
  };
  const insertEmoji = (emoji: string) => {
    const { start, end } = selection;
    const next = text.slice(0, start) + emoji + text.slice(end);
    setText(next);
    setSelection({ start: start + emoji.length, end: start + emoji.length });
  };

  // ---- one message's actions ----
  const refresh = async () => { await q.refetch(); changed(); };
  const act = async (work: () => Promise<unknown>) => {
    try { await work(); await refresh(); } catch (error) { fail(); setNotice(errorMessage(error)); }
  };
  const react = (line: Line, emoji: string) => {
    setMenu(null);
    // Same reaction again takes it off; another one replaces yours.
    const mineBefore = line.my_reaction ?? null;
    const counts = new Map((line.reactions ?? []).map(r => [r.emoji, r.count]));
    if (mineBefore) counts.set(mineBefore, (counts.get(mineBefore) ?? 1) - 1);
    const next = mineBefore === emoji ? null : emoji;
    if (next) counts.set(next, (counts.get(next) ?? 0) + 1);
    const reactions = [...counts.entries()].filter(([, n]) => n > 0).map(([e, n]) => ({ emoji: e, count: n })).sort((a, b) => a.emoji.localeCompare(b.emoji));
    setReacted(was => ({ ...was, [line.id]: { reactions, my_reaction: next } }));
    void (async () => {
      try {
        const updated = await chat.react(line.id, emoji);
        const confirmed = { reactions: updated.reactions ?? [], my_reaction: updated.my_reaction ?? null };
        setReacted(was => ({ ...was, [line.id]: confirmed }));
        // Older pages aren't fetched again, so they keep the server's answer themselves.
        setOlder(w => w.map(m => (m.id === line.id ? { ...m, ...confirmed } : m)));
        setSettled(w => w.map(m => (m.id === line.id ? { ...m, ...confirmed } : m)));
        await refresh();
      } catch (error) {
        fail();
        setNotice(errorMessage(error));
      }
      setReacted(({ [line.id]: _done, ...rest }) => rest);
    })();
  };

  /** Reply to this message: the banner over the box, and the keyboard up to type. */
  const replyTo = useCallback((line: Line) => {
    setReplying(line);
    setEditing(null);
    requestAnimationFrame(() => input.current?.focus());
  }, []);

  const hideForMe = (line: Line) => {
    setOlder(w => w.filter(m => m.id !== line.id));
    setSettled(w => w.filter(m => m.id !== line.id));
    void act(() => convo.hide(line.id));
  };

  /** Everything you can do with a held message, for the menu under it. */
  const actionsFor = (line: Line): MenuAction[] => {
    if (line.unsent) return [{ label: tr("Delete for me"), icon: "trash-outline", destructive: true, onPress: () => hideForMe(line) }];
    const fresh = Date.now() - new Date(line.at).getTime() <= 15 * 60_000;
    const options: MenuAction[] = [{ label: tr("Reply"), icon: "arrow-undo-outline", onPress: () => replyTo(line) }];
    if (line.body) options.push({ label: tr("Copy"), icon: "copy-outline", onPress: () => { void Clipboard.setStringAsync(line.body); } });
    options.push({ label: tr("Forward"), icon: "arrow-redo-outline", onPress: () => setForwarding(line) });
    options.push({ label: line.pinned ? tr("Unpin") : tr("Pin"), icon: line.pinned ? "pin" : "pin-outline", onPress: () => { void act(() => convo.pin(line.id)); } });
    const attachment = line.attachments[0];
    if (attachment) {
      options.push({
        label: attachment.kind === "file" ? tr("Download") : tr("Save or share"),
        icon: attachment.kind === "file" ? "download-outline" : "share-outline",
        onPress: () => { void saveOrShare(attachment).catch(e => setNotice(errorMessage(e))); },
      });
    }
    if (line.mine && fresh && line.body && !line.attachments.length) options.push({ label: tr("Edit"), icon: "create-outline", onPress: () => { setEditing(line); setReplying(null); setDraft(null); setText(line.body); } });
    if (line.mine && fresh) options.push({ label: tr("Unsend for everyone"), icon: "arrow-undo-circle-outline", destructive: true, onPress: () => confirm(tr("Unsend message?"), tr("It will be removed for everyone in this conversation."), tr("Unsend"), () => { void act(() => chat.unsend(line.id)); }) });
    options.push({ label: tr("Delete for me"), icon: "trash-outline", destructive: true, onPress: () => hideForMe(line) });
    if (!line.mine) options.push({ label: tr("Report"), icon: "flag-outline", destructive: true, onPress: () => report(line) });
    return options;
  };

  const report = (line: Line) => choose(tr("Why are you reporting this?"), [
    ["spam", tr("Spam or misleading")], ["harassment", tr("Harassment or bullying")], ["hate", tr("Hate speech or violence")],
    ["sexual", tr("Nudity or sexual content")], ["other", tr("Something else")],
  ].map(([reason, label]) => ({ label, onPress: () => { void act(() => convo.report(line.id, reason)).then(() => setNotice(tr("Thanks. Only this message was sent to our moderators."))); } })));

  const scrollToMessage = (messageId: number) => {
    const index = lines.findIndex(l => l.id === messageId);
    if (index >= 0) list.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
  };

  // ---- header ----
  const c = page?.conversation;
  const person = c?.person;
  const subtitle = typing.length
    ? (typing.length === 1 ? tr("{name} is typing…", { name: typing[0] }) : tr("{n} people are typing…", { n: typing.length }))
    : isGroup ? tr("{n} members", { n: c?.member_count ?? 0 }) : person?.is_live ? tr("Active now") : person ? `@${person.username}` : "";
  const header = c ? (
    <Pressable onPress={() => router.push(`/messages/info/${id}` as never)} accessibilityRole="button" accessibilityLabel={tr("Conversation details for {name}", { name: c.title })} style={styles.who}>
      <View>
        <Avatar person={person || { username: c.id, name: c.title, initial: c.initial, hue: c.hue, photo: c.photo, is_live: false } as never} size={40} />
        {person?.is_live ? <View style={[styles.live, { backgroundColor: t.brand, borderColor: t.bg }]} /> : null}
      </View>
      <View style={{ flexShrink: 1 }}>
        <Text style={{ color: t.text, fontSize: 17, fontWeight: "700" }} numberOfLines={1}>{c.title}</Text>
        <Text style={{ color: typing.length ? t.brand : t.muted, fontSize: 12 }} numberOfLines={1} accessibilityLiveRegion="polite">{subtitle}</Text>
      </View>
    </Pressable>
  ) : null;
  const infoButton = (
    <Pressable onPress={() => router.push(`/messages/info/${id}` as never)} accessibilityRole="button" accessibilityLabel={tr("Conversation details")} hitSlop={8} style={styles.headerIcon}>
      <Ionicons name="information-circle-outline" size={26} color={t.text} />
    </Pressable>
  );

  const mineIndex = lines.findIndex(l => l.mine && l.localKey === undefined && !l.event);
  const canSend = page?.can_send ?? false;
  const composing = !!(text.trim() || draft || editing);

  return (
    <Screen back backLabel={tr("Chats")} right={infoButton}>
      <WithDepth>{(under) => (
        <View style={{ flex: 1 }}>
          <FlatList
            ref={list}
            inverted
            data={lines}
            keyExtractor={m => String(m.localKey ?? m.id)}
            {...under.scroll}
            initialNumToRender={18}
            maxToRenderPerBatch={12}
            windowSize={9}
            removeClippedSubviews
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            onEndReached={loadOlder}
            onEndReachedThreshold={0.4}
            onScroll={e => setFarFromFoot(e.nativeEvent.contentOffset.y > 400)}
            scrollEventThrottle={64}
            onScrollToIndexFailed={() => {}}
            contentContainerStyle={[layout.column, { paddingTop: sp[3], paddingBottom: under.padTop + sp[3], flexGrow: 1 }]}
            // The list is upside down, so its header is the foot: where Messenger's dots sit.
            ListHeaderComponent={typers.length ? (
              <TypingBubble names={typing}
                people={typers.map(v => (!isGroup && person) || faceOf(v.username, v.name))} />
            ) : undefined}
            ListFooterComponent={
              <View style={{ gap: sp[3], paddingBottom: sp[3], alignItems: "center" }}>
                {header}
                {q.error && !page ? <ErrorBanner error={q.error} onRetry={q.refetch} /> : null}
                {loadingOlder ? <ActivityIndicator color={t.brand} accessibilityLabel={tr("Loading earlier messages")} /> : null}
                {olderError ? <ErrorBanner error={olderError} onRetry={loadOlder} /> : null}
              </View>
            }
            ListEmptyComponent={q.isLoading ? <ActivityIndicator color={t.brand} style={{ marginTop: sp[6] }} /> : page ? (
              <View style={{ transform: [{ scaleY: -1 }] }}>
                <Empty icon="chatbubbles-outline" title={tr("Say hello")} sub={isGroup ? tr("Messages here are only seen by the group's members.") : tr("Messages here are between the two of you.")} card={false} />
              </View>
            ) : undefined}
            renderItem={({ item, index }) => {
              const olderLine = lines[index + 1], newerLine = lines[index - 1];
              const newDay = item.day && (!olderLine || olderLine.day !== item.day);
              return (
                <View>
                  {newDay ? <Text style={[styles.day, { color: t.muted }]} accessibilityRole="header">{item.day}</Text> : null}
                  {firstUnread.current && item.id === firstUnread.current ? (
                    <View style={styles.unreadLine} accessibilityRole="text"><View style={[styles.rule, { backgroundColor: t.brand }]} /><Text style={{ color: t.brand, fontSize: 12, fontWeight: "700" }}>{tr("New messages")}</Text><View style={[styles.rule, { backgroundColor: t.brand }]} /></View>
                  ) : null}
                  <Bubble
                    line={item}
                    group={isGroup}
                    firstOfRun={!sameRun(item, olderLine) || !!newDay}
                    lastOfRun={!sameRun(item, newerLine)}
                    showStatus={index === mineIndex || item.localKey !== undefined}
                    onLongPress={(held, rect) => {
                      if (held.localKey !== undefined || held.event) return;
                      setMenu({ line: held, rect, first: !sameRun(item, olderLine) || !!newDay, last: !sameRun(item, newerLine) });
                    }}
                    onOpenMedia={(items, i) => setViewer({ items, index: Math.max(0, i) })}
                    onOpenFile={file => { void saveOrShare(file).catch(e => setNotice(errorMessage(e))); }}
                    onRetry={retry}
                    onDiscard={discard}
                    onReplyPress={scrollToMessage}
                    onSwipeReply={replyTo}
                  />
                </View>
              );
            }}
          />

          {farFromFoot ? (
            <Pressable onPress={() => list.current?.scrollToOffset({ offset: 0, animated: true })} accessibilityRole="button" accessibilityLabel={tr("Go to the newest message")}
              style={[styles.toFoot, { backgroundColor: t.surface, borderColor: t.line, bottom: 92 + layout.insets.bottom }]}>
              <Ionicons name="arrow-down" size={20} color={t.text} />
            </Pressable>
          ) : null}

          <View style={[layout.column, styles.composer, { borderTopColor: t.line, backgroundColor: t.bg, paddingBottom: Math.max(layout.insets.bottom, sp[2]) }]}>
            {notice ? <Text accessibilityRole="alert" style={{ color: t.danger, fontSize: 13, paddingHorizontal: sp[2] }}>{notice}</Text> : null}
            {replying || editing ? (
              <View style={[styles.banner, { backgroundColor: t.surface, borderLeftColor: t.brand }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.text, fontSize: 13, fontWeight: "700" }}>{editing ? tr("Editing message") : tr("Replying to {name}", { name: replying?.mine ? tr("yourself") : replying?.sender?.name || "" })}</Text>
                  <Text style={{ color: t.muted, fontSize: 13 }} numberOfLines={1}>{editing ? editing.body : replying?.body || tr(replying?.attachments[0]?.kind === "video" ? "Video" : replying?.attachments[0]?.kind === "audio" ? "Voice message" : replying?.attachments[0]?.kind === "file" ? "File" : "Photo")}</Text>
                </View>
                <Pressable onPress={() => { setReplying(null); if (editing) { setEditing(null); setText(""); } }} accessibilityRole="button" accessibilityLabel={tr("Cancel")} style={styles.icon44}><Ionicons name="close" size={20} color={t.text2} /></Pressable>
              </View>
            ) : null}
            {draft ? <DraftTray draft={draft} onChange={setDraft} onClear={() => setDraft(null)} /> : null}
            {page && !canSend ? (
              <Text style={{ color: t.muted, fontSize: 14, textAlign: "center", paddingVertical: sp[3] }}>{page.why_not || tr("You can only message your friends.")}</Text>
            ) : (
              <View style={styles.inputRow}>
                {recording ? null : (
                  <>
                    <Pressable onPress={attachMenu} disabled={!page || !!editing} accessibilityRole="button" accessibilityLabel={tr("Attach")} testID="chat-attach"
                      style={({ pressed }) => [styles.icon44, { borderRadius: 22, backgroundColor: pressed ? t.surface2 : "transparent", opacity: editing ? 0.4 : 1 }]}>
                      <Ionicons name="add-circle-outline" size={26} color={t.brand} />
                    </Pressable>
                    <View style={[styles.inputWrap, { backgroundColor: t.dark ? t.surface2 : t.surface, borderColor: t.line }]}>
                      <TextInput
                        ref={input}
                        value={text}
                        onChangeText={type}
                        onSelectionChange={e => setSelection(e.nativeEvent.selection)}
                        placeholder={draft ? tr("Add a caption") : tr("Message")}
                        placeholderTextColor={t.muted}
                        multiline
                        maxLength={page?.max_length ?? 2000}
                        editable={!!page}
                        accessibilityLabel={tr("Message")}
                        testID="chat-input"
                        style={[styles.input, { color: t.text }]}
                      />
                      <Pressable onPress={() => setEmojiOpen(open => !open)} accessibilityRole="button" accessibilityLabel={emojiOpen ? tr("Close emoji") : tr("Emoji")} style={styles.emojiButton}>
                        <Ionicons name={emojiOpen ? "close-circle-outline" : "happy-outline"} size={22} color={t.text2} />
                      </Pressable>
                    </View>
                  </>
                )}
                {composing || !canRecord() ? (
                  <Pressable onPress={() => { void submit(); }} disabled={!composing || !page} accessibilityRole="button" accessibilityLabel={editing ? tr("Save edit") : tr("Send")} testID="chat-send"
                    style={({ pressed }) => [styles.send, { backgroundColor: t.brand, opacity: !composing ? 0.4 : pressed ? 0.8 : 1 }]}>
                    <Ionicons name={editing ? "checkmark" : "arrow-up"} size={22} color={t.brandInk} />
                  </Pressable>
                ) : (
                  <VoiceRecorder maxSeconds={limits.audio_max_seconds} onSend={sendVoice} onActive={setRecording} onError={setNotice} disabled={!page} />
                )}
              </View>
            )}
            {emojiOpen && !recording ? (
              <ScrollView style={{ maxHeight: 200 }} contentContainerStyle={styles.emojiGrid} keyboardShouldPersistTaps="always">
                {EMOJI.map(emoji => <Pressable key={emoji} onPress={() => insertEmoji(emoji)} accessibilityRole="button" accessibilityLabel={emoji} style={styles.emojiCell}><Text style={{ fontSize: 26 }}>{emoji}</Text></Pressable>)}
              </ScrollView>
            ) : null}
          </View>
          {menu ? (
            <MessageMenu
              rect={menu.rect}
              mine={menu.line.mine}
              chosen={menu.line.my_reaction}
              canReact={!menu.line.unsent}
              actions={actionsFor(menu.line)}
              onReact={emoji => react(menu.line, emoji)}
              onClose={() => setMenu(null)}
            >
              <Bubble line={menu.line} group={isGroup} firstOfRun={menu.first} lastOfRun={menu.last} showStatus={false}
                onLongPress={() => {}} onOpenMedia={() => {}} onOpenFile={() => {}} onRetry={() => {}} onDiscard={() => {}} />
            </MessageMenu>
          ) : null}
          {viewer ? <MediaViewer items={viewer.items} start={viewer.index} onClose={() => setViewer(null)} /> : null}
          {forwarding ? <ForwardSheet line={forwarding} from={id} onDone={message => { setForwarding(null); if (message) setNotice(message); changed(); }} /> : null}
        </View>
      )}</WithDepth>
    </Screen>
  );
}

/** What's about to be sent: thumbnails to remove one by one, and Standard/HD. */
function DraftTray({ draft, onChange, onClear }: { draft: Draft; onChange: (draft: Draft | null) => void; onClear: () => void }) {
  const t = useTheme(), tr = useT();
  const remove = (index: number) => {
    const files = draft.files.filter((_, i) => i !== index);
    onChange(files.length ? ({ ...draft, files } as Draft) : null);
  };
  return (
    <View style={[styles.draft, { backgroundColor: t.surface, borderColor: t.line }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, padding: 8 }}>
        {draft.files.map((file, index) => (
          <View key={file.uri + index} style={[styles.thumb, { backgroundColor: t.surface2 }]}>
            {draft.kind === "file" ? (
              <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 4 }}>
                <Ionicons name="document-outline" size={26} color={t.text2} />
                <Text style={{ color: t.text2, fontSize: 10 }} numberOfLines={2}>{file.name}</Text>
              </View>
            ) : (
              <>
                {/* A video's first frame is what the picker gives as its uri on both platforms. */}
                <ImageThumb uri={file.uri} />
                {draft.kind === "video" ? <View style={styles.videoMark}><Ionicons name="videocam" size={14} color="#fff" /></View> : null}
              </>
            )}
            <Pressable onPress={() => remove(index)} accessibilityRole="button" accessibilityLabel={tr("Remove")} hitSlop={8} style={styles.removeThumb}>
              <Ionicons name="close" size={14} color="#fff" />
            </Pressable>
          </View>
        ))}
      </ScrollView>
      <View style={styles.draftBar}>
        {draft.kind !== "file" ? (
          <View style={[styles.quality, { borderColor: t.line }]} accessibilityRole="radiogroup" accessibilityLabel={tr("Quality")}>
            {(["standard", "hd"] as const).map(value => (
              <Pressable key={value} onPress={() => onChange({ ...draft, quality: value })} accessibilityRole="radio" accessibilityState={{ checked: draft.quality === value }}
                style={[styles.qualityOption, draft.quality === value && { backgroundColor: t.brand }]}>
                <Text style={{ color: draft.quality === value ? t.brandInk : t.text2, fontSize: 12, fontWeight: "700" }}>{value === "hd" ? "HD" : tr("Standard")}</Text>
              </Pressable>
            ))}
          </View>
        ) : <View />}
        <Pressable onPress={onClear} accessibilityRole="button" accessibilityLabel={tr("Remove all")} style={{ minHeight: 36, justifyContent: "center", paddingHorizontal: 8 }}>
          <Text style={{ color: t.muted, fontSize: 13, fontWeight: "600" }}>{tr("Remove all")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ImageThumb({ uri }: { uri: string }) {
  return <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />;
}

/** Choose up to ten conversations to send a copy to. */
function ForwardSheet({ line, from, onDone }: { line: Line; from: string; onDone: (message?: string) => void }) {
  const t = useTheme(), tr = useT(), { insets } = useLayout();
  const inbox = useChatInbox({});
  const rows = (inbox.data?.pages.flatMap(p => p.conversations) ?? []).filter(row => row.id !== from);
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await convo.forward(line.id, chosen);
      onDone(result.failed.length ? tr("Forwarded to {n}. Some couldn't be sent.", { n: result.sent.length }) : tr("Forwarded."));
    } catch (e) { setError(e); setBusy(false); }
  };
  return (
    // Full screen, not a page sheet: the sheet shrank the chat behind it and
    // left a dark border round the app (see ui/transitions riseOptions).
    <Modal visible animationType="slide" onRequestClose={() => onDone()}>
      <View style={{ flex: 1, backgroundColor: t.bg, padding: sp[4], paddingTop: insets.top + sp[2], paddingBottom: Math.max(insets.bottom, sp[4]), gap: sp[3] }}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text accessibilityRole="header" style={{ color: t.text, fontSize: 20, fontWeight: "800", flex: 1 }}>{tr("Forward to")}</Text>
          <Pressable onPress={() => onDone()} accessibilityRole="button" accessibilityLabel={tr("Close")} style={styles.icon44}><Ionicons name="close" size={24} color={t.text} /></Pressable>
        </View>
        {error ? <ErrorBanner error={error} /> : null}
        <FlatList
          data={rows}
          keyExtractor={row => row.id}
          renderItem={({ item }) => {
            const on = chosen.includes(item.id);
            return (
              <Pressable onPress={() => setChosen(was => on ? was.filter(x => x !== item.id) : was.length < 10 ? [...was, item.id] : was)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                style={[styles.forwardRow, { borderBottomColor: t.line }]}>
                <Avatar person={item.person || { username: item.id, name: item.title, initial: item.initial, hue: item.hue, photo: item.photo } as never} size={40} />
                <Text style={{ color: t.text, fontSize: 16, flex: 1 }} numberOfLines={1}>{item.title}</Text>
                <Ionicons name={on ? "checkmark-circle" : "ellipse-outline"} size={24} color={on ? t.brand : t.muted} />
              </Pressable>
            );
          }}
        />
        <Pressable onPress={() => { void send(); }} disabled={!chosen.length || busy} accessibilityRole="button"
          style={[styles.forwardSend, { backgroundColor: t.brand, opacity: !chosen.length || busy ? 0.5 : 1 }]}>
          <Text style={{ color: t.brandInk, fontWeight: "800", fontSize: 16 }}>{busy ? tr("Sending…") : tr("Send to {n}", { n: chosen.length })}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

export type { ConvoPage };

const styles = StyleSheet.create({
  who: { flexDirection: "row", alignItems: "center", gap: sp[3], minHeight: 44 },
  live: { position: "absolute", right: -1, bottom: -1, width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
  headerIcon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  day: { alignSelf: "center", fontSize: 12, fontWeight: "600", marginTop: sp[4], marginBottom: sp[1] },
  unreadLine: { flexDirection: "row", alignItems: "center", gap: 8, marginVertical: sp[2] },
  rule: { flex: 1, height: StyleSheet.hairlineWidth * 2 },
  toFoot: { position: "absolute", right: 16, width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
  composer: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: sp[2], gap: 6 },
  banner: { minHeight: 52, borderLeftWidth: 3, borderRadius: 10, marginHorizontal: sp[2], paddingLeft: 10, flexDirection: "row", alignItems: "center" },
  icon44: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: sp[1] },
  inputWrap: { flex: 1, minHeight: 44, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "flex-end" },
  input: { flex: 1, maxHeight: 132, paddingLeft: 16, paddingRight: 4, paddingTop: 11, paddingBottom: 11, fontSize: 16 },
  emojiButton: { width: 40, height: 44, alignItems: "center", justifyContent: "center" },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  emojiGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center" },
  emojiCell: { width: 46, height: 46, alignItems: "center", justifyContent: "center" },
  draft: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, marginHorizontal: sp[2] },
  draftBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8, paddingBottom: 8 },
  thumb: { width: 72, height: 72, borderRadius: 10, overflow: "hidden" },
  videoMark: { position: "absolute", left: 4, bottom: 4, backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 8, padding: 2 },
  removeThumb: { position: "absolute", right: 3, top: 3, width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  quality: { flexDirection: "row", borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, overflow: "hidden" },
  qualityOption: { paddingHorizontal: 12, minHeight: 32, justifyContent: "center" },
  forwardRow: { flexDirection: "row", alignItems: "center", gap: sp[3], minHeight: 60, borderBottomWidth: StyleSheet.hairlineWidth },
  forwardSend: { minHeight: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
});
