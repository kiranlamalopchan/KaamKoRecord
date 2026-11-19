import { catalogue, lookUpBarcode, sameCode } from "@/api/catalogue";

jest.mock("@/auth/session", () => ({ useSession: () => ({ me: null }) }));

const item = (id: number, code: string) => ({ id, catalogue_id: 1, title: `Item ${id}`, description: "", code, fields: {} });
const page = (results: ReturnType<typeof item>[]) => ({ count: results.length, next: null, previous: null, page: 1, pages: 1, results, total: 10, samples: [], catalogue: null, catalogues: [] }) as any;

describe("barcode lookup", () => {
  afterEach(() => jest.restoreAllMocks());

  it("treats codes that differ only by leading zeros as the same", () => {
    expect(sameCode("0012345678905", "12345678905")).toBe(true);
    expect(sameCode("4011", "4012")).toBe(false);
  });

  it("puts the exact code first and keeps the rest apart", async () => {
    jest.spyOn(catalogue, "search").mockResolvedValue(page([item(1, "40111"), item(2, "4011")]));
    const found = await lookUpBarcode("4011");
    expect(found.exact.map(i => i.id)).toEqual([2]);
    expect(found.others.map(i => i.id)).toEqual([1]);
  });

  it("tries the code without leading zeros when the scan finds nothing", async () => {
    const search = jest.spyOn(catalogue, "search")
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(page([item(3, "12345678905")]));
    const found = await lookUpBarcode("012345678905", 7);
    expect(search).toHaveBeenNthCalledWith(2, "12345678905", 1, 7);
    expect(found.exact.map(i => i.id)).toEqual([3]);
  });
});
