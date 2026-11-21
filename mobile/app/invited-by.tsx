/**
 * "Did someone invite you?" — once, right after a brand-new account is made
 * with Google or Apple (nav/askInvitedBy). Their invite code gives the person
 * who invited you credit towards the Champion badge. Skip is always there,
 * and the same box stays on Profile → Invite friends for the first 14 days.
 */
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { MaterialIcons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";

import { me as meApi } from "@/api";
import { fieldErrors } from "@/api/client";
import { useSession } from "@/auth/session";
import { useT } from "@/i18n";
import { Button, Field, Input, Page, PageTitle, Screen } from "@/ui";
import { success } from "@/ui/haptics";
import { alpha, sp, useTheme } from "@/ui/theme";

export default function InvitedByScreen() {
  const t = useTheme(), tr = useT();
  const router = useRouter();
  const { me } = useSession();
  const client = useQueryClient();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const done = () => { if (router.canGoBack()) router.back(); else router.replace("/"); };

  const save = async () => {
    setError(undefined);
    setBusy(true);
    try {
      const next = await meApi.setInvitedBy(code.trim());
      client.setQueryData(["invites", me?.username], next);
      success();
      done();
    } catch (e) {
      setError(fieldErrors(e, { invited_by: "code" }, "code").code);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen back backLabel="Skip">
      <Page>
        <View style={[styles.icon, { backgroundColor: alpha(t.brand, 0.12) }]}>
          <MaterialIcons name="military-tech" size={40} color={t.brand} />
        </View>
        <PageTitle sub="Type their invite code so they get credit towards their Champion badge.">Did someone invite you?</PageTitle>
        <Field label={tr("Invite code")} help={tr("The 6-character code in their invite — it counts towards their Champion badge.")} error={error}>
          <Input value={code} onChangeText={(typed) => setCode(typed.toUpperCase())} autoCapitalize="characters" autoCorrect={false}
            autoFocus maxLength={12} onSubmitEditing={() => { if (code.trim()) void save(); }} returnKeyType="done" testID="ask-invited-by-input" />
        </Field>
        <Button title={tr("Save")} onPress={save} busy={busy} disabled={!code.trim()} testID="ask-invited-by-save" />
        <Button title={tr("Skip")} kind="plain" onPress={done} testID="ask-invited-by-skip" />
        <Text style={{ color: t.muted, fontSize: 13, textAlign: "center", lineHeight: 19 }}>
          {tr("You can add it later in Profile → Invite friends, within your first 14 days.")}
        </Text>
      </Page>
    </Screen>
  );
}

const styles = StyleSheet.create({
  icon: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", alignSelf: "center", marginTop: sp[4] },
});
