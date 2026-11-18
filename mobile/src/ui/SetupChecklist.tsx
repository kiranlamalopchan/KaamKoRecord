import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { useT } from "@/i18n";
import { pushState } from "@/push/register";
import { usePrivateState } from "@/storage/private";
import { Card } from "./index";
import { sp, useTheme } from "./theme";

export function SetupChecklist({ workplaceCount, shiftCount }: { workplaceCount?: number; shiftCount?: number }) {
  const t = useTheme(), tr = useT();
  const router = useRouter();
  const [push, setPush] = useState(false);
  const [dismissed, setDismissed, ready] = usePrivateState("setup-checklist-dismissed", false);
  useEffect(() => { pushState().then(state => setPush(state === "on")).catch(() => {}); }, []);
  if (!ready || dismissed || workplaceCount == null || shiftCount == null) return null;
  const rows = [
    { done: workplaceCount > 0, title: tr("Add your workplace"), sub: tr("Set your rate, pay cycle and hours limit."), to: "/workplaces/new" },
    { done: shiftCount > 0, title: tr("Record your first shift"), sub: tr("Clock in now or add a past shift."), to: "/clock" },
    { done: push, title: tr("Choose your reminders"), sub: tr("Control exactly what may notify this phone."), to: "/profile/notifications" },
  ];
  const completed = rows.filter(row => row.done).length;
  if (completed === rows.length) return null;
  return <Card style={{ gap: sp[3] }} testID="setup-checklist">
    <View style={styles.head}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.text, fontSize: 18, fontWeight: "800" }}>{tr("Finish setting up")}</Text>
        <Text style={{ color: t.muted, fontSize: 13, marginTop: 2 }}>{tr("{done} of {total} complete", { done: completed, total: rows.length })}</Text>
      </View>
      <Pressable onPress={() => setDismissed(true)} accessibilityRole="button" accessibilityLabel={tr("Hide setup checklist")} style={styles.close}><Ionicons name="close" size={20} color={t.muted} /></Pressable>
    </View>
    {rows.map(row => <Pressable key={row.title} onPress={() => router.push(row.to as never)} accessibilityRole="button" accessibilityState={{ checked: row.done }} style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}>
      <Ionicons name={row.done ? "checkmark-circle" : "ellipse-outline"} size={23} color={row.done ? t.brand : t.muted} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: t.text, fontSize: 15, fontWeight: "700" }}>{row.title}</Text>
        <Text style={{ color: t.muted, fontSize: 13, lineHeight: 18 }}>{row.sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={17} color={t.muted} />
    </Pressable>)}
  </Card>;
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: sp[2] },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  row: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: sp[3] },
});
