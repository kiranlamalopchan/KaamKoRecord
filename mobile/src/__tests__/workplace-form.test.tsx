import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { ApiError } from "@/api/client";
import { WorkplaceForm } from "@/ui/WorkplaceForm";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/storage/private", () => {
  const { useState } = require("react");
  return { usePrivateState: (_key: string, initial: unknown) => { const [v, set] = useState(initial); return [v, set, true]; } };
});
jest.mock("@/ui/haptics", () => ({ fail: jest.fn(), success: jest.fn(), tick: jest.fn(), tap: jest.fn() }));

const choices = {
  weekdays: [{ value: 0, label: "Monday" }, { value: 6, label: "Sunday" }],
  phases: [{ value: "this", label: "This week" }, { value: "last", label: "Last week" }],
  colors: [{ value: 1, label: "Blue", css: "#3b82f6" }, { value: 2, label: "Green", css: "#22c55e" }],
  pay_cycles: [{ value: "IRREGULAR", label: "Whenever I'm paid" }, { value: "FORTNIGHT", label: "Fortnightly" }],
  paid_in: [{ value: "BANK", label: "Into my account, with tax taken out" }, { value: "CASH", label: "Cash in hand" }],
  limit_periods: [{ value: "WEEK", label: "Per week" }, { value: "FORTNIGHT", label: "Per fortnight" }],
  max_month_start: 28,
  tax_scales: [{ value: "TFT", label: "Tax-free threshold claimed" }, { value: "CUSTOM", label: "My own % from a payslip" }],
  loan_scales: ["TFT"],
} as any;
const cycles = { week_starts_on: 0, fortnight_starts_on: 0, fortnight_phase: "this", month_starts_on: 1, fortnight_hint: "" } as any;
const workplace = {
  id: 4, name: "Courtlands", hue: 1, address: "", hourly_rate: 28.5, tax_rate: null, tax_scale: "TFT", study_loan: false,
  paid_in: "BANK", pay_cycle: "FORTNIGHT", saturday_multiplier: 1.25, sunday_multiplier: 1, public_holiday_multiplier: 1,
  overtime_after_hours: null, overtime_multiplier: 1.5, hours_limit: 48, limit_period: "FORTNIGHT",
  week_starts_on: 0, fortnight_starts_on: 0, fortnight_phase: "this", month_starts_on: 1, is_default: true,
} as any;

const form = (onSave = jest.fn(async () => {})) =>
  render(<WorkplaceForm choices={choices} cycles={cycles} workplace={workplace} onSave={onSave} onCancel={jest.fn()} />);

test("up front only the essentials; everything else folds away with a one-line summary", async () => {
  const view = await form();
  expect(view.getByTestId("wp-name").props.value).toBe("Courtlands");
  expect(view.getByTestId("wp-rate").props.value).toBe("28.5");
  expect(view.getByText("Bank")).toBeTruthy();
  // Each folded row says what it is set to.
  expect(view.getByText("Fortnightly · Tax-free threshold claimed")).toBeTruthy();
  expect(view.getByText("Sat 1.25×")).toBeTruthy();
  expect(view.getByText("48 h per fortnight")).toBeTruthy();
  expect(view.getByText("Week from Mon · Month from day 1")).toBeTruthy();
  expect(view.getByText("Not added")).toBeTruthy();
  for (const id of ["pay", "rates", "limit", "cycles", "address"]) {
    expect(view.getByTestId(`wp-section-${id}`)).toBeTruthy();
  }
});

test("choosing cash says there is no tax, and saving sends every setting unchanged", async () => {
  const onSave = jest.fn(async () => {});
  const view = await form(onSave);
  await fireEvent.press(view.getByText("Cash"));
  expect(view.getByText("Fortnightly · Cash, no tax")).toBeTruthy();
  await act(async () => { fireEvent.press(view.getByTestId("save-workplace")); });
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
    name: "Courtlands", paid_in: "CASH", hourly_rate: "28.5", pay_cycle: "FORTNIGHT", tax_rate: "",
    saturday_multiplier: "1.25", hours_limit: "48", limit_period: "FORTNIGHT", month_starts_on: "1", is_default: true,
  }));
});

test("a refused value inside a folded row opens that row and shows the message there", async () => {
  const onSave = jest.fn(async () => { throw new ApiError(400, "Check the form", { hours_limit: ["Use a number of hours."] }); });
  const view = await form(onSave);
  const limitRow = () => view.getByTestId("wp-section-limit");
  await act(async () => { fireEvent.press(view.getByTestId("save-workplace")); });
  await waitFor(() => expect(view.getByText("Use a number of hours.")).toBeTruthy());
  // The row's head reports itself open to VoiceOver/TalkBack.
  const head = limitRow().children[0] as any;
  expect(head.props.accessibilityState).toEqual({ expanded: true });
});

test("a payslip fills the tax situation, HELP and the weekend and overtime rates, and opens their rows", async () => {
  const api = require("@/api");
  jest.spyOn(api.timesheet, "readPayslip").mockResolvedValue({
    fields: { hourly_rate: "30.00", tax_rate: "17.04", tax_scale: "TFT", study_loan: true, saturday_multiplier: "1.25", sunday_multiplier: "1.5", public_holiday_multiplier: "2.5", overtime_multiplier: "1.5" },
    read: [{ label: "Tax situation", value: "Tax-free threshold claimed + study loan", how: "matched" }],
    notes: [],
  });
  jest.spyOn(require("@/ui/native"), "native").mockReturnValue({ getDocumentAsync: async () => ({ canceled: false, assets: [{ uri: "file:///slip.pdf", name: "slip.pdf", mimeType: "application/pdf" }] }) });
  const newPlace = { ...workplace, tax_scale: "", tax_rate: null, saturday_multiplier: 1, study_loan: false };
  const onSave = jest.fn(async () => {});
  const view = await render(<WorkplaceForm choices={choices} cycles={cycles} workplace={newPlace} onSave={onSave} onCancel={jest.fn()} />);
  await act(async () => { fireEvent.press(view.getByTestId("wp-payslip")); });
  await waitFor(() => expect(view.getByText("Fortnightly · Tax-free threshold claimed")).toBeTruthy());
  expect(view.getByText("Sat 1.25× · Sun 1.5× · Holiday 2.5×")).toBeTruthy();
  // The first row it filled is open for checking.
  expect((view.getByTestId("wp-section-pay").children[0] as any).props.accessibilityState).toEqual({ expanded: true });
  await act(async () => { fireEvent.press(view.getByTestId("save-workplace")); });
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
    tax_scale: "TFT", study_loan: true, tax_rate: "", saturday_multiplier: "1.25", sunday_multiplier: "1.5",
    public_holiday_multiplier: "2.5", overtime_multiplier: "1.5", hourly_rate: "30.00",
  }));
});

test("while a payslip is being read the row says so and shows a spinner", async () => {
  let finish: (v: unknown) => void = () => {};
  jest.spyOn(require("@/api").timesheet, "readPayslip").mockReturnValue(new Promise((r) => { finish = r; }));
  jest.spyOn(require("@/ui/native"), "native").mockReturnValue({ getDocumentAsync: async () => ({ canceled: false, assets: [{ uri: "file:///slip.pdf", name: "slip.pdf", mimeType: "application/pdf" }] }) });
  const view = await form();
  await act(async () => { fireEvent.press(view.getByTestId("wp-payslip")); });
  expect(view.getByText("Reading payslip…")).toBeTruthy();
  expect(view.getByTestId("wp-payslip-reading")).toBeTruthy();
  expect(view.getByTestId("wp-payslip").props.accessibilityState).toEqual(expect.objectContaining({ busy: true }));
  await act(async () => { finish({ fields: {}, read: [], notes: [] }); });
  expect(view.queryByTestId("wp-payslip-reading")).toBeNull();
  expect(view.getByText("Fill from a payslip")).toBeTruthy();
});
