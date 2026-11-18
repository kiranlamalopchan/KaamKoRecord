import * as SecureStore from "expo-secure-store";

const key = (username: string) => `chat.draft.${username.toLowerCase().replace(/[^a-z0-9_.-]/g, "")}`;

export async function loadDraft(username: string): Promise<string> {
  try { return (await SecureStore.getItemAsync(key(username))) || ""; } catch { return ""; }
}

export async function saveDraft(username: string, text: string): Promise<void> {
  try {
    if (text) await SecureStore.setItemAsync(key(username), text);
    else await SecureStore.deleteItemAsync(key(username));
  } catch {
    // The visible composer still keeps the draft for this session.
  }
}
