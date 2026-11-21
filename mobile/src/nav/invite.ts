/**
 * Inviting friends: the phone's own share sheet (WhatsApp, Messenger,
 * Viber, a text…) with a short message and the one link to hand out. The
 * link is the website's /get/, which sends a phone to its own store;
 * `src=invite` lets the site count installs that came from an invite, and
 * `ref=` is the sharer's own invite code (random, not their name), which
 * counts the new person towards their Champion badge (apps/invites).
 */
import { Share } from "react-native";

import { tr } from "@/i18n";

export const INVITE_URL = "https://kaamkorecord.com/get/?src=invite";

/** The message that goes out, in the app's language, ending with the link (the sharer's own, when known). */
export function inviteMessage(link: string = INVITE_URL, code?: string): string {
  const words = tr("I use KaamKoRecord to clock in, keep my timesheets and check my pay. It's free — get it here:");
  const codeLine = code ? `\n${tr("My invite code: {code}", { code })}` : "";
  return `${words} ${link}${codeLine}`;
}

/** Opens the share sheet. Resolves whether it was sent (Android can't tell, so true there). */
export async function inviteFriends(link?: string, code?: string): Promise<boolean> {
  try {
    const result = await Share.share({ message: inviteMessage(link, code) }, { dialogTitle: tr("Invite friends") });
    return result.action !== Share.dismissedAction;
  } catch {
    // Share sheet couldn't open: nothing was sent, and nothing to tell — the row is still there.
    return false;
  }
}
