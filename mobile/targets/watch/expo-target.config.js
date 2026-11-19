// The Apple Watch app: clock in, breaks and clock out from the wrist.
// Built into the iOS app by @bacons/apple-targets on every prebuild; the
// phone hands it the sign-in through modules/watch-link.
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = () => ({
  type: "watch",
  name: "KaamKoRecordWatch",
  displayName: "KaamKoRecord",
  bundleIdentifier: ".watchkitapp",
  icon: "../../assets/icon.png",
  deploymentTarget: "10.0",
  // Shared with the watch-face complication (targets/watch-face), which reads
  // the shift from here. The same group the phone's widgets already use.
  entitlements: { "com.apple.security.application-groups": ["group.com.kiranlama.mywork"] },
  colors: {
    $accent: "#79cfa8",
    brand: "#79cfa8",
    brandInk: "#10261c",
    warn: "#fcd34d",
    danger: "#fca5a5",
  },
});
