/** The bottom navigation: Apple's own bar on iPhone, the app's floating bar on Android, both with Chats and its unread badge. */
import React from "react";
import { Platform } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";

import TabsLayout from "../../app/(tabs)/_layout";
import { setTabBarHidden } from "@/ui/chrome";
import { TabBar } from "@/ui/TabBar";

let mockUnread = 0, mockChatUnread = 0;
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
const mockSetBadge = jest.fn();
jest.mock("@/api", () => ({ useUnread: () => ({ data: { unread: mockUnread } }), useChatUnread: () => ({ data: { unread: mockChatUnread } }) }));
jest.mock("@/push/register", () => ({ setBadge: (n: number) => mockSetBadge(n) }));
jest.mock("@/ui/haptics", () => ({ tick: jest.fn() }));
jest.mock("expo-router", () => ({ usePathname: () => "/" }));
// The navigator itself needs a whole navigation tree; here it only has to
// hand its screens to the bar the way the real one does.
jest.mock("expo-router/js-tabs", () => {
  const React = require("react");
  const Tabs: any = ({ children, tabBar }: any) => {
    const screens = React.Children.toArray(children).map((child: any) => child.props);
    const routes = screens.map((s: any) => ({ key: `${s.name}-key`, name: s.name }));
    const descriptors = Object.fromEntries(screens.map((s: any) => [`${s.name}-key`, { options: s.options }]));
    return tabBar({ state: { index: 0, routes }, descriptors, emitter: { emit: () => ({ defaultPrevented: false }) }, navigateToTab: jest.fn(), insets: { top: 0, bottom: 0, left: 0, right: 0 } });
  };
  Tabs.Screen = function Screen() { return null; };
  return { Tabs };
});
jest.mock("expo-router/native-tabs", () => {
  const React = require("react");
  const { View, Text } = require("react-native");
  const NativeTabs: any = ({ children, hidden }: any) => React.createElement(View, { testID: "native-tabs", accessibilityState: { expanded: !hidden } }, children);
  NativeTabs.Trigger = function Trigger({ children }: any) { return React.createElement(View, null, children); };
  NativeTabs.Trigger.Label = function Label({ children }: any) { return React.createElement(Text, null, children); };
  NativeTabs.Trigger.Icon = function Icon() { return null; };
  NativeTabs.Trigger.VectorIcon = function VectorIcon() { return null; };
  NativeTabs.Trigger.Badge = function Badge({ children }: any) { return React.createElement(Text, { testID: "unread-badge" }, children); };
  return { NativeTabs };
});

const originalPlatform = Platform.OS;
afterEach(async () => { Object.defineProperty(Platform, "OS", { value: originalPlatform }); await act(async () => setTabBarHidden(false)); });

test("iPhone keeps Apple's own bar, with Chats and its unread badge, and hides it while scrolled down", async () => {
  Object.defineProperty(Platform, "OS", { value: "ios" });
  mockChatUnread = 120;
  mockUnread = 7;
  const view = await render(<TabsLayout />);
  expect(view.getByTestId("native-tabs")).toBeTruthy();
  expect(view.queryByTestId("tab-bar")).toBeNull();
  for (const label of ["Home", "Items", "Work", "Chats", "Profile"]) expect(view.getByText(label)).toBeTruthy();
  // Notifications live behind the bell at the top now, not in the tab bar.
  expect(view.queryByText("Alerts")).toBeNull();
  expect(view.getByTestId("unread-badge")).toHaveTextContent("99+");
  // The app icon's number still follows notifications.
  expect(mockSetBadge).toHaveBeenLastCalledWith(7);
  await act(async () => setTabBarHidden(true));
  expect(view.getByTestId("native-tabs")).toHaveProp("accessibilityState", { expanded: false });
  mockChatUnread = 0;
  await view.rerender(<TabsLayout />);
  expect(view.queryByTestId("unread-badge")).toBeNull();
});

test("Android draws the app's own bar, with Chats and its unread badge", async () => {
  Object.defineProperty(Platform, "OS", { value: "android" });
  mockChatUnread = 120;
  const view = await render(<TabsLayout />);
  expect(view.getByTestId("tab-bar")).toBeTruthy();
  expect(view.queryByTestId("native-tabs")).toBeNull();
  for (const label of ["Home", "Items", "Work", "Chats", "Profile"]) expect(view.getByText(label)).toBeTruthy();
  expect(view.getByTestId("tab-chats")).toHaveProp("accessibilityLabel", "Chats, 99+");
  mockChatUnread = 0;
  await view.rerender(<TabsLayout />);
  expect(view.queryByText("99+")).toBeNull();
});

const routes = ["(home)", "plu", "work", "chats", "account"].map((name) => ({ key: `${name}-key`, name }));
const descriptors = Object.fromEntries(routes.map((r) => [r.key, { options: { title: r.name } }])) as any;
const icons = Object.fromEntries(routes.map((r) => [r.name, { icon: "ellipse-outline", selected: "ellipse" }])) as any;
const noInsets = { top: 0, bottom: 0, left: 0, right: 0 };

test("Android: a tap on another tab goes there; a tap on the open tab only tells it (to scroll up or pop)", async () => {
  const emit = jest.fn(() => ({ defaultPrevented: false }));
  const navigateToTab = jest.fn();
  const view = await render(<TabBar state={{ index: 0, routes }} descriptors={descriptors} emitter={{ emit } as any} navigateToTab={navigateToTab} insets={noInsets} icons={icons} />);
  await fireEvent.press(view.getByTestId("tab-work"));
  expect(emit).toHaveBeenLastCalledWith({ type: "tabPress", target: "work-key", canPreventDefault: true });
  expect(navigateToTab).toHaveBeenCalledWith("work-key");
  navigateToTab.mockClear();
  await fireEvent.press(view.getByTestId("tab-(home)"));
  expect(emit).toHaveBeenLastCalledWith({ type: "tabPress", target: "(home)-key", canPreventDefault: true });
  expect(navigateToTab).not.toHaveBeenCalled();
  expect(view.getByTestId("tab-(home)")).toHaveProp("accessibilityState", { selected: true });
});

test("Android: scrolled away, the bar lets touches through to the page", async () => {
  const view = await render(<TabBar state={{ index: 0, routes }} descriptors={descriptors} emitter={{ emit: jest.fn(() => ({})) } as any} navigateToTab={jest.fn()} insets={noInsets} icons={icons} />);
  expect(view.getByTestId("tab-bar")).toHaveProp("pointerEvents", "box-none");
  await act(async () => setTabBarHidden(true));
  expect(view.getByTestId("tab-bar")).toHaveProp("pointerEvents", "none");
  await act(async () => setTabBarHidden(false));
  expect(view.getByTestId("tab-bar")).toHaveProp("pointerEvents", "box-none");
});
