/**
 * "Message this person": from a profile, a notification for a direct message
 * (/profile/?chat=<username>), or an older link. Finds the one conversation
 * with them — making it the first time — and opens it by its id, so there is
 * never a second thread with the same friend.
 */
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { convo } from "@/api";
import { useT } from "@/i18n";
import { ErrorBanner, Page, Screen } from "@/ui";
import { sp, useTheme } from "@/ui/theme";

export default function MessagePerson() {
  const t = useTheme(), tr = useT();
  const router = useRouter();
  const { username } = useLocalSearchParams<{ username: string }>();
  const [error, setError] = useState<unknown>(null);

  const open = useCallback(async () => {
    setError(null);
    try {
      const found = await convo.openDirect(username);
      router.replace(`/messages/c/${found.id}` as never);
    } catch (e) { setError(e); }
  }, [username, router]);
  useEffect(() => { void open(); }, [open]);

  return (
    <Screen back backLabel={tr("Chats")}>
      <Page>
        {error ? <ErrorBanner error={error} onRetry={() => { void open(); }} /> : (
          <View style={{ paddingTop: sp[6] }}><ActivityIndicator color={t.brand} accessibilityLabel={tr("Opening conversation")} /></View>
        )}
      </Page>
    </Screen>
  );
}
