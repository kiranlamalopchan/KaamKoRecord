import Foundation
import Security
import WatchConnectivity
import WatchKit

/// The watch's half of modules/watch-link: the phone sends who is signed in,
/// which server and which language; the watch keeps them and tells the phone
/// when it moved the clock so the phone's screens and widgets catch up.
///
/// The token lives in the watch's keychain, the rest in UserDefaults.
final class Link: NSObject, WCSessionDelegate, ObservableObject {
  static let shared = Link()

  @Published private(set) var token: String?
  @Published private(set) var server: String
  @Published private(set) var lang: String

  private let defaults = UserDefaults.standard
  private static let tokenAccount = "mywork.token"
  /// Background wake-ups for phone data, finished once it has all arrived.
  private var held: [WKWatchConnectivityRefreshBackgroundTask] = []
  private var pendingWatch: NSKeyValueObservation?

  override init() {
    server = defaults.string(forKey: "server") ?? ""
    lang = defaults.string(forKey: "lang") ?? "en"
    token = Link.readToken()
    super.init()
    if WCSession.isSupported() {
      WCSession.default.delegate = self
      WCSession.default.activate()
      pendingWatch = WCSession.default.observe(\.hasContentPending) { [weak self] _, _ in
        DispatchQueue.main.async { self?.finishIfDone() }
      }
    }
  }

  /// watchOS woke the app because the phone sent something: keep the task until it has arrived.
  func hold(_ task: WKWatchConnectivityRefreshBackgroundTask) {
    DispatchQueue.main.async {
      self.held.append(task)
      self.finishIfDone()
    }
  }

  private func finishIfDone() {
    guard !held.isEmpty, WCSession.isSupported() else { return }
    let session = WCSession.default
    guard session.activationState == .activated, !session.hasContentPending else { return }
    held.forEach { $0.setTaskCompletedWithSnapshot(false) }
    held = []
  }

  var signedIn: Bool { token != nil && !server.isEmpty }

  /// The server turned the token down: forget it until the phone sends another.
  func forgetToken() {
    Link.writeToken(nil)
    DispatchQueue.main.async {
      self.token = nil
      Face.rewrite(signedIn: false, lang: self.lang)
    }
  }

  /// Tell the phone the clock moved. Best effort: the phone also refreshes on its own.
  func tellPhoneClockChanged() {
    guard WCSession.isSupported(), WCSession.default.activationState == .activated else { return }
    let note: [String: Any] = ["event": "clock-changed", "at": Date().timeIntervalSince1970]
    if WCSession.default.isReachable {
      WCSession.default.sendMessage(note, replyHandler: nil, errorHandler: nil)
    } else {
      WCSession.default.transferUserInfo(note)
    }
  }

  // MARK: - from the phone

  private func apply(_ context: [String: Any]) {
    let newToken = (context["token"] as? String).flatMap { $0.isEmpty ? nil : $0 }
    let newServer = (context["server"] as? String) ?? ""
    let newLang = (context["lang"] as? String) == "ne" ? "ne" : "en"
    Link.writeToken(newToken)
    defaults.set(newServer, forKey: "server")
    defaults.set(newLang, forKey: "lang")
    DispatchQueue.main.async {
      let changed = self.token != newToken || self.server != newServer
      self.token = newToken
      self.server = newServer
      self.lang = newLang
      if changed { NotificationCenter.default.post(name: .watchSessionChanged, object: nil) }
      // Also when the app isn't running: the face follows the sign-in and the language.
      Face.rewrite(signedIn: self.signedIn, lang: newLang)
    }
  }

  /// The phone moved the clock and sent its state along, for the face and the app.
  private func receiveClock(_ info: [String: Any]) {
    guard let json = info["clock"] as? String, let data = json.data(using: .utf8),
          let fresh = try? JSONDecoder().decode(ClockState.self, from: data) else { return }
    DispatchQueue.main.async {
      if Face.adoptPushed(fresh, signedIn: self.signedIn, lang: self.lang) {
        NotificationCenter.default.post(name: .watchClockPushed, object: fresh)
      }
      self.finishIfDone()
    }
  }

  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
    receiveClock(userInfo)
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    receiveClock(message)
  }

  func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
    if state == .activated, !session.receivedApplicationContext.isEmpty {
      apply(session.receivedApplicationContext)
    }
    DispatchQueue.main.async { self.finishIfDone() }
  }

  func session(_ session: WCSession, didReceiveApplicationContext context: [String: Any]) {
    apply(context)
  }

  // MARK: - keychain

  private static func query() -> [String: Any] {
    [kSecClass as String: kSecClassGenericPassword,
     kSecAttrService as String: "com.kiranlama.mywork.watch",
     kSecAttrAccount as String: tokenAccount]
  }

  private static func readToken() -> String? {
    var q = query()
    q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    var out: CFTypeRef?
    guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }

  private static func writeToken(_ token: String?) {
    SecItemDelete(query() as CFDictionary)
    guard let token, let data = token.data(using: .utf8) else { return }
    var q = query()
    q[kSecValueData as String] = data
    q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
    SecItemAdd(q as CFDictionary, nil)
  }
}

extension Notification.Name {
  static let watchSessionChanged = Notification.Name("watchSessionChanged")
  static let watchClockPushed = Notification.Name("watchClockPushed")
}
