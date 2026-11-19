const { withDangerousMod, withProjectBuildGradle, withSettingsGradle } = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

// The Wear OS app (mobile/wear) as a second module, android/wear, next to the
// phone's android/app. It is only added when KAAMKORECORD_WEAR=1 — the
// "production-wear" EAS profile sets it — so phone builds stay exactly as
// they were and never wait on the watch.
//
// The watch shares the phone app's package name and signing key (the
// Wearable Data Layer only connects apps that match) and its version name.
// Its version code is the phone's plus WEAR_CODE_OFFSET: Google Play wants a
// different code for every bundle uploaded to the same app.
const WEAR_CODE_OFFSET = 100000;
const enabled = () => process.env.KAAMKORECORD_WEAR === "1";

function kotlinVersion(projectRoot) {
  const reactNative = path.dirname(require.resolve("react-native/package.json", { paths: [projectRoot] }));
  const toml = fs.readFileSync(path.join(reactNative, "gradle", "libs.versions.toml"), "utf8");
  const match = toml.match(/^kotlin\s*=\s*"([^"]+)"/m);
  if (!match) throw new Error("with-wear-app: could not read React Native's Kotlin version");
  return match[1];
}

module.exports = function withWearApp(config) {
  if (!enabled()) return config;

  config = withSettingsGradle(config, (mod) => {
    if (!mod.modResults.contents.includes("include ':wear'")) {
      mod.modResults.contents = mod.modResults.contents.replace("include ':app'", "include ':app'\ninclude ':wear'");
    }
    return mod;
  });

  // Compose needs Kotlin's compose compiler plugin, at the same version as Kotlin itself.
  config = withProjectBuildGradle(config, (mod) => {
    const version = kotlinVersion(mod.modRequest.projectRoot);
    const line = `classpath("org.jetbrains.kotlin:compose-compiler-gradle-plugin:${version}")`;
    if (!mod.modResults.contents.includes("compose-compiler-gradle-plugin")) {
      mod.modResults.contents = mod.modResults.contents.replace(
        "classpath('com.facebook.react:react-native-gradle-plugin')",
        `classpath('com.facebook.react:react-native-gradle-plugin')\n    ${line}`);
    }
    return mod;
  });

  return withDangerousMod(config, ["android", async (mod) => {
    const from = path.join(mod.modRequest.projectRoot, "wear");
    const to = path.join(mod.modRequest.platformProjectRoot, "wear");
    fs.rmSync(to, { recursive: true, force: true });
    fs.cpSync(from, to, { recursive: true, filter: (src) => !/[\\/](build|\.gradle)$/.test(src) });
    const profile = process.env.EAS_BUILD_PROFILE || "development";
    const forStore = profile.startsWith("production");
    fs.writeFileSync(path.join(to, "wear.properties"), [
      "# Written by plugins/with-wear-app.js on every prebuild.",
      `applicationId=${mod.android.package}`,
      `versionName=${mod.version}`,
      `versionCode=${WEAR_CODE_OFFSET + Number(mod.android.versionCode)}`,
      `usesCleartextTraffic=${!forStore}`,
      "",
    ].join("\n"));
    return mod;
  }]);
};
