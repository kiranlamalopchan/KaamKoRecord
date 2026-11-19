/**
 * Somebody's page (templates/noticeboard/person.html), laid out like a
 * profile: their face in the middle (with the ring of a story you may watch),
 * name, badge and the friends you share; one row of buttons that fits where
 * you stand (Add friend, Accept, Requested, or Friends and Message); their
 * tallies on one strip; then what they have posted. Report and Block sit
 * behind the ••• button, and an admin's moderator switch below the strip.
 */
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { friends, moderation, safety, useFriendsChanged, usePerson, useSafetyChanged } from "@/api";
import type { Person, PersonPage } from "@/api/types";
import { AdminBadge, Avatar, Button, Card, Empty, ErrorBanner, Page, Screen } from "@/ui";
import { choose, confirm, notify } from "@/ui/confirm";
import { SkeletonPerson } from "@/ui/Skeleton";
import { NoticeCard } from "@/ui/NoticeCard";
import { ReportSheet, type ReportTarget } from "@/ui/ReportSheet";
import { radius, sp, useTheme } from "@/ui/theme";
import { errorMessage } from "@/api/errors";
import { useT } from "@/i18n";
import { success } from "@/ui/haptics";

export default function PersonScreen() {
  const t = useTheme(), tr = useT();
  const router = useRouter();
  const { username } = useLocalSearchParams<{ username: string }>();
  const q = usePerson(username);
  const changed = useSafetyChanged();
  const friendsChanged = useFriendsChanged();
  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const data = q.data;

  /** One change, then the page (and every friends list) fetched again. */
  const run = async (key: string, work: () => Promise<unknown>, failed: string, after?: () => void) => {
    setBusy(key);
    try { await work(); success(); after?.(); friendsChanged(); await q.refetch(); }
    catch (e) { notify(tr(failed), errorMessage(e)); }
    finally { setBusy(null); }
  };

  const block = () => confirm(tr("Block {name}?", { name: username }), tr("Neither of you will see the other's posts, comments or stories, and any friendship ends."), tr("Block"),
    () => void run("block", () => safety.block(username), "Couldn't block them", changed));
  const unblock = () => void run("unblock", () => safety.unblock(username), "Couldn't unblock them", changed);
  const addFriend = () => void run("friend", () => friends.request(username), "Couldn't send the request");
  const accept = () => data?.friend_request && void run("friend", () => friends.accept(data.friend_request!), "Couldn't accept it");
  const decline = () => data?.friend_request && void run("decline", () => friends.decline(data.friend_request!), "Couldn't decline it");
  const cancel = () => confirm(tr("Cancel your request?"), undefined, tr("Cancel request"),
    () => data?.friend_request && void run("friend", () => friends.decline(data.friend_request!), "Couldn't cancel it"));
  const unfriend = () => confirm(tr("Remove {name} as a friend?", { name: username }), tr("Friends-only posts will stop reaching each other."), tr("Remove"),
    () => void run("friend", () => friends.remove(username), "Couldn't remove them"));
  const more = () => data && choose(data.person.username, [
    ...(data.friendship === "friends" ? [{ label: tr("Remove friend"), destructive: true, onPress: unfriend }] : []),
    { label: tr("Report"), onPress: () => setReporting({ kind: "user", id: data.id, username: data.person.username }) },
    { label: tr("Block"), destructive: true, onPress: block },
  ]);
  const message = () => router.push(`/messages/${encodeURIComponent(username)}` as never);

  /** An admin makes them a moderator, or stops it. */
  const moderate = (on: boolean) => confirm(
    on ? tr("Make {name} a moderator?", { name: username }) : tr("Remove {name} as a moderator?", { name: username }),
    on ? tr("They'll see what people report and can take posts down.") : tr("They'll no longer see reports."),
    on ? tr("Make moderator") : tr("Remove"),
    () => void run("moderator", () => moderation.setModerator(username, on), "Couldn't change that"),
    !on,
  );

  return (
    <Screen back backLabel={tr("Back")}>
      <Page>
        {q.error ? <ErrorBanner error={q.error} onRetry={q.refetch} /> : null}
        {q.isLoading ? <SkeletonPerson /> : null}
        {data ? (
          <>
            <Hero data={data} onStory={() => router.push(`/stories/${encodeURIComponent(username)}` as never)} />

            {data.person.is_me ? null : data.blocked ? (
              <Card tint={t.dangerSoft} style={styles.row}>
                <Ionicons name="ban-outline" size={20} color={t.danger} />
                <Text style={{ flex: 1, color: t.text, fontSize: 14.5 }}>{tr("You've blocked {name}. Their posts are hidden.", { name: data.person.username })}</Text>
                <Button title="Unblock" size="sm" kind="plain" onPress={unblock} busy={busy === "unblock"} testID="person-unblock" />
              </Card>
            ) : (
              <View style={styles.actions}>
                <FriendButton data={data} busy={busy} onAdd={addFriend} onAccept={accept} onCancel={cancel} onUnfriend={unfriend} />
                {data.friendship === "received"
                  ? <Button title="Decline" kind="plain" onPress={decline} busy={busy === "decline"} style={styles.grow} testID="person-decline" />
                  : data.can_message ? <Button title="Message" kind={data.friendship === "friends" ? "primary" : "plain"} icon="chatbubble-outline" onPress={message} style={styles.grow} testID="person-message" /> : null}
                <Pressable onPress={more} accessibilityRole="button" accessibilityLabel={tr("More options")} testID="person-more" hitSlop={6}
                  style={({ pressed }) => [styles.more, { backgroundColor: pressed ? t.surface3 : t.surface2 }]}>
                  <Ionicons name="ellipsis-horizontal" size={20} color={t.text} />
                </Pressable>
              </View>
            )}

            <Card pad={false} style={styles.strip}>
              <Stat n={data.notice_count} label={tr(data.notice_count === 1 ? "Notice" : "Notices")} />
              <Stat n={data.comment_count} label={tr(data.comment_count === 1 ? "Comment" : "Comments")} />
              <Stat n={data.friends_count ?? 0} label={tr(data.friends_count === 1 ? "Friend" : "Friends")} />
              <Stat n={data.received} label={tr("Reactions")} last />
            </Card>

            {data.can_make_moderator ? (
              <Card style={styles.row}>
                <View style={[styles.icon, { backgroundColor: t.brandSoft }]}><Ionicons name="shield-checkmark-outline" size={18} color={t.brand} /></View>
                <Text style={{ flex: 1, color: t.text, fontSize: 14.5 }}>
                  {data.is_moderator ? tr("{name} is a moderator: they can review reports.", { name: data.person.username }) : tr("Moderators can review reports and take posts down.")}
                </Text>
                <Button title={data.is_moderator ? "Remove moderator" : "Make moderator"} size="sm" kind={data.is_moderator ? "plain" : "primary"}
                  onPress={() => moderate(!data.is_moderator)} busy={busy === "moderator"} testID="person-make-moderator" />
              </Card>
            ) : null}

            <View style={styles.head}>
              <Text style={{ color: t.text, fontSize: 20, fontWeight: "700", letterSpacing: -0.3, flex: 1 }}>{data.person.is_me ? tr("Your notices") : tr("Notices")}</Text>
              {data.notice_count ? <Text style={{ color: t.muted, fontSize: 14 }}>{data.notice_count}</Text> : null}
            </View>
            {data.notices.length === 0
              ? <Empty icon="chatbubble-outline" title={data.blocked ? tr("Hidden while blocked") : tr("Nothing posted yet")} />
              : data.notices.map((n) => <NoticeCard key={n.id} notice={n} />)}
          </>
        ) : null}
      </Page>
      <ReportSheet target={reporting} onClose={() => setReporting(null)} onBlocked={() => { changed(); void q.refetch(); }} />
    </Screen>
  );
}

/** Face, name, badge, when they joined, and the friends you share. */
function Hero({ data, onStory }: { data: PersonPage; onStory: () => void }) {
  const t = useTheme(), tr = useT();
  const p = data.person;
  const ring = data.story === "unseen" ? t.brand : data.story === "seen" ? t.lineStrong : "transparent";
  const name = p.is_me ? tr("You") : p.name || p.username;
  const mutual = data.mutual ?? [];
  return (
    <View style={styles.hero}>
      <Pressable onPress={data.story ? onStory : undefined} disabled={!data.story} testID={data.story ? "person-story" : undefined}
        accessibilityRole={data.story ? "button" : undefined} accessibilityLabel={data.story ? tr("Watch {name}'s story", { name: p.username }) : undefined}>
        <View style={[styles.ring, { borderColor: ring }]}>
          <Avatar person={p} size={104} dotRing={t.bg} />
        </View>
      </Pressable>
      <View style={styles.nameLine}>
        <Text style={[styles.name, { color: t.text }]} numberOfLines={1}>{name}</Text>
      </View>
      {!p.is_me && p.name && p.name !== p.username ? <Text style={{ color: t.muted, fontSize: 15 }}>@{p.username}</Text> : null}
      <AdminBadge person={{ ...p, is_moderator: p.is_moderator ?? data.is_moderator }} size={12} full />
      <Text style={{ color: t.muted, fontSize: 14 }}>
        {tr("Joined {date}", { date: data.since })}{p.is_live ? <Text style={{ color: t.brand, fontWeight: "600" }}> · {tr("here now")}</Text> : null}
      </Text>
      {data.mutual_count ? (
        <View style={styles.mutual} testID="person-mutual">
          <View style={{ flexDirection: "row" }}>
            {mutual.map((m, i) => (
              <View key={m.username} style={[styles.face, { marginLeft: i ? -8 : 0, borderColor: t.bg }]}>
                <Avatar person={m as Person} size={22} live={false} />
              </View>
            ))}
          </View>
          <Text style={{ color: t.text2, fontSize: 14 }}>{tr(data.mutual_count === 1 ? "{count} mutual friend" : "{count} mutual friends", { count: data.mutual_count })}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** The one friendship button that fits where you stand. */
function FriendButton({ data, busy, onAdd, onAccept, onCancel, onUnfriend }: {
  data: PersonPage; busy: string | null; onAdd: () => void; onAccept: () => void; onCancel: () => void; onUnfriend: () => void;
}) {
  const working = busy === "friend";
  switch (data.friendship) {
    case "friends": return <Button title="Friends" kind="plain" icon="people" onPress={onUnfriend} busy={working} style={styles.grow} testID="person-friends" />;
    case "received": return <Button title="Accept" icon="person-add" onPress={onAccept} busy={working} style={styles.grow} testID="person-accept" />;
    case "sent": return <Button title="Requested" kind="plain" icon="time-outline" onPress={onCancel} busy={working} style={styles.grow} testID="person-requested" />;
    case "none": return <Button title="Add friend" icon="person-add-outline" onPress={onAdd} busy={working} style={styles.grow} testID="person-add" />;
    default: return null;
  }
}

function Stat({ n, label, last }: { n: number; label: string; last?: boolean }) {
  const t = useTheme();
  return (
    <View style={[styles.stat, !last && { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: t.line }]}>
      <Text style={{ color: t.text, fontWeight: "700", fontSize: 20, letterSpacing: -0.4 }}>{n}</Text>
      <Text style={{ color: t.muted, fontSize: 12.5 }} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: "center", gap: 6, paddingTop: sp[5], paddingBottom: sp[2] },
  ring: { borderWidth: 3, borderRadius: 999, padding: 3, marginBottom: sp[2] },
  nameLine: { flexDirection: "row", alignItems: "center", gap: 6, maxWidth: "90%" },
  name: { fontWeight: "800", fontSize: 26, letterSpacing: -0.5, flexShrink: 1 },
  mutual: { flexDirection: "row", alignItems: "center", gap: sp[2], marginTop: 2 },
  face: { borderWidth: 2, borderRadius: 999 },
  actions: { flexDirection: "row", gap: sp[2], alignItems: "center" },
  grow: { flex: 1 },
  more: { width: 52, height: 52, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  strip: { flexDirection: "row", paddingVertical: sp[3] },
  stat: { flex: 1, alignItems: "center", gap: 2, paddingHorizontal: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: sp[3] },
  icon: { width: 34, height: 34, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  head: { flexDirection: "row", alignItems: "center", gap: sp[2], marginTop: sp[2] },
});
