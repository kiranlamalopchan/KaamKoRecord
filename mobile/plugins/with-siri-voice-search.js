const { IOSConfig, withXcodeProject } = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

// "Hey Siri, voice search in KaamKoRecord": an App Shortcut, there with no
// setup the moment the app is installed (iOS 16+). Siri opens the app and
// leaves the time in the app's own UserDefaults (`kkrVoiceSearchAt`); the app
// (src/ui/siri.ts, through React Native's Settings) sees it, goes to Items and
// starts listening. A note in UserDefaults rather than a link, because a link
// opened while the app is still starting up is lost before the screens are
// there to follow it — the note waits until they are.
const SWIFT = `import AppIntents
import Foundation

@available(iOS 16.0, *)
struct VoiceSearchIntent: AppIntent {
  static var title: LocalizedStringResource = "Voice search"
  static var description = IntentDescription("Opens your items, listening for the name or code of what you're looking for.")
  static var openAppWhenRun: Bool = true

  @MainActor
  func perform() async throws -> some IntentResult {
    UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: "kkrVoiceSearchAt")
    return .result()
  }
}

@available(iOS 16.0, *)
struct KaamKoRecordShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: VoiceSearchIntent(),
      phrases: [
        "Voice search in \\(.applicationName)",
        "Search items in \\(.applicationName)",
        "Find an item in \\(.applicationName)",
        "Search \\(.applicationName)",
      ]
    )
  }
}
`;

module.exports = function withSiriVoiceSearch(config) {
  return withXcodeProject(config, (mod) => {
    const name = mod.modRequest.projectName;
    const file = path.join(mod.modRequest.platformProjectRoot, name, "VoiceSearchIntent.swift");
    fs.writeFileSync(file, SWIFT);
    const project = mod.modResults;
    if (!project.hasFile(`${name}/VoiceSearchIntent.swift`)) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({ filepath: `${name}/VoiceSearchIntent.swift`, groupName: name, project });
    }
    return mod;
  });
};
