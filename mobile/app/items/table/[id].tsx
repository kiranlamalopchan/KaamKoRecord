/**
 * One catalogue as a table: every item with its barcode and other columns.
 * Add an item by typing or by scanning its barcode; tap one to change it.
 */
import React from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";

import { useCatalogueItems, type CatalogueConfig, type CatalogueItem } from "@/api/catalogue";
import { useT } from "@/i18n";
import { Button, Empty, ErrorBanner, PageTitle, Screen } from "@/ui";
import { useLayout } from "@/ui/layout";
import { WithDepth } from "@/ui/depth";
import { SkeletonRows } from "@/ui/Skeleton";
import { tick } from "@/ui/haptics";
import { radius, sp, useTheme } from "@/ui/theme";

export default function CatalogueTable() {
  const t = useTheme(), tr = useT();
  const router = useRouter(), layout = useLayout();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useCatalogueItems(Number(id));
  const pages = query.data?.pages ?? [];
  const config = pages[0]?.catalogue;
  const rows = pages.flatMap(p => p.results);
  const count = pages[0]?.count ?? 0;

  const open = (item?: CatalogueItem, scan = false) => {
    tick();
    const params = new URLSearchParams({ catalogue: String(id), ...(item ? { id: String(item.id) } : {}), ...(scan ? { scan: "1" } : {}) });
    router.push(`/items/item?${params}` as never);
  };

  const header = <View style={{ gap: sp[3], paddingTop: sp[4], paddingBottom: sp[3] }}>
    <PageTitle sub={config ? (count === 1 ? tr("1 item") : tr("{count} items", { count: count.toLocaleString() })) : undefined}>{config?.name || tr("Catalogue")}</PageTitle>
    <View style={{ flexDirection: "row", gap: sp[2] }}>
      <Button title="Add item" icon="add" style={{ flex: 1 }} onPress={() => open()} testID="table-add" />
      {config?.code_column ? <Button title="Scan to add" icon="barcode-outline" kind="plain" style={{ flex: 1 }} onPress={() => open(undefined, true)} /> : null}
    </View>
    {config && !config.code_column ? (
      <Pressable onPress={() => router.push(`/items/catalogue/${id}` as never)} accessibilityRole="button" style={[styles.note, { backgroundColor: t.surface2 }]}>
        <Ionicons name="barcode-outline" size={18} color={t.brandStrong} />
        <Text style={{ color: t.text2, flex: 1, fontSize: 14 }}>{tr("Choose a barcode column to scan items.")}</Text>
        <Ionicons name="chevron-forward" size={16} color={t.muted} />
      </Pressable>
    ) : null}
    {query.error ? <ErrorBanner error={query.error} onRetry={() => void query.refetch()} /> : null}
  </View>;

  return <Screen back backLabel={tr("Catalogues")} right={config ? <Pressable onPress={() => router.push(`/items/catalogue/${id}` as never)} accessibilityRole="button" accessibilityLabel={tr("Edit catalogue")} hitSlop={8}>
      <Ionicons name="settings-outline" size={22} color={t.text} />
    </Pressable> : undefined}>
    <WithDepth>{(under) => <FlatList<CatalogueItem>
      {...under.scroll}
      onScroll={under.onScroll} scrollEventThrottle={16}
      style={{ flex: 1 }}
      data={rows}
      keyExtractor={item => String(item.id)}
      contentContainerStyle={[layout.column, { paddingTop: under.padTop, paddingBottom: layout.insets.bottom + sp[6] }]}
      ListHeaderComponent={header}
      renderItem={({ item, index }) => <Row item={item} config={config!} first={index === 0} last={index === rows.length - 1} onPress={() => open(item)} />}
      ListEmptyComponent={query.isLoading ? <SkeletonRows count={4} /> : query.error ? undefined
        : <Empty icon="cube-outline" title={tr("No items yet")} sub={tr("Add your first item, or scan its barcode.")} />}
      ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator style={{ marginTop: sp[4] }} color={t.brand} /> : undefined}
      onEndReached={() => { if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage(); }}
      onEndReachedThreshold={0.5}
      showsVerticalScrollIndicator={false}
    />}</WithDepth>
  </Screen>;
}

function Row({ item, config, first, last, onPress }: { item: CatalogueItem; config: CatalogueConfig; first: boolean; last: boolean; onPress: () => void }) {
  const t = useTheme();
  const extra = config.headers.filter(h => h !== config.title_column && h !== config.code_column)
    .map(h => item.fields[h] ? `${h}: ${item.fields[h]}` : "").filter(Boolean).join(" · ");
  return <Pressable onPress={onPress} accessibilityRole="button" testID="table-row"
    style={({ pressed }) => [styles.row, { backgroundColor: pressed ? t.surface2 : t.surface, borderColor: t.line },
      first && styles.first, last ? styles.last : { borderBottomWidth: StyleSheet.hairlineWidth }]}>
    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
      <Text style={{ color: t.text, fontSize: 16, fontWeight: "600" }} numberOfLines={2}>{item.title}</Text>
      {item.code ? <Text style={{ color: t.brandStrong, fontSize: 13, fontVariant: ["tabular-nums"] }}>{item.code}</Text> : null}
      {extra ? <Text style={{ color: t.muted, fontSize: 13 }} numberOfLines={2}>{extra}</Text> : null}
    </View>
    {config.track_stock ? <View style={[styles.stock, { backgroundColor: item.stock > 0 ? t.surface2 : t.dangerSoft }]} accessibilityLabel={`Stock ${item.stock}`}>
      <Text style={{ color: item.stock > 0 ? t.text : t.danger, fontSize: 15, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{item.stock}</Text>
    </View> : null}
    <Ionicons name="chevron-forward" size={16} color={t.muted} />
  </Pressable>;
}

const styles = StyleSheet.create({
  stock: { minWidth: 44, paddingHorizontal: sp[2], paddingVertical: 4, borderRadius: radius.pill, alignItems: "center" },
  note: { flexDirection: "row", alignItems: "center", gap: sp[2], padding: sp[3], borderRadius: radius.md },
  row: { flexDirection: "row", alignItems: "center", gap: sp[3], paddingHorizontal: sp[4], paddingVertical: sp[3], borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth },
  first: { borderTopWidth: StyleSheet.hairlineWidth, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  last: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
});
