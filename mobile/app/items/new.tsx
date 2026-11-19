/**
 * Make a catalogue in the app instead of uploading a file: a name, then the
 * columns. The first column names each item and the second holds its
 * barcode; any more (price, size, shelf…) are the person's own.
 */
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { catalogue, useCatalogueChanged } from "@/api/catalogue";
import { errorMessage } from "@/api/errors";
import { useT } from "@/i18n";
import { Button, Card, Field, Input, Page, PageTitle, Screen } from "@/ui";
import { tick } from "@/ui/haptics";
import { Switch } from "@/ui/timesheet";
import { sp, useTheme } from "@/ui/theme";

export default function NewCatalogue() {
  const t = useTheme(), tr = useT();
  const router = useRouter(), changed = useCatalogueChanged();
  const [name, setName] = useState("");
  const [columns, setColumns] = useState<string[]>([tr("Name"), tr("Barcode"), tr("Price")]);
  const [stock, setStock] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");

  const clean = columns.map(c => c.trim());
  const unique = new Set(clean.map(c => c.toLocaleLowerCase())).size === clean.length;
  const ready = !!name.trim() && clean.length >= 2 && clean.every(Boolean) && unique;

  const setColumn = (i: number, value: string) => setColumns(old => old.map((c, j) => j === i ? value : c));
  const save = async () => {
    setBusy(true); setError("");
    try {
      const made = await catalogue.create({ name: name.trim(), headers: clean, title_column: clean[0], code_column: clean[1], track_stock: stock });
      changed();
      router.replace(`/items/table/${made.id}` as never);
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  return <Screen back backLabel={tr("Catalogues")}><Page>
    <PageTitle sub={tr("Name it, choose its columns, then add items one by one.")}>{tr("Create a catalogue")}</PageTitle>
    <Card style={{ gap: sp[4] }}>
      <Field label={tr("Catalogue name")}>
        <Input accessibilityLabel={tr("Catalogue name")} value={name} onChangeText={setName} maxLength={100} placeholder={tr("For example, Shop stock")} editable={!busy} testID="new-catalogue-name" />
      </Field>
      <Field label={tr("Columns")} help={!unique ? tr("Give each column a different name.") : tr("You can add more columns later.")}>
        <View style={{ gap: sp[2] }}>
          {columns.map((column, i) => (
            <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: sp[2] }}>
              <View style={{ flex: 1 }}>
                <Input accessibilityLabel={tr("Column {n}", { n: i + 1 })} value={column} onChangeText={v => setColumn(i, v)} maxLength={100} editable={!busy} invalid={!column.trim()} />
              </View>
              {i < 2 ? (
                <View style={{ width: 84, flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Ionicons name={i === 0 ? "pricetag-outline" : "barcode-outline"} size={16} color={t.brandStrong} />
                  <Text style={{ color: t.muted, fontSize: 12, flexShrink: 1 }}>{i === 0 ? tr("Item name") : tr("Barcode")}</Text>
                </View>
              ) : (
                <Pressable onPress={() => { tick(); setColumns(old => old.filter((_, j) => j !== i)); }} accessibilityRole="button"
                  accessibilityLabel={tr("Remove {name}", { name: column || tr("column") })} hitSlop={8} style={{ width: 84, alignItems: "center" }}>
                  <Ionicons name="remove-circle-outline" size={22} color={t.danger} />
                </Pressable>
              )}
            </View>
          ))}
          {columns.length < 50 ? <Button title="Add column" icon="add" kind="plain" size="sm" disabled={busy} onPress={() => { tick(); setColumns(old => [...old, ""]); }} /> : null}
        </View>
      </Field>
      <View>
        <Switch value={stock} onChange={setStock} label={tr("Count stock")} disabled={busy} />
        <Text style={{ color: t.muted, fontSize: 13, lineHeight: 18 }}>{tr("Keep a count of each item. Scanning can add one in or take one out.")}</Text>
      </View>
      {error ? <Text accessibilityRole="alert" style={{ color: t.danger }}>{error}</Text> : null}
      <Button title="Create catalogue" onPress={save} busy={busy} disabled={!ready || busy} testID="new-catalogue-save" />
    </Card>
  </Page></Screen>;
}
