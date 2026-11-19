// What differs between a build that talks to a laptop and one for the
// stores, on top of app.json. EAS names the profile in EAS_BUILD_PROFILE;
// a local `expo run:ios` / `expo start` has none and counts as development.
const profile = process.env.EAS_BUILD_PROFILE || "development";
// production, production-apk and production-wear (the Wear OS bundle).
const forStore = profile.startsWith("production");

// One build number for both stores, so an iOS and an Android build of the
// same release carry the same number. Raise it by one before every store
// build (both stores refuse a number they have already seen). The version
// name is shared too: it is app.json's "version", and after a release it
// must go up as well (App Store Connect closes a version once it is live).
const BUILD_NUMBER = 25;

module.exports = ({ config }) => ({
  ...config,
  ios: {
    ...config.ios,
    buildNumber: String(BUILD_NUMBER),
    infoPlist: {
      ...config.ios.infoPlist,
      // Plain http to a laptop on the Wi-Fi, and its media — never in a store build.
      ...(forStore ? {} : { NSAppTransportSecurity: { NSAllowsLocalNetworking: true, NSAllowsArbitraryLoadsInMedia: true } }),
    },
  },
  android: {
    ...config.android,
    versionCode: BUILD_NUMBER,
    // The Firebase file comes from an EAS file secret on a build server; the
    // checked-out copy is for a laptop only and is not in git.
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON || config.android.googleServicesFile,
    // The template asks for the debug overlay's permission; a store build has no overlay.
    blockedPermissions: forStore ? ["android.permission.SYSTEM_ALERT_WINDOW"] : config.android.blockedPermissions,
  },
  plugins: config.plugins.map((plugin) =>
    Array.isArray(plugin) && plugin[0] === "expo-build-properties"
      ? [plugin[0], { ...plugin[1], android: { ...(plugin[1].android || {}), usesCleartextTraffic: !forStore } }]
      : plugin,
  ),
  extra: {
    ...config.extra,
    // The "Server" line under Sign in: for pointing a build at a laptop.
    devServerPicker: !forStore,
  },
});
