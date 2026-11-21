/** Invite friends: your own link and code, progress to the Champion badge, and who invited you. */
import React from "react";
import { Share } from "react-native";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { setLang } from "@/i18n";
import { INVITE_URL, inviteFriends, inviteMessage } from "@/nav/invite";
import { inviteCodeFrom } from "@/nav/referrer";
import Profile from "@/screens/Profile";
import InviteScreen from "../../app/profile/invite";
import { AdminBadge } from "@/ui/AdminBadge";

const mockPush = jest.fn();
let mockInvites: any;
const mockSetInvitedBy = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null, MaterialIcons: () => null }));
jest.mock("@/auth/session", () => ({ useSession: () => ({ me: { username: "preview", name: "Preview", initial: "P", hue: 160, photo: null, is_live: false, is_me: true, is_admin: false, display_name: "Preview", since: "Oct 2026" }, setMe: jest.fn(), signOut: jest.fn() }) }));
jest.mock("@/api", () => ({
  me: { invites: jest.fn(async () => mockInvites), setInvitedBy: (code: string) => mockSetInvitedBy(code) },
  useActivity: () => ({ data: { notice_count: 0, friend_count: 0, shift_count: 0 } }),
}));
jest.mock("@/ui", () => {
  const real = jest.requireActual("@/ui"), { View } = jest.requireActual("react-native");
  return { ...real, Screen: ({ children }: any) => <View>{children}</View>, Page: ({ children }: any) => <View>{children}</View> };
});
jest.mock("@/ui/Version", () => ({ Version: () => null }));
jest.mock("@/ui/haptics", () => ({ success: jest.fn(), tick: jest.fn(), tap: jest.fn(), warn: jest.fn(), fail: jest.fn() }));

const share = jest.spyOn(Share, "share");
const base = {
  code: "K7Q2MX", link: "https://kaamkorecord.com/get/?src=invite&ref=K7Q2MX", joined: 3, waiting: 2,
  level: null, next_level: "bronze", next_at: 10,
  levels: [{ level: "bronze", at: 10 }, { level: "silver", at: 25 }, { level: "gold", at: 50 }],
  invited_by: null, can_say_invited_by: false,
};
beforeEach(() => { share.mockReset(); mockPush.mockReset(); mockSetInvitedBy.mockReset(); setLang("en"); mockInvites = { ...base }; });
afterAll(() => setLang("en"));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const wrap = (ui: React.ReactElement) => (
  <SafeAreaProvider initialMetrics={metrics}>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
  </SafeAreaProvider>
);

test("the message carries your own link and code, in the app's language", () => {
  expect(inviteMessage(base.link, base.code)).toBe(
    "I use KaamKoRecord to clock in, keep my timesheets and check my pay. It's free — get it here: https://kaamkorecord.com/get/?src=invite&ref=K7Q2MX\nMy invite code: K7Q2MX");
  expect(inviteMessage()).toMatch(new RegExp(`${INVITE_URL.replace(/[?.]/g, "\\$&")}$`));
  setLang("ne");
  expect(inviteMessage(base.link, base.code)).toContain("मेरो निमन्त्रणा कोड: K7Q2MX");
});

test("Profile's Invite friends row opens the invite page", async () => {
  const s = await render(<Profile tabMode />);
  await fireEvent.press(s.getByTestId("profile-invite"));
  expect(mockPush).toHaveBeenCalledWith("/profile/invite");
});

test("the page shows the code, the progress to Bronze, and shares the personal link", async () => {
  share.mockResolvedValue({ action: Share.sharedAction, activityType: undefined });
  const s = await render(wrap(<InviteScreen />));
  await waitFor(() => expect(s.getByTestId("invite-code")).toHaveTextContent("K7Q2MX"));
  expect(s.getByTestId("invite-level")).toHaveTextContent("No badge yet");
  expect(s.getByText("3 friends using the app · 2 still to start")).toBeTruthy();
  expect(s.getByTestId("invite-next")).toHaveTextContent("7 more for Bronze Champion");
  await fireEvent.press(s.getByTestId("invite-share"));
  expect(share).toHaveBeenCalledWith({ message: inviteMessage(base.link, base.code) }, { dialogTitle: "Invite friends" });
});

test("at the top level it says so", async () => {
  mockInvites = { ...base, joined: 52, level: "gold", next_level: null, next_at: null };
  const s = await render(wrap(<InviteScreen />));
  await waitFor(() => expect(s.getByTestId("invite-level")).toHaveTextContent("Gold Champion"));
  expect(s.getByText("You've reached the top level. Thank you!")).toBeTruthy();
});

test("a new account can say who invited them; a wrong code is shown under the box", async () => {
  mockInvites = { ...base, can_say_invited_by: true };
  const { ApiError } = jest.requireActual("@/api/client");
  mockSetInvitedBy.mockRejectedValueOnce(new ApiError(400, "We couldn't find that invite code. Check it and try again.", { invited_by: ["We couldn't find that invite code. Check it and try again."] }));
  const s = await render(wrap(<InviteScreen />));
  await waitFor(() => expect(s.getByTestId("invited-by-input")).toBeTruthy());
  await fireEvent.changeText(s.getByTestId("invited-by-input"), "nope");
  await fireEvent.press(s.getByTestId("invited-by-save"));
  await waitFor(() => expect(s.getByText("We couldn't find that invite code. Check it and try again.")).toBeTruthy());
  mockSetInvitedBy.mockResolvedValueOnce({ ...base, invited_by: "kiran", can_say_invited_by: false });
  await fireEvent.changeText(s.getByTestId("invited-by-input"), "K7Q2MX");
  await fireEvent.press(s.getByTestId("invited-by-save"));
  await waitFor(() => expect(s.getByTestId("invited-by")).toHaveTextContent("You were invited by kiran."));
});

test("a dismissed or failed share is no error", async () => {
  share.mockResolvedValue({ action: Share.dismissedAction, activityType: undefined });
  await expect(inviteFriends()).resolves.toBe(false);
  share.mockRejectedValue(new Error("no sheet"));
  await expect(inviteFriends()).resolves.toBe(false);
});

test("Android's install referrer gives the code; anything odd gives nothing", () => {
  expect(inviteCodeFrom("utm_source=invite&utm_medium=link&utm_content=k7q2mx")).toBe("K7Q2MX");
  expect(inviteCodeFrom("utm_source=google-play&utm_medium=organic")).toBe("");
  expect(inviteCodeFrom("utm_content=<script>")).toBe("");
});

test("the Champion medal sits beside a name, and is written out on a profile", async () => {
  const s = await render(<AdminBadge person={{ is_admin: false, is_moderator: false, champion: "silver" }} />);
  expect(s.getByTestId("champion-badge-silver")).toHaveProp("accessibilityLabel", "Silver Champion");
  expect(s.queryByText("Silver Champion")).toBeNull();
  const full = await render(<AdminBadge person={{ is_admin: false, is_moderator: true, champion: "gold" }} full />);
  expect(full.getByTestId("moderator-badge")).toBeTruthy();
  expect(full.getByText("Gold Champion")).toBeTruthy();
  const none = await render(<AdminBadge person={{ is_admin: false, is_moderator: false, champion: null }} />);
  expect(none.toJSON()).toBeNull();
});

test("a code typed in small letters is shown in capitals", async () => {
  mockInvites = { ...base, can_say_invited_by: true };
  const s = await render(wrap(<InviteScreen />));
  await waitFor(() => expect(s.getByTestId("invited-by-input")).toBeTruthy());
  await fireEvent.changeText(s.getByTestId("invited-by-input"), "k7q2mx");
  expect(s.getByTestId("invited-by-input")).toHaveProp("value", "K7Q2MX");
  mockSetInvitedBy.mockResolvedValueOnce({ ...base, invited_by: "kiran", can_say_invited_by: false });
  await fireEvent.press(s.getByTestId("invited-by-save"));
  expect(mockSetInvitedBy).toHaveBeenCalledWith("K7Q2MX");
});
