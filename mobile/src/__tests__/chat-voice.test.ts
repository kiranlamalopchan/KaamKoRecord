import { bars, canRecord } from "@/chat/Voice";

jest.mock("@/ui/native", () => ({ nativeOrNull: () => null, native: () => null }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

test("a long recording's loudness is drawn as at most n bars, keeping the peaks", () => {
  const samples = Array.from({ length: 600 }, (_, i) => (i === 300 ? 100 : 10));
  const drawn = bars(samples, 48);
  expect(drawn).toHaveLength(48);
  expect(Math.max(...drawn)).toBe(100);
  expect(bars([5, 6], 48)).toEqual([5, 6]);
});

test("a build without the audio module offers no microphone", () => {
  expect(canRecord()).toBe(false);
});
