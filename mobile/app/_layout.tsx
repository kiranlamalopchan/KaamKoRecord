/**
 * The root: the query cache, who is signed in, and the rule that a signed-out
 * phone sees only the sign-in screens. A tapped notification is followed to
 * the screen its path means.
 */
import "react-native-gesture-handler";
import React, { useEffect, useMemo, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Appearance, AppState } from "react-native";
import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider as NavigationTheme, useRootNavigationState } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { SessionProvider, useSession } from "@/auth/session";
import { OnboardingProvider, useOnboarding } from "@/onboarding/seen";
import { Crashed } from "@/ui/Crashed";
import { OfflineSync } from "@/offline/shifts";
import { Splash } from "@/ui/Splash";
import { UpdateRequired } from "@/ui/UpdateRequired";
import { useRequiredUpdate } from "@/update/required";
import { useRatingPrompt } from "@/review/rating";
import { useSiriVoiceSearch } from "@/ui/siri";
import { useAskInvitedBy } from "@/nav/askInvitedBy";
import { useNotificationNavigation } from "@/push/useNotificationNavigation";
import { nativeOrNull } from "@/ui/native";
import { notifications, whileOpen } from "@/push/register";
import { loadLang, useT } from "@/i18n";
import { registerClockActions } from "@/roster/reminders";
import { RosterAlarms } from "@/roster/RosterAlarms";
import { ChatRealtime } from "@/chat/realtime";
import { loadThemeMode, saveThemeMode, ThemeContext, type ThemeMode, useTheme } from "@/ui/theme";
import { pushOptions, riseOptions } from "@/ui/transitions";

/** What shows if a screen throws: the error in words and a way back, never a blank page. */
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  return <Crashed error={error} retry={retry} />;
}

const client = new QueryClient({ defaultOptions: { queries: {
  retry: (failures, error) => failures < 2 && [0, 502, 503, 504].includes((error as { status?: number }).status ?? -1),
  retryDelay: (attempt) => attempt === 0 ? 400 : 1200,
  refetchOnWindowFocus: true,
} } });

// TanStack's "window focus" is a browser idea; on a phone it is the app
// coming back to the front, which is when the board and the inbox should
// be asked again.
focusManager.setEventListener((setFocused) => {
  const sub = AppState.addEventListener("change", (state) => setFocused(state === "active"));
  return () => sub.remove();
});

// The still stays up until ui/Splash has painted over it; a build without the
// module simply never had one to hold.
nativeOrNull(() => require("expo-splash-screen"))?.preventAutoHideAsync?.()?.catch?.(() => {});

// Where the phone can be buzzed at all (not Expo Go on Android).
notifications()?.setNotificationHandler({
  handleNotification: async (notification) => whileOpen(notification.request.content.data),
});

function Guard() {
  const { ready, me } = useSession();
  const { checked, seen } = useOnboarding();
  const t = useTheme();
  const navigation = useRootNavigationState();
  useNotificationNavigation(ready && checked && !!navigation?.key, me?.username);

  // Nothing until the keychain has been asked: the splash stays up that long.
  if (!ready || !checked) return null;

  // Somebody already signed in has been here before, whatever the flag says —
  // an update should not hand a regular a tour of their own app.
  const tour = !seen && !me;

  // The way in first if it is owed, then the sign-in screens while signed
  // out, then everything else. Every screen draws its own app bar
  // (ui/AppBar), so the stack draws none.
  // The navigator's own colours too. Its container sits behind every screen
  // and showed its default near-white round the edges while a page was
  // swiped back, whatever colour the app was in.
  const base = t.dark ? DarkTheme : DefaultTheme;
  const navTheme = { ...base, colors: { ...base.colors, background: t.bg, card: t.bg, text: t.text, border: t.line, primary: t.brand } };
  return (
    <NavigationTheme value={navTheme}>
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg }, ...pushOptions }}>
      <Stack.Protected guard={tour}>
        {/* Faded, not pushed: the splash is dissolving into this. */}
        <Stack.Screen name="(onboarding)" options={{ animation: "fade" }} />
      </Stack.Protected>
      <Stack.Protected guard={!tour && !me}>
        <Stack.Screen name="(auth)" options={{ animation: "fade" }} />
      </Stack.Protected>
      <Stack.Protected guard={!tour && !!me}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="board" />
        <Stack.Screen name="notifications" />
        <Stack.Screen name="notices/compose" options={riseOptions} />
        <Stack.Screen name="notices/[id]/index" />
        <Stack.Screen name="notices/[id]/reactions" options={riseOptions} />
        <Stack.Screen name="people/[username]" />
        <Stack.Screen name="stories/[username]" options={{ presentation: "fullScreenModal", animation: "fade" }} />
        <Stack.Screen name="stories/compose" options={riseOptions} />
        <Stack.Screen name="profile/index" />
        <Stack.Screen name="profile/offline" />
        <Stack.Screen name="profile/report" />
        <Stack.Screen name="profile/edit" />
        <Stack.Screen name="profile/settings" />
        <Stack.Screen name="profile/appearance" />
        <Stack.Screen name="profile/notifications" />
        <Stack.Screen name="profile/privacy" />
        <Stack.Screen name="profile/help" />
        <Stack.Screen name="profile/friends" />
        <Stack.Screen name="profile/invite" />
        <Stack.Screen name="invited-by" options={riseOptions} />
        <Stack.Screen name="profile/statement" />
        <Stack.Screen name="profile/activity" />
        <Stack.Screen name="profile/festival" />
        <Stack.Screen name="profile/delete" />
        <Stack.Screen name="profile/blocked" />
        <Stack.Screen name="plu/[plu_no]" />
        <Stack.Screen name="holidays" />
        <Stack.Screen name="shifts/new" />
        <Stack.Screen name="shifts/[id]/index" />
        <Stack.Screen name="shifts/[id]/edit" />
        <Stack.Screen name="workplaces/index" />
        <Stack.Screen name="workplaces/new" />
        <Stack.Screen name="workplaces/[id]/edit" />
        <Stack.Screen name="workplaces/[id]/remove" />
        <Stack.Screen name="pay" options={{ animation: "none" }} />
        <Stack.Screen name="clock" options={{ animation: "none" }} />
        <Stack.Screen name="timesheet" options={{ animation: "none" }} />
        <Stack.Screen name="more" options={{ animation: "none" }} />
        <Stack.Screen name="items/import" />
        <Stack.Screen name="items/scanner" options={riseOptions} />
        <Stack.Screen name="roster/index" />
        <Stack.Screen name="roster/new" />
        <Stack.Screen name="roster/[id]" />
        <Stack.Screen name="payslip-check" />
        <Stack.Screen name="messages/index" />
        <Stack.Screen name="messages/new" />
        <Stack.Screen name="messages/[username]" />
        <Stack.Screen name="messages/c/[id]" />
        <Stack.Screen name="messages/info/[id]" />
      </Stack.Protected>
      <Stack.Screen name="auth-complete" options={{ animation: "none" }} />
    </Stack>
    </NavigationTheme>
  );
}

/** The day/night choice, kept between runs the way the site keeps its cookie. */
function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("system");
  useEffect(() => { loadThemeMode().then(setModeState); }, []);
  // Tell iOS and Android which one the app chose, not only our own screens.
  // Left to the phone, a dark app on a light phone kept the native layers
  // under the screens (the tab container, the window) white, and that white
  // showed round the edges while a screen slid back.
  useEffect(() => { Appearance.setColorScheme(mode === "system" ? "auto" : mode); }, [mode]);
  const value = useMemo(() => ({
    mode,
    setMode: (next: ThemeMode) => { setModeState(next); saveThemeMode(next).catch(() => {}); },
  }), [mode]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

type SystemUI = typeof import("expo-system-ui");
const systemUI = nativeOrNull<SystemUI>(() => require("expo-system-ui"));

function openAskInvitedBy() {
  router.push("/invited-by" as never);
}

function openVoiceSearch() {
  router.navigate("/plu?listen=1");
}

function Shell() {
  const t = useTheme();
  // The window behind every screen wears the page colour. Left at the default white, it
  // showed as a thin white line at the edge while one page slid away and the next came in.
  useEffect(() => { void systemUI?.setBackgroundColorAsync(t.bg).catch(() => {}); }, [t.bg]);
  const { ready, me } = useSession();
  const { checked } = useOnboarding();
  const [wayIn, setWayIn] = useState(true);
  // A version the server has retired sees only the way to the store.
  const update = useRequiredUpdate();
  // Now and then, the store's own "rate this app" popup (review/rating).
  useRatingPrompt(!wayIn && !!me && !update.required);
  // "Hey Siri, voice search in KaamKoRecord": Items, listening (ui/siri.ts).
  useSiriVoiceSearch(!wayIn && !!me && !update.required, openVoiceSearch);
  // A new Google/Apple account: "Did someone invite you?", once (nav/askInvitedBy).
  useAskInvitedBy(!wayIn && !!me && !update.required, openAskInvitedBy);
  // Drawn again when the language changes, so every screen under here is too.
  useT();
  // The saved language, then the buttons a clock notification wears — in
  // that order, because the buttons are worded in it.
  useEffect(() => { loadLang().finally(() => { void registerClockActions(); }); }, []);
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: t.bg }}>
      {/* The splash is navy whichever way the phone is set. */}
      <StatusBar style={wayIn || t.dark ? "light" : "dark"} />
      <OfflineSync />
      <RosterAlarms />
      <ChatRealtime />
      <Guard />
      {update.required ? <UpdateRequired current={update.current} latest={update.latest} /> : null}
      {wayIn ? <Splash ready={ready && checked} onDone={() => setWayIn(false)} /> : null}
    </GestureHandlerRootView>
  );
}

export default function Root() {
  // A development build's tooling (expo's withDevTools) holds the screen
  // awake, so the phone never dims or locks while the app is open — which
  // is not how the app behaves once built for real. Let the phone have its
  // way, once the tooling has taken hold. A release build has none of this.
  useEffect(() => {
    if (!__DEV__) return;
    const id = setTimeout(() => {
      const KeepAwake = nativeOrNull(() => require("expo-keep-awake") as typeof import("expo-keep-awake"));
      KeepAwake?.deactivateKeepAwake(KeepAwake.ExpoKeepAwakeTag).catch(() => {});
    }, 1000);
    return () => clearTimeout(id);
  }, []);
  return (
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <SessionProvider>
          <OnboardingProvider>
            <Shell />
          </OnboardingProvider>
        </SessionProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
