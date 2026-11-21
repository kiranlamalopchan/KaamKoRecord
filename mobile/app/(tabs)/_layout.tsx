/**
 * The five tabs: Home · Items · Work · Chats · Profile.
 *
 * iPhone keeps Apple's own tab bar (NativeTabs): its glass, its feel. When a
 * page is scrolled down it slides away and comes back on the way up, with the
 * top bar's spring (patches/react-native-screens — the bar moves, the page
 * never resizes). Expo Go hasn't that patch, and UIKit's stock hide there
 * resizes the page as it animates, which shook it: in Expo Go the iPhone bar
 * stays put.
 *
 * Android draws the app's own floating bar (ui/TabBar), because the system
 * bar there can only snap in and out: this one slides and fades with the
 * same spring as the top bar.
 *
 * Both follow ui/chrome.ts, and both are back whenever the page changes.
 */
import React, { useEffect, useMemo } from "react";
import { Platform } from "react-native";
import { usePathname } from "expo-router";
import { Tabs } from "expo-router/js-tabs";
import { NativeTabs } from "expo-router/native-tabs";
import { Ionicons } from "@expo/vector-icons";

import { useChatUnread, useUnread } from "@/api";
import { setBadge } from "@/push/register";
import { setTabBarHidden, useTabBarHidden } from "@/ui/chrome";
import { inExpoGo } from "@/ui/native";
import { TabBar, type TabIcon } from "@/ui/TabBar";
import { useTheme } from "@/ui/theme";
import { useT } from "@/i18n";

type SF = Extract<React.ComponentProps<typeof NativeTabs.Trigger.Icon>, { sf?: unknown }>["sf"];
type Tab = {
  name: string; title: string;
  /** Apple's symbols, for the iPhone bar; null where Ionicons draws it (the plain Chats bubble). */
  sf: SF | null;
  /** Ionicons, for the Android bar (and the Chats bubble on iPhone). */
  icon: TabIcon;
};

const TABS: Tab[] = [
  { name: "(home)", title: "Home", sf: { default: "house", selected: "house.fill" }, icon: { icon: "home-outline", selected: "home" } },
  { name: "plu", title: "Items", sf: { default: "magnifyingglass", selected: "magnifyingglass" }, icon: { icon: "search-outline", selected: "search" } },
  { name: "work", title: "Work", sf: { default: "briefcase", selected: "briefcase.fill" }, icon: { icon: "briefcase-outline", selected: "briefcase" } },
  // Notifications moved to the bell at the top right of the main screens (ui/AppBar).
  { name: "chats", title: "Chats", sf: null, icon: { icon: "chatbubble-outline", selected: "chatbubble" } },
  { name: "account", title: "Profile", sf: { default: "person.crop.circle", selected: "person.crop.circle.fill" }, icon: { icon: "person-circle-outline", selected: "person-circle" } },
];
/** Expo Go on iPhone: only UIKit's stock hide, which shakes the page (see above). */
const IOS_STOCK_HIDE = inExpoGo();
const ICONS = Object.fromEntries(TABS.map((tab) => [tab.name, tab.icon]));

export default function TabsLayout() {
  const t = useTheme(), tr = useT();
  // The number on the app's icon follows the inbox wherever you are.
  const unread = useUnread().data?.unread ?? 0;
  useEffect(() => { setBadge(unread); }, [unread]);
  // The Chats tab shows unread messages, direct and group.
  const chatUnread = useChatUnread().data?.unread ?? 0;
  const chatBadge = chatUnread > 0 ? (chatUnread > 99 ? "99+" : String(chatUnread)) : undefined;
  const badges = useMemo(() => ({ chats: chatBadge }), [chatBadge]);
  // Away while a page is scrolled down, back on the way up (ui/chrome.ts) —
  // and always back on a new page, so no tab opens without it.
  const hidden = useTabBarHidden();
  const path = usePathname();
  useEffect(() => { setTabBarHidden(false); }, [path]);

  if (Platform.OS !== "ios") {
    return (
      <Tabs
        tabBar={(props) => <TabBar {...props} icons={ICONS} badges={badges} />}
        screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: t.bg } }}
      >
        {TABS.map((tab) => <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.title }} />)}
      </Tabs>
    );
  }

  return (
    <NativeTabs
      tintColor={t.brand}
      badgeBackgroundColor={t.danger}
      badgeTextColor={t.dangerInk}
      minimizeBehavior="never"
      hidden={hidden && !IOS_STOCK_HIDE}
      labelStyle={{ fontWeight: "600" }}
      iconColor={{ default: t.muted, selected: t.brand }}
    >
      {TABS.map((tab) => (
        <NativeTabs.Trigger key={tab.name} name={tab.name}>
          <NativeTabs.Trigger.Label>{tr(tab.title)}</NativeTabs.Trigger.Label>
          {tab.sf ? <NativeTabs.Trigger.Icon sf={tab.sf} /> : (
            <NativeTabs.Trigger.Icon src={{
              default: <NativeTabs.Trigger.VectorIcon family={Ionicons} name={tab.icon.icon} />,
              selected: <NativeTabs.Trigger.VectorIcon family={Ionicons} name={tab.icon.selected} />,
            }} />
          )}
          {tab.name === "chats" && chatBadge ? <NativeTabs.Trigger.Badge>{chatBadge}</NativeTabs.Trigger.Badge> : null}
        </NativeTabs.Trigger>
      ))}
    </NativeTabs>
  );
}
