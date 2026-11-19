/**
 * Add an item to a catalogue, or change one: a box for each column. The
 * barcode box can read the code with the camera, and says at once when that
 * code already belongs to another item.
 */
import React, { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { catalogue, lookUpBarcode, useCatalogueChanged, useCatalogueDetails, type CatalogueDetails, type CatalogueItem } from "@/api/catalogue";
import { errorMessage } from "@/api/errors";
import { useSession } from "@/auth/session";
import { useT } from "@/i18n";
import { Button, Card, ErrorBanner, Field, Input, Page, PageTitle, Screen } from "@/ui";
import { confirm } from "@/ui/confirm";
import { ScanCode } from "@/ui/ScanCode";
import { SkeletonRows } from "@/ui/Skeleton";
import { success, tick } from "@/ui/haptics";
import { radius, sp, useTheme } from "@/ui/theme";

export default function ItemScreen() {
  const tr = useT();
  const { me } = useSession();
  const params = useLocalSearchParams<{ catalogue: string; id?: string; code?: string; scan?: string }>();
  const catalogueId = Number(params.catalogue);
  const itemId = params.id ? Number(params.id) : undefined;
  const details = useCatalogueDetails(catalogueId);
  const item = useQuery({ queryKey: ["catalogue", me?.username, "item", itemId], queryFn: () => catalogue.one(itemId!), enabled: !!me && !!itemId });
  const error = details.error || item.error;
  const ready = details.data && (!itemId || item.data);

  return <Screen back backLabel={details.data?.name || tr("Catalogue")}><Page keyboardShouldPersistTaps="handled">
    <PageTitle sub={details.data?.name}>{itemId ? tr("Edit item") : tr("Add item")}</PageTitle>
    {error ? <ErrorBanner error={error} onRetry={() => { void details.refetch(); if (itemId) void item.refetch(); }} /> : null}
    {!ready && !error ? <SkeletonRows count={3} /> : null}
    {ready ? <Form key={itemId ?? "new"} details={details.data!} item={item.data} startCode={params.code} startScan={params.scan === "1"} /> : null}
  </Page></Screen>;
}

function Form({ details, item, startCode, startScan }: { details: CatalogueDetails; item?: CatalogueItem; startCode?: string; startScan: boolean }) {
  const t = useTheme(), tr = useT();
  const router = useRouter(), changed = useCatalogueChanged();
  const codeColumn = details.code_column;
  const blank = () => Object.fromEntries(details.headers.map(h => [h, ""]));
  const [values, setValues] = useState<Record<string, string>>(() => ({
    ...blank(), ...(item?.fields ?? {}), ...(startCode && codeColumn ? { [codeColumn]: startCode } : {}),
  }));
  const [scanning, setScanning] = useState(false);
  const [taken, setTaken] = useState<CatalogueItem | null>(null);
  const [busy, setBusy] = useState(false), [problem, setProblem] = useState("");
  const [saved, setSaved] = useState("");
  const counting = !!details.track_stock;
  const [stock, setStock] = useState(String(item?.stock ?? 0));
  const stockOk = /^-?\d{1,9}$/.test(stock.trim());
  const bump = (by: number) => { tick(); setStock(old => String((Number(old) || 0) + by)); setSaved(""); };

  const checkCode = async (code: string) => {
    setTaken(null);
    if (!code) return;
    try {
      const found = await lookUpBarcode(code, details.id);
      const other = found.exact.find(i => i.id !== item?.id);
      if (other) setTaken(other);
    } catch { /* the save says so if it really is taken */ }
  };
  useEffect(() => {
    if (startScan && codeColumn) setScanning(true);
    else if (startCode) void checkCode(startCode);
    // Once, when the form opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (header: string, value: string) => {
    setValues(old => ({ ...old, [header]: value }));
    setSaved("");
    if (header === codeColumn) setTaken(null);
  };
  const scanned = (code: string) => {
    setScanning(false);
    set(codeColumn, code);
    void checkCode(code);
  };

  const save = async (next: boolean) => {
    setBusy(true); setProblem("");
    try {
      const fields = Object.fromEntries(details.headers.map(h => [h, (values[h] || "").trim()]));
      const result = item ? await catalogue.updateItem(item.id, fields) : await catalogue.addItem(details.id, fields);
      if (counting && Number(stock) !== (item?.stock ?? 0)) await catalogue.stock(result.id, { count: Number(stock) });
      changed();
      success();
      if (next) {
        setValues(blank());
        setStock("0");
        setTaken(null);
        setSaved(tr("Saved {name}.", { name: result.title }));
        if (codeColumn) setScanning(true);
      } else router.back();
    } catch (e) { setProblem(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const remove = () => item && confirm(tr("Delete {name}?", { name: item.title }), tr("This item is removed from {name}.", { name: details.name }), tr("Delete"), async () => {
    setBusy(true); setProblem("");
    try { await catalogue.removeItem(item.id); changed(); router.back(); }
    catch (e) { setProblem(errorMessage(e)); setBusy(false); }
  });

  const canSave = !busy && !!(values[details.title_column] || "").trim() && (!counting || stockOk);

  return <>
    {saved ? <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", gap: sp[2], padding: sp[3], borderRadius: radius.md, backgroundColor: t.surface2 }}>
      <Ionicons name="checkmark-circle" size={20} color={t.brand} />
      <Text style={{ color: t.text, flex: 1 }}>{saved}</Text>
    </View> : null}
    <Card style={{ gap: sp[4] }}>
      {details.headers.map(header => {
        const isCode = header === codeColumn, isName = header === details.title_column;
        return <Field key={header} label={isName ? `${header} *` : header}>
          {isCode ? (
            <View style={{ flexDirection: "row", gap: sp[2], alignItems: "center" }}>
              <View style={{ flex: 1 }}>
                <Input accessibilityLabel={header} value={values[header] || ""} onChangeText={v => set(header, v)} onEndEditing={() => void checkCode((values[header] || "").trim())}
                  autoCapitalize="none" autoCorrect={false} maxLength={100} editable={!busy} invalid={!!taken} testID="item-code" />
              </View>
              <Pressable onPress={() => { tick(); setScanning(true); }} accessibilityRole="button" accessibilityLabel={tr("Scan barcode")} disabled={busy}
                style={({ pressed }) => ({ width: 48, height: 48, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? t.brandStrong : t.brand })}>
                <Ionicons name="barcode-outline" size={24} color={t.brandInk} />
              </Pressable>
            </View>
          ) : (
            <Input accessibilityLabel={header} value={values[header] || ""} onChangeText={v => set(header, v)} editable={!busy} multiline={!isName} maxLength={10000} testID={isName ? "item-name" : undefined} />
          )}
          {isCode && taken ? (
            <Pressable onPress={() => router.replace(`/items/item?catalogue=${details.id}&id=${taken.id}` as never)} accessibilityRole="button" style={{ marginTop: sp[2] }}>
              <Text style={{ color: t.danger, fontSize: 14, lineHeight: 20 }}>{tr("{name} already has this code. Tap to open it.", { name: taken.title })}</Text>
            </Pressable>
          ) : null}
        </Field>;
      })}
      {counting ? <Field label={tr("Stock")} error={stockOk ? undefined : tr("Enter the stock as a whole number.")}>
        <View style={{ flexDirection: "row", gap: sp[2], alignItems: "center" }}>
          <Stepper icon="remove" label={tr("One fewer")} onPress={() => bump(-1)} disabled={busy} />
          <View style={{ flex: 1 }}>
            <Input accessibilityLabel={tr("Stock")} value={stock} onChangeText={v => { setStock(v.replace(/[^\d-]/g, "")); setSaved(""); }} keyboardType="numbers-and-punctuation"
              editable={!busy} invalid={!stockOk} style={{ textAlign: "center", fontVariant: ["tabular-nums"] }} testID="item-stock" />
          </View>
          <Stepper icon="add" label={tr("One more")} onPress={() => bump(1)} disabled={busy} />
        </View>
      </Field> : null}
      {problem ? <Text accessibilityRole="alert" style={{ color: t.danger }}>{problem}</Text> : null}
      <Button title={item ? "Save changes" : "Save item"} onPress={() => void save(false)} busy={busy} disabled={!canSave || !!taken} testID="item-save" />
      {!item ? <Button title={codeColumn ? "Save and scan next" : "Save and add another"} kind="plain" icon={codeColumn ? "barcode-outline" : "add"} onPress={() => void save(true)} disabled={!canSave || !!taken} /> : null}
      {item ? <Button title="Delete item" kind="danger" icon="trash-outline" onPress={remove} disabled={busy} /> : null}
    </Card>
    {codeColumn ? <ScanCode visible={scanning} onClose={() => setScanning(false)} onCode={scanned} /> : null}
  </>;
}

function Stepper({ icon, label, onPress, disabled }: { icon: "add" | "remove"; label: string; onPress: () => void; disabled?: boolean }) {
  const t = useTheme();
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} hitSlop={4}
    style={({ pressed }) => ({ width: 52, height: 52, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? t.surface3 : t.surface2, opacity: disabled ? 0.5 : 1 })}>
    <Ionicons name={icon} size={24} color={t.text} />
  </Pressable>;
}
