/**
 * Google's ML Kit scanner screens (barcode and document) lock themselves to
 * portrait, and Android then infers that the app *requires* a portrait
 * screen (android.hardware.screen.portrait). Play treats that as limiting
 * which devices can install the app and blocks the release until it's
 * declared optional. The scanners still open in portrait; nothing else changes.
 */
const { withAndroidManifest } = require("expo/config-plugins");

const FEATURE = "android.hardware.screen.portrait";

module.exports = function withOptionalPortrait(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    manifest["uses-feature"] = (manifest["uses-feature"] || []).filter((f) => f.$["android:name"] !== FEATURE);
    manifest["uses-feature"].push({ $: { "android:name": FEATURE, "android:required": "false" } });
    return mod;
  });
};
