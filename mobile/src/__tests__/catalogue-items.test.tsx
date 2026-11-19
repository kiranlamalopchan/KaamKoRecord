import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import NewCatalogue from "../../app/items/new";
import ItemScreen from "../../app/items/item";

const mockPush = jest.fn(), mockReplace = jest.fn(), mockBack = jest.fn(), mockChanged = jest.fn();
const mockCreate = jest.fn(), mockAdd = jest.fn(), mockUpdate = jest.fn(), mockLookup = jest.fn(), mockStock = jest.fn();
let mockTrack = false;
let mockParams: Record<string, string> = {};
const mockDetails = { id: 9, name: "Shop", count: 0, headers: ["Name", "Barcode", "Price"], search_columns: ["Name", "Barcode", "Price"], title_column: "Name", code_column: "Barcode", description_column: "" };

jest.mock("expo-router", () => ({ useLocalSearchParams: () => mockParams, useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack }) }));
jest.mock("@/auth/session", () => ({ useSession: () => ({ me: { username: "owner" } }) }));
jest.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: undefined }) }));
jest.mock("@/api/catalogue", () => ({
  catalogue: { create: (...a: unknown[]) => mockCreate(...a), addItem: (...a: unknown[]) => mockAdd(...a), updateItem: (...a: unknown[]) => mockUpdate(...a), stock: (...a: unknown[]) => mockStock(...a) },
  lookUpBarcode: (...a: unknown[]) => mockLookup(...a),
  useCatalogueChanged: () => mockChanged,
  useCatalogueDetails: () => ({ data: { ...mockDetails, track_stock: mockTrack } }),
}));
jest.mock("@/ui/ScanCode", () => ({ ScanCode: ({ visible, onCode }: any) => {
  const { Pressable, Text } = require("react-native");
  return visible ? <Pressable accessibilityRole="button" accessibilityLabel="Fake scan" onPress={() => onCode("9300633603501")}><Text>camera</Text></Pressable> : null;
} }));
jest.mock("@/ui/Skeleton", () => ({ SkeletonRows: () => null }));
jest.mock("@/ui/haptics", () => ({ tick: jest.fn(), success: jest.fn() }));
jest.mock("@/ui/index", () => {
  const { View, Text, TextInput, Pressable } = require("react-native");
  const Wrapper = ({ children }: any) => <View>{children}</View>;
  return { Screen: Wrapper, Page: Wrapper, Card: Wrapper, ErrorBanner: () => null,
    Field: ({ label, help, children }: any) => <View><Text>{label}</Text>{children}{help ? <Text>{help}</Text> : null}</View>,
    PageTitle: ({ children }: any) => <Text>{children}</Text>,
    Input: (props: any) => <TextInput {...props} />,
    Button: ({ title, onPress, disabled }: any) => <Pressable accessibilityRole="button" accessibilityLabel={title} disabled={disabled} onPress={onPress}><Text>{title}</Text></Pressable>,
  };
});
beforeEach(() => { jest.clearAllMocks(); mockParams = {}; mockTrack = false; mockLookup.mockResolvedValue({ exact: [], others: [], count: 0 }); });

test("creates a catalogue with a name column, a barcode column and the person's own columns", async () => {
  mockCreate.mockResolvedValue({ ...mockDetails, id: 12 });
  const screen = await render(<NewCatalogue />);
  await fireEvent.changeText(screen.getByLabelText("Catalogue name"), "Shop stock");
  await fireEvent.press(screen.getByRole("button", { name: "Add column" }));
  await fireEvent.changeText(screen.getByLabelText("Column 4"), "Shelf");
  await fireEvent.press(screen.getByRole("button", { name: "Create catalogue" }));
  await waitFor(() => expect(mockCreate).toHaveBeenCalledWith({ name: "Shop stock", headers: ["Name", "Barcode", "Price", "Shelf"], title_column: "Name", code_column: "Barcode", track_stock: false }));
  expect(mockReplace).toHaveBeenCalledWith("/items/table/12");
});

test("two columns with the same name cannot be created", async () => {
  const screen = await render(<NewCatalogue />);
  await fireEvent.changeText(screen.getByLabelText("Catalogue name"), "Shop");
  await fireEvent.changeText(screen.getByLabelText("Column 3"), "barcode");
  expect(screen.getByText("Give each column a different name.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Create catalogue" })).toBeDisabled();
});

test("a scanned barcode fills the item and is saved with the other columns", async () => {
  mockParams = { catalogue: "9" };
  mockAdd.mockResolvedValue({ id: 1, title: "Milk" });
  const screen = await render(<ItemScreen />);
  await fireEvent.changeText(screen.getByLabelText("Name"), "Milk");
  await fireEvent.changeText(screen.getByLabelText("Price"), "3.10");
  await fireEvent.press(screen.getByRole("button", { name: "Scan barcode" }));
  await fireEvent.press(screen.getByRole("button", { name: "Fake scan" }));
  expect(screen.getByLabelText("Barcode")).toHaveProp("value", "9300633603501");
  await waitFor(() => expect(mockLookup).toHaveBeenCalledWith("9300633603501", 9));
  await fireEvent.press(screen.getByRole("button", { name: "Save item" }));
  await waitFor(() => expect(mockAdd).toHaveBeenCalledWith(9, { Name: "Milk", Barcode: "9300633603501", Price: "3.10" }));
  expect(mockBack).toHaveBeenCalled();
});

test("a barcode that belongs to another item is pointed out and blocks saving", async () => {
  mockParams = { catalogue: "9", code: "123" };
  mockLookup.mockResolvedValue({ exact: [{ id: 4, title: "Tea", code: "123" }], others: [], count: 1 });
  const screen = await render(<ItemScreen />);
  await waitFor(() => expect(screen.getByText("Tea already has this code. Tap to open it.")).toBeTruthy());
  await fireEvent.changeText(screen.getByLabelText("Name"), "Coffee");
  expect(screen.getByRole("button", { name: "Save item" })).toBeDisabled();
  await fireEvent.press(screen.getByText("Tea already has this code. Tap to open it."));
  expect(mockReplace).toHaveBeenCalledWith("/items/item?catalogue=9&id=4");
});

test("in a catalogue that counts stock, the item's stock is set with the steppers", async () => {
  mockParams = { catalogue: "9" };
  mockTrack = true;
  mockAdd.mockResolvedValue({ id: 7, title: "Milk", stock: 0 });
  const screen = await render(<ItemScreen />);
  await fireEvent.changeText(screen.getByLabelText("Name"), "Milk");
  await fireEvent.changeText(screen.getByLabelText("Stock"), "10");
  await fireEvent.press(screen.getByRole("button", { name: "One more" }));
  expect(screen.getByLabelText("Stock")).toHaveProp("value", "11");
  await fireEvent.changeText(screen.getByLabelText("Stock"), "-");
  expect(screen.getByRole("button", { name: "Save item" })).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText("Stock"), "11");
  await fireEvent.press(screen.getByRole("button", { name: "Save item" }));
  await waitFor(() => expect(mockStock).toHaveBeenCalledWith(7, { count: 11 }));
});
