/**
 * Scan item after item without leaving the camera. Each barcode is looked up
 * at once and shown on a card over the camera: the item it is, or that it is
 * not in the catalogue. Pointing at the next barcode replaces the card.
 *
 * In a catalogue that counts stock, the scanner can also count: in "In" each
 * scan adds one to that item, in "Out" each scan takes one away, with Undo.
 */
import React, { useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";

import { catalogue, lookUpBarcode, useBarcodeLookup, useCatalogueChanged, useCatalogueIdle, type CatalogueItem } from "@/api/catalogue";
import { errorMessage } from "@/api/errors";
import { useT } from "@/i18n";
import { Button, Card, ErrorBanner, Page, PageTitle, Screen, Segments } from "@/ui";
import { useLayout } from "@/ui/layout";
import { BARCODE_TYPES } from "@/ui/ScanCode";
import { fail, success, tick, warn } from "@/ui/haptics";
import { radius, sp, useTheme } from "@/ui/theme";

/**
 * The camera reads a barcode many times a second while it is in view. A read
 * only counts as a new scan once the code has been out of view this long, so
 * holding one box up counts it once, and showing it again counts it again.
 */
const GONE_MS = 900;

type Mode = "look" | "in" | "out";
type Counted = { item: CatalogueItem; change: number };
const SHOWN = 3;

export default function BarcodeScanner() {
  const t = useTheme(), tr = useT();
  const router = useRouter();
  const layout = useLayout();
  const params = useLocalSearchParams<{ catalogue?: string }>();
  const catalogueId = params.catalogue ? Number(params.catalogue) : undefined;
  const [permission, ask] = useCameraPermissions();
  const [code, setCode] = useState("");
  const [torch, setTorch] = useState(false);
  const seen = useRef({ code: "", at: 0 });
  const latest = useRef("");
  const lookup = useBarcodeLookup(code, catalogueId);
  const changed = useCatalogueChanged();
  const config = useCatalogueIdle(catalogueId).data?.catalogue;
  const counting = !!config?.track_stock;
  const [mode, setMode] = useState<Mode>("look");
  const active: Mode = counting ? mode : "look";
  const [counted, setCounted] = useState<Counted | null>(null);
  const [countProblem, setCountProblem] = useState("");

  /** One scan in "In" or "Out": find the item and change its stock by one. */
  const count = async (value: string, change: number) => {
    try {
      const match = await lookUpBarcode(value, catalogueId);
      if (latest.current !== value) return;
      if (match.exact.length !== 1) { warn(); return; }  // the card says it isn't there, or which it might be
      const item = await catalogue.stock(match.exact[0].id, { change });
      if (latest.current !== value) return;
      success();
      setCounted({ item, change });
      changed();
    } catch (e) {
      fail();
      if (latest.current === value) setCountProblem(errorMessage(e));
    }
  };

  const found = ({ data }: BarcodeScanningResult) => {
    const value = String(data || "").trim();
    const now = Date.now();
    const stillInView = value === seen.current.code && now - seen.current.at < GONE_MS;
    seen.current = { code: value, at: now };
    if (!value || stillInView) return;
    if (active === "look" && value === code) return;
    latest.current = value;
    setCode(value);
    setCounted(null);
    setCountProblem("");
    if (active === "look") success();
    else { tick(); void count(value, active === "in" ? 1 : -1); }
  };

  /** The − and + on the card, and Undo. */
  const adjust = async (item: CatalogueItem, by: number, undo = false) => {
    tick();
    setCountProblem("");
    try {
      const fresh = await catalogue.stock(item.id, { change: by });
      setCounted(old => undo ? null : old && old.item.id === fresh.id ? { ...old, item: fresh } : old);
      changed();
    } catch (e) { fail(); setCountProblem(errorMessage(e)); }
  };

  const showAll = () => {
    tick();
    router.replace({ pathname: "/(tabs)/plu", params: { scan: code, view: "search", ...(catalogueId ? { catalogue: String(catalogueId) } : {}) } });
  };
  const edit = (item: CatalogueItem) => { tick(); router.push(`/items/item?catalogue=${item.catalogue_id}&id=${item.id}` as never); };
  const add = () => {
    const id = lookup.data?.catalogue?.id;
    if (!id) return;
    tick();
    router.push(`/items/item?${new URLSearchParams({ catalogue: String(id), code })}` as never);
  };
  const close = () => { tick(); setCode(""); setCounted(null); setCountProblem(""); latest.current = ""; seen.current = { code: "", at: 0 }; };

  if (!permission) return <Screen back backLabel={tr("Items")}><Page><PageTitle>{tr("Scan a barcode")}</PageTitle></Page></Screen>;
  if (!permission.granted) return (
    <Screen back backLabel={tr("Items")}>
      <Page>
        <PageTitle sub={tr("Use the camera to search by product or PLU code.")}>{tr("Scan a barcode")}</PageTitle>
        <Card>
          <View style={styles.permission}>
            <Ionicons name="camera-outline" size={34} color={t.brand} />
            <Text style={{ color: t.text, fontSize: 18, fontWeight: "700", textAlign: "center" }}>{tr("Camera access is off")}</Text>
            <Text style={{ color: t.muted, fontSize: 15, lineHeight: 22, textAlign: "center" }}>{tr("Allow camera access to scan a barcode. You can still type a code instead.")}</Text>
            <Button title={tr("Allow camera")} icon="camera-outline" onPress={() => { tick(); void ask(); }} />
          </View>
        </Card>
      </Page>
    </Screen>
  );

  const data = lookup.data;
  const shown: CatalogueItem[] = data ? (data.exact.length ? data.exact : data.others).slice(0, SHOWN) : [];
  const more = data ? data.count - shown.length : 0;

  return (
    <Screen back backLabel={tr("Items")}>
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={torch}
          onBarcodeScanned={found}
          barcodeScannerSettings={{ barcodeTypes: BARCODE_TYPES }}
        />
        <View style={styles.overlay} pointerEvents="box-none">
          <View style={[styles.guide, { borderColor: code ? "rgba(255,255,255,0.5)" : t.brand }]} accessibilityLabel={tr("Place the barcode inside the frame")} />
          <Text style={styles.hint}>{active === "in" ? tr("Each scan adds one") : active === "out" ? tr("Each scan takes one away")
            : code ? tr("Point at the next barcode to keep going") : tr("Place the barcode inside the frame")}</Text>
          <Pressable onPress={() => { tick(); setTorch(on => !on); }} accessibilityRole="switch" accessibilityState={{ checked: torch }}
            accessibilityLabel={tr("Torch")} hitSlop={8}
            style={({ pressed }) => [styles.torch, { backgroundColor: torch ? t.brand : "rgba(0,0,0,0.6)", opacity: pressed ? 0.75 : 1 }]}>
            <Ionicons name={torch ? "flashlight" : "flashlight-outline"} size={22} color={torch ? t.brandInk : "#fff"} />
          </Pressable>
        </View>

        {counting ? (
          <View style={[styles.modes, { top: layout.insets.top + layout.bar + sp[2] }]}>
            <Segments<Mode> value={mode} label={tr("Scan mode")} onChange={next => { setMode(next); setCounted(null); }}
              options={[{ value: "look", label: tr("Look up"), icon: "search" }, { value: "in", label: tr("In +1"), icon: "add-circle-outline" }, { value: "out", label: tr("Out −1"), icon: "remove-circle-outline" }]} />
          </View>
        ) : null}

        {code ? (
          <View style={[styles.sheet, { backgroundColor: t.surface, marginBottom: layout.insets.bottom + sp[3] }]} accessibilityLiveRegion="polite" testID="scan-result">
            <View style={styles.sheetHead}>
              <View style={{ flex: 1 }} />
              <Pressable onPress={close} accessibilityRole="button" accessibilityLabel={tr("Close")} hitSlop={10}>
                <Ionicons name="close" size={22} color={t.muted} />
              </Pressable>
            </View>

            {countProblem ? <Text accessibilityRole="alert" style={{ color: t.danger, fontSize: 14 }}>{countProblem}</Text> : null}
            {counted && counted.item.code && lookup.data?.exact[0]?.id === counted.item.id ? (
              <View style={{ gap: sp[3] }} testID="scan-counted">
                <View style={styles.row}>
                  <Text style={{ color: counted.change > 0 ? t.brandStrong : t.danger, fontSize: 28, fontWeight: "800", fontVariant: ["tabular-nums"] }}>{counted.change > 0 ? `+${counted.change}` : `−${-counted.change}`}</Text>
                  <Text style={{ color: t.text, fontSize: 18, fontWeight: "700", flex: 1 }} numberOfLines={2}>{counted.item.title}</Text>
                </View>
                <StockLine stock={counted.item.stock} onMinus={() => void adjust(counted.item, -1)} onPlus={() => void adjust(counted.item, 1)} />
                <Button title="Undo" icon="arrow-undo-outline" kind="plain" size="sm" onPress={() => void adjust(counted.item, -counted.change, true)} testID="scan-undo" />
              </View>
            ) : lookup.isLoading ? (
              <View style={styles.row}>
                <ActivityIndicator color={t.brand} />
                <Text style={{ color: t.text2, fontSize: 15 }}>{tr("Looking it up…")}</Text>
              </View>
            ) : lookup.error ? (
              <ErrorBanner error={lookup.error} onRetry={() => void lookup.refetch()} />
            ) : data && data.exact.length === 1 ? (
              <Details item={data.exact[0]} headers={(data.catalogue?.headers ?? []).filter(h => h !== data.catalogue?.code_column && h !== data.catalogue?.title_column)} onEdit={() => edit(data.exact[0])}
                stock={data.catalogue?.track_stock ? { onMinus: () => void adjust(data.exact[0], -1), onPlus: () => void adjust(data.exact[0], 1) } : undefined} />
            ) : data && !data.exact.length && !data.count ? (
              <View style={{ gap: sp[2] }}>
                <Text style={{ color: t.text, fontSize: 17, fontWeight: "700" }}>{tr("Not in your catalogue")}</Text>
                <Text style={{ color: t.muted, fontSize: 14, lineHeight: 20 }}>
                  {data.catalogue?.name ? tr("Nothing in {name} has this code.", { name: data.catalogue.name }) : tr("No item has this code.")}
                </Text>
                {data.catalogue?.code_column ? <Button title="Add this item" icon="add" size="sm" onPress={add} testID="scan-add" /> : null}
              </View>
            ) : data ? (
              <View style={{ gap: sp[2] }}>
                {!data.exact.length ? <Text style={{ color: t.muted, fontSize: 13 }}>{tr("No exact match. Closest items:")}</Text> : null}
                {shown.map(item => (
                  <Pressable key={item.id} style={styles.item} testID="scan-item" onPress={() => edit(item)} accessibilityRole="button">
                    <Text style={{ color: t.text, fontSize: 16, lineHeight: 22, flex: 1, minWidth: 0 }}>{item.description || item.title}</Text>
                  </Pressable>
                ))}
                {more > 0 ? <Button title={tr("See all {count} results", { count: data.count })} kind="plain" size="sm" onPress={showAll} /> : null}
                {!data.exact.length && data.catalogue?.code_column ? <Button title="Add this item" icon="add" kind="plain" size="sm" onPress={add} /> : null}
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

/** Everything the catalogue holds about the scanned item, column by column. */
function Details({ item, headers, onEdit, stock }: { item: CatalogueItem; headers: string[]; onEdit: () => void; stock?: { onMinus: () => void; onPlus: () => void } }) {
  const t = useTheme();
  const rows = headers.filter(h => item.fields[h]);
  return <View style={{ gap: sp[2] }} testID="scan-details">
    <Text style={{ color: t.text, fontSize: 19, fontWeight: "700" }}>{item.title}</Text>
    <ScrollView style={{ maxHeight: 220 }} contentContainerStyle={{ gap: sp[1] }}>
      {rows.map(h => (
        <View key={h} style={styles.field}>
          <Text style={{ color: t.muted, fontSize: 14, width: "38%" }} numberOfLines={2}>{h}</Text>
          <Text selectable={false} style={{ color: t.text, fontSize: 15, flex: 1, fontWeight: "600" }}>{item.fields[h]}</Text>
        </View>
      ))}
    </ScrollView>
    {stock ? <StockLine stock={item.stock} {...stock} /> : null}
    <Button title="Edit item" icon="create-outline" kind="plain" size="sm" onPress={onEdit} />
  </View>;
}

/** "Stock 13" with a − and a + beside it. */
function StockLine({ stock, onMinus, onPlus }: { stock: number; onMinus: () => void; onPlus: () => void }) {
  const t = useTheme(), tr = useT();
  const step = (icon: "remove" | "add", label: string, onPress: () => void) => (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={4}
      style={({ pressed }) => [styles.step, { backgroundColor: pressed ? t.surface3 : t.surface2 }]}>
      <Ionicons name={icon} size={22} color={t.text} />
    </Pressable>
  );
  return <View style={styles.row} testID="scan-stock">
    <Text style={{ color: t.muted, fontSize: 15, flex: 1 }}>{tr("Stock")}</Text>
    {step("remove", tr("One fewer"), onMinus)}
    <Text accessibilityLiveRegion="polite" style={{ color: stock > 0 ? t.text : t.danger, fontSize: 22, fontWeight: "800", minWidth: 48, textAlign: "center", fontVariant: ["tabular-nums"] }}>{stock}</Text>
    {step("add", tr("One more"), onPlus)}
  </View>;
}

const styles = StyleSheet.create({
  modes: { position: "absolute", left: sp[3], right: sp[3] },
  step: { width: 44, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  field: { flexDirection: "row", gap: sp[3], paddingVertical: 2 },
  permission: { alignItems: "center", gap: sp[3], paddingVertical: sp[4] },
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", paddingHorizontal: sp[6], backgroundColor: "rgba(0,0,0,0.22)" },
  guide: { width: "100%", maxWidth: 340, aspectRatio: 1.65, borderWidth: 3, borderRadius: radius.lg, backgroundColor: "transparent" },
  hint: { color: "#fff", fontSize: 16, fontWeight: "700", textAlign: "center", marginTop: sp[4], textShadowColor: "#000", textShadowRadius: 6 },
  torch: { marginTop: sp[4], width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  sheet: { position: "absolute", left: sp[3], right: sp[3], bottom: 0, borderRadius: radius.lg, padding: sp[4], gap: sp[3] },
  sheetHead: { flexDirection: "row", alignItems: "center", gap: sp[2] },
  row: { flexDirection: "row", alignItems: "center", gap: sp[3], minHeight: 32 },
  item: { flexDirection: "row", alignItems: "flex-start", gap: sp[3] },
});
