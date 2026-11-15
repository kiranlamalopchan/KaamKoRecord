/**
 * The page a phone on a retired version sees instead of the app: what is
 * new, and one button to the store. It covers everything, the Android back
 * button included, until the update is installed.
 */
import React, { useEffect, useRef, useState } from "react";
import { BackHandler, Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { openAppStore } from "@/nav/stores";
import { useT } from "@/i18n";
import { BrandMark } from "./AppBar";
import { Button } from "./index";
import { sp, useTheme } from "./theme";

export function UpdateRequired({ current, latest }: { current: string; latest: string }) {
  const t = useTheme();
  const tr = useT();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => { mounted.current = false; sub.remove(); };
  }, []);

  const update = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await openAppStore(() => mounted.current);
    } catch {
      if (mounted.current) setFailed(true);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const store = Platform.OS === "android" ? "Google Play" : "the App Store";
  return (
    <View
      style={[StyleSheet.absoluteFill, styles.page, { backgroundColor: t.bg, paddingTop: insets.top, paddingBottom: insets.bottom + sp[4] }]}
      accessibilityViewIsModal
      testID="update-required"
    >
      <View style={styles.middle}>
        <View style={styles.mark}>
          <BrandMark size={88} />
        </View>
        <Text style={[styles.eyebrow, { color: t.muted }]}>{tr("New update available").toUpperCase()}</Text>
        <Text accessibilityRole="header" style={[styles.title, { color: t.text }]}>{tr("Update your app to the latest version")}</Text>
        <Text style={[styles.body, { color: t.muted }]}>
          {tr("A new version of KaamKoRecord is ready in {store}. Update it to keep recording your shifts.", { store: tr(store) })}
        </Text>
        {current && latest ? (
          <Text style={[styles.versions, { color: t.muted }]}>{tr("You have {current} · Latest {latest}", { current, latest })}</Text>
        ) : null}
      </View>
      {failed ? (
        <Text accessibilityRole="alert" style={[styles.failed, { color: t.danger }]}>{tr("We couldn't open the store. Please try again.")}</Text>
      ) : null}
      <Button title={tr("Update now")} icon="arrow-down-circle-outline" busy={busy} onPress={() => { void update(); }} testID="update-now" />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { zIndex: 1000, elevation: 1000, paddingHorizontal: sp[6] },
  middle: { flex: 1, justifyContent: "center", alignItems: "center", gap: sp[3] },
  mark: { marginBottom: sp[2] },
  eyebrow: { fontSize: 12, fontWeight: "700", letterSpacing: 1.2 },
  title: { fontSize: 26, fontWeight: "800", letterSpacing: -0.5, textAlign: "center", lineHeight: 32 },
  body: { fontSize: 15, lineHeight: 22, textAlign: "center", maxWidth: 360 },
  versions: { fontSize: 13, marginTop: sp[1] },
  failed: { fontSize: 14, textAlign: "center", marginBottom: sp[3] },
});
