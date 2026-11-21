/**
 * Invite friends: your invite link and code, how many people you've brought
 * into the app, and the Champion badge it earns — Bronze at 10, Silver at 25,
 * Gold at 50 (apps/invites). Somebody counts once they sign up with your link
 * or code and start using the app (a workplace or a shift).
 *
 * In your first fortnight, and once, you can also say who invited you.
 */
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { me as meApi, type ChampionLevel, type Invites } from "@/api";
import { fieldErrors } from "@/api/client";
import { useSession } from "@/auth/session";
import { useT } from "@/i18n";
import { inviteFriends } from "@/nav/invite";
import { Button, Card, ErrorBanner, Field, Input, Page, PageTitle, Screen } from "@/ui";
import { success } from "@/ui/haptics";
import { SkeletonRows } from "@/ui/Skeleton";
import { useCopyCode } from "@/ui/useCopyCode";
import { alpha, sp, useTheme } from "@/ui/theme";

const LEVEL_WORDS: Record<ChampionLevel, string> = { bronze: "Bronze Champion", silver: "Silver Champion", gold: "Gold Champion" };
const LEVEL_INK: Record<ChampionLevel, string> = { bronze: "#b86b2e", silver: "#8a94a3", gold: "#e0a800" };

export default function InviteScreen() {
  const t = useTheme(), tr = useT();
  const { me } = useSession();
  const client = useQueryClient();
  const key = ["invites", me?.username];
  const q = useQuery({ queryKey: key, queryFn: meApi.invites });
  const { copy, copied } = useCopyCode();
  const [who, setWho] = useState("");
  const [whoError, setWhoError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  const saveWho = async () => {
    setWhoError(undefined);
    setSaving(true);
    try {
      const next = await meApi.setInvitedBy(who.trim());
      client.setQueryData(key, next);
      success();
    } catch (e) {
      setWhoError(fieldErrors(e, { invited_by: "who" }, "who").who);
    } finally {
      setSaving(false);
    }
  };

  const data = q.data;
  return (
    <Screen back backLabel="Profile">
      <Page>
        <PageTitle sub="Bring your coworkers into KaamKoRecord and earn the Champion badge.">Invite friends</PageTitle>
        {q.error ? <ErrorBanner error={q.error} onRetry={q.refetch} /> : null}
        {q.isLoading ? <SkeletonRows count={3} badge={false} /> : null}
        {data ? (
          <>
            <Progress data={data} />
            <Card style={{ gap: sp[3] }} testID="invite-code-card">
              <Text style={[styles.label, { color: t.muted }]}>{tr("Your invite code")}</Text>
              <Text selectable style={[styles.code, { color: t.text }]} testID="invite-code">{data.code}</Text>
              <Button title={tr("Invite friends")} icon="share-social-outline" onPress={() => { void inviteFriends(data.link, data.code); }} testID="invite-share" />
              <Button title={copied ? tr("Copied") : tr("Copy code")} icon={copied ? "checkmark" : "copy-outline"} kind="plain" onPress={() => void copy(data.code)} testID="invite-copy" />
              <Text style={{ color: t.muted, fontSize: 13, lineHeight: 19 }}>
                {tr("A friend counts once they sign up with your link or code and start using the app — adding a workplace or recording a shift.")}
              </Text>
            </Card>
            {data.invited_by ? (
              <Text style={{ color: t.muted, fontSize: 14, textAlign: "center" }} testID="invited-by">{tr("You were invited by {name}.", { name: data.invited_by })}</Text>
            ) : data.can_say_invited_by ? (
              <Card style={{ gap: sp[3] }}>
                <Field label={tr("Who invited you?")} help={tr("The 6-character code in their invite — it counts towards their Champion badge.")} error={whoError}>
                  <Input value={who} onChangeText={(typed) => setWho(typed.toUpperCase())} autoCapitalize="characters" autoCorrect={false} maxLength={150} testID="invited-by-input" />
                </Field>
                <Button title={tr("Save")} kind="plain" onPress={saveWho} busy={saving} disabled={!who.trim()} testID="invited-by-save" />
              </Card>
            ) : null}
          </>
        ) : null}
      </Page>
    </Screen>
  );
}

/** The level you're at, the medals along the way, and how far to the next. */
function Progress({ data }: { data: Invites }) {
  const t = useTheme(), tr = useT();
  const top = data.levels[data.levels.length - 1]?.at || 50;
  const target = data.next_at ?? top;
  const share = Math.min(1, data.joined / target);
  return (
    <Card style={{ gap: sp[4], alignItems: "center" }} testID="invite-progress">
      <View style={[styles.medal, { backgroundColor: data.level ? alpha(LEVEL_INK[data.level], 0.14) : t.surface2 }]}>
        <MaterialIcons name="military-tech" size={44} color={data.level ? LEVEL_INK[data.level] : t.muted} />
      </View>
      <View style={{ alignItems: "center", gap: 2 }}>
        <Text style={[styles.title, { color: t.text }]} testID="invite-level">{data.level ? tr(LEVEL_WORDS[data.level]) : tr("No badge yet")}</Text>
        <Text style={{ color: t.muted, fontSize: 14 }}>
          {tr("{n} friends using the app", { n: data.joined })}{data.waiting ? ` · ${tr("{n} still to start", { n: data.waiting })}` : ""}
        </Text>
      </View>
      {data.next_level ? (
        <View style={{ alignSelf: "stretch", gap: sp[2] }}>
          <View style={[styles.track, { backgroundColor: t.surface2 }]} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: target, now: data.joined }}>
            <View style={[styles.fill, { width: `${Math.max(share * 100, data.joined ? 4 : 0)}%`, backgroundColor: LEVEL_INK[data.next_level] }]} />
          </View>
          <Text style={{ color: t.text2, fontSize: 14, textAlign: "center" }} testID="invite-next">
            {tr("{left} more for {level}", { left: target - data.joined, level: tr(LEVEL_WORDS[data.next_level]) })}
          </Text>
        </View>
      ) : (
        <Text style={{ color: t.text2, fontSize: 14 }}>{tr("You've reached the top level. Thank you!")}</Text>
      )}
      <View style={styles.steps}>
        {data.levels.map((step) => {
          const reached = data.joined >= step.at;
          return (
            <View key={step.level} style={styles.step} testID={`invite-step-${step.level}`}>
              <MaterialIcons name="military-tech" size={26} color={reached ? LEVEL_INK[step.level] : alpha(t.muted, 0.5)} />
              <Text style={{ color: reached ? t.text : t.muted, fontSize: 12, fontWeight: "700" }}>{step.at}</Text>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  code: { fontSize: 34, fontWeight: "800", letterSpacing: 4, fontVariant: ["tabular-nums"] },
  medal: { width: 76, height: 76, borderRadius: 38, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 20, fontWeight: "800" },
  track: { height: 10, borderRadius: 5, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 5 },
  steps: { flexDirection: "row", gap: sp[6] },
  step: { alignItems: "center", gap: 2 },
});
