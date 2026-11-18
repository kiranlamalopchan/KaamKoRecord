import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { me, type NotificationPreferences } from "@/api";
import { currentPushToken } from "@/push/register";
import { useT } from "@/i18n";
import { ErrorBanner } from "./index";
import { tick } from "./haptics";
import { sp, useTheme } from "./theme";

const INITIAL: NotificationPreferences = { messages: true, roster: true, notices: true, pay: true, friends: true };
const ROWS: { key: keyof NotificationPreferences; icon: keyof typeof Ionicons.glyphMap; title: string; sub: string }[] = [
  { key: "messages", icon: "chatbubble-outline", title: "Messages", sub: "New messages from friends" },
  { key: "roster", icon: "calendar-outline", title: "Roster", sub: "Shift changes and cover" },
  { key: "notices", icon: "newspaper-outline", title: "Community", sub: "Notices, comments, reactions and stories" },
  { key: "pay", icon: "cash-outline", title: "Pay and time", sub: "Hours limits, clock-out and pay summaries" },
  { key: "friends", icon: "people-outline", title: "Friends", sub: "Friend requests and acceptances" },
];

export function NotificationChoices({ refreshKey = 0 }: { refreshKey?: number }) {
  const t = useTheme(), tr = useT();
  const [choices, setChoices] = useState(INITIAL);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<keyof NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    currentPushToken().then(async value => {
      if (!active) return;
      setToken(value);
      if (value) try { const saved = await me.devicePreferences(value); if (active) setChoices(saved); } catch (reason) { if (active) setError(reason); }
    }).catch(reason => { if (active) setError(reason); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refreshKey]);
  if (loading) return <View style={styles.loading} accessibilityRole="progressbar"><ActivityIndicator color={t.brand} /><Text style={{ color: t.muted }}>{tr("Loading notification choices")}</Text></View>;
  if (!token) return null;

  const change = async (key: keyof NotificationPreferences, value: boolean) => {
    tick(); setBusy(key); setError(null);
    const next = { ...choices, [key]: value };
    setChoices(next);
    try { setChoices(await me.saveDevicePreferences(token, next)); }
    catch (reason) { setChoices(choices); setError(reason); }
    finally { setBusy(null); }
  };

  return <View>
    {error ? <View style={{ padding: sp[3] }}><ErrorBanner error={error} /></View> : null}
    {ROWS.map((row, index) => <View key={row.key} style={[styles.row, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line }]}>
      <Ionicons name={row.icon} size={21} color={t.brand} accessibilityElementsHidden />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: t.text, fontSize: 15 }}>{tr(row.title)}</Text>
        <Text style={{ color: t.muted, fontSize: 13, lineHeight: 18 }}>{tr(row.sub)}</Text>
      </View>
      <Switch value={choices[row.key]} onValueChange={value => { void change(row.key, value); }} disabled={busy !== null} trackColor={{ true: t.brand }} accessibilityLabel={tr(row.title)} />
    </View>)}
  </View>;
}

const styles = StyleSheet.create({
  loading: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: sp[3], paddingHorizontal: sp[4] },
  row: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: sp[3], paddingHorizontal: sp[4], paddingVertical: sp[2] },
});
