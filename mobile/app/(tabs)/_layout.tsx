import React, { useEffect } from "react";
import { Platform } from "react-native";
import { NativeTabs } from "expo-router/native-tabs";

import { useChatUnread, useUnread } from "@/api";
import { setBadge } from "@/push/register";
import { useTheme } from "@/ui/theme";
import { useT } from "@/i18n";

const TABS = [
  { name: "(home)", title: "Home", sf: { default: "house", selected: "house.fill" }, md: "home" },
  { name: "plu", title: "Items", sf: { default: "magnifyingglass", selected: "magnifyingglass" }, md: "search" },
  { name: "work", title: "Work", sf: { default: "briefcase", selected: "briefcase.fill" }, md: "work" },
  // Notifications moved to the bell at the top right of the main screens (ui/AppBar).
  { name: "chats", title: "Chats", sf: { default: "bubble.left.and.bubble.right", selected: "bubble.left.and.bubble.right.fill" }, md: "chat" },
  { name: "account", title: "Profile", sf: { default: "person.crop.circle", selected: "person.crop.circle.fill" }, md: "account_circle" },
] as const;

export default function TabsLayout() {
  const t = useTheme(), tr = useT();
  // The number on the app's icon follows the inbox wherever you are.
  const unread = useUnread().data?.unread ?? 0;
  useEffect(() => { setBadge(unread); }, [unread]);
  // The Chats tab shows unread messages, direct and group.
  const chatUnread = useChatUnread().data?.unread ?? 0;
  const chatBadge = chatUnread > 99 ? "99+" : String(chatUnread);

  return (
    <NativeTabs
      tintColor={t.brand}
      badgeBackgroundColor={t.danger}
      badgeTextColor={t.dangerInk}
      minimizeBehavior="onScrollDown"
      labelStyle={{ fontWeight: "600" }}
      iconColor={{ default: t.muted, selected: t.brand }}
      backgroundColor={Platform.OS === "android" ? t.surface : undefined}
      indicatorColor={t.brandSoft}
      rippleColor={t.brandSoft}
    >
      {TABS.map((tab) => (
        <NativeTabs.Trigger key={tab.name} name={tab.name}>
          <NativeTabs.Trigger.Label>{tr(tab.title)}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf={tab.sf} md={tab.md} />
          {tab.name === "chats" && chatUnread > 0 ? <NativeTabs.Trigger.Badge>{chatBadge}</NativeTabs.Trigger.Badge> : null}
        </NativeTabs.Trigger>
      ))}
    </NativeTabs>
  );
}
