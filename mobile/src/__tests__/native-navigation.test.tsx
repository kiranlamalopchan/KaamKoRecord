import React from "react";
import { Platform } from "react-native";
import { render } from "@testing-library/react-native";
import TabsLayout from "../../app/(tabs)/_layout";

let mockUnread = 0, mockChatUnread = 0;
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
const mockSetBadge = jest.fn();
jest.mock("@/api", () => ({ useUnread: () => ({ data: { unread: mockUnread } }), useChatUnread: () => ({ data: { unread: mockChatUnread } }) }));
jest.mock("@/push/register", () => ({ setBadge: (n: number) => mockSetBadge(n) }));
jest.mock("expo-router/native-tabs", () => {
  const React = require("react");
  const { View, Text } = require("react-native");
  const NativeTabs: any = ({ children }: any) => React.createElement(View, { testID: "native-tabs" }, children);
  NativeTabs.Trigger = function Trigger({ children }: any) { return React.createElement(View, null, children); };
  NativeTabs.Trigger.Label = function Label({ children }: any) { return React.createElement(Text, null, children); };
  NativeTabs.Trigger.Icon = function Icon() { return null; };
  NativeTabs.Trigger.Badge = function Badge({ children }: any) { return React.createElement(Text, { testID: "unread-badge" }, children); };
  return { NativeTabs };
});
const originalPlatform = Platform.OS;
afterEach(() => { Object.defineProperty(Platform, "OS", { value: originalPlatform }); });

test.each(["ios", "android"])("%s uses the native navigator, with Chats where Alerts was and its unread badge", async (platform) => {
  Object.defineProperty(Platform, "OS", { value: platform });
  mockChatUnread = 120;
  mockUnread = 7;
  const view = await render(<TabsLayout />);
  expect(view.getByTestId("native-tabs")).toBeTruthy();
  for (const label of ["Home", "Items", "Work", "Chats", "Profile"]) expect(view.getByText(label)).toBeTruthy();
  // Notifications live behind the bell at the top now, not in the tab bar.
  expect(view.queryByText("Alerts")).toBeNull();
  expect(view.getByTestId("unread-badge")).toHaveTextContent("99+");
  // The app icon's number still follows notifications.
  expect(mockSetBadge).toHaveBeenLastCalledWith(7);
  mockChatUnread = 0;
  await view.rerender(<TabsLayout />);
  expect(view.queryByTestId("unread-badge")).toBeNull();
});
