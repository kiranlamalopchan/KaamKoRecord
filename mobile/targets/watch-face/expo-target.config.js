// The Apple Watch face complication: the shift's time, counting by itself,
// and this week's hours. Embedded in the watch app (targets/watch) by
// @bacons/apple-targets; reads what the watch app writes to the app group.
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = () => ({
  type: "watch-widget",
  name: "KaamKoRecordFace",
  displayName: "KaamKoRecord",
  bundleIdentifier: "com.kiranlama.mywork.watchkitapp.face",
  deploymentTarget: "10.0",
  entitlements: { "com.apple.security.application-groups": ["group.com.kiranlama.mywork"] },
  colors: {
    $accent: "#79cfa8",
    brand: "#79cfa8",
    warn: "#fcd34d",
    danger: "#fca5a5",
  },
});
