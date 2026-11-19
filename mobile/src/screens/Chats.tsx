/**
 * Chats (a tab of its own): every conversation, direct and group, newest activity first and
 * pinned ones on top. More load as the list is scrolled; the realtime
 * stream keeps previews and order current without a pull.
 *
 * A plain list of people rather than cards: a big round photo (ringed while
 * they have a story up — tap it to watch), their name and the last words,
 * the time, and on the right what is waiting: a dot for unread, their tiny
 * photo once they have read yours. Archived chats live one row down the
 * list, on a screen of their own (`archived`).
 */
import React, { useDeferredValue, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import ReanimatedSwipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, { Extrapolation, interpolate, type SharedValue, useAnimatedStyle } from "react-native-reanimated";

import { convo, useChatChanged, useChatInbox, type ConvoSummary } from "@/api";
import { useT } from "@/i18n";
import { Avatar, Button, Empty, ErrorBanner, Screen, usePullRefresh } from "@/ui";
import { choose, confirm } from "@/ui/confirm";
import { underRefresh, WithDepth } from "@/ui/depth";
import { fail, tap } from "@/ui/haptics";
import { useLayout } from "@/ui/layout";
import { SkeletonRows } from "@/ui/Skeleton";
import { radius, sp, useTheme } from "@/ui/theme";


export function previewOf(row: ConvoSummary, tr: ReturnType<typeof useT>): string {
  const last = row.last;
  if (!last) return "";
  if (last.unsent) return tr("Message removed");
  if (last.event) return last.body;
  const words = last.body || (last.attachment ? tr(last.attachment) : "");
  const who = last.mine ? tr("You") : row.kind === "group" ? last.sender : "";
  return who ? `${who}: ${words}` : words;
}

export default function Chats({ archived = false }: { archived?: boolean }) {
  const t = useTheme(), tr = useT();
  const router = useRouter();
  const layout = useLayout();
  const changed = useChatChanged();
  const [search, setSearch] = useState("");
  const [actionError, setActionError] = useState<unknown>(null);
  const query = useDeferredValue(search.trim());
  const q = useChatInbox({ q: query || undefined, archived });
  const archivedCount = q.data?.pages[0]?.archived ?? 0;
  const rows = q.data?.pages.flatMap(page => page.conversations) ?? [];
  // The spinner follows a pull only. Background reloads (switching to this tab, a new message
  // arriving) pass unseen: shown, iOS could leave the spinner stuck over the list.
  const refresh = usePullRefresh(q.refetch);

  const run = async (work: () => Promise<unknown>) => {
    try { setActionError(null); await work(); changed(); await q.refetch(); } catch (error) { fail(); setActionError(error); }
  };
  const manage = (row: ConvoSummary) => choose(row.title, [
    { label: tr(row.pinned ? "Unpin" : "Pin"), onPress: () => { void run(() => convo.update(row.id, { pinned: !row.pinned })); } },
    { label: tr(row.muted ? "Unmute notifications" : "Mute notifications"), onPress: () => { void run(() => convo.update(row.id, { muted: !row.muted })); } },
    row.unread
      ? { label: tr("Mark as read"), onPress: () => { if (row.last) void run(() => convo.read(row.id, row.last!.id).then(() => convo.update(row.id, { unread: false }))); } }
      : { label: tr("Mark as unread"), onPress: () => { void run(() => convo.update(row.id, { unread: true })); } },
    { label: tr(row.archived ? "Move to inbox" : "Archive"), onPress: () => { void run(() => convo.update(row.id, { archived: !row.archived })); } },
    row.kind === "group"
      ? { label: tr("Leave group"), destructive: true, onPress: () => confirm(tr("Leave {name}?", { name: row.title }), tr("You'll stop getting its messages."), tr("Leave"), () => { void run(() => convo.leave(row.id)); }) }
      : { label: tr("Delete conversation"), destructive: true, onPress: () => confirm(tr("Delete this conversation?"), tr("It's removed for you only. {name} keeps their copy.", { name: row.title }), tr("Delete"), () => { void run(() => convo.hideAll(row.id)); }) },
  ]);

  // Swiping a row: one open at a time, like other messengers.
  const openRow = useRef<SwipeableMethods | null>(null);
  const swipeRight = (row: ConvoSummary): SwipeAction[] => [
    row.unread
      ? { key: "read", label: tr("Read"), icon: "mail-open-outline", color: t.brand, ink: t.brandInk, onPress: () => { if (row.last) void run(() => convo.read(row.id, row.last!.id).then(() => convo.update(row.id, { unread: false }))); } }
      : { key: "unread", label: tr("Unread"), icon: "mail-unread-outline", color: t.brand, ink: t.brandInk, onPress: () => { void run(() => convo.update(row.id, { unread: true })); } },
    { key: "pin", label: tr(row.pinned ? "Unpin" : "Pin"), icon: row.pinned ? "pin" : "pin-outline", color: t.text2, ink: t.bg, onPress: () => { void run(() => convo.update(row.id, { pinned: !row.pinned })); } },
  ];
  const swipeLeft = (row: ConvoSummary): SwipeAction[] => [
    { key: "mute", label: tr(row.muted ? "Unmute" : "Mute"), icon: row.muted ? "notifications-outline" : "notifications-off-outline", color: t.muted, ink: "#fff", onPress: () => { void run(() => convo.update(row.id, { muted: !row.muted })); } },
    { key: "archive", label: tr(row.archived ? "Unarchive" : "Archive"), icon: row.archived ? "file-tray-full-outline" : "archive-outline", color: t.text2, ink: t.bg, onPress: () => { void run(() => convo.update(row.id, { archived: !row.archived })); } },
    row.kind === "group"
      ? { key: "leave", label: tr("Leave"), icon: "exit-outline", color: t.danger, ink: "#fff", onPress: () => confirm(tr("Leave {name}?", { name: row.title }), tr("You'll stop getting its messages."), tr("Leave"), () => { void run(() => convo.leave(row.id)); }) }
      : { key: "delete", label: tr("Delete"), icon: "trash-outline", color: t.danger, ink: "#fff", onPress: () => confirm(tr("Delete this conversation?"), tr("It's removed for you only. {name} keeps their copy.", { name: row.title }), tr("Delete"), () => { void run(() => convo.hideAll(row.id)); }) },
  ];

  const heading = (
    <View style={{ gap: sp[3], paddingBottom: sp[3] }}>
      <View style={styles.heading}>
        <View style={{ flex: 1 }}>
          <Text accessibilityRole="header" style={{ color: t.text, fontSize: 30, fontWeight: "800" }}>{archived ? tr("Archived chats") : tr("Chats")}</Text>
          <Text style={{ color: t.muted, fontSize: 14 }}>{archived ? tr("Hidden from your chats until a new message arrives.") : tr("Private conversations and groups with your friends.")}</Text>
        </View>
        {archived ? null : <Pressable onPress={() => router.push("/messages/new" as never)} accessibilityRole="button" accessibilityLabel={tr("New message")} testID="chat-new"
          style={({ pressed }) => [styles.compose, { backgroundColor: pressed ? t.surface2 : t.surface, borderColor: t.line }]}>
          <Ionicons name="create-outline" size={24} color={t.text} />
        </Pressable>}
      </View>
      <View style={[styles.search, { backgroundColor: t.surface, borderColor: t.line }]}>
        <Ionicons name="search-outline" size={20} color={t.muted} />
        <TextInput value={search} onChangeText={setSearch} placeholder={tr("Search people, groups and messages")} placeholderTextColor={t.muted}
          accessibilityLabel={tr("Search conversations")} returnKeyType="search" style={[styles.searchInput, { color: t.text }]} />
        {search ? <Pressable onPress={() => setSearch("")} accessibilityRole="button" accessibilityLabel={tr("Clear search")} style={styles.clear}><Ionicons name="close-circle" size={20} color={t.muted} /></Pressable> : null}
      </View>
      {q.error ? <ErrorBanner error={q.error} onRetry={q.refetch} /> : null}
      {actionError ? <ErrorBanner error={actionError} /> : null}
      {q.isLoading ? <SkeletonRows count={6} /> : null}
    </View>
  );

  return (
    <Screen back={archived} backLabel={archived ? tr("Chats") : undefined}>
      <WithDepth>{(under) => (
        <FlatList
          data={rows}
          keyExtractor={row => row.id}
          {...under.scroll}
          ListHeaderComponent={heading}
          contentContainerStyle={[layout.column, { paddingTop: under.padTop + sp[3], paddingBottom: layout.bottom + sp[6] }]}
          onScroll={under.onScroll}
          scrollEventThrottle={16}
          refreshControl={underRefresh(refresh, under)}
          onEndReached={() => { if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage(); }}
          onEndReachedThreshold={0.5}
          initialNumToRender={14}
          windowSize={11}
          ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator color={t.brand} style={{ marginVertical: sp[4] }} />
            : !archived && !query && archivedCount > 0 ? (
              <Pressable onPress={() => router.push("/messages/archived" as never)} accessibilityRole="button" testID="chat-archived"
                accessibilityLabel={tr("Archived chats, {n}", { n: archivedCount })}
                style={({ pressed }) => [styles.row, { backgroundColor: pressed ? t.surface2 : "transparent" }]}>
                <View style={[styles.archivedIcon, { backgroundColor: t.surface2 }]}><Ionicons name="archive" size={26} color={t.text2} /></View>
                <View style={styles.words}>
                  <Text style={{ color: t.text, fontSize: 17, fontWeight: "700" }}>{tr("Archived chats")}</Text>
                  <Text style={{ color: t.muted, fontSize: 14 }}>{archivedCount === 1 ? tr("1 conversation") : tr("{n} conversations", { n: archivedCount })}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={t.muted} />
              </Pressable>
            ) : undefined}
          ListEmptyComponent={q.data ? (
            <Empty icon={query ? "search-outline" : archived ? "archive-outline" : "chatbubbles-outline"}
              title={query ? tr("No conversations found") : archived ? tr("No archived conversations") : tr("No messages yet")}
              sub={query ? tr("Try a name or a word from a message.") : archived ? undefined : tr("Start a private conversation or a group with your friends.")}
              action={!query && !archived ? <Button title={tr("New message")} icon="create-outline" onPress={() => router.push("/messages/new" as never)} /> : undefined} />
          ) : undefined}
          renderItem={({ item: row, index }) => {
            const unread = (row.unread ?? 0) > 0;
            const avatar = row.person || ({ username: row.id, name: row.title, initial: row.initial, hue: row.hue, photo: row.photo } as never);
            const mine = !!row.last?.mine;
            const when = row.last ? (new Date(row.last.at).toDateString() === new Date().toDateString() ? row.last.time : row.last.day) : "";
            const ring = row.story === "unseen" ? t.brand : row.story === "seen" ? t.line : "transparent";
            const watch = row.story && row.person ? () => router.push(`/stories/${encodeURIComponent(row.person!.username)}` as never) : undefined;
            return (
              <SwipeRow left={swipeRight(row)} right={swipeLeft(row)} openRow={openRow} style={{ borderRadius: radius.lg }}>
              <Pressable onPress={() => router.push(`/messages/c/${row.id}` as never)} onLongPress={() => manage(row)}
                accessibilityRole="button"
                accessibilityLabel={[row.title, unread ? tr("{n} unread", { n: row.unread ?? 0 }) : "", previewOf(row, tr), when].filter(Boolean).join(", ")}
                accessibilityActions={[{ name: "longpress", label: tr("Conversation options") }]}
                onAccessibilityAction={() => manage(row)}
                testID={`chat-row-${row.person?.username || row.id}`}
                accessibilityHint={tr("Swipe for quick actions, or hold for conversation options")}
                style={({ pressed }) => [styles.row, { backgroundColor: pressed ? t.surface2 : t.bg }]}>
                <Pressable onPress={watch} disabled={!watch} accessibilityRole={watch ? "button" : undefined}
                  accessibilityLabel={watch ? tr("Watch {name}'s story", { name: row.title }) : undefined} testID={watch ? "chat-story-ring" : undefined}>
                  <View style={[styles.ring, { borderColor: ring }]}>
                    <Avatar person={avatar} size={56} />
                  </View>
                  {row.person?.is_live ? <View style={[styles.live, { backgroundColor: t.brand, borderColor: t.bg }]} /> : null}
                  {row.kind === "group" ? <View style={[styles.groupMark, { backgroundColor: t.surface2, borderColor: t.bg }]}><Ionicons name="people" size={11} color={t.text2} /></View> : null}
                </Pressable>
                <View style={styles.words}>
                  <View style={styles.nameLine}>
                    <Text style={{ color: t.text, fontSize: 17, fontWeight: unread ? "800" : "600", flex: 1 }} numberOfLines={1}>{row.title}</Text>
                    {row.pinned ? <Ionicons name="pin" size={13} color={t.muted} accessibilityLabel={tr("Pinned")} /> : null}
                    {row.muted ? <Ionicons name="notifications-off-outline" size={14} color={t.muted} accessibilityLabel={tr("Muted")} /> : null}
                    <Text style={{ color: unread ? t.brand : t.muted, fontSize: 13, fontWeight: unread ? "700" : "400" }}>{when}</Text>
                  </View>
                  <View style={styles.previewLine}>
                    <Text style={{ color: unread ? t.text : t.muted, fontSize: 15, fontWeight: unread ? "700" : "400", flex: 1 }} numberOfLines={1}>{previewOf(row, tr)}</Text>
                    {unread ? (
                      <View style={[styles.dot, { backgroundColor: row.muted ? t.muted : t.brand }]} accessibilityLabel={tr("{n} unread", { n: row.unread ?? 0 })} testID="chat-unread-dot" />
                    ) : mine && row.last?.status === "read" && row.person ? (
                      <View accessibilityLabel={tr("Seen")} testID="chat-seen"><Avatar person={row.person} size={16} /></View>
                    ) : mine && row.last?.status ? (
                      <Ionicons name={row.last.status === "read" ? "checkmark-done-circle" : row.last.status === "delivered" ? "checkmark-circle" : "checkmark-circle-outline"} size={16}
                        color={row.last.status === "read" ? t.brand : t.muted} accessibilityLabel={tr(row.last.status === "read" ? "Seen" : row.last.status === "delivered" ? "Delivered" : "Sent")} />
                    ) : null}
                  </View>
                </View>
              </Pressable>
              </SwipeRow>
            );
          }}
        />
      )}</WithDepth>
    </Screen>
  );
}

type SwipeAction = { key: string; label: string; icon: keyof typeof Ionicons.glyphMap; color: string; ink: string; onPress: () => void };
const ACTION_W = 76;

/** The buttons a swipe uncovers; each one grows in as the row slides. */
function SwipeButtons({ actions, side, drag, close }: { actions: SwipeAction[]; side: "left" | "right"; drag: SharedValue<number>; close: () => void }) {
  const width = actions.length * ACTION_W;
  return (
    <View style={{ width, flexDirection: "row" }}>
      {actions.map((action, i) => <SwipeButton key={action.key} action={action} index={i} count={actions.length} side={side} drag={drag} close={close} />)}
    </View>
  );
}

function SwipeButton({ action, index, count, side, drag, close }: { action: SwipeAction; index: number; count: number; side: "left" | "right"; drag: SharedValue<number>; close: () => void }) {
  // The button nearest the row's edge arrives last.
  const order = side === "right" ? index : count - 1 - index;
  const style = useAnimatedStyle(() => {
    const pulled = Math.abs(drag.value);
    const start = order * ACTION_W * 0.6;
    return {
      opacity: interpolate(pulled, [start, start + ACTION_W * 0.8], [0, 1], Extrapolation.CLAMP),
      transform: [{ scale: interpolate(pulled, [start, start + ACTION_W], [0.6, 1], Extrapolation.CLAMP) }],
    };
  });
  return (
    <Pressable onPress={() => { close(); action.onPress(); }} accessibilityRole="button" accessibilityLabel={action.label} testID={`swipe-${action.key}`}
      style={{ width: ACTION_W, backgroundColor: action.color, alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={[{ alignItems: "center", gap: 4 }, style]}>
        <Ionicons name={action.icon} size={22} color={action.ink} />
        <Text style={{ color: action.ink, fontSize: 12, fontWeight: "700" }} numberOfLines={1}>{action.label}</Text>
      </Animated.View>
    </Pressable>
  );
}

function SwipeRow({ left, right, openRow, style, children }: {
  left: SwipeAction[]; right: SwipeAction[]; openRow: React.MutableRefObject<SwipeableMethods | null>;
  style: object; children: React.ReactNode;
}) {
  const me = useRef<SwipeableMethods>(null);
  const close = () => me.current?.close();
  return (
    <ReanimatedSwipeable
      ref={me}
      friction={1.6}
      overshootFriction={8}
      leftThreshold={ACTION_W * 0.6}
      rightThreshold={ACTION_W * 0.6}
      containerStyle={[{ overflow: "hidden" }, style]}
      onSwipeableWillOpen={() => {
        tap("light");
        if (openRow.current && openRow.current !== me.current) openRow.current.close();
        openRow.current = me.current;
      }}
      renderLeftActions={(_, drag) => <SwipeButtons actions={left} side="left" drag={drag} close={close} />}
      renderRightActions={(_, drag) => <SwipeButtons actions={right} side="right" drag={drag} close={close} />}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  heading: { flexDirection: "row", alignItems: "center", gap: sp[3] },
  compose: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
  search: { minHeight: 48, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, gap: sp[2] },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 10 },
  clear: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginRight: -12 },
  row: { flexDirection: "row", alignItems: "center", gap: sp[3], paddingHorizontal: sp[2], paddingVertical: 10, minHeight: 80 },
  // A gap between the photo and its story ring, as the stories on Home have.
  ring: { borderWidth: 2.5, borderRadius: 999, padding: 2 },
  dot: { width: 11, height: 11, borderRadius: 6 },
  archivedIcon: { width: 65, height: 65, borderRadius: radius.lg, alignItems: "center", justifyContent: "center" },
  words: { flex: 1, minWidth: 0, gap: 5 },
  nameLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  previewLine: { flexDirection: "row", alignItems: "center", gap: 4 },
  live: { position: "absolute", right: 3, bottom: 3, width: 15, height: 15, borderRadius: 8, borderWidth: 2.5 },
  groupMark: { position: "absolute", right: 1, bottom: 1, width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: "center", justifyContent: "center" },
});
