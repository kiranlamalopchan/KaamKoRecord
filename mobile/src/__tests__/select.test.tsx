import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { ActionSheetIOS, Platform } from "react-native";
import { Select } from "@/ui/Select";

jest.mock("@/ui/haptics", () => ({ tick: jest.fn() }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const options = [{ value: "w", label: "Weekly" }, { value: "f", label: "Fortnightly" }];
const os = Platform.OS;
afterEach(() => { Platform.OS = os; });

test("on iOS the field opens the action sheet with the current row ticked", async () => {
  Platform.OS = "ios";
  const onChange = jest.fn();
  const sheet = jest.spyOn(ActionSheetIOS, "showActionSheetWithOptions").mockImplementation((_o, pick) => pick(0));
  const screen = await render(<Select label="Paid" value="f" options={options} onChange={onChange} />);
  await fireEvent.press(screen.getByRole("button", { name: "Paid: Fortnightly" }));
  expect(sheet.mock.calls[0][0].options).toEqual(["Weekly", "✓ Fortnightly", "Cancel"]);
  expect(onChange).toHaveBeenCalledWith("w");
});

test("on Android the same field opens a sheet of the same rows", async () => {
  Platform.OS = "android";
  const onChange = jest.fn();
  const screen = await render(<Select label="Paid" value="f" options={options} onChange={onChange} />);
  await fireEvent.press(screen.getByRole("button", { name: "Paid: Fortnightly" }));
  await fireEvent.press(screen.getByText("Weekly"));
  expect(onChange).toHaveBeenCalledWith("w");
  // Picking the row you're already on, or Cancel, changes nothing.
  await fireEvent.press(screen.getByRole("button", { name: "Paid: Fortnightly" }));
  await fireEvent.press(screen.getByText("Cancel"));
  expect(onChange).toHaveBeenCalledTimes(1);
});
