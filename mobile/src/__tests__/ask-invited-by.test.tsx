/** A brand-new Google/Apple account is asked once "Did someone invite you?". */
import React from "react";
import { act, fireEvent, render, renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { askInvitedByNext, useAskInvitedBy } from "@/nav/askInvitedBy";
import InvitedByScreen from "../../app/invited-by";

const mockBack = jest.fn(), mockReplace = jest.fn();
const mockSetInvitedBy = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ back: mockBack, replace: mockReplace, canGoBack: () => true }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null, MaterialIcons: () => null }));
jest.mock("@/auth/session", () => ({ useSession: () => ({ me: { username: "newbie" } }) }));
jest.mock("@/api", () => ({ me: { setInvitedBy: (code: string) => mockSetInvitedBy(code) } }));
jest.mock("@/ui", () => {
  const real = jest.requireActual("@/ui"), { View } = jest.requireActual("react-native");
  return { ...real, Screen: ({ children }: any) => <View>{children}</View>, Page: ({ children }: any) => <View>{children}</View> };
});
jest.mock("@/ui/haptics", () => ({ success: jest.fn(), tick: jest.fn(), tap: jest.fn() }));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const wrap = (ui: React.ReactElement) => (
  <SafeAreaProvider initialMetrics={metrics}><QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider></SafeAreaProvider>
);

beforeEach(async () => { jest.clearAllMocks(); await act(async () => askInvitedByNext(false)); });

test("asked once, after the app is on screen; not at all when not owed", async () => {
  jest.useFakeTimers();
  const open = jest.fn();
  const view = await renderHook((p: { active: boolean }) => useAskInvitedBy(p.active, open), { initialProps: { active: false } });
  await act(async () => askInvitedByNext(true));
  await act(async () => { jest.advanceTimersByTime(1000); });
  expect(open).not.toHaveBeenCalled();
  await view.rerender({ active: true });
  await act(async () => { jest.advanceTimersByTime(1000); });
  expect(open).toHaveBeenCalledTimes(1);
  await view.rerender({ active: false });
  await view.rerender({ active: true });
  await act(async () => { jest.advanceTimersByTime(1000); });
  expect(open).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});

test("the code is typed in capitals and saved; Skip just closes", async () => {
  mockSetInvitedBy.mockResolvedValue({ invited_by: "kiran" });
  const s = await render(wrap(<InvitedByScreen />));
  await fireEvent.changeText(s.getByTestId("ask-invited-by-input"), "k7q2mx");
  expect(s.getByTestId("ask-invited-by-input")).toHaveProp("value", "K7Q2MX");
  await fireEvent.press(s.getByTestId("ask-invited-by-save"));
  await waitFor(() => expect(mockBack).toHaveBeenCalled());
  expect(mockSetInvitedBy).toHaveBeenCalledWith("K7Q2MX");
  const skip = await render(wrap(<InvitedByScreen />));
  await fireEvent.press(skip.getByTestId("ask-invited-by-skip"));
  expect(mockBack).toHaveBeenCalledTimes(2);
});

test("a wrong code is said under the box, and the screen stays", async () => {
  const { ApiError } = jest.requireActual("@/api/client");
  mockSetInvitedBy.mockRejectedValue(new ApiError(400, "x", { invited_by: ["We couldn't find that invite code. Check it and try again."] }));
  const s = await render(wrap(<InvitedByScreen />));
  await fireEvent.changeText(s.getByTestId("ask-invited-by-input"), "ZZZZZZ");
  await fireEvent.press(s.getByTestId("ask-invited-by-save"));
  await waitFor(() => expect(s.getByText("We couldn't find that invite code. Check it and try again.")).toBeTruthy());
  expect(mockBack).not.toHaveBeenCalled();
});
