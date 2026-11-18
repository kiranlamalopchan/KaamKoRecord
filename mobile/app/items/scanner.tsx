import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { useT } from "@/i18n";
import { Button, Card, Page, PageTitle, Screen } from "@/ui";
import { success, tick } from "@/ui/haptics";
import { radius, sp, useTheme } from "@/ui/theme";

export default function BarcodeScanner() {
  const t = useTheme(), tr = useT();
  const router = useRouter();
  const [permission, ask] = useCameraPermissions();
  const [locked, setLocked] = useState(false);

  const found = ({ data }: BarcodeScanningResult) => {
    const value = String(data || "").trim();
    if (!value || locked) return;
    setLocked(true);
    success();
    router.replace({ pathname: "/(tabs)/plu", params: { scan: value, view: "search" } });
  };

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

  return (
    <Screen back backLabel={tr("Items")}>
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          onBarcodeScanned={locked ? undefined : found}
          barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e", "code128", "code39", "itf14", "qr"] }}
        />
        <View style={styles.overlay} pointerEvents="box-none">
          <View style={[styles.guide, { borderColor: t.brand }]} accessibilityLabel={tr("Place the barcode inside the frame")} />
          <Text style={styles.hint}>{tr("Place the barcode inside the frame")}</Text>
          {locked ? <Pressable accessibilityRole="button" accessibilityLabel={tr("Scan again")} onPress={() => setLocked(false)} style={styles.again}>
            <Ionicons name="refresh" size={20} color="#fff" />
            <Text style={styles.againText}>{tr("Scan again")}</Text>
          </Pressable> : null}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  permission: { alignItems: "center", gap: sp[3], paddingVertical: sp[4] },
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", paddingHorizontal: sp[6], backgroundColor: "rgba(0,0,0,0.22)" },
  guide: { width: "100%", maxWidth: 340, aspectRatio: 1.65, borderWidth: 3, borderRadius: radius.lg, backgroundColor: "transparent" },
  hint: { color: "#fff", fontSize: 16, fontWeight: "700", textAlign: "center", marginTop: sp[4], textShadowColor: "#000", textShadowRadius: 6 },
  again: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: sp[2], marginTop: sp[4], paddingHorizontal: sp[4], borderRadius: radius.pill, backgroundColor: "rgba(0,0,0,0.72)" },
  againText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
