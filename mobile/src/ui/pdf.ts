/**
 * A PDF from the API, opened the way the phone opens files: fetched with
 * the token, written to the cache, handed to the share sheet. GET by default; a POST carries `body` as JSON.
 * The native modules are loaded here, not at the top of a screen, so a
 * build made before they were added still shows the screen.
 */
import { getToken } from "@/auth/token";

import { tell } from "./confirm";
import { native } from "./native";
import { ApiError } from "@/api/client";

export async function openFile(url: string, name: string, mimeType: string, body?: unknown): Promise<void> {
  const token = await getToken();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  const headers: Record<string, string> = { Authorization: `Token ${token}`, "X-Timezone": tz };
  const init: RequestInit = body === undefined
    ? { headers }
    : { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) };
  const response = await fetch(url, init);
  if (!response.ok) {
    let detail = "";
    try { detail = (await response.json()).detail || ""; } catch { /* not JSON */ }
    throw new ApiError(response.status, detail);
  }
  const { Directory, File, Paths } = native<typeof import("expo-file-system")>(() => require("expo-file-system"));
  const Sharing = native<typeof import("expo-sharing")>(() => require("expo-sharing"));
  const dir = new Directory(Paths.cache, "exports");
  if (!dir.exists) dir.create();
  const file = new File(dir, name);
  file.write(new Uint8Array(await response.arrayBuffer()));
  const uti = mimeType === "application/pdf" ? "com.adobe.pdf" : mimeType === "text/csv" ? "public.comma-separated-values-text" : undefined;
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType, UTI: uti });
  else tell("Saved", file.uri);
}

export const openPdf = (url: string, name: string, body?: unknown) => openFile(url, name, "application/pdf", body);
