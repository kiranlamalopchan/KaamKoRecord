import { api } from "@/api/client";
import { sendOutgoing, uploadResumable, formatBytes, formatDuration, type Outgoing } from "@/chat/send";
import { targetFor } from "@/nav/paths";

jest.mock("@/api/client", () => ({
  api: jest.fn(),
  formWith: jest.fn((fields: Record<string, unknown>) => {
    const appended: [string, unknown][] = Object.entries(fields).filter(([, v]) => v !== undefined && v !== null && v !== "");
    return { appended, append: (k: string, v: unknown) => appended.push([k, v]) };
  }),
}));
const mockSize = jest.fn();
jest.mock("@/api/chunked", () => ({ sizeOf: (...a: unknown[]) => mockSize(...a) }));
const mockRead = jest.fn(async () => "AAAA");
jest.mock("expo-file-system/legacy", () => ({ readAsStringAsync: (...a: unknown[]) => (mockRead as any)(...a), EncodingType: { Base64: "base64" } }), { virtual: true });
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("@/nav/stores", () => ({ openAppStore: jest.fn() }));

const base: Outgoing = {
  key: -1, clientId: "11111111-1111-4111-8111-111111111111", conversationId: "c1", body: "", kind: "text", files: [],
  quality: "standard", state: "pending", progress: 0, createdAt: "2026-11-18T00:00:00Z",
};

beforeEach(() => { jest.clearAllMocks(); });

test("text goes to the conversation with its client id and reply", async () => {
  jest.mocked(api).mockResolvedValue({ id: 5 } as never);
  await sendOutgoing({ ...base, body: "Hi", replyTo: 3 }, jest.fn(), jest.fn());
  expect(api).toHaveBeenCalledWith("messages/c/c1/", { method: "POST", body: { body: "Hi", client_id: base.clientId, reply_to: 3, quality: "standard" } });
});

test("several photos go in one request, all under 'photos', with the chosen quality", async () => {
  jest.mocked(api).mockResolvedValue({ id: 5 } as never);
  const files = [1, 2, 3].map(n => ({ uri: `file:///p${n}.jpg`, name: `p${n}.jpg`, type: "image/jpeg" }));
  await sendOutgoing({ ...base, kind: "photos", files, quality: "hd" }, jest.fn(), jest.fn());
  const form = (jest.mocked(api).mock.calls[0][1] as any).form;
  expect(form.appended.filter(([k]: [string]) => k === "photos")).toHaveLength(3);
  expect(form.appended).toContainEqual(["quality", "hd"]);
});

test("a big video goes in pieces, resuming from what the server already has", async () => {
  const PIECE = 4 * 1024 * 1024;
  mockSize.mockResolvedValue(PIECE * 3);
  jest.mocked(api).mockImplementation(async (path: string, options: any = {}) => {
    if (path === "uploads/" && !options.method) return { bytes: PIECE } as never; // one piece arrived before the drop
    return { id: 9 } as never;
  });
  const keep = jest.fn();
  await sendOutgoing({ ...base, kind: "video", files: [{ uri: "file:///v.mov", name: "v.mov", type: "video/quicktime" }], uploadId: "abcdef0123456789abcdef0123456789" }, jest.fn(), keep);
  const pieces = jest.mocked(api).mock.calls.filter(([p, o]: any) => p === "uploads/" && o?.method === "POST").map(([, o]: any) => o.body);
  expect(pieces.map((b: any) => [b.index, b.offset])).toEqual([[1, PIECE], [2, PIECE * 2]]);
  expect(keep).toHaveBeenCalledWith("abcdef0123456789abcdef0123456789");
  const final = jest.mocked(api).mock.calls.at(-1) as any;
  expect(final[0]).toBe("messages/c/c1/");
  expect(final[1].body).toMatchObject({ upload_id: "abcdef0123456789abcdef0123456789", upload_kind: "video", client_id: base.clientId });
});

test("an upload the server has an odd amount of starts again from the top", async () => {
  await uploadResumable({ uri: "f", name: "f.pdf", type: "application/pdf" }, 10, "a".repeat(32), jest.fn());
  // (no server status mocked: treated as nothing arrived)
  const first = jest.mocked(api).mock.calls.find(([p, o]: any) => p === "uploads/" && o?.method === "POST") as any;
  expect(first[1].body).toMatchObject({ index: 0, offset: 0, total: 1 });
});

test("a big photo is made smaller on the phone first; a small or see-through one goes as it is", async () => {
  const { shrinkPhoto } = jest.requireActual("@/chat/send");
  const resize = jest.fn();
  jest.doMock("expo-image-manipulator", () => ({
    SaveFormat: { JPEG: "jpeg" },
    ImageManipulator: { manipulate: () => ({ resize, renderAsync: async () => ({ saveAsync: async () => ({ uri: "file:///small.jpg" }) }) }) },
  }));
  const big = await shrinkPhoto({ uri: "file:///big.heic", name: "big.heic", type: "image/heic", width: 4032, height: 3024 }, "standard");
  expect(resize).toHaveBeenCalledWith({ width: 1600 });
  expect(big).toEqual({ uri: "file:///small.jpg", name: "big.jpg", type: "image/jpeg" });
  const small = { uri: "file:///s.jpg", name: "s.jpg", type: "image/jpeg", width: 800, height: 600 };
  expect(await shrinkPhoto(small, "hd")).toBe(small);
  const clear = { uri: "file:///c.png", name: "c.png", type: "image/png", width: 5000, height: 5000 };
  expect(await shrinkPhoto(clear, "standard")).toBe(clear);
});

test("sizes and lengths read the way people say them", () => {
  expect(formatBytes(512)).toBe("512 B");
  expect(formatBytes(1536)).toBe("2 KB");
  expect(formatBytes(5.5 * 1024 * 1024)).toBe("5.5 MB");
  expect(formatDuration(65)).toBe("1:05");
  expect(formatDuration(null)).toBe("0:00");
});

test("a group message notification opens that conversation", () => {
  expect(targetFor("/profile/?conversation=8f1c2d3e-0000-4000-8000-000000000000")).toEqual({ screen: "/messages/c/8f1c2d3e-0000-4000-8000-000000000000" });
  expect(targetFor("/profile/?chat=sam")).toEqual({ screen: "/messages/sam" });
});
