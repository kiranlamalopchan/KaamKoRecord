/**
 * One message in a conversation. Consecutive messages from the same person
 * a few minutes apart are drawn as a run: the name above the first (in a
 * group), the corners joined between them, the time under the last.
 */
import React, { memo, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { Extrapolation, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withSpring, ZoomIn } from "react-native-reanimated";
import { tap } from "@/ui/haptics";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";

import type { ChatAttachment, ChatStatus, ConvoMessage } from "@/api/types";
import { useT } from "@/i18n";
import { Avatar } from "@/ui";
import { useTheme } from "@/ui/theme";
import { formatBytes, formatDuration } from "./send";
import { VoicePlayer } from "./Voice";

export type Rect = { x: number; y: number; width: number; height: number };

export type Line = ConvoMessage & {
  /** Not on the server yet: the outgoing queue's key and how far its upload is. */
  localKey?: number;
  progress?: number;
  failed?: boolean;
  error?: string;
  localFiles?: { uri: string; kind: string }[];
};

type Props = {
  line: Line;
  group: boolean;
  firstOfRun: boolean;
  lastOfRun: boolean;
  showStatus: boolean;
  /** Held: the message and where it sits on screen, for the reaction menu to rise from. */
  onLongPress: (line: Line, rect?: Rect) => void;
  onOpenMedia: (items: ChatAttachment[], index: number) => void;
  onOpenFile: (attachment: ChatAttachment) => void;
  onRetry: (line: Line) => void;
  onDiscard: (line: Line) => void;
  onReplyPress?: (id: number) => void;
  /** Swiped far enough to reply (someone else's message to the right, your own to the left). */
  onSwipeReply?: (line: Line) => void;
};

/** How far a message is pulled before letting go means "reply". */
const SWIPE_TO_REPLY = 64;
/**
 * The strip along the left of the screen where a drag is iPhone's "go back", never a reply.
 * Without it, swiping back from a conversation also slid the message under your thumb and
 * showed its reply arrow along the screen's edge as the page left.
 */
const BACK_EDGE = 36;

function StatusIcon({ status, color }: { status?: ChatStatus; color: string }) {
  const tr = useT();
  const name = status === "read" ? "checkmark-done" : status === "delivered" ? "checkmark-done-outline" : status === "sent" ? "checkmark" : "time-outline";
  const label = status === "read" ? tr("Read") : status === "delivered" ? tr("Delivered") : status === "sent" ? tr("Sent") : tr("Sending…");
  return <Ionicons name={name} size={14} color={color} accessibilityLabel={label} />;
}

function Photos({ items, local, onOpen, onHold }: { items: ChatAttachment[]; local?: string[]; onOpen: (index: number) => void; onHold: () => void }) {
  const tr = useT();
  const sources = items.length ? items.map(item => ({ uri: item.thumb || item.url, w: item.width || 4, h: item.height || 3 })) : (local || []).map(uri => ({ uri, w: 4, h: 3 }));
  if (sources.length === 1) {
    const ratio = Math.max(0.6, Math.min(1.8, sources[0].w / sources[0].h));
    return (
      <Pressable onPress={() => onOpen(0)} onLongPress={onHold} delayLongPress={280} accessibilityRole="imagebutton" accessibilityLabel={tr("Photo. Open full screen.")}>
        <Image source={{ uri: sources[0].uri }} style={[styles.single, { aspectRatio: ratio }]} contentFit="cover" transition={120} recyclingKey={sources[0].uri} />
      </Pressable>
    );
  }
  const shown = sources.slice(0, 4);
  return (
    <View style={styles.grid}>
      {shown.map((source, i) => (
        <Pressable key={source.uri + i} onPress={() => onOpen(i)} onLongPress={onHold} delayLongPress={280} accessibilityRole="imagebutton" accessibilityLabel={tr("Photo {n} of {total}", { n: i + 1, total: sources.length })} style={styles.cell}>
          <Image source={{ uri: source.uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} recyclingKey={source.uri} />
          {i === 3 && sources.length > 4 ? <View style={styles.more}><Text style={styles.moreText}>+{sources.length - 4}</Text></View> : null}
        </Pressable>
      ))}
    </View>
  );
}

function VideoTile({ item, local, onOpen, onHold }: { item?: ChatAttachment; local?: string; onOpen: () => void; onHold: () => void }) {
  const tr = useT();
  const ratio = item?.width && item?.height ? Math.max(0.6, Math.min(1.8, item.width / item.height)) : 16 / 9;
  return (
    <Pressable onPress={item ? onOpen : undefined} onLongPress={onHold} delayLongPress={280} accessibilityRole="button" accessibilityLabel={tr("Video, {length}. Play.", { length: formatDuration(item?.duration) })} style={[styles.single, { aspectRatio: ratio, backgroundColor: "#111" }]}>
      {item?.thumb || local ? <Image source={{ uri: item?.thumb || local }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
      <View style={styles.playBadge}><Ionicons name="play" size={26} color="#fff" /></View>
      {item?.duration ? <Text style={styles.duration}>{formatDuration(item.duration)}</Text> : null}
    </Pressable>
  );
}

function FileCard({ item, mine, onOpen, onHold }: { item: ChatAttachment; mine: boolean; onOpen: () => void; onHold: () => void }) {
  const t = useTheme(), tr = useT();
  const ext = (item.name.split(".").pop() || "").toUpperCase();
  const icon = ext === "PDF" ? "document-text" : ["XLS", "XLSX", "CSV"].includes(ext) ? "grid" : ext === "ZIP" ? "archive" : "document";
  const ink = mine ? t.brandInk : t.text;
  return (
    <Pressable onPress={onOpen} onLongPress={onHold} delayLongPress={280} accessibilityRole="button" accessibilityLabel={tr("{name}, {size}. Download.", { name: item.name, size: formatBytes(item.size) })} style={[styles.file, { backgroundColor: mine ? "rgba(255,255,255,0.16)" : t.surface2 }]}>
      <Ionicons name={icon as never} size={26} color={ink} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: ink, fontWeight: "700", fontSize: 14 }} numberOfLines={2}>{item.name}</Text>
        <Text style={{ color: ink, opacity: 0.75, fontSize: 12 }}>{ext} · {formatBytes(item.size)}</Text>
      </View>
      <Ionicons name="download-outline" size={21} color={ink} />
    </Pressable>
  );
}

function BubbleImpl({ line, group, firstOfRun, lastOfRun, showStatus, onLongPress, onOpenMedia, onOpenFile, onRetry, onDiscard, onReplyPress, onSwipeReply }: Props) {
  const t = useTheme(), tr = useT();
  const row = useRef<React.ComponentRef<typeof View>>(null);

  // ---- swipe to reply ----
  // Only a clearly sideways drag in the reply direction starts it, so scrolling the thread
  // up and down (and the hold for reactions) work as before.
  const dx = useSharedValue(0), armed = useSharedValue(false);
  const dir = line.mine ? -1 : 1;
  const canSwipe = !!onSwipeReply && !line.event && !line.unsent && line.localKey === undefined;
  const fireReply = () => onSwipeReply?.(line);
  const buzz = () => tap("light");
  const swipe = Gesture.Pan()
    .withTestId(`swipe-reply-${line.id}`)
    .enabled(canSwipe)
    .activeOffsetX(dir > 0 ? 14 : -14)
    .failOffsetY([-12, 12])
    // A drag starting at the screen's left edge is the back swipe: this one stands aside.
    .hitSlop({ left: -BACK_EDGE })
    .onUpdate(e => {
      const pulled = Math.max(0, e.translationX * dir);
      // Past the point that counts, it gets heavier to pull.
      const shown = pulled > SWIPE_TO_REPLY ? SWIPE_TO_REPLY + (pulled - SWIPE_TO_REPLY) * 0.25 : pulled;
      dx.value = shown * dir;
      if (pulled >= SWIPE_TO_REPLY && !armed.value) { armed.value = true; runOnJS(buzz)(); }
      else if (pulled < SWIPE_TO_REPLY) armed.value = false;
    })
    .onEnd(() => {
      if (armed.value) runOnJS(fireReply)();
      armed.value = false;
      dx.value = withSpring(0, { damping: 16, stiffness: 190 });
    })
    .onFinalize(() => {
      if (dx.value !== 0) dx.value = withSpring(0, { damping: 16, stiffness: 190 });
    });
  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: dx.value }] }));
  const arrow = useAnimatedStyle(() => {
    const pulled = Math.abs(dx.value);
    return {
      opacity: interpolate(pulled, [12, SWIPE_TO_REPLY], [0, 1], Extrapolation.CLAMP),
      transform: [{ scale: interpolate(pulled, [12, SWIPE_TO_REPLY, SWIPE_TO_REPLY + 12], [0.4, 1, 1.15], Extrapolation.CLAMP) }],
    };
  });

  // Where the message is on screen, so the reactions rise from it like they do in other messengers.
  const hold = () => {
    const node = row.current;
    let answered = false;
    // If measuring never answers (mid-scroll), the menu still opens, centred.
    const fallback = setTimeout(() => { if (!answered) { answered = true; onLongPress(line); } }, 150);
    if (node && typeof node.measureInWindow === "function") {
      node.measureInWindow((x: number, y: number, width: number, height: number) => {
        if (answered) return;
        answered = true;
        clearTimeout(fallback);
        onLongPress(line, width ? { x, y, width, height } : undefined);
      });
    }
  };
  if (line.event) {
    return <Text style={[styles.event, { color: t.muted }]} accessibilityRole="text">{line.body}</Text>;
  }
  const mine = line.mine;
  const ink = mine ? t.brandInk : t.text;
  const visual = line.attachments.filter(a => a.kind === "photo" || a.kind === "video");
  const localPhotos = (line.localFiles || []).filter(f => f.kind === "photo").map(f => f.uri);
  const localVideo = (line.localFiles || []).find(f => f.kind === "video")?.uri;
  const photos = line.attachments.filter(a => a.kind === "photo");
  const video = line.attachments.find(a => a.kind === "video");
  const audio = line.attachments.find(a => a.kind === "audio");
  const files = line.attachments.filter(a => a.kind === "file");
  const mediaOnly = !line.body && !line.reply && (photos.length || video || localPhotos.length || localVideo) && !audio && !files.length;
  const r = 20, tight = 6;
  const corners = mine
    ? { borderTopRightRadius: firstOfRun ? r : tight, borderBottomRightRadius: lastOfRun ? r : tight }
    : { borderTopLeftRadius: firstOfRun ? r : tight, borderBottomLeftRadius: lastOfRun ? r : tight };
  const pending = line.localKey !== undefined && !line.failed;
  const label = [
    mine ? tr("You") : line.sender?.name,
    line.unsent ? tr("Message removed") : line.body,
    line.attachments.length ? tr("{n} attachments", { n: line.attachments.length }) : "",
    line.time,
  ].filter(Boolean).join(", ");

  return (
    <View>
      <Animated.View pointerEvents="none" style={[styles.replyArrow, mine ? { right: 6 } : { left: group ? 40 : 6 }, { backgroundColor: t.surface2 }, arrow]}>
        <Ionicons name="arrow-undo" size={18} color={t.text2} />
      </Animated.View>
    <GestureDetector gesture={swipe}>
    <Animated.View style={slide}>
    <View ref={row} collapsable={false} style={[styles.row, { justifyContent: mine ? "flex-end" : "flex-start", marginTop: firstOfRun ? 8 : 2 }]}>
      {group && !mine ? <View style={styles.avatarSlot}>{lastOfRun ? <Avatar person={line.sender} size={28} /> : null}</View> : null}
      <View style={{ maxWidth: "80%", alignItems: mine ? "flex-end" : "flex-start" }}>
        {group && !mine && firstOfRun ? <Text style={[styles.sender, { color: t.muted }]}>{line.sender?.name}</Text> : null}
        {line.forwarded ? <Text style={[styles.forwarded, { color: t.muted }]}><Ionicons name="arrow-redo-outline" size={11} /> {tr("Forwarded")}</Text> : null}
        <Pressable
          onLongPress={hold}
          delayLongPress={280}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint={tr("Hold for options")}
          accessibilityActions={[{ name: "longpress", label: tr("Message options") }]}
          onAccessibilityAction={() => onLongPress(line)}
          style={[
            styles.bubble,
            mediaOnly ? styles.bare : { backgroundColor: mine ? t.brand : t.surface, borderColor: t.line, borderWidth: mine ? 0 : StyleSheet.hairlineWidth },
            corners,
            pending && { opacity: 0.75 },
          ]}
        >
          {line.reply ? (
            <Pressable onPress={() => onReplyPress?.(line.reply!.id)} onLongPress={hold} delayLongPress={280} accessibilityRole="button" accessibilityLabel={tr("Replying to {name}", { name: line.reply.sender || "" })} style={[styles.quote, { borderLeftColor: mine ? t.brandInk : t.brand, backgroundColor: mine ? "rgba(255,255,255,0.14)" : t.surface2 }]}>
              <Text style={{ color: ink, fontSize: 12, fontWeight: "700" }} numberOfLines={1}>{line.reply.mine ? tr("You") : line.reply.sender}</Text>
              <Text style={{ color: ink, opacity: 0.8, fontSize: 13 }} numberOfLines={2}>
                {line.reply.unsent ? tr("Message removed") : line.reply.body || tr(line.reply.attachment === "video" ? "Video" : line.reply.attachment === "audio" ? "Voice message" : line.reply.attachment === "file" ? "File" : "Photo")}
              </Text>
            </Pressable>
          ) : null}
          {line.unsent ? null : (
            <>
              {photos.length || localPhotos.length ? <Photos items={photos} local={localPhotos} onHold={hold} onOpen={i => onOpenMedia(visual, visual.indexOf(photos[i]) >= 0 ? visual.indexOf(photos[i]) : i)} /> : null}
              {video || localVideo ? <VideoTile item={video} local={localVideo} onHold={hold} onOpen={() => video && onOpenMedia(visual, visual.indexOf(video))} /> : null}
              {audio ? <View style={{ paddingVertical: 2 }}><VoicePlayer uri={audio.url} duration={audio.duration} waveform={audio.waveform} mine={mine} onHold={hold} /></View> : null}
              {files.map(file => <FileCard key={file.id} item={file} mine={mine} onHold={hold} onOpen={() => onOpenFile(file)} />)}
            </>
          )}
          {line.unsent ? <Text style={{ color: ink, fontStyle: "italic", fontSize: 15, opacity: 0.8 }}>{tr("Message removed")}</Text>
            : line.body ? <Text selectable style={[styles.body, { color: ink }, mediaOnly ? null : (photos.length || video) ? { marginTop: 6 } : null]}>{line.body}</Text> : null}
          {pending && line.progress !== undefined && line.progress < 1 && (line.attachments.length || line.localFiles?.length) ? (
            <View style={[styles.progressTrack, { backgroundColor: mine ? "rgba(255,255,255,0.3)" : t.line }]} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round((line.progress || 0) * 100) }}>
              <View style={{ width: `${Math.round((line.progress || 0) * 100)}%`, height: "100%", backgroundColor: mine ? t.brandInk : t.brand }} />
            </View>
          ) : null}
        </Pressable>
        {line.reactions?.length ? (
          // Keyed by what's in it, so a new or changed reaction pops in rather than just appearing.
          <Animated.View key={line.reactions.map(r => r.emoji + r.count).join("")} entering={ZoomIn.springify().damping(11).stiffness(260)}
            style={[styles.reactions, { backgroundColor: t.surface, borderColor: t.line }]}>
            {line.reactions.map(reaction => <Text key={reaction.emoji} style={{ fontSize: 13, color: t.text }}>{reaction.emoji}{reaction.count > 1 ? ` ${reaction.count}` : ""}</Text>)}
          </Animated.View>
        ) : null}
        {line.failed ? (
          <View style={styles.failedRow}>
            <Ionicons name="alert-circle" size={15} color={t.danger} />
            <Text style={{ color: t.danger, fontSize: 12, flexShrink: 1 }} numberOfLines={2}>{line.error || tr("Not sent.")}</Text>
            <Pressable onPress={() => onRetry(line)} accessibilityRole="button" accessibilityLabel={tr("Retry sending")} testID="chat-retry" style={styles.failedAction}>
              <Text style={{ color: t.brand, fontWeight: "700", fontSize: 12 }}>{tr("Retry")}</Text>
            </Pressable>
            <Pressable onPress={() => onDiscard(line)} accessibilityRole="button" accessibilityLabel={tr("Discard message")} style={styles.failedAction}>
              <Text style={{ color: t.muted, fontWeight: "600", fontSize: 12 }}>{tr("Discard")}</Text>
            </Pressable>
          </View>
        ) : lastOfRun ? (
          <View style={styles.meta}>
            {line.pinned ? <Ionicons name="pin" size={11} color={t.muted} /> : null}
            <Text style={{ color: t.muted, fontSize: 11 }}>{pending ? (line.progress && line.progress < 1 && line.localFiles?.length ? `${Math.round(line.progress * 100)}%` : tr("Sending…")) : line.time}{line.edited ? ` · ${tr("Edited")}` : ""}</Text>
            {mine && showStatus && !line.unsent ? <StatusIcon status={pending ? "sending" : line.status} color={line.status === "read" ? t.brand : t.muted} /> : null}
          </View>
        ) : null}
      </View>
    </View>
    </Animated.View>
    </GestureDetector>
    </View>
  );
}

export const Bubble = memo(BubbleImpl);

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-end", gap: 6 },
  replyArrow: { position: "absolute", bottom: 14, width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  avatarSlot: { width: 28 },
  sender: { fontSize: 12, fontWeight: "600", marginLeft: 12, marginBottom: 2 },
  forwarded: { fontSize: 11, marginHorizontal: 10, marginBottom: 2 },
  bubble: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, overflow: "hidden" },
  bare: { paddingHorizontal: 0, paddingVertical: 0, backgroundColor: "transparent" },
  body: { fontSize: 16, lineHeight: 22 },
  quote: { borderLeftWidth: 3, borderRadius: 8, paddingLeft: 8, paddingRight: 8, paddingVertical: 4, marginBottom: 6, maxWidth: 260 },
  single: { width: 240, maxWidth: "100%", borderRadius: 16, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  grid: { width: 240, flexDirection: "row", flexWrap: "wrap", gap: 3, borderRadius: 16, overflow: "hidden" },
  cell: { width: 118.5, height: 118.5, overflow: "hidden" },
  more: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
  moreText: { color: "#fff", fontSize: 22, fontWeight: "700" },
  playBadge: { width: 52, height: 52, borderRadius: 26, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", paddingLeft: 3 },
  duration: { position: "absolute", right: 8, bottom: 6, color: "#fff", fontSize: 12, fontWeight: "600", textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 3 },
  file: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, padding: 10, marginVertical: 2, minWidth: 220, minHeight: 56 },
  progressTrack: { height: 4, borderRadius: 2, overflow: "hidden", marginTop: 6, minWidth: 120 },
  reactions: { flexDirection: "row", gap: 4, marginTop: -6, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  meta: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3, marginHorizontal: 6 },
  failedRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4, flexWrap: "wrap", justifyContent: "flex-end" },
  failedAction: { minHeight: 32, paddingHorizontal: 6, justifyContent: "center" },
  event: { alignSelf: "center", fontSize: 12, marginVertical: 10, textAlign: "center", paddingHorizontal: 24 },
});
