import React, { useState } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { catalogue, useCatalogueChanged, type CatalogueDetails } from "@/api/catalogue";
import { useSession } from "@/auth/session";
import { Button, Card, Chip, ErrorBanner, Field, Input, Page, PageTitle, Screen } from "@/ui";
import { SkeletonRows } from "@/ui/Skeleton";
import { Select } from "@/ui/Select";
import { Switch } from "@/ui/timesheet";
import { errorMessage } from "@/api/errors";
import { useDeleteCatalogue } from "@/ui/useDeleteCatalogue";
import { sp, useTheme } from "@/ui/theme";

export default function ManageCatalogue() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me } = useSession();
  const query = useQuery({ queryKey: ["catalogue", me?.username, "details", id], queryFn: () => catalogue.details(Number(id)), enabled: !!me });
  return <Screen back backLabel="Catalogues"><Page>
    <PageTitle sub="Change its name and the columns included in searches.">Edit catalogue</PageTitle>
    {query.isLoading ? <SkeletonRows count={3} /> : null}
    {query.error ? <ErrorBanner error={query.error} onRetry={query.refetch} /> : null}
    {query.data ? <Editor key={query.data.id} details={query.data} /> : null}
  </Page></Screen>;
}

function Editor({ details }: { details: CatalogueDetails }) {
  const t = useTheme(), router = useRouter(), changed = useCatalogueChanged();
  const deletion = useDeleteCatalogue();
  const [name, setName] = useState(details.name);
  const [columns, setColumns] = useState(details.search_columns);
  const [headers, setHeaders] = useState(details.headers);
  const [newColumn, setNewColumn] = useState("");
  const [code, setCode] = useState(details.code_column);
  const [stock, setStock] = useState(!!details.track_stock);
  const fresh = newColumn.trim();
  const canAdd = !!fresh && fresh.length <= 100 && headers.length < 50 && !headers.some(h => h.toLocaleLowerCase() === fresh.toLocaleLowerCase());
  const addColumn = () => {
    if (!canAdd) return;
    setHeaders(old => [...old, fresh]);
    setColumns(old => [...old, fresh]);
    setNewColumn("");
  };
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const disabled = busy || deletion.busyId !== null;
  const back = () => router.canGoBack() ? router.back() : router.replace({ pathname: "/plu", params: { view: "catalogues" } });
  const save = async () => {
    setBusy(true); setError("");
    try { await catalogue.update(details.id, { name, search_columns: columns, headers, code_column: code, track_stock: stock }); back(); changed(); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  return <>
    {error || deletion.error ? <Text accessibilityRole="alert" style={{ color: t.danger }}>{error || deletion.error}</Text> : null}
    <Card style={{ gap: sp[4] }}>
      <Field label="Catalogue name"><Input accessibilityLabel="Catalogue name" value={name} onChangeText={setName} maxLength={100} editable={!disabled} /></Field>
      <Field label="Columns to search" help="Choose at least one column. All existing item details are kept.">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: sp[2] }}>{headers.map(header => <Chip key={header} on={columns.includes(header)} onPress={() => { if (!disabled) setColumns(old => old.includes(header) ? old.filter(c => c !== header) : [...old, header]); }}>{header}</Chip>)}</View>
      </Field>
      <Field label="Add a column" help="New columns start empty. Fill them in on each item.">
        <View style={{ flexDirection: "row", gap: sp[2], alignItems: "center" }}>
          <View style={{ flex: 1 }}><Input accessibilityLabel="New column name" value={newColumn} onChangeText={setNewColumn} maxLength={100} editable={!disabled} placeholder="For example, Price" onSubmitEditing={addColumn} returnKeyType="done" /></View>
          <Button title="Add" icon="add" kind="plain" size="sm" disabled={disabled || !canAdd} onPress={addColumn} />
        </View>
      </Field>
      <Field label="Barcode column" help="Scanning a barcode finds the item with this code.">
        <Select value={code} label="Barcode column" testID="barcode-column" onChange={setCode}
          options={[{ value: "", label: "None" }, ...headers.filter(h => h !== details.title_column).map(h => ({ value: h, label: h }))]} />
      </Field>
      <Field help="Keep a count of each item. Scanning can add one in or take one out.">
        <Switch value={stock} onChange={setStock} label="Count stock" disabled={disabled} />
      </Field>
      <Button title="Save changes" onPress={save} busy={busy} disabled={disabled || !name.trim() || !columns.length} />
      <Button title="Open items" icon="list-outline" kind="plain" onPress={() => router.push(`/items/table/${details.id}` as never)} disabled={disabled} />
      <Button title="Cancel" kind="plain" onPress={back} disabled={disabled} />
    </Card>
    <Card style={{ gap: sp[3] }}>
      <Text style={{ color: t.text, fontSize: 18, fontWeight: "700" }}>Update catalogue data</Text>
      <Text style={{ color: t.muted }}>Upload a replacement CSV to update items or change their display columns.</Text>
      <Button title="Replace CSV" icon="cloud-upload-outline" kind="plain" disabled={disabled} onPress={() => router.push({ pathname: "/items/import", params: { catalogue: String(details.id) } })} />
      <Button title="Delete catalogue" icon="trash-outline" kind="danger" disabled={disabled} onPress={() => deletion.remove(details.id, details.name, details.count)} />
    </Card>
  </>;
}
