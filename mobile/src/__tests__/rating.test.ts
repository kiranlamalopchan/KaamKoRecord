/** The store's rating popup: after 5 opens and 3 days, once a version, 4 months apart. */
const mockReview = { available: true, action: true, shown: 0 };
jest.mock("expo-store-review", () => ({
  isAvailableAsync: jest.fn(async () => mockReview.available),
  hasAction: jest.fn(async () => mockReview.action),
  requestReview: jest.fn(async () => { mockReview.shown += 1; }),
}));
let mockVersion = "1.4.5";
const mockConstants = { appOwnership: null as string | null, executionEnvironment: "standalone" };
jest.mock("expo-constants", () => ({ __esModule: true, default: {
  get appOwnership() { return mockConstants.appOwnership; },
  get executionEnvironment() { return mockConstants.executionEnvironment; },
} }));
jest.mock("@/ui/Version", () => ({ appVersion: () => ({ version: mockVersion, build: "27" }) }));

import AsyncStorage from "@react-native-async-storage/async-storage";
import { askAtGoodMoment, MOMENT_SETTLE_MS, askIfDue as askWith, countOpen, DAYS_BETWEEN_ASKS, DEV_RULES, due as dueWith, loadRating, STORE_RULES } from "@/review/rating";

// The store build's rules; a development build has its own (below).
const askIfDue = (now: number) => askWith(now, STORE_RULES);
const due = (state: Parameters<typeof dueWith>[0], version: string, now: number) => dueWith(state, version, now, STORE_RULES);

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 10, 1);

async function opens(n: number, at = T0) {
  for (let i = 0; i < n; i++) await countOpen(at);
}

beforeEach(async () => {
  await AsyncStorage.clear();
  Object.assign(mockReview, { available: true, action: true, shown: 0 });
  mockVersion = "1.4.5";
  Object.assign(mockConstants, { appOwnership: null, executionEnvironment: "standalone" });
});

test("counts opens from the first one", async () => {
  await opens(3);
  expect(await loadRating()).toEqual({ first: T0, opens: 3, asked: null, askedVersion: null });
});

test("not before the 5th open", async () => {
  await opens(4);
  expect(await askIfDue(T0 + 10 * DAY)).toBe(false);
  await opens(1);
  expect(await askIfDue(T0 + 10 * DAY)).toBe(true);
  expect(mockReview.shown).toBe(1);
});

test("not in the first 3 days, however often it is opened", async () => {
  await opens(20);
  expect(await askIfDue(T0 + 2 * DAY)).toBe(false);
  expect(await askIfDue(T0 + 3 * DAY)).toBe(true);
});

test("once per version, 3 months apart", async () => {
  await opens(5);
  const asked = T0 + 5 * DAY;
  expect(await askIfDue(asked)).toBe(true);
  expect(await askIfDue(asked + 200 * DAY)).toBe(false); // same version
  mockVersion = "1.4.6";
  expect(await askIfDue(asked + 30 * DAY)).toBe(false); // too soon
  expect(await askIfDue(asked + DAYS_BETWEEN_ASKS * DAY)).toBe(true);
  expect(mockReview.shown).toBe(2);
});

test("nothing when the store can't show it, and it is not marked asked", async () => {
  await opens(5);
  mockReview.available = false;
  expect(await askIfDue(T0 + 5 * DAY)).toBe(false);
  expect((await loadRating())?.asked).toBeNull();
});

test("due() rules on their own", () => {
  const state = { first: T0, opens: 5, asked: null, askedVersion: null };
  expect(due(state, "1.4.5", T0 + 3 * DAY)).toBe(true);
  expect(due({ ...state, opens: 4 }, "1.4.5", T0 + 9 * DAY)).toBe(false);
});

test("never in Expo Go, where it would ask for a rating of Expo Go", async () => {
  await opens(5);
  Object.assign(mockConstants, { appOwnership: "expo", executionEnvironment: "storeClient" });
  expect(await askIfDue(T0 + 5 * DAY)).toBe(false);
  expect(mockReview.shown).toBe(0);
});

test("a development build skips the waiting days, still after 5 opens and once per version", async () => {
  await opens(4);
  expect(await askWith(T0, DEV_RULES)).toBe(false);
  await opens(1);
  expect(await askWith(T0 + 1000, DEV_RULES)).toBe(true);
  expect(await askWith(T0 + 2000, DEV_RULES)).toBe(false);
  expect(mockReview.shown).toBe(1);
});

test("never more than three times in all, however many versions and months", async () => {
  await opens(5);
  let at = T0 + 5 * DAY;
  expect(await askIfDue(at)).toBe(true);
  for (const version of ["1.5.0", "1.6.0"]) {
    mockVersion = version; at += DAYS_BETWEEN_ASKS * DAY;
    expect(await askIfDue(at)).toBe(true);
  }
  mockVersion = "1.7.0"; at += 3 * DAYS_BETWEEN_ASKS * DAY;
  expect(await askIfDue(at)).toBe(false);
  expect(mockReview.shown).toBe(3);
  expect((await loadRating())?.asks).toBe(3);
});

test("3 months at least between asks, even on a new version", async () => {
  await opens(5);
  const at = T0 + 5 * DAY;
  expect(await askIfDue(at)).toBe(true);
  mockVersion = "1.5.0";
  expect(await askIfDue(at + 60 * DAY)).toBe(false);
  expect(await askIfDue(at + 90 * DAY)).toBe(true);
});

test("what an earlier version saved (no count) counts as one ask", async () => {
  await AsyncStorage.setItem("mywork.rating", JSON.stringify({ first: T0, opens: 9, asked: T0, askedVersion: "1.4.4" }));
  expect(await askIfDue(T0 + 100 * DAY)).toBe(true);
  expect((await loadRating())?.asks).toBe(2);
});

describe("a good moment asks too, under the same rules", () => {
  beforeEach(() => jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] }));
  afterEach(() => jest.useRealTimers());
  const settle = async () => { jest.advanceTimersByTime(MOMENT_SETTLE_MS); for (let i = 0; i < 20; i++) await new Promise<void>((r) => setImmediate(() => r())); };

  it("asks once the result has been seen, when it is due", async () => {
    jest.setSystemTime(T0);
    await opens(5, T0 - 10 * DAY);
    askAtGoodMoment();
    expect(mockReview.shown).toBe(0);
    await settle();
    expect(mockReview.shown).toBe(1);
  });

  it("never sooner than opening would: not before 5 opens", async () => {
    jest.setSystemTime(T0);
    await opens(2, T0 - 10 * DAY);
    askAtGoodMoment();
    await settle();
    expect(mockReview.shown).toBe(0);
  });
});
