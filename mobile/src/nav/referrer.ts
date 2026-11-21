/**
 * The invite code a new Android install came with. Somebody's invite link
 * (kaamkorecord.com/get/?ref=CODE) hands Google Play `utm_content=CODE`, and
 * Play gives it to the app on its first start — so "Who invited you?" can be
 * filled in for them. iPhones have nothing like it: there they type it.
 */
import { Platform } from "react-native";

import { nativeOrNull } from "@/ui/native";

const CODE = /^[A-Za-z0-9]{4,12}$/;

/** The code from Play's install referrer, or "" — never throws. */
export async function installInviteCode(): Promise<string> {
  if (Platform.OS !== "android") return "";
  const application = nativeOrNull<typeof import("expo-application")>(() => require("expo-application"));
  try {
    const referrer = (await application?.getInstallReferrerAsync?.()) || "";
    return inviteCodeFrom(referrer);
  } catch {
    return "";
  }
}

/** `utm_source=invite&utm_content=K7Q2MX` → "K7Q2MX"; anything else → "". */
export function inviteCodeFrom(referrer: string): string {
  let content = "";
  try {
    content = new URLSearchParams(referrer).get("utm_content") || "";
  } catch {
    return "";
  }
  return CODE.test(content) ? content.toUpperCase() : "";
}
