/**
 * The tick badge of somebody who runs the board: a seal with a tick, gold
 * for an admin and blue for a moderator. Beside a name (a notice, a comment,
 * a story, a friend row) it is just the badge, the word read out by a screen
 * reader; on their profile (`full`) the word "Admin" or "Moderator" is shown.
 * Nothing for everybody else. Matches templates/accounts/_admin_badge.html.
 * `light` is for the story viewer, where the name sits in white on the picture.
 */
import React from "react";
import { Text, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";

import type { Person } from "@/api/types";

import { useT } from "@/i18n";

export function AdminBadge({ person, size = 11, light = false, full = false }: { person: Pick<Person, "is_admin" | "is_moderator">; size?: number; light?: boolean; full?: boolean }) {
  const tr = useT();
  const admin = person.is_admin;
  if (!admin && !person.is_moderator) return null;
  const ink = light ? "#fff" : admin ? ADMIN_GOLD : MODERATOR_BLUE;
  const word = admin ? "Admin" : tr("Moderator");
  return (
    <View
      accessibilityLabel={word}
      testID={admin ? "admin-badge" : "moderator-badge"}
      accessibilityRole={full ? undefined : "image"}
      style={{
        flexDirection: "row", alignItems: "center", gap: 3, borderRadius: 999,
        // Beside a name only the badge; on their profile (`full`) a pill with the word.
        ...(full ? {
          paddingLeft: 4, paddingRight: 8, paddingVertical: 1.5,
          backgroundColor: light ? "rgba(255,255,255,0.22)" : admin ? "rgba(234,179,8,0.16)" : "rgba(59,130,246,0.14)",
        } : {}),
      }}
    >
      <MaterialIcons name="verified" size={full ? size + 3 : size + 4} color={ink} />
      {full ? <Text style={{ color: ink, fontSize: size, fontWeight: "700", letterSpacing: 0.2 }}>{word}</Text> : null}
    </View>
  );
}

/** An admin's badge is gold, a moderator's blue (as on the site). */
const ADMIN_GOLD = "#e0a800";
const MODERATOR_BLUE = "#3b82f6";
