import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { AppBar } from "@/ui/AppBar";

let mockUnread = 0, mockSignedIn = true;
const mockPush = jest.fn();
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/api", () => ({ useUnread: () => ({ data: { unread: mockUnread } }) }));
jest.mock("@/auth/session", () => ({ useSignedIn: () => mockSignedIn }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush, navigate: jest.fn() }), useFocusEffect: jest.fn() }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/nav/paths", () => ({ goBack: jest.fn() }));

beforeEach(() => { jest.clearAllMocks(); mockUnread = 0; mockSignedIn = true; });

test("the main screens have the bell at the top right, with the unread count, opening notifications", async () => {
  mockUnread = 3;
  const view = await render(<AppBar />);
  expect(view.getByTestId("bell-badge")).toHaveTextContent("3");
  expect(view.getByLabelText("Notifications, 3 unread")).toBeTruthy();
  await fireEvent.press(view.getByTestId("appbar-bell"));
  expect(mockPush).toHaveBeenCalledWith("/notifications");
});

test("no badge when there is nothing new, and no bell on pages with a back button or when signed out", async () => {
  const main = await render(<AppBar />);
  expect(main.getByTestId("appbar-bell")).toBeTruthy();
  expect(main.queryByTestId("bell-badge")).toBeNull();
  const inner = await render(<AppBar back />);
  expect(inner.queryByTestId("appbar-bell")).toBeNull();
  mockSignedIn = false;
  const out = await render(<AppBar />);
  expect(out.queryByTestId("appbar-bell")).toBeNull();
});
