/**
 * Start a conversation: tap a friend to open (or reopen) your one direct
 * thread with them, or switch to New group, tick two or more friends and
 * give it a name. Only friends are listed — the friends list is who may
 * message you.
 */
import React, { useDeferredValue, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { convo, useChatChanged, useChatPeople, type Person } from "@/api";
import { useT } from "@/i18n";
import { Avatar, Button, Card, Empty, ErrorBanner, Page, PageTitle, Screen } from "@/ui";
import { fail } from "@/ui/haptics";
import { SkeletonRows } from "@/ui/Skeleton";
import { radius, sp, useTheme } from "@/ui/theme";

export default function NewMessage() {
  const t = useTheme(), tr = useT();
  const router = useRouter();
  const changed = useChatChanged();
  const params = useLocalSearchParams<{ group?: string; add?: string }>();
  // ?add=<conversation id>: choosing people to add to an existing group.
  const adding = params.add || null;
  const [group, setGroup] = useState(params.group === "1" || !!adding);
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<Person[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const query = useDeferredValue(search.trim());
  const q = useChatPeople(query);
  const people = q.data?.people ?? [];

  const toggle = (person: Person) => setChosen(was => was.some(p => p.username === person.username) ? was.filter(p => p.username !== person.username) : [...was, person]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      if (adding) {
        await convo.addMembers(adding, chosen.map(p => p.username));
        changed();
        router.back();
      } else {
        const made = await convo.createGroup(title.trim(), chosen.map(p => p.username));
        changed();
        router.replace(`/messages/c/${made.id}` as never);
      }
    } catch (e) { fail(); setError(e); setBusy(false); }
  };

  const ready = adding ? chosen.length >= 1 : chosen.length >= 2 && !!title.trim();

  return (
    <Screen back backLabel={tr("Chats")}>
      <Page keyboardShouldPersistTaps="handled">
        <PageTitle sub={adding ? tr("Choose friends to add. They'll see messages from now on, not the history before.") : group ? tr("Choose at least two friends and name the group.") : tr("Choose a friend to start or reopen a private conversation.")}>
          {adding ? tr("Add people") : group ? tr("New group") : tr("New message")}
        </PageTitle>
        {!adding ? (
          <Pressable onPress={() => { setGroup(g => !g); setChosen([]); }} accessibilityRole="button" testID="chat-new-group"
            style={({ pressed }) => [styles.groupToggle, { backgroundColor: pressed ? t.surface2 : t.surface, borderColor: t.line }]}>
            <View style={[styles.groupIcon, { backgroundColor: t.brand }]}><Ionicons name={group ? "person" : "people"} size={20} color={t.brandInk} /></View>
            <Text style={{ color: t.text, fontSize: 16, fontWeight: "700", flex: 1 }}>{group ? tr("Message one friend instead") : tr("New group")}</Text>
            <Ionicons name="chevron-forward" size={19} color={t.muted} />
          </Pressable>
        ) : null}
        {group && !adding ? (
          <TextInput value={title} onChangeText={setTitle} placeholder={tr("Group name")} placeholderTextColor={t.muted} maxLength={100}
            accessibilityLabel={tr("Group name")} testID="chat-group-name" style={[styles.titleInput, { backgroundColor: t.surface, borderColor: t.line, color: t.text }]} />
        ) : null}
        {group && chosen.length ? (
          <View style={styles.chips}>
            {chosen.map(person => (
              <Pressable key={person.username} onPress={() => toggle(person)} accessibilityRole="button" accessibilityLabel={tr("Remove {name}", { name: person.name })} style={[styles.chip, { backgroundColor: t.surface2 }]}>
                <Text style={{ color: t.text, fontSize: 13, fontWeight: "600" }}>{person.name}</Text>
                <Ionicons name="close" size={14} color={t.text2} />
              </Pressable>
            ))}
          </View>
        ) : null}
        <View style={[styles.search, { backgroundColor: t.surface, borderColor: t.line }]}>
          <Ionicons name="search-outline" size={20} color={t.muted} />
          <TextInput autoFocus={!group} value={search} onChangeText={setSearch} placeholder={tr("Search friends")} placeholderTextColor={t.muted}
            accessibilityLabel={tr("Search friends")} style={[styles.input, { color: t.text }]} />
        </View>
        {error ? <ErrorBanner error={error} /> : null}
        {q.error ? <ErrorBanner error={q.error} onRetry={q.refetch} /> : null}
        {q.isLoading ? <SkeletonRows count={6} /> : null}
        {q.data && !people.length ? <Empty icon="people-outline" title={query ? tr("No friends found") : tr("No friends yet")} sub={query ? tr("Try another name.") : tr("Add a friend before starting a conversation.")} /> : null}
        {people.length ? <Card pad={false}>{people.map((person, index) => {
          const on = chosen.some(p => p.username === person.username);
          return (
            <Pressable key={person.username}
              onPress={() => group ? toggle(person) : router.replace(`/messages/${encodeURIComponent(person.username)}` as never)}
              accessibilityRole={group ? "checkbox" : "button"} accessibilityState={group ? { checked: on } : undefined}
              accessibilityLabel={group ? person.name : tr("Message {name}", { name: person.name })}
              testID={`chat-person-${person.username}`}
              style={({ pressed }) => [styles.row, { backgroundColor: pressed ? t.surface2 : "transparent", borderBottomColor: t.line, borderBottomWidth: index === people.length - 1 ? 0 : StyleSheet.hairlineWidth }]}>
              <Avatar person={person} size={46} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: t.text, fontSize: 16, fontWeight: "700" }} numberOfLines={1}>{person.name}</Text>
                <Text style={{ color: t.muted, fontSize: 13 }} numberOfLines={1}>{person.is_live ? tr("Active now") : `@${person.username}`}</Text>
              </View>
              {group ? <Ionicons name={on ? "checkmark-circle" : "ellipse-outline"} size={24} color={on ? t.brand : t.muted} /> : <Ionicons name="chevron-forward" size={19} color={t.muted} />}
            </Pressable>
          );
        })}</Card> : null}
        {group ? (
          <Button title={busy ? tr("Saving…") : adding ? tr("Add {n}", { n: chosen.length }) : tr("Create group")} icon={adding ? "person-add-outline" : "people-outline"}
            onPress={() => { void create(); }} disabled={!ready || busy} testID="chat-create-group" />
        ) : null}
      </Page>
    </Screen>
  );
}

const styles = StyleSheet.create({
  groupToggle: { minHeight: 60, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", gap: sp[3], paddingHorizontal: sp[4] },
  groupIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  titleInput: { minHeight: 50, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, fontSize: 16 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, minHeight: 36, borderRadius: 18 },
  search: { minHeight: 50, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, gap: sp[2] },
  input: { flex: 1, fontSize: 16, paddingVertical: 11 },
  row: { minHeight: 70, flexDirection: "row", alignItems: "center", gap: sp[3], paddingHorizontal: sp[4], paddingVertical: sp[3] },
});
