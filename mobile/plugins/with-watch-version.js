const { withXcodeProject } = require("expo/config-plugins");

// Apple refuses an iPhone app whose Watch app has a different version or
// build number. @bacons/apple-targets writes the watch target as "1.0", so
// every build configuration that targets watchOS is given the phone's
// version (app.json "version") and build number (BUILD_NUMBER in app.config.js).
module.exports = function withWatchVersion(config) {
  return withXcodeProject(config, (mod) => {
    const version = mod.version;
    const build = String(mod.ios?.buildNumber || "1");
    const configurations = mod.modResults.pbxXCBuildConfigurationSection();
    for (const entry of Object.values(configurations)) {
      const settings = entry && entry.buildSettings;
      if (settings && settings.WATCHOS_DEPLOYMENT_TARGET) {
        settings.MARKETING_VERSION = version;
        settings.CURRENT_PROJECT_VERSION = build;
      }
    }
    return mod;
  });
};
