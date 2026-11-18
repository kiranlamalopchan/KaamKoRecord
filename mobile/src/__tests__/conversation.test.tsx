import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Conversation } from "@/chat/Conversation";
import { ApiError } from "@/api/client";

// The app's root (app/_layout.tsx) wraps every screen in one; swipe-to-reply needs it.
const Root = ({ children }: { children: React.ReactNode }) => <GestureHandlerRootView style={{ flex: 1 }}>{children}</GestureHandlerRootView>;

const mockSend = jest.fn(), mockChanged = jest.fn(), mockRefetch = jest.fn(), mockReact = jest.fn();
const person = { username: "sam", name: "Sam", initial: "S", hue: 1, photo: null, is_live: false, is_me: false, is_admin: false };
const mockPage = {
  conversation: { id: "c1", kind: "direct", title: "Sam", person, photo: null, initial: "S", hue: 1, pinned: false, muted: false, archived: false, role: "member" },
  messages: [], more: false, more_newer: false, first_unread: null, can_send: true, why_not: "", max_length: 2000, typing: [],
  limits: { photo_max_bytes: 1, photo_batch: 10, video_max_bytes: 1, video_max_seconds: 300, audio_max_seconds: 600, audio_max_bytes: 1, file_max_bytes: 1, file_types: ["pdf"] },
};
jest.mock("@/api", () => ({
  ApiError: jest.requireActual("@/api/client").ApiError,
  chat: { edit: jest.fn(), react: (...a: unknown[]) => mockReact(...a), unsend: jest.fn() },
  convo: { typing: jest.fn(() => Promise.resolve()), page: jest.fn(), hide: jest.fn(), pin: jest.fn(), report: jest.fn(), forward: jest.fn() },
  useConvo: () => ({ data: mockPage, isLoading: false, error: null, refetch: mockRefetch }),
  useChatChanged: () => mockChanged,
  useChatInbox: () => ({ data: { pages: [] } }),
}));
jest.mock("@/chat/send", () => ({
  ...jest.requireActual("@/chat/send"),
  sendOutgoing: (...args: unknown[]) => mockSend(...args),
}));
jest.mock("@/chat/Voice", () => ({ VoiceRecorder: () => null, VoicePlayer: () => null, canRecord: () => false }));
jest.mock("@/chat/Viewer", () => ({ MediaViewer: () => null, saveOrShare: jest.fn() }));
jest.mock("@/chat/drafts", () => ({ loadDraft: jest.fn(() => Promise.resolve("")), saveDraft: jest.fn(() => Promise.resolve()) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
let mockUuid = 0;
jest.mock("expo-crypto", () => ({ randomUUID: () => `00000000-0000-4000-8000-${String(++mockUuid).padStart(12, "0")}` }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }), useFocusEffect: (callback: any) => require("react").useEffect(callback, [callback]) }));
jest.mock("@/ui", () => ({ Screen: ({ children }: any) => children, Avatar: () => null, Empty: () => null, ErrorBanner: () => null }));
jest.mock("@/ui/depth", () => ({ WithDepth: ({ children }: any) => children({ scroll: {}, padTop: 0 }) }));
jest.mock("@/ui/layout", () => ({ useLayout: () => ({ column: {}, insets: { bottom: 0 } }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/ui/haptics", () => ({ fail: jest.fn(), tap: jest.fn() }));

const sent = (body: string, clientId: string, id = 1) => ({
  id, client_id: clientId, conversation_id: "c1", body, mine: true, at: "2026-11-18T00:00:00Z", day: "Wed 18 Nov", time: "9:30 am",
  read: false, status: "sent", sender: person, attachments: [], forwarded: false, event: null, pinned: false, reactions: [], reply: null,
});

beforeEach(() => { jest.clearAllMocks(); });

test("a message shows at once and the box clears; the server's copy replaces it", async () => {
  mockSend.mockImplementation(async (o: any) => sent(o.body, o.clientId));
  const view = await render(<Conversation id="c1" />, { wrapper: Root });
  await fireEvent.changeText(view.getByTestId("chat-input"), "Cover Saturday?");
  await fireEvent.press(view.getByTestId("chat-send"));
  expect(view.getByTestId("chat-input").props.value).toBe("");
  await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
  const outgoing = mockSend.mock.calls[0][0];
  expect(outgoing).toMatchObject({ conversationId: "c1", body: "Cover Saturday?", kind: "text" });
  expect(outgoing.clientId).toMatch(/^[0-9a-f-]{36}$/);
  await waitFor(() => expect(view.getByText("Cover Saturday?")).toBeTruthy());
});

test("a failed send stays with Retry, shows guidance not technical details, and retries with the same client id", async () => {
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  mockSend.mockRejectedValueOnce(new TypeError("InternalSession.swift:88"));
  const view = await render(<Conversation id="c1" />, { wrapper: Root });
  await fireEvent.changeText(view.getByTestId("chat-input"), "Hi Sam");
  await fireEvent.press(view.getByTestId("chat-send"));
  await waitFor(() => expect(view.getByTestId("chat-retry")).toBeTruthy());
  expect(view.queryByText(/InternalSession/)).toBeNull();
  expect(view.getByText("Hi Sam")).toBeTruthy();
  const first = mockSend.mock.calls[0][0].clientId;
  mockSend.mockImplementationOnce(async (o: any) => sent(o.body, o.clientId));
  await act(async () => { fireEvent.press(view.getByTestId("chat-retry")); });
  await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(2));
  expect(mockSend.mock.calls[1][0].clientId).toBe(first);
  await waitFor(() => expect(view.queryByTestId("chat-retry")).toBeNull());
  warn.mockRestore();
});

test("a dropped connection is retried once quietly with the same client id", async () => {
  mockSend
    .mockRejectedValueOnce(new ApiError(0, "offline"))
    .mockImplementationOnce(async (o: any) => sent(o.body, o.clientId));
  const view = await render(<Conversation id="c1" />, { wrapper: Root });
  await fireEvent.changeText(view.getByTestId("chat-input"), "Once only");
  await fireEvent.press(view.getByTestId("chat-send"));
  await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(2), { timeout: 3000 });
  expect(mockSend.mock.calls[0][0].clientId).toBe(mockSend.mock.calls[1][0].clientId);
  await waitFor(() => expect(view.queryByTestId("chat-retry")).toBeNull());
});

test("messages typed quickly go one at a time, in order, each with its own id", async () => {
  const order: string[] = [];
  let release!: () => void;
  mockSend.mockImplementation((o: any) => {
    order.push(o.body);
    if (o.body === "one") return new Promise(resolve => { release = () => resolve(sent(o.body, o.clientId, 1)); });
    return Promise.resolve(sent(o.body, o.clientId, 2));
  });
  const view = await render(<Conversation id="c1" />, { wrapper: Root });
  await fireEvent.changeText(view.getByTestId("chat-input"), "one");
  await fireEvent.press(view.getByTestId("chat-send"));
  await fireEvent.changeText(view.getByTestId("chat-input"), "two");
  await fireEvent.press(view.getByTestId("chat-send"));
  await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
  await act(async () => { release(); });
  await waitFor(() => expect(order).toEqual(["one", "two"]));
  expect(mockSend.mock.calls[0][0].clientId).not.toBe(mockSend.mock.calls[1][0].clientId);
});

test("somebody who can't send here is told why instead of getting a box", async () => {
  const saved = { ...mockPage };
  Object.assign(mockPage, { can_send: false, why_not: "You can only message your friends." });
  const view = await render(<Conversation id="c1" />, { wrapper: Root });
  expect(view.getByText("You can only message your friends.")).toBeTruthy();
  expect(view.queryByTestId("chat-input")).toBeNull();
  Object.assign(mockPage, saved);
});

test("holding a photo opens the reactions, and a reaction shows at once", async () => {
  jest.useFakeTimers();
  const photo = { id: "a1", kind: "photo", url: "https://x/p.jpg", thumb: "https://x/t.jpg", download: "", name: "", content_type: "image/jpeg", size: 1, duration: null, width: 400, height: 300, quality: "standard", waveform: [] };
  const saved = mockPage.messages;
  (mockPage as any).messages = [{ ...sent("", "c-1", 7), mine: false, sender: person, attachments: [photo], reactions: [], my_reaction: null }];
  // The server hasn't answered yet: the reaction must already be showing.
  mockReact.mockImplementation(() => new Promise(() => {}));
  const view = await render(<Conversation id="c1" />, { wrapper: Root });
  await act(async () => { fireEvent(view.getByLabelText("Photo. Open full screen."), "longPress"); });
  await act(async () => { jest.advanceTimersByTime(200); });
  expect(view.getByTestId("react-❤️")).toBeTruthy();
  expect(view.getByText("Reply")).toBeTruthy();
  await act(async () => { fireEvent.press(view.getByTestId("react-❤️")); });
  await act(async () => { jest.advanceTimersByTime(200); });
  expect(mockReact).toHaveBeenCalledWith(7, "❤️");
  expect(view.queryByTestId("react-❤️")).toBeNull();
  expect(view.getByText("❤️")).toBeTruthy();
  (mockPage as any).messages = saved;
  jest.useRealTimers();
});

test("swiping someone's message to the right opens a reply to it; a short swipe does nothing", async () => {
  const { fireGestureHandler, getByGestureTestId } = require("react-native-gesture-handler/jest-utils");
  const { State } = require("react-native-gesture-handler");
  const saved = mockPage.messages;
  (mockPage as any).messages = [{ ...sent("Can you swap Saturday?", "c-2", 9), mine: false, sender: person, reactions: [], my_reaction: null }];
  const view = await render(<Conversation id="c1" />, { wrapper: Root });
  const swipe = (x: number) => fireGestureHandler(getByGestureTestId("swipe-reply-9"), [
    { state: State.BEGAN, translationX: 0 },
    { state: State.ACTIVE, translationX: x / 2 },
    { state: State.ACTIVE, translationX: x },
    { state: State.END, translationX: x },
  ]);
  await act(async () => { swipe(30); });
  expect(view.queryByText("Replying to Sam")).toBeNull();
  await act(async () => { swipe(90); });
  expect(view.getByText("Replying to Sam")).toBeTruthy();
  (mockPage as any).messages = saved;
});
