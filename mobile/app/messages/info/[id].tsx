/**
 * About a conversation: who is in it, what has been shared, what you
 * pinned, search, and the settings that are yours (mute, archive, delete)
 * or a group admin's (name, photo, members, admins).
 */
import React, { useDeferredValue, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";

import { convo, safety, useChatChanged, useConvo, useConvoMembers, type ChatAttachment, type ChatMember, type GalleryItem, type LinkItem } from "@/api";
import { useT } from "@/i18n";
import { Avatar, Card, ErrorBanner, MenuRow, Page, Screen, SectionLabel, Segments } from "@/ui";
import { choose, confirm, tell } from "@/ui/confirm";
import { fail } from "@/ui/haptics";
import { native } from "@/ui/native";
import { radius, sp, useTheme } from "@/ui/theme";
import { formatBytes, formatDuration } from "@/chat/send";
import { MediaViewer, saveOrShare } from "@/chat/Viewer";

type Shelf = "photo" | "video" | "file" | "audio" | "link";

export default function ConversationInfo() {
  const t = useTheme(), tr = useT();
  const router = useRouter();
  const changed = useChatChanged();
  const { id } = useLocalSearchParams<{ id: string }>();
  const page = useConvo(id);
  const c = page.data?.conversation;
  const isGroup = c?.kind === "group";
  const admin = c?.role === "admin";
  const members = useConvoMembers(isGroup ? id : "");
  const [shelf, setShelf] = useState<Shelf>("photo");
  const gallery = useQuery({ queryKey: ["chat", "gallery", id, shelf], queryFn: () => convo.gallery(id, shelf), enabled: !!id });
  const pins = useQuery({ queryKey: ["chat", "pins", id], queryFn: () => convo.pins(id), enabled: !!id });
  const [search, setSearch] = useState("");
  const query = useDeferredValue(search.trim());
  const found = useQuery({ queryKey: ["chat", "search", id, query], queryFn: () => convo.search(id, query), enabled: query.length >= 2 });
  const [viewer, setViewer] = useState<{ items: ChatAttachment[]; index: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  const run = async (work: () => Promise<unknown>, after?: () => void) => {
    setError(null);
    try { await work(); changed(); await page.refetch(); await members.refetch(); after?.(); } catch (e) { fail(); setError(e); }
  };

  const changePhoto = async () => {
    const P = native<typeof import("expo-image-picker")>(() => require("expo-image-picker"));
    const permission = await P.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { tell(tr("Photos"), tr("Allow photo access in Settings to choose a group photo.")); return; }
    const picked = await P.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.9 });
    if (picked.canceled) return;
    const asset = picked.assets[0];
    await run(() => convo.setPhoto(id, { uri: asset.uri, name: asset.fileName || "group.jpg", type: asset.mimeType || "image/jpeg" }));
  };

  const memberActions = (member: ChatMember) => {
    if (member.is_me) return;
    const options = [{ label: tr("View profile"), onPress: () => router.push(`/people/${encodeURIComponent(member.username)}` as never) }];
    if (admin) {
      options.push(member.role === "admin"
        ? { label: tr("Remove as admin"), onPress: () => { void run(() => convo.setRole(id, member.username, "member")); } }
        : { label: tr("Make admin"), onPress: () => { void run(() => convo.setRole(id, member.username, "admin")); } });
      options.push({ label: tr("Remove from group"), onPress: () => confirm(tr("Remove {name}?", { name: member.name }), tr("They'll no longer see new messages or what's shared here."), tr("Remove"), () => { void run(() => convo.removeMember(id, member.username)); }) } as never);
    }
    choose(member.name, options);
  };

  if (!c) {
    return (
      <Screen back backLabel={tr("Chat")}>
        <Page>{page.error ? <ErrorBanner error={page.error} onRetry={page.refetch} /> : <ActivityIndicator color={t.brand} style={{ marginTop: sp[6] }} />}</Page>
      </Screen>
    );
  }

  const avatar = c.person || ({ username: c.id, name: c.title, initial: c.initial, hue: c.hue, photo: c.photo } as never);
  const items = (gallery.data?.items ?? []) as GalleryItem[];

  return (
    <Screen back backLabel={tr("Chat")}>
      <Page keyboardShouldPersistTaps="handled">
        <View style={styles.top}>
          <Pressable onPress={admin && isGroup ? () => { void changePhoto(); } : undefined} disabled={!(admin && isGroup)} accessibilityRole={admin && isGroup ? "button" : undefined} accessibilityLabel={admin && isGroup ? tr("Change group photo") : undefined}>
            <Avatar person={avatar} size={88} />
            {admin && isGroup ? <View style={[styles.camera, { backgroundColor: t.brand, borderColor: t.bg }]}><Ionicons name="camera" size={14} color={t.brandInk} /></View> : null}
          </Pressable>
          {renaming !== null ? (
            <View style={styles.renameRow}>
              <TextInput value={renaming} onChangeText={setRenaming} autoFocus maxLength={100} accessibilityLabel={tr("Group name")}
                style={[styles.renameInput, { color: t.text, borderColor: t.line, backgroundColor: t.surface }]} />
              <Pressable onPress={() => { void run(() => convo.update(id, { title: renaming }), () => setRenaming(null)); }} accessibilityRole="button" accessibilityLabel={tr("Save name")} style={styles.icon44}>
                <Ionicons name="checkmark" size={24} color={t.brand} />
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={admin && isGroup ? () => setRenaming(c.title) : undefined} disabled={!(admin && isGroup)} accessibilityRole={admin && isGroup ? "button" : "header"} accessibilityHint={admin && isGroup ? tr("Rename the group") : undefined}>
              <Text style={{ color: t.text, fontSize: 22, fontWeight: "800", textAlign: "center" }}>{c.title}{admin && isGroup ? " ✎" : ""}</Text>
            </Pressable>
          )}
          <Text style={{ color: t.muted, fontSize: 14 }}>{isGroup ? tr("{n} members", { n: c.member_count ?? 0 }) : c.person?.is_live ? tr("Active now") : `@${c.person?.username}`}</Text>
        </View>

        <View style={styles.quick}>
          {!isGroup && c.person ? <Quick icon="person-circle-outline" label={tr("Profile")} onPress={() => router.push(`/people/${encodeURIComponent(c.person!.username)}` as never)} /> : null}
          <Quick icon={c.muted ? "notifications-outline" : "notifications-off-outline"} label={c.muted ? tr("Unmute") : tr("Mute")} onPress={() => { void run(() => convo.update(id, { muted: !c.muted })); }} />
          <Quick icon={c.archived ? "file-tray-full-outline" : "archive-outline"} label={c.archived ? tr("Unarchive") : tr("Archive")} onPress={() => { void run(() => convo.update(id, { archived: !c.archived })); }} />
          {isGroup && admin ? <Quick icon="person-add-outline" label={tr("Add")} onPress={() => router.push(`/messages/new?add=${id}` as never)} /> : null}
        </View>

        {error ? <ErrorBanner error={error} /> : null}

        <View style={[styles.search, { backgroundColor: t.surface, borderColor: t.line }]}>
          <Ionicons name="search-outline" size={20} color={t.muted} />
          <TextInput value={search} onChangeText={setSearch} placeholder={tr("Search in this conversation")} placeholderTextColor={t.muted} accessibilityLabel={tr("Search in this conversation")} style={{ flex: 1, color: t.text, fontSize: 16, paddingVertical: 10 }} />
        </View>
        {query.length >= 2 ? (
          <Card pad={false}>
            {found.isLoading ? <ActivityIndicator color={t.brand} style={{ margin: sp[4] }} /> : null}
            {found.data && !found.data.results.length ? <Text style={{ color: t.muted, padding: sp[4] }}>{tr("No messages found.")}</Text> : null}
            {found.data?.results.map((r, i) => (
              <View key={r.id} style={[styles.result, { borderBottomColor: t.line, borderBottomWidth: i === found.data!.results.length - 1 ? 0 : StyleSheet.hairlineWidth }]}>
                <Text style={{ color: t.muted, fontSize: 12 }}>{r.mine ? tr("You") : r.sender} · {r.day}</Text>
                <Text style={{ color: t.text, fontSize: 15 }} numberOfLines={3}>{r.body}</Text>
              </View>
            ))}
          </Card>
        ) : null}

        {pins.data?.messages.length ? (
          <>
            <SectionLabel>{tr("Pinned messages")}</SectionLabel>
            <Card pad={false}>
              {pins.data.messages.map((m, i) => (
                <View key={m.id} style={[styles.result, { borderBottomColor: t.line, borderBottomWidth: i === pins.data!.messages.length - 1 ? 0 : StyleSheet.hairlineWidth }]}>
                  <Text style={{ color: t.muted, fontSize: 12 }}>{m.mine ? tr("You") : m.sender.name} · {m.day}</Text>
                  <Text style={{ color: t.text, fontSize: 15 }} numberOfLines={3}>{m.body || tr(m.attachments[0]?.kind === "video" ? "Video" : m.attachments[0]?.kind === "audio" ? "Voice message" : m.attachments[0]?.kind === "file" ? "File" : "Photo")}</Text>
                </View>
              ))}
            </Card>
          </>
        ) : null}

        {isGroup ? (
          <>
            <SectionLabel>{tr("Members")}</SectionLabel>
            <Card pad={false}>
              {members.data?.members.map((m, i) => (
                <Pressable key={m.username} onPress={() => memberActions(m)} disabled={m.is_me} accessibilityRole="button" accessibilityLabel={`${m.name}${m.role === "admin" ? `, ${tr("admin")}` : ""}`}
                  style={({ pressed }) => [styles.member, { backgroundColor: pressed ? t.surface2 : "transparent", borderBottomColor: t.line, borderBottomWidth: i === members.data!.members.length - 1 ? 0 : StyleSheet.hairlineWidth }]}>
                  <Avatar person={m} size={40} />
                  <Text style={{ color: t.text, fontSize: 16, flex: 1 }} numberOfLines={1}>{m.is_me ? tr("You") : m.name}</Text>
                  {m.role === "admin" ? <Text style={{ color: t.brand, fontSize: 12, fontWeight: "700" }}>{tr("Admin")}</Text> : null}
                </Pressable>
              )) ?? <ActivityIndicator color={t.brand} style={{ margin: sp[4] }} />}
            </Card>
          </>
        ) : null}

        <SectionLabel>{tr("Shared")}</SectionLabel>
        <Segments<Shelf> value={shelf} onChange={setShelf} label={tr("Shared")} options={[
          { value: "photo", label: tr("Photos") }, { value: "video", label: tr("Videos") }, { value: "file", label: tr("Files") },
          { value: "audio", label: tr("Voice") }, { value: "link", label: tr("Links") },
        ]} />
        {gallery.isLoading ? <ActivityIndicator color={t.brand} /> : null}
        {gallery.error ? <ErrorBanner error={gallery.error} onRetry={gallery.refetch} /> : null}
        {gallery.data && !gallery.data.items.length ? <Text style={{ color: t.muted, textAlign: "center", padding: sp[4] }}>{tr("Nothing shared yet.")}</Text> : null}
        {shelf === "photo" || shelf === "video" ? (
          <View style={styles.grid}>
            {items.map((item, index) => (
              <Pressable key={item.id} onPress={() => setViewer({ items, index })} accessibilityRole="imagebutton" accessibilityLabel={item.kind === "video" ? tr("Video, {length}", { length: formatDuration(item.duration) }) : tr("Photo")} style={[styles.tile, { backgroundColor: t.surface2 }]}>
                <Image source={{ uri: item.thumb || item.url }} style={StyleSheet.absoluteFill} contentFit="cover" />
                {item.kind === "video" ? <Text style={styles.tileTime}>▶ {formatDuration(item.duration)}</Text> : null}
              </Pressable>
            ))}
          </View>
        ) : shelf === "link" ? (
          <Card pad={false}>
            {(gallery.data?.items as LinkItem[] | undefined)?.map((link, i) => (
              <Pressable key={`${link.message_id}-${i}`} onPress={() => { void Linking.openURL(link.url); }} accessibilityRole="link" style={[styles.result, { borderBottomColor: t.line, borderBottomWidth: StyleSheet.hairlineWidth }]}>
                <Text style={{ color: t.brand, fontSize: 15 }} numberOfLines={2}>{link.url}</Text>
              </Pressable>
            ))}
          </Card>
        ) : (
          <Card pad={false}>
            {items.map((item, i) => (
              <Pressable key={item.id} onPress={() => { void saveOrShare(item).catch(e => setError(e)); }} accessibilityRole="button" accessibilityLabel={tr("{name}, {size}. Download.", { name: item.name || tr("Voice message"), size: formatBytes(item.size) })}
                style={[styles.member, { borderBottomColor: t.line, borderBottomWidth: i === items.length - 1 ? 0 : StyleSheet.hairlineWidth }]}>
                <Ionicons name={item.kind === "audio" ? "mic-outline" : "document-outline"} size={24} color={t.text2} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.text, fontSize: 15 }} numberOfLines={1}>{item.kind === "audio" ? tr("Voice message") : item.name}</Text>
                  <Text style={{ color: t.muted, fontSize: 12 }}>{item.kind === "audio" ? formatDuration(item.duration) : formatBytes(item.size)} · {new Date(item.at).toLocaleDateString()}</Text>
                </View>
                <Ionicons name="download-outline" size={20} color={t.muted} />
              </Pressable>
            ))}
          </Card>
        )}

        <SectionLabel>{tr("Privacy and support")}</SectionLabel>
        <Card pad={false}>
          {!isGroup && c.person ? (
            <MenuRow icon="hand-left-outline" title={tr("Block {name}", { name: c.person.name })} tint={t.danger}
              onPress={() => confirm(tr("Block {name}?", { name: c.person!.name }), tr("They won't be able to message you, and this conversation closes for both of you."), tr("Block"), () => { void run(() => safety.block(c.person!.username), () => router.back()); })} />
          ) : null}
          {isGroup ? (
            <MenuRow icon="exit-outline" title={tr("Leave group")} tint={t.danger}
              onPress={() => confirm(tr("Leave {name}?", { name: c.title }), tr("You'll stop getting its messages."), tr("Leave"), () => { void run(() => convo.leave(id), () => router.replace("/messages" as never)); })} />
          ) : null}
          <MenuRow icon="trash-outline" title={tr("Delete conversation")} tint={t.danger} last
            onPress={() => confirm(tr("Delete this conversation?"), isGroup ? tr("Messages so far are removed for you only.") : tr("It's removed for you only. {name} keeps their copy.", { name: c.title }), tr("Delete"), () => { void run(() => convo.hideAll(id), () => router.replace("/messages" as never)); })} />
        </Card>
        <Text style={{ color: t.muted, fontSize: 12, lineHeight: 17 }}>
          {tr("Messages and attachments are encrypted on their way between your phone and KaamKoRecord, and kept privately on our server where only the people in this conversation can open them. They are not end-to-end encrypted. To report a message, hold it and choose Report — only that message is sent to our moderators.")}
        </Text>
      </Page>
      {viewer ? <MediaViewer items={viewer.items} start={viewer.index} onClose={() => setViewer(null)} /> : null}
    </Screen>
  );
}

function Quick({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.quickButton, { backgroundColor: pressed ? t.surface2 : t.surface, borderColor: t.line }]}>
      <Ionicons name={icon} size={22} color={t.text} />
      <Text style={{ color: t.text2, fontSize: 12, fontWeight: "600" }} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  top: { alignItems: "center", gap: 6, paddingTop: sp[2] },
  camera: { position: "absolute", right: 0, bottom: 0, width: 28, height: 28, borderRadius: 14, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  renameRow: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "stretch" },
  renameInput: { flex: 1, minHeight: 44, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, fontSize: 17 },
  icon44: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  quick: { flexDirection: "row", gap: sp[2], justifyContent: "center" },
  quickButton: { flex: 1, maxWidth: 110, minHeight: 64, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center", gap: 4 },
  search: { minHeight: 48, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, gap: sp[2] },
  result: { paddingHorizontal: sp[4], paddingVertical: sp[3], gap: 3 },
  member: { flexDirection: "row", alignItems: "center", gap: sp[3], paddingHorizontal: sp[4], minHeight: 58 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 3 },
  tile: { width: "32.6%", aspectRatio: 1, borderRadius: 6, overflow: "hidden" },
  tileTime: { position: "absolute", left: 6, bottom: 4, color: "#fff", fontSize: 11, fontWeight: "700", textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 3 },
});
