import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Chats from "@/screens/Chats";

let mockControl: any = null;
const mockPush = jest.fn();
const mockInbox: any = { data: { pages: [{ conversations: [], next: null, unread: 0 }] }, isLoading: false, isRefetching: true, isFetchingNextPage: false, hasNextPage: false, error: null, refetch: jest.fn(() => Promise.resolve()), fetchNextPage: jest.fn() };
jest.mock("@/api", () => ({ convo: {}, useChatChanged: () => jest.fn(), useChatInbox: () => mockInbox }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
// Swiping is not what these tests are about; the real one needs a device's gesture runtime.
jest.mock("react-native-gesture-handler/ReanimatedSwipeable", () => {
  const React = require("react");
  const Swipeable = React.forwardRef(({ children }: any, _ref: any) => children);
  Swipeable.displayName = "Swipeable";
  return { __esModule: true, default: Swipeable };
});
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }), useFocusEffect: jest.fn() }));
jest.mock("@/ui", () => {
  const actual = jest.requireActual("@/ui/refresh");
  return { Screen: ({ children }: any) => children, Avatar: () => null, Button: () => null, Empty: () => null, ErrorBanner: () => null, usePullRefresh: actual.usePullRefresh };
});
jest.mock("@/ui/depth", () => ({
  WithDepth: ({ children }: any) => children({ scroll: {}, padTop: 0, onScroll: undefined, refreshOffset: 0 }),
  underRefresh: (control: any) => { mockControl = control; return control; },
}));
jest.mock("@/ui/layout", () => ({ useLayout: () => ({ column: {}, insets: { bottom: 0 }, bottom: 0 }) }));
jest.mock("@/ui/Skeleton", () => ({ SkeletonRows: () => null }));

test("switching to Chats reloads quietly: the pull-down spinner only turns for a pull", async () => {
  const view = await render(<GestureHandlerRootView style={{ flex: 1 }}><Chats /></GestureHandlerRootView>);
  // A background reload is in progress (isRefetching), yet nothing spins over the list.
  expect(view.toJSON()).toBeTruthy();
  expect(mockControl.props.refreshing).toBe(false);
});

const person = (username: string) => ({ username, name: username, initial: username[0], hue: 1, photo: null, is_live: false, is_me: false, is_admin: false });
const row = (id: string, who: string, extra: Record<string, unknown>) => ({
  id, kind: "direct", title: who, person: person(who), photo: null, initial: who[0], hue: 1, pinned: false, muted: false, archived: false, role: "member",
  last: { id: 1, body: "Hi", mine: false, sender: who, at: new Date().toISOString(), time: "18:18", day: "Wed", unsent: false, event: null, attachment: null, status: null },
  ...extra,
});

test("a plain list like other messengers: no filter tabs, a dot for unread, their photo once they read yours, and archived one row down", async () => {
  mockInbox.data = { pages: [{ next: null, unread: 1, archived: 3, conversations: [
    row("a", "pramila", { unread: 2, story: "unseen" }),
    row("b", "tirtha", { unread: 0, last: { id: 2, body: "See you", mine: true, sender: "me", at: new Date().toISOString(), time: "15:11", day: "Wed", unsent: false, event: null, attachment: null, status: "read" } }),
  ] }] };
  const view = await render(<GestureHandlerRootView style={{ flex: 1 }}><Chats /></GestureHandlerRootView>);
  expect(view.queryByText("Unread")).toBeNull();
  expect(view.queryByText("All")).toBeNull();
  expect(view.getAllByTestId("chat-unread-dot")).toHaveLength(1);
  expect(view.getByTestId("chat-seen")).toBeTruthy();
  expect(view.getByText("You: See you")).toBeTruthy();
  // Their story ring opens the story; the row itself opens the chat.
  await fireEvent.press(view.getByTestId("chat-story-ring"));
  expect(mockPush).toHaveBeenCalledWith("/stories/pramila");
  expect(view.getByText("3 conversations")).toBeTruthy();
  await fireEvent.press(view.getByTestId("chat-archived"));
  expect(mockPush).toHaveBeenCalledWith("/messages/archived");
});

test("the archived screen has its own title and no Archived row of its own", async () => {
  mockInbox.data = { pages: [{ next: null, unread: 0, conversations: [row("c", "uttam", { archived: true })] }] };
  const view = await render(<GestureHandlerRootView style={{ flex: 1 }}><Chats archived /></GestureHandlerRootView>);
  expect(view.getByText("Archived chats")).toBeTruthy();
  expect(view.queryByTestId("chat-archived")).toBeNull();
  expect(view.queryByTestId("chat-new")).toBeNull();
});
