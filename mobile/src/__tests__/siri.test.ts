/** "Hey Siri, voice search in KaamKoRecord": Siri's note in UserDefaults opens Items, listening — once. */
import { DeviceEventEmitter, Platform, Settings } from "react-native";
import { act, renderHook } from "@testing-library/react-native";

import { SIRI_VOICE_KEY, takeSiriVoiceSearch, useSiriVoiceSearch } from "@/ui/siri";

// The native side of React Native's Settings (UserDefaults on iOS).
const mockDefaults: Record<string, unknown> = {};
jest.mock("react-native/Libraries/Settings/NativeSettingsManager", () => ({
  __esModule: true,
  default: { getConstants: () => ({ settings: mockDefaults }), setValues: (v: object) => Object.assign(mockDefaults, v), deleteValues: jest.fn() },
}));

/** Siri writing the note, as UserDefaults reports it to the app. */
const siriAsks = (at = Date.now() / 1000) => DeviceEventEmitter.emit("settingsUpdated", { [SIRI_VOICE_KEY]: at });

const original = Platform.OS;
beforeEach(() => { Object.defineProperty(Platform, "OS", { value: "ios" }); Settings.set({ [SIRI_VOICE_KEY]: 0 }); });
afterAll(() => Object.defineProperty(Platform, "OS", { value: original }));

const now = 1_800_000_000;

test("a fresh note is taken once; an old one, or none, is not followed", () => {
  siriAsks(now - 5);
  expect(takeSiriVoiceSearch(now)).toBe(true);
  expect(Settings.get(SIRI_VOICE_KEY)).toBe(0);
  expect(takeSiriVoiceSearch(now)).toBe(false);
  siriAsks(now - 600);
  expect(takeSiriVoiceSearch(now)).toBe(false);
  expect(Settings.get(SIRI_VOICE_KEY)).toBe(0);
});

test("waits until someone is looking at the app, then opens voice search; and again when Siri asks while it is open", async () => {
  const open = jest.fn();
  siriAsks();
  const view = await renderHook((props: { active: boolean }) => useSiriVoiceSearch(props.active, open), { initialProps: { active: false } });
  expect(open).not.toHaveBeenCalled();
  await view.rerender({ active: true });
  expect(open).toHaveBeenCalledTimes(1);
  await act(async () => { siriAsks(); });
  expect(open).toHaveBeenCalledTimes(2);
  await view.unmount();
});

test("Android has no Siri: nothing is read", () => {
  siriAsks();
  Object.defineProperty(Platform, "OS", { value: "android" });
  expect(takeSiriVoiceSearch()).toBe(false);
  Object.defineProperty(Platform, "OS", { value: "ios" });
  expect(Settings.get(SIRI_VOICE_KEY)).not.toBe(0);
});
