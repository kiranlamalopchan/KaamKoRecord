import { setLang } from "@/i18n";
import { setToken } from "@/auth/token";
import { QueryClient } from "@tanstack/react-query";
import { onWatchClockChanged, startClockSync, startWatchSync } from "@/watch/link";

const mockSend = jest.fn((_token: string, _server: string, _lang: string) => true);
const mockSendClock = jest.fn((_json: string) => true);
const mockListeners: (() => void)[] = [];
jest.mock("../../modules/watch-link", () => ({
  WatchLink: {
    send: (token: string, server: string, lang: string) => mockSend(token, server, lang),
    sendClock: (json: string) => mockSendClock(json),
    addListener: (_event: string, fn: () => void) => { mockListeners.push(fn); return { remove: () => mockListeners.splice(mockListeners.indexOf(fn), 1) }; },
  },
}));
jest.mock("expo-secure-store", () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => {}), deleteItemAsync: jest.fn(async () => {}) }));
jest.mock("@/api/server", () => ({ serverUrl: () => "https://kaamkorecord.com" }));

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("the watch is signed in, follows the language, and is signed out with the phone", async () => {
  const stop = startWatchSync();
  await settle();
  // Nobody signed in yet: the watch is told so, and is given no server.
  expect(mockSend).toHaveBeenLastCalledWith("", "", "en");

  await setToken("abc123");
  await settle();
  expect(mockSend).toHaveBeenLastCalledWith("abc123", "https://kaamkorecord.com", "en");

  setLang("ne");
  await settle();
  expect(mockSend).toHaveBeenLastCalledWith("abc123", "https://kaamkorecord.com", "ne");

  // Nothing changed: nothing is sent again.
  const calls = mockSend.mock.calls.length;
  await setToken("abc123");
  await settle();
  expect(mockSend.mock.calls.length).toBe(calls);

  await setToken(null);
  await settle();
  expect(mockSend).toHaveBeenLastCalledWith("", "", "ne");
  stop();
  setLang("en");
});

test("a tap on the watch tells the phone to refresh its clock", () => {
  const refresh = jest.fn();
  const off = onWatchClockChanged(refresh);
  mockListeners.forEach((fn) => fn());
  expect(refresh).toHaveBeenCalledTimes(1);
  off();
  expect(mockListeners).toHaveLength(0);
});

test("the watch face is handed each new clock, and not the same one twice", () => {
  const client = new QueryClient();
  const stop = startClockSync(client);
  const clock = (status: string | null, at = "2026-11-19T10:00:00Z") => ({
    server_now: at, today: "", workplaces: [{ id: 1, name: "Shop" }], selected: 1,
    shift: status ? { status, clock_in: "2026-11-19T08:00:00Z", banked_break_seconds: 0, running_break: null, workplace: { id: 1, name: "Shop" } } : null,
    limit: null, week: { worked: { seconds: 7200 } },
  });
  client.setQueryData(["clock", null], clock("WORKING"));
  expect(mockSendClock).toHaveBeenCalledTimes(1);
  expect(JSON.parse(mockSendClock.mock.calls[0][0]).shift.status).toBe("WORKING");
  // A refresh with nothing new for the face is not sent again.
  client.setQueryData(["clock", null], clock("WORKING", "2026-11-19T10:00:10Z"));
  expect(mockSendClock).toHaveBeenCalledTimes(1);
  client.setQueryData(["clock", null], clock(null));
  expect(mockSendClock).toHaveBeenCalledTimes(2);
  // Other queries are none of the watch's business.
  client.setQueryData(["timesheet", null], { pages: [] });
  expect(mockSendClock).toHaveBeenCalledTimes(2);
  stop();
  client.setQueryData(["clock", null], clock("ON_BREAK"));
  expect(mockSendClock).toHaveBeenCalledTimes(2);
});
