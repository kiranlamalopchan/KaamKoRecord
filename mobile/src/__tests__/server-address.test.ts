// A store build has no address field, so an address saved by a test build on
// the same phone must not pin it to another server (the retired one, say).

const mockStore: Record<string, string> = {};
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (k: string) => mockStore[k] ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => { mockStore[k] = v; }),
  deleteItemAsync: jest.fn(async (k: string) => { delete mockStore[k]; }),
}));

let mockPicker = false;
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { get expoConfig() { return { extra: { devServerPicker: mockPicker } }; } },
}));

const OLD = "https://butcher11643.retired.invalid";

function fresh() {
  let mod: typeof import("@/api/server");
  jest.isolateModules(() => { mod = require("@/api/server"); });
  return mod!;
}

describe("a saved server address", () => {
  const dev = (globalThis as any).__DEV__;
  beforeEach(() => {
    for (const k of Object.keys(mockStore)) delete mockStore[k];
    mockStore["mywork.server"] = OLD;
    process.env.EXPO_PUBLIC_API_URL = "https://kaamkorecord.com";
  });
  afterAll(() => { (globalThis as any).__DEV__ = dev; });

  it("is forgotten by a store build, which uses its own server", async () => {
    (globalThis as any).__DEV__ = false;
    mockPicker = false;
    const server = fresh();
    expect(await server.loadServer()).toBe("https://kaamkorecord.com");
    expect(server.isCustomServer()).toBe(false);
    expect(mockStore["mywork.server"]).toBeUndefined();
  });

  it("is forgotten by a test build too", async () => {
    (globalThis as any).__DEV__ = false;
    mockPicker = true;
    const server = fresh();
    expect(await server.loadServer()).toBe("https://kaamkorecord.com");
    expect(server.isCustomServer()).toBe(false);
    expect(mockStore["mywork.server"]).toBeUndefined();
  });

  it("repairs every retired account-host address", async () => {
    (globalThis as any).__DEV__ = true;
    mockStore["mywork.server"] = "http://butcher11643.old.invalid";
    const server = fresh();
    expect(await server.loadServer()).toBe("https://kaamkorecord.com");
    expect(server.isCustomServer()).toBe(false);
    expect(mockStore["mywork.server"]).toBeUndefined();
  });
});
