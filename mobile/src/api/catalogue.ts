import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/auth/session";
import { api, formWith, type FilePart } from "./client";
import type { Page } from "./types";

export type CatalogueItem = { id: number; catalogue_id: number; title: string; description: string; code: string; fields: Record<string, string>; stock: number };
export type CatalogueMapping = { name: string; title_column: string; description_column: string; code_column: string; search_columns: string[]; catalogue_id?: number };
export type CatalogueConfig = CatalogueMapping & { id: number; headers: string[]; track_stock: boolean };
export type CatalogueDetails = CatalogueConfig & { count: number };
export type CataloguePreview = { upload_id: string; headers: string[]; sample: Record<string, string>[]; count: number; defaults: CatalogueMapping };
export type CatalogueSearch = Page<CatalogueItem> & { total: number; samples: CatalogueItem[]; catalogue: CatalogueConfig | null; catalogues: { id: number; name: string; count: number }[] };

export const catalogue = {
  search: (q: string, page = 1, catalogueId?: number) => api<CatalogueSearch>("items/search/", { query: { q, page, catalogue: catalogueId } }),
  one: (id: number) => api<CatalogueItem>(`items/${id}/`),
  details: (id: number) => api<CatalogueDetails>(`catalogues/${id}/`),
  update: (id: number, settings: { name?: string; search_columns?: string[]; headers?: string[]; code_column?: string; track_stock?: boolean }) => api<CatalogueDetails>(`catalogues/${id}/`, { method: "PATCH", body: settings }),
  remove: (id: number) => api<void>(`catalogues/${id}/`, { method: "DELETE" }),
  create: (body: { name: string; headers: string[]; title_column: string; code_column: string; track_stock: boolean }) => api<CatalogueDetails>("catalogues/", { method: "POST", body }),
  items: (id: number, page = 1) => api<Page<CatalogueItem> & { catalogue: CatalogueConfig }>(`catalogues/${id}/items/`, { query: { page } }),
  addItem: (id: number, fields: Record<string, string>) => api<CatalogueItem>(`catalogues/${id}/items/`, { method: "POST", body: { fields } }),
  updateItem: (itemId: number, fields: Record<string, string>) => api<CatalogueItem>(`items/${itemId}/`, { method: "PATCH", body: { fields } }),
  /** {change: 1} or {change: -1} for a scan; {count: 12} after counting the shelf. */
  stock: (itemId: number, body: { change: number } | { count: number }) => api<CatalogueItem>(`items/${itemId}/stock/`, { method: "POST", body }),
  removeItem: (itemId: number) => api<void>(`items/${itemId}/`, { method: "DELETE" }),
  preview: (file: FilePart, onProgress?: (sent: number) => void) => api<CataloguePreview>("items/preview/", { method: "POST", form: formWith({ file }), onProgress }),
  save: (upload_id: string, mapping: CatalogueMapping) => api<{ catalogue_id: number; name: string; total: number; skipped: number; message: string }>("items/import/", { method: "POST", body: { upload_id, ...mapping } }),
};

export function useCatalogueIdle(catalogueId?: number) {
  const { me } = useSession();
  return useQuery({ queryKey: ["catalogue", me?.username, "idle", catalogueId], queryFn: () => catalogue.search("", 1, catalogueId), enabled: !!me, staleTime: 60_000 });
}
export function useCatalogueSearch(q: string, catalogueId?: number, page = 1) {
  const { me } = useSession();
  return useQuery({ queryKey: ["catalogue", me?.username, "search", catalogueId, q, page], queryFn: () => catalogue.search(q, page, catalogueId), enabled: !!me && !!q });
}

/** Codes match when they differ only by leading zeros: a UPC-A read as EAN-13 gains a 0. */
export const sameCode = (a: string, b: string) => a.trim().replace(/^0+/, "") === b.trim().replace(/^0+/, "");

/**
 * What a scanned barcode is. Rows whose code is the scan come first; when the
 * scan finds nothing and starts with zeros, the code without them is tried too.
 */
export async function lookUpBarcode(code: string, catalogueId?: number) {
  let found = await catalogue.search(code, 1, catalogueId);
  const bare = code.replace(/^0+/, "");
  if (!found.count && bare && bare !== code) found = await catalogue.search(bare, 1, catalogueId);
  const exact = found.results.filter(item => sameCode(item.code, code));
  return { ...found, exact, others: found.results.filter(item => !exact.includes(item)) };
}
export function useBarcodeLookup(code: string, catalogueId?: number) {
  const { me } = useSession();
  return useQuery({ queryKey: ["catalogue", me?.username, "barcode", catalogueId, code], queryFn: () => lookUpBarcode(code, catalogueId), enabled: !!me && !!code, staleTime: 60_000 });
}
export function useCatalogueDetails(id?: number) {
  const { me } = useSession();
  return useQuery({ queryKey: ["catalogue", me?.username, "details", String(id)], queryFn: () => catalogue.details(id!), enabled: !!me && !!id });
}
/** A catalogue's items as a table, page after page. */
export function useCatalogueItems(id: number) {
  const { me } = useSession();
  return useInfiniteQuery({
    queryKey: ["catalogue", me?.username, "items", id],
    queryFn: ({ pageParam }) => catalogue.items(id, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => last.next ?? undefined,
    enabled: !!me,
  });
}
export function useCatalogueChanged() {
  const client = useQueryClient();
  return () => {
    client.invalidateQueries({ queryKey: ["catalogue"] });
    client.invalidateQueries({ queryKey: ["plu"] });
    client.invalidateQueries({ queryKey: ["plu-idle"] });
    client.invalidateQueries({ queryKey: ["plu-item"] });
    client.invalidateQueries({ queryKey: ["plu-importable"] });
  };
}
