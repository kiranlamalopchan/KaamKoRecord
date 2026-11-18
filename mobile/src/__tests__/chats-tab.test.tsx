import React from "react";
import { render } from "@testing-library/react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Chats from "@/screens/Chats";

let mockControl: any = null;
const mockInbox = { data: { pages: [{ conversations: [], next: null, unread: 0 }] }, isLoading: false, isRefetching: true, isFetchingNextPage: false, hasNextPage: false, error: null, refetch: jest.fn(() => Promise.resolve()), fetchNextPage: jest.fn() };
jest.mock("@/api", () => ({ convo: {}, useChatChanged: () => jest.fn(), useChatInbox: () => mockInbox }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }), useFocusEffect: jest.fn() }));
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
