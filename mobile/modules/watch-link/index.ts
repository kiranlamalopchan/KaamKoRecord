import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";

type Native = {
  /** Hand the watch app who is signed in. An empty token signs it out. */
  send(token: string, server: string, lang: string): boolean;
  /** Hand the watch face the phone's latest clock (the server's clock reply, as JSON). */
  sendClock(json: string): boolean;
  addListener(event: "onClockChanged", listener: () => void): { remove(): void };
};

/** iOS and Android, in a build that has the module (not Expo Go). */
export const WatchLink: Native | null =
  Platform.OS === "ios" || Platform.OS === "android" ? requireOptionalNativeModule<Native>("WatchLink") : null;
