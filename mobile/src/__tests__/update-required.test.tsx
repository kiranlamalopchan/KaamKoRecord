import React from "react";
import { BackHandler } from "react-native";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

import { isOlder, checkForRequiredUpdate } from "@/update/required";
import { UpdateRequired } from "@/ui/UpdateRequired";

const mockApi = jest.fn();
jest.mock("@/api/client", () => ({ api: (...args: unknown[]) => mockApi(...args) }));
jest.mock("@/ui/Version", () => ({ appVersion: () => ({ version: "1.4.1", build: "" }) }));
const mockOpen = jest.fn();
jest.mock("@/nav/stores", () => ({ openAppStore: (...args: unknown[]) => mockOpen(...args) }));
jest.mock("@/ui/AppBar", () => ({ BrandMark: () => null }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

beforeEach(() => { mockApi.mockReset(); mockOpen.mockReset(); });

test("versions compare as numbers, not text", () => {
  expect(isOlder("1.4.1", "1.4.2")).toBe(true);
  expect(isOlder("1.4.9", "1.4.10")).toBe(true);
  expect(isOlder("1.4.10", "1.4.9")).toBe(false);
  expect(isOlder("1.4.2", "1.4.2")).toBe(false);
  expect(isOlder("1.5", "1.4.2")).toBe(false);
  expect(isOlder("1.4", "1.4.0")).toBe(false);
  expect(isOlder("", "1.4.2")).toBe(false);
  expect(isOlder("1.4.1", "")).toBe(false);
});

test("an older app is told to update, without needing to be signed in", async () => {
  mockApi.mockResolvedValue({ version: "1.4.3", minimum_version: "1.4.2" });
  await expect(checkForRequiredUpdate()).resolves.toEqual({ required: true, current: "1.4.1", latest: "1.4.3" });
  expect(mockApi).toHaveBeenCalledWith("mobile/release/", { anonymous: true });
});

test("no minimum, or a failed check, lets the app run", async () => {
  mockApi.mockResolvedValue({ version: "1.4.3", minimum_version: "" });
  await expect(checkForRequiredUpdate()).resolves.toEqual({ required: false });
  mockApi.mockResolvedValue({ version: "1.4.3" });
  await expect(checkForRequiredUpdate()).resolves.toEqual({ required: false });
  mockApi.mockRejectedValue(Object.assign(new Error("offline"), { status: 0 }));
  await expect(checkForRequiredUpdate()).resolves.toEqual({ required: false });
});

test("the page sends people to the store and holds the back button", async () => {
  const back = jest.spyOn(BackHandler, "addEventListener");
  mockOpen.mockResolvedValue(undefined);
  const s = await render(<UpdateRequired current="1.4.1" latest="1.4.2" />);
  expect(s.getByText("Update your app to the latest version")).toBeTruthy();
  expect(s.getByText("You have 1.4.1 · Latest 1.4.2")).toBeTruthy();
  expect(back).toHaveBeenCalledWith("hardwareBackPress", expect.any(Function));
  const handler = back.mock.calls[0][1] as () => boolean;
  expect(handler()).toBe(true);
  fireEvent.press(s.getByTestId("update-now"));
  await waitFor(() => expect(mockOpen).toHaveBeenCalled());
});

test("if the store won't open, it says so in words and lets them try again", async () => {
  mockOpen.mockRejectedValue(new Error("Could not open URL"));
  const s = await render(<UpdateRequired current="1.4.1" latest="1.4.2" />);
  fireEvent.press(s.getByTestId("update-now"));
  expect(await s.findByText("We couldn't open the store. Please try again.")).toBeTruthy();
  expect(s.queryByText(/Could not open URL/)).toBeNull();
});
