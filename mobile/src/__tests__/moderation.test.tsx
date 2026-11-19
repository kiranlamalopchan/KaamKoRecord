import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import Reports from "../../app/moderation/reports";
import PersonScreen from "../../app/people/[username]";

const mockResolve = jest.fn(), mockSetModerator = jest.fn(), mockRefetch = jest.fn(), mockInvalidate = jest.fn(async () => {});
let mockPersonPage: Record<string, unknown> = {};
const person = (username: string) => ({ username, name: username, initial: username[0], hue: 1, photo: null, is_live: false, is_me: false, is_admin: false });
const mockReport = {
  id: 7, kind: "notice", kind_label: "Notice", reason: "spam", reason_label: "Spam or misleading", note: "selling stuff",
  excerpt: "Buy cheap watches", reporter: person("eve"), accused: person("sam"), reports: 2, up: true, can_take_down: true,
  created: "2026-11-19T10:00:00Z", handled: null,
};

jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ username: "mona" }), useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: mockInvalidate }) }));
jest.mock("@/api", () => ({
  moderation: { resolve: (...a: unknown[]) => mockResolve(...a), setModerator: (...a: unknown[]) => mockSetModerator(...a) },
  safety: { block: jest.fn(), unblock: jest.fn() },
  useModerationReports: () => ({ data: { pages: [{ results: [mockReport], open: 1, next: null }] }, isLoading: false, error: null, hasNextPage: false }),
  usePerson: () => ({ data: mockPersonPage, isLoading: false, error: null, refetch: mockRefetch }),
  useSafetyChanged: () => jest.fn(),
  friends: {},
  useFriendsChanged: () => jest.fn(),
}));
jest.mock("@/ui/haptics", () => ({ success: jest.fn(), tick: jest.fn(), warn: jest.fn() }));
jest.mock("@/ui/depth", () => ({ WithDepth: ({ children }: any) => children({ scroll: {}, onScroll: () => {}, padTop: 0 }) }));
jest.mock("@/ui/layout", () => ({ useLayout: () => ({ column: {}, insets: { top: 0, bottom: 0, left: 0, right: 0 } }) }));
jest.mock("@/ui/Skeleton", () => ({ SkeletonRows: () => null, SkeletonPerson: () => null }));
jest.mock("@/ui/NoticeCard", () => ({ NoticeCard: () => null }));
jest.mock("@/ui/ReportSheet", () => ({ ReportSheet: () => null }));
jest.mock("@/ui/index", () => {
  const { View, Text, Pressable } = require("react-native");
  const Wrapper = ({ children }: any) => <View>{children}</View>;
  return { Screen: Wrapper, Page: Wrapper, Card: Wrapper, ErrorBanner: () => null, Avatar: () => null,
    AdminBadge: ({ person }: any) => person.is_moderator ? <Text>Moderator</Text> : null,
    Empty: ({ title }: any) => <Text>{title}</Text>,
    PageTitle: ({ children }: any) => <Text>{children}</Text>,
    Segments: ({ options, onChange }: any) => <View>{options.map((o: any) => <Pressable key={o.value} accessibilityRole="button" accessibilityLabel={o.label} onPress={() => onChange(o.value)}><Text>{o.label}</Text></Pressable>)}</View>,
    Button: ({ title, onPress, disabled }: any) => <Pressable accessibilityRole="button" accessibilityLabel={title} disabled={disabled} onPress={onPress}><Text>{title}</Text></Pressable>,
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockResolve.mockResolvedValue({ closed: 2 });
  mockSetModerator.mockResolvedValue({ is_moderator: true });
  // Say yes to every confirm.
  jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => { buttons?.find(b => b.style !== "cancel")?.onPress?.(); });
});

test("a moderator sees one card per reported thing and takes it down after confirming", async () => {
  const screen = await render(<Reports />);
  expect(screen.getByText("Buy cheap watches")).toBeTruthy();
  expect(screen.getByText("2 reports")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Open (1)" })).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Take down" }));
  await waitFor(() => expect(mockResolve).toHaveBeenCalledWith(7, "take_down"));
  expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ["moderation-reports"] });
  await fireEvent.press(screen.getByRole("button", { name: "Dismiss" }));
  await waitFor(() => expect(mockResolve).toHaveBeenLastCalledWith(7, "dismiss"));
});

test("an admin makes somebody a moderator from their page; nobody else sees the button", async () => {
  mockPersonPage = { id: 3, person: person("mona"), blocked: false, can_message: false, since: "Nov 2026", notice_count: 0, comment_count: 0, received: 0, given: 0, notices: [], is_moderator: false, can_make_moderator: true };
  const screen = await render(<PersonScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Make moderator" }));
  await waitFor(() => expect(mockSetModerator).toHaveBeenCalledWith("mona", true));
  expect(mockRefetch).toHaveBeenCalled();

  mockPersonPage = { ...mockPersonPage, is_moderator: true, can_make_moderator: false };
  const other = await render(<PersonScreen />);
  expect(other.queryByRole("button", { name: "Make moderator" })).toBeNull();
  expect(other.getByText("Moderator")).toBeTruthy();
});
