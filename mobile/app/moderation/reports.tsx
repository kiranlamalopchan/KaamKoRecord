/**
 * The moderators' queue (templates/moderation/reports.html): one card per
 * reported thing — several reports of the same notice are one card, with how
 * many — what was said and why, and two answers. Take down hides it from
 * everyone; Dismiss leaves it up. Admins and the moderators they chose only.
 */
import React, { useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";

import { moderation, useModerationReports } from "@/api";
import { errorMessage } from "@/api/errors";
import type { ModerationReport } from "@/api/types";
import { useT } from "@/i18n";
import { Button, Card, Empty, ErrorBanner, PageTitle, Screen, Segments } from "@/ui";
import { confirm } from "@/ui/confirm";
import { WithDepth } from "@/ui/depth";
import { success } from "@/ui/haptics";
import { useLayout } from "@/ui/layout";
import { SkeletonRows } from "@/ui/Skeleton";
import { radius, sp, useTheme } from "@/ui/theme";

type Status = "open" | "handled";

export default function Reports() {
  const t = useTheme(), tr = useT();
  const layout = useLayout();
  const client = useQueryClient();
  const [status, setStatus] = useState<Status>("open");
  const query = useModerationReports(status);
  const [busy, setBusy] = useState<number | null>(null);
  const [problem, setProblem] = useState("");
  const rows = query.data?.pages.flatMap(p => p.results) ?? [];
  const open = query.data?.pages[0]?.open ?? 0;

  const answer = async (report: ModerationReport, action: "take_down" | "dismiss") => {
    setBusy(report.id); setProblem("");
    try {
      await moderation.resolve(report.id, action);
      success();
      await client.invalidateQueries({ queryKey: ["moderation-reports"] });
      void client.invalidateQueries({ queryKey: ["me"] });
    } catch (e) { setProblem(errorMessage(e)); }
    finally { setBusy(null); }
  };
  const takeDown = (report: ModerationReport) => confirm(
    tr("Take this {kind} down?", { kind: report.kind_label.toLowerCase() }),
    tr("It's hidden from everyone, and every report of it is closed."),
    tr("Take down"),
    () => void answer(report, "take_down"),
  );

  const header = <View style={{ gap: sp[3], paddingTop: sp[4], paddingBottom: sp[3] }}>
    <PageTitle sub={tr("Check what was reported against the community rules, then take it down or dismiss the report.")}>{tr("Reports")}</PageTitle>
    <Segments<Status> value={status} label={tr("Reports")} onChange={setStatus}
      options={[{ value: "open", label: open ? tr("Open ({count})", { count: open }) : tr("Open") }, { value: "handled", label: tr("Handled") }]} />
    {query.error ? <ErrorBanner error={query.error} onRetry={() => void query.refetch()} /> : null}
    {problem ? <Text accessibilityRole="alert" style={{ color: t.danger }}>{problem}</Text> : null}
  </View>;

  return <Screen back backLabel={tr("Settings")}>
    <WithDepth>{(under) => <FlatList<ModerationReport>
      {...under.scroll}
      onScroll={under.onScroll} scrollEventThrottle={16}
      style={{ flex: 1 }}
      data={rows}
      keyExtractor={r => String(r.id)}
      contentContainerStyle={[layout.column, { paddingTop: under.padTop, paddingBottom: layout.insets.bottom + sp[6], gap: sp[3] }]}
      ListHeaderComponent={header}
      renderItem={({ item }) => <Line report={item} handled={status === "handled"} busy={busy === item.id}
        onTakeDown={() => takeDown(item)} onDismiss={() => void answer(item, "dismiss")} />}
      ListEmptyComponent={query.isLoading ? <SkeletonRows count={3} /> : query.error ? undefined
        : <Empty icon="shield-checkmark-outline" title={status === "open" ? tr("No open reports") : tr("Nothing handled yet")} sub={status === "open" ? tr("Nice and quiet.") : undefined} />}
      ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator color={t.brand} style={{ marginTop: sp[3] }} /> : undefined}
      onEndReached={() => { if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage(); }}
      onEndReachedThreshold={0.5}
      showsVerticalScrollIndicator={false}
    />}</WithDepth>
  </Screen>;
}

function Line({ report, handled, busy, onTakeDown, onDismiss }: { report: ModerationReport; handled: boolean; busy: boolean; onTakeDown: () => void; onDismiss: () => void }) {
  const t = useTheme(), tr = useT();
  const router = useRouter();
  const when = new Date(report.created).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  return <Card style={{ gap: sp[2] }} testID="moderation-report">
    <View style={styles.head}>
      <Text style={{ color: t.text, fontSize: 16, fontWeight: "700" }}>{tr(report.kind_label)}</Text>
      <Text style={{ color: t.danger, fontSize: 14 }}>{tr(report.reason_label)}</Text>
      {report.reports > 1 ? <View style={[styles.count, { backgroundColor: t.surface2 }]}>
        <Text style={{ color: t.brandStrong, fontSize: 12, fontWeight: "700" }}>{tr("{count} reports", { count: report.reports })}</Text>
      </View> : null}
      {!report.up ? <Text style={{ color: t.muted, fontSize: 13 }}>{tr("Already gone")}</Text> : null}
    </View>
    {report.excerpt ? <View style={[styles.quote, { borderLeftColor: t.line, backgroundColor: t.surface2 }]}>
      <Text style={{ color: t.text, fontSize: 15, lineHeight: 21 }}>{report.excerpt}</Text>
    </View> : null}
    {report.note ? <Text style={{ color: t.text2, fontSize: 14, fontStyle: "italic" }}>“{report.note}”</Text> : null}
    <Text style={{ color: t.muted, fontSize: 13 }}>
      {report.accused ? <Text onPress={() => router.push(`/people/${encodeURIComponent(report.accused!.username)}` as never)} style={{ color: t.brandStrong }}>{tr("By {name}", { name: report.accused.username })} · </Text> : null}
      {tr("reported by {name}", { name: report.reporter.username })} · {when}
    </Text>
    {!handled ? <View style={styles.actions}>
      {report.can_take_down && report.up ? <Button title="Take down" kind="danger" size="sm" icon="eye-off-outline" onPress={onTakeDown} busy={busy} testID="moderation-take-down" /> : null}
      <Button title="Dismiss" kind="plain" size="sm" icon="checkmark" onPress={onDismiss} disabled={busy} testID="moderation-dismiss" />
    </View> : <View style={styles.head}>
      <Ionicons name="checkmark-circle-outline" size={16} color={t.muted} />
      <Text style={{ color: t.muted, fontSize: 13 }}>{report.up ? tr("Dismissed, still up") : tr("Taken down")}</Text>
    </View>}
  </Card>;
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: sp[2], flexWrap: "wrap" },
  count: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
  quote: { borderLeftWidth: 3, borderRadius: 6, paddingHorizontal: sp[3], paddingVertical: sp[2] },
  actions: { flexDirection: "row", gap: sp[2], flexWrap: "wrap" },
});
