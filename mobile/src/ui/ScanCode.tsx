/**
 * Read one barcode with the camera and hand it back: the barcode box on the
 * item form opens this rather than leaving the half-filled form.
 */
import React, { useRef } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions, type BarcodeType } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useT } from "@/i18n";
import { Button } from "@/ui";
import { success, tick } from "@/ui/haptics";
import { radius, sp, useTheme } from "@/ui/theme";

export const BARCODE_TYPES: BarcodeType[] = ["ean13", "ean8", "upc_a", "upc_e", "code128", "code39", "code93", "codabar", "itf14", "qr", "datamatrix"];

export function ScanCode({ visible, onClose, onCode }: { visible: boolean; onClose: () => void; onCode: (code: string) => void }) {
  const t = useTheme(), tr = useT();
  const insets = useSafeAreaInsets();
  const [permission, ask] = useCameraPermissions();
  const done = useRef(false);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose} onShow={() => { done.current = false; }}>
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        {permission?.granted ? (
          <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: BARCODE_TYPES }}
            onBarcodeScanned={({ data }) => {
              const value = String(data || "").trim();
              if (!value || done.current) return;
              done.current = true;
              success();
              onCode(value);
            }} />
        ) : null}
        <View style={styles.middle} pointerEvents="box-none">
          {permission && !permission.granted ? (
            <View style={[styles.ask, { backgroundColor: t.surface }]}>
              <Ionicons name="camera-outline" size={30} color={t.brand} />
              <Text style={{ color: t.text, fontSize: 16, textAlign: "center", lineHeight: 22 }}>{tr("Allow camera access to scan a barcode. You can still type a code instead.")}</Text>
              <Button title="Allow camera" icon="camera-outline" onPress={() => { tick(); void ask(); }} />
            </View>
          ) : <>
            <View style={[styles.guide, { borderColor: t.brand }]} />
            <Text style={styles.hint}>{tr("Place the barcode inside the frame")}</Text>
          </>}
        </View>
        <Pressable onPress={() => { tick(); onClose(); }} accessibilityRole="button" accessibilityLabel={tr("Close")} hitSlop={8}
          style={[styles.close, { top: insets.top + sp[3] }]}>
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  middle: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", paddingHorizontal: sp[6] },
  guide: { width: "100%", maxWidth: 340, aspectRatio: 1.65, borderWidth: 3, borderRadius: radius.lg },
  hint: { color: "#fff", fontSize: 16, fontWeight: "700", textAlign: "center", marginTop: sp[4], textShadowColor: "#000", textShadowRadius: 6 },
  ask: { alignItems: "center", gap: sp[3], padding: sp[5], borderRadius: radius.lg, width: "100%", maxWidth: 360 },
  close: { position: "absolute", left: sp[4], width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.6)" },
});
