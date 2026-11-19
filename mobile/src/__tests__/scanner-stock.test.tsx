import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import BarcodeScanner from "../../app/items/scanner";

const mockStock = jest.fn(), mockLookup = jest.fn(), mockChanged = jest.fn();
let mockScan: (code: string) => void = () => {};
const mockMilk = { id: 3, catalogue_id: 9, title: "Milk", description: "Milk", code: "111", fields: { Name: "Milk", Barcode: "111" }, stock: 5 };
const mockConfig = { id: 9, name: "Shop", headers: ["Name", "Barcode"], title_column: "Name", code_column: "Barcode", description_column: "", search_columns: [], track_stock: true };
const mockMatch = { exact: [mockMilk], others: [], count: 1, catalogue: mockConfig, results: [mockMilk] };

jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({}), useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));
jest.mock("expo-camera", () => ({
  useCameraPermissions: () => [{ granted: true }, jest.fn()],
  CameraView: ({ onBarcodeScanned }: any) => { mockScan = (code: string) => onBarcodeScanned({ data: code }); return null; },
}));
jest.mock("@/api/catalogue", () => ({
  catalogue: { stock: (...a: unknown[]) => mockStock(...a) },
  lookUpBarcode: (...a: unknown[]) => mockLookup(...a),
  useBarcodeLookup: (code: string) => ({ data: code ? mockMatch : undefined, isLoading: false, error: null }),
  useCatalogueChanged: () => mockChanged,
  useCatalogueIdle: () => ({ data: { catalogue: mockConfig } }),
}));
jest.mock("@/ui/layout", () => ({ useLayout: () => ({ insets: { top: 0, bottom: 0, left: 0, right: 0 }, bar: 50 }) }));
jest.mock("@/ui/haptics", () => ({ tick: jest.fn(), success: jest.fn(), warn: jest.fn(), fail: jest.fn() }));
jest.mock("@/ui/index", () => {
  const { View, Text, Pressable } = require("react-native");
  const Wrapper = ({ children }: any) => <View>{children}</View>;
  return { Screen: Wrapper, Page: Wrapper, Card: Wrapper, ErrorBanner: () => null,
    PageTitle: ({ children }: any) => <Text>{children}</Text>,
    Button: ({ title, onPress }: any) => <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress}><Text>{title}</Text></Pressable>,
    Segments: ({ options, onChange }: any) => <View>{options.map((o: any) => <Pressable key={o.value} accessibilityRole="button" accessibilityLabel={o.label} onPress={() => onChange(o.value)}><Text>{o.label}</Text></Pressable>)}</View>,
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockLookup.mockResolvedValue(mockMatch);
  mockStock.mockImplementation(async (_id: number, body: { change: number }) => ({ ...mockMilk, stock: mockMilk.stock + body.change }));
});

test("look up shows the item's stock, and + changes it by one", async () => {
  const screen = await render(<BarcodeScanner />);
  await act(async () => mockScan("111"));
  expect(screen.getByTestId("scan-details")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "One more" }));
  await waitFor(() => expect(mockStock).toHaveBeenCalledWith(3, { change: 1 }));
  expect(mockChanged).toHaveBeenCalled();
});

test("in mode a scan adds one, held in view counts once, and Undo takes it back", async () => {
  const now = jest.spyOn(Date, "now");
  const screen = await render(<BarcodeScanner />);
  await fireEvent.press(screen.getByRole("button", { name: "In +1" }));
  now.mockReturnValue(10_000);
  await act(async () => mockScan("111"));
  now.mockReturnValue(10_100);
  await act(async () => mockScan("111"));  // the same box, still in front of the camera
  await waitFor(() => expect(screen.getByTestId("scan-counted")).toBeTruthy());
  expect(mockStock).toHaveBeenCalledTimes(1);
  expect(mockStock).toHaveBeenCalledWith(3, { change: 1 });
  expect(screen.getByText("+1")).toBeTruthy();
  now.mockReturnValue(12_000);
  await act(async () => mockScan("111"));  // shown again after it left the view
  await waitFor(() => expect(mockStock).toHaveBeenCalledTimes(2));
  await fireEvent.press(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(mockStock).toHaveBeenLastCalledWith(3, { change: -1 }));
  now.mockRestore();
});

test("out mode takes one away", async () => {
  const screen = await render(<BarcodeScanner />);
  await fireEvent.press(screen.getByRole("button", { name: "Out −1" }));
  await act(async () => mockScan("111"));
  await waitFor(() => expect(mockStock).toHaveBeenCalledWith(3, { change: -1 }));
  expect(await screen.findByText("−1")).toBeTruthy();
});
