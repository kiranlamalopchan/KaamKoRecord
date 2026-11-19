import { setViewing } from "@/chat/realtime";

jest.mock("@/api", () => ({ chat: {}, convo: {} }));
jest.mock("@/api/server", () => ({ serverUrl: () => "http://localhost" }));
jest.mock("@/auth/session", () => ({ useSession: () => ({ me: null }) }));

test("leaving a conversation stops the refresh, and nothing is sent without a stream", () => {
  jest.useFakeTimers();
  const timers = () => jest.getTimerCount();
  setViewing("c1");
  expect(timers()).toBe(1);
  setViewing("c1");          // the same one again: no second timer
  expect(timers()).toBe(1);
  setViewing(null);
  expect(timers()).toBe(0);
  jest.useRealTimers();
});
