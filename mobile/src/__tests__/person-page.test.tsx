import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { ActionSheetIOS, Alert } from "react-native";
import PersonScreen from "../../app/people/[username]";

const mockPush = jest.fn(), mockRefetch = jest.fn(async () => ({})), mockFriendsChanged = jest.fn();
const mockFriends = { request: jest.fn(async () => ({ status: "sent" })), accept: jest.fn(async () => ({})), decline: jest.fn(async () => ({})), remove: jest.fn(async () => ({})) };
const mockBlock = jest.fn(async () => ({}));
let mockPage: Record<string, unknown> = {};
const person = (username: string, extra = {}) => ({ username, name: username, initial: username[0], hue: 1, photo: null, is_live: false, is_me: false, is_admin: false, ...extra });
const page = (extra = {}) => ({
  id: 3, person: person("mona"), blocked: false, can_message: false, since: "3 Nov 2026",
  notice_count: 2, comment_count: 1, received: 5, given: 0, notices: [],
  friendship: "none", friend_request: null, friends_count: 4, mutual_count: 0, mutual: [], story: null, ...extra,
});

jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ username: "mona" }), useRouter: () => ({ push: mockPush }) }));
jest.mock("@/api", () => ({
  get friends() { return mockFriends; },
  moderation: { setModerator: jest.fn() },
  safety: { block: (...a: unknown[]) => mockBlock(...(a as [])), unblock: jest.fn() },
  usePerson: () => ({ data: mockPage, isLoading: false, error: null, refetch: mockRefetch }),
  useSafetyChanged: () => jest.fn(),
  useFriendsChanged: () => mockFriendsChanged,
}));
jest.mock("@/ui/haptics", () => ({ success: jest.fn(), tick: jest.fn(), warn: jest.fn(), fail: jest.fn() }));
jest.mock("@/ui/Skeleton", () => ({ SkeletonPerson: () => null }));
jest.mock("@/ui/NoticeCard", () => ({ NoticeCard: () => null }));
jest.mock("@/ui/ReportSheet", () => ({ ReportSheet: ({ target }: any) => { const { Text } = require("react-native"); return target ? <Text>Reporting {target.username}</Text> : null; } }));
jest.mock("@/ui/index", () => {
  const { View, Text, Pressable } = require("react-native");
  const Wrapper = ({ children }: any) => <View>{children}</View>;
  return { Screen: Wrapper, Page: Wrapper, Card: Wrapper, ErrorBanner: () => null, Avatar: () => null, AdminBadge: () => null,
    Empty: ({ title }: any) => <Text>{title}</Text>,
    Button: ({ title, onPress, testID }: any) => <Pressable accessibilityRole="button" accessibilityLabel={title} testID={testID} onPress={onPress}><Text>{title}</Text></Pressable>,
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => { buttons?.find(b => b.style !== "cancel")?.onPress?.(); });
});

test("a stranger's page offers Add friend and shows their counts", async () => {
  mockPage = page();
  const screen = await render(<PersonScreen />);
  expect(screen.getByText("Joined 3 Nov 2026")).toBeTruthy();
  expect(screen.getByText("4")).toBeTruthy();
  expect(screen.getByText("Friends")).toBeTruthy();
  expect(screen.queryByTestId("person-message")).toBeNull();
  await fireEvent.press(screen.getByTestId("person-add"));
  await waitFor(() => expect(mockFriends.request).toHaveBeenCalledWith("mona"));
  expect(mockFriendsChanged).toHaveBeenCalled();
  expect(mockRefetch).toHaveBeenCalled();
});

test("a request from them can be accepted or declined right on their page", async () => {
  mockPage = page({ friendship: "received", friend_request: 9 });
  const screen = await render(<PersonScreen />);
  await fireEvent.press(screen.getByTestId("person-accept"));
  await waitFor(() => expect(mockFriends.accept).toHaveBeenCalledWith(9));
  await fireEvent.press(screen.getByTestId("person-decline"));
  await waitFor(() => expect(mockFriends.decline).toHaveBeenCalledWith(9));
});

test("a sent request can be cancelled after confirming", async () => {
  mockPage = page({ friendship: "sent", friend_request: 4 });
  const screen = await render(<PersonScreen />);
  await fireEvent.press(screen.getByTestId("person-requested"));
  await waitFor(() => expect(mockFriends.decline).toHaveBeenCalledWith(4));
});

test("a friend's page leads with Message, shows mutual friends and the story ring", async () => {
  mockPage = page({ friendship: "friends", can_message: true, mutual_count: 2, mutual: [person("sam"), person("eve")], story: "unseen" });
  const screen = await render(<PersonScreen />);
  expect(screen.getByText("2 mutual friends")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("person-message"));
  expect(mockPush).toHaveBeenCalledWith("/messages/mona");
  await fireEvent.press(screen.getByTestId("person-story"));
  expect(mockPush).toHaveBeenCalledWith("/stories/mona");
});

test("Report and Block live behind the ••• button", async () => {
  mockPage = page();
  const sheet = jest.spyOn(ActionSheetIOS, "showActionSheetWithOptions");
  const screen = await render(<PersonScreen />);
  sheet.mockImplementationOnce((_o, pick) => pick(0));
  await fireEvent.press(screen.getByTestId("person-more"));
  expect(screen.getByText("Reporting mona")).toBeTruthy();
  sheet.mockImplementationOnce((_o, pick) => pick(1));
  await fireEvent.press(screen.getByTestId("person-more"));
  await waitFor(() => expect(mockBlock).toHaveBeenCalledWith("mona"));
});

test("your own page has no friendship buttons", async () => {
  mockPage = page({ person: person("mona", { is_me: true }), friendship: "me" });
  const screen = await render(<PersonScreen />);
  expect(screen.getByText("You")).toBeTruthy();
  expect(screen.queryByTestId("person-more")).toBeNull();
  expect(screen.getByText("Your notices")).toBeTruthy();
});
