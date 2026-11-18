import React from "react";
import { render, waitFor } from "@testing-library/react-native";
import MessagePerson from "../../app/messages/[username]";

const mockReplace = jest.fn(), mockOpen = jest.fn();
jest.mock("@/api", () => ({ convo: { openDirect: (...a: unknown[]) => mockOpen(...a) } }));
jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ username: "sam" }), useRouter: () => ({ replace: mockReplace }) }));
jest.mock("@/ui", () => ({ Screen: ({ children }: any) => children, Page: ({ children }: any) => children, ErrorBanner: () => null }));

test("messaging a friend opens the one conversation with them, by its id", async () => {
  mockOpen.mockResolvedValue({ id: "c-123" });
  await render(<MessagePerson />);
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/messages/c/c-123"));
  expect(mockOpen).toHaveBeenCalledWith("sam");
});
