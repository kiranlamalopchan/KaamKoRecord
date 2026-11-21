/** Searching items by voice: what is said becomes the search, codes as digits, problems in words. */
import { act, renderHook } from "@testing-library/react-native";

import { setLang } from "@/i18n";
import { spokenMatch, spokenToQuery, useVoiceSearch, voiceProblem } from "@/ui/voice";

type Listener = (event: any) => void;
const mockListeners: Record<string, Listener[]> = {};
const mockSpeech = {
  granted: true,
  available: true,
  started: [] as any[],
  stopped: 0,
};
jest.mock("expo-speech-recognition", () => ({
  ExpoSpeechRecognitionModule: {
    isRecognitionAvailable: () => mockSpeech.available,
    requestPermissionsAsync: async () => ({ granted: mockSpeech.granted }),
    start: (options: any) => { mockSpeech.started.push(options); },
    stop: () => { mockSpeech.stopped += 1; },
    abort: () => {},
    addListener: (name: string, fn: Listener) => {
      (mockListeners[name] ||= []).push(fn);
      return { remove: () => { mockListeners[name] = mockListeners[name].filter((f) => f !== fn); } };
    },
  },
}));
jest.mock("@/ui/native", () => ({ ...jest.requireActual("@/ui/native"), inExpoGo: () => false }));
jest.mock("@/api/errors", () => ({ logError: jest.fn() }));
let mockHasNative = true;
jest.mock("expo", () => ({ ...jest.requireActual("expo"), requireOptionalNativeModule: (name: string) => (name === "ExpoSpeechRecognition" && mockHasNative ? {} : null) }));

const fire = (name: string, event: any = {}) => act(async () => { (mockListeners[name] || []).forEach((fn) => fn(event)); });

beforeEach(() => {
  Object.assign(mockSpeech, { granted: true, available: true, started: [], stopped: 0 });
  mockHasNative = true;
  setLang("en");
});
afterAll(() => setLang("en"));

describe("what is said becomes the search", () => {
  it.each([
    ["four zero one one", "4011"],
    ["Four oh one one.", "4011"],
    ["40 11", "4011"],
    ["double four one", "441"],
    ["चार शून्य एक एक", "4011"],
    ["४०११", "4011"],
    ["Banana cavendish.", "Banana cavendish"],
    ["red apple", "red apple"],
    ["   ", ""],
  ])("%s → %s", (said, query) => expect(spokenToQuery(said)).toBe(query));
});

test("problems are words, never codes; stopping it yourself is no problem", () => {
  expect(voiceProblem("aborted")).toBeNull();
  expect(voiceProblem("not-allowed")).toMatch(/allow the microphone/);
  expect(voiceProblem("no-speech")).toMatch(/didn't catch that/);
  expect(voiceProblem("network")).toMatch(/couldn't connect/);
  expect(voiceProblem("something-new")).toMatch(/type instead/);
  for (const code of ["not-allowed", "no-speech", "speech-timeout", "too-many-requests", "audio-capture"]) expect(voiceProblem(code)).not.toMatch(code);
});

test("tap, speak: the box fills as it hears, and the final words search", async () => {
  const heard: [string, boolean][] = [];
  const { result } = await renderHook(() => useVoiceSearch((q, final) => heard.push([q, final]), ["Banana cavendish"]));
  expect(result.current.available).toBe(true);
  await act(async () => { await result.current.start(); });
  expect(mockSpeech.started[0]).toMatchObject({ interimResults: true, continuous: false, contextualStrings: ["Banana cavendish"] });
  expect(mockSpeech.started[0].lang).toBeUndefined();
  await fire("start");
  expect(result.current.listening).toBe(true);
  await fire("result", { isFinal: false, results: [{ transcript: "four zero" }] });
  await fire("result", { isFinal: true, results: [{ transcript: "four zero one one" }] });
  await fire("end");
  expect(heard).toEqual([["40", false], ["4011", true]]);
  expect(result.current.listening).toBe(false);
  expect(result.current.problem).toBeNull();
});

test("tap again to stop", async () => {
  const { result } = await renderHook(() => useVoiceSearch(() => {}));
  await act(async () => { await result.current.start(); });
  await fire("start");
  await act(async () => result.current.stop());
  expect(mockSpeech.stopped).toBe(1);
});

test("no permission: nothing starts, and it says how to allow it", async () => {
  mockSpeech.granted = false;
  const { result } = await renderHook(() => useVoiceSearch(() => {}));
  await act(async () => { await result.current.start(); });
  expect(mockSpeech.started).toHaveLength(0);
  expect(result.current.problem).toMatch(/allow the microphone/);
});

test("nothing heard: a plain sentence, and listening stops", async () => {
  const { result } = await renderHook(() => useVoiceSearch(() => {}));
  await act(async () => { await result.current.start(); });
  await fire("start");
  await fire("error", { error: "no-speech", message: "No speech" });
  expect(result.current.listening).toBe(false);
  expect(result.current.problem).toMatch(/didn't catch that/);
});

test("in Nepali it listens in Nepali, and falls back to the phone's language when Nepali isn't there", async () => {
  setLang("ne");
  const { result } = await renderHook(() => useVoiceSearch(() => {}));
  await act(async () => { await result.current.start(); });
  expect(mockSpeech.started[0].lang).toBe("ne-NP");
  await fire("error", { error: "language-not-supported", message: "" });
  expect(mockSpeech.started).toHaveLength(2);
  expect(mockSpeech.started[1].lang).toBeUndefined();
  expect(result.current.problem).toBeNull();
});

test("no recogniser on this phone: no mic is offered", async () => {
  mockSpeech.available = false;
  const { result } = await renderHook(() => useVoiceSearch(() => {}));
  expect(result.current.available).toBe(false);
});

describe("after a spoken search, the item it clearly meant opens by itself", () => {
  const rumpSteak = { id: 1, code: "2201", title: "Beef Rump Steak", description: "" };
  const rump = { id: 2, code: "2202", title: "Beef Rump", description: "" };
  const roast = { id: 3, code: "2203", title: "Beef Rump Roast", description: "" };
  const banana = { id: 4, code: "4011", title: "Bananas", description: "Banana Cavendish" };

  it("the item with exactly that name, among near matches", () => {
    expect(spokenMatch("beef rump", [rumpSteak, rump, roast], 3)).toBe(rump);
    expect(spokenMatch("Beef rump.", [rumpSteak, rump, roast], 3)).toBe(rump);
  });
  it("the item with exactly that code", () => expect(spokenMatch("2203", [rumpSteak, rump, roast], 3)).toBe(roast));
  it("a description counts as a name", () => expect(spokenMatch("banana cavendish", [banana, rump], 2)).toBe(banana));
  it("the only result there is", () => expect(spokenMatch("cavendish", [banana], 1)).toBe(banana));
  it("several near matches are left to the person", () => {
    expect(spokenMatch("rump", [rumpSteak, rump, roast], 3)).toBeNull();
    expect(spokenMatch("beef", [rumpSteak, roast], 2)).toBeNull();
  });
  it("only one on this page but more on the next is not 'the only one'", () => expect(spokenMatch("beef", [rumpSteak], 12)).toBeNull());
  it("nothing found, nothing opens", () => expect(spokenMatch("lamb", [], 0)).toBeNull());
});

test("a build without voice search's native side offers no mic, and never loads the package", async () => {
  mockHasNative = false;
  const { result } = await renderHook(() => useVoiceSearch(() => {}));
  expect(result.current.available).toBe(false);
  await act(async () => { await result.current.start(); });
  expect(mockSpeech.started).toHaveLength(0);
});
