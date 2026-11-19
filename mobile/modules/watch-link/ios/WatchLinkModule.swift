import ExpoModulesCore
import WatchConnectivity

/// The phone's half of the Apple Watch link (the watch's is targets/watch/Link.swift).
///
/// `send` puts who is signed in, the server and the language into the
/// application context, which watchOS delivers to the watch app whenever it
/// next can — the watch app need not be running. An empty token signs the
/// watch out. When the watch moves the clock it says so, and JS hears
/// `onClockChanged` so the phone's clock, widgets and Live Activity catch up.
public class WatchLinkModule: Module {
  private lazy var relay = Relay { [weak self] in self?.sendEvent("onClockChanged", [:]) }

  public func definition() -> ModuleDefinition {
    Name("WatchLink")
    Events("onClockChanged")

    OnCreate { _ = self.relay }

    Function("send") { (token: String, server: String, lang: String) -> Bool in
      self.relay.send(["token": token, "server": server, "lang": lang])
    }

    Function("sendClock") { (json: String) -> Bool in
      self.relay.sendClock(json)
    }
  }
}

private final class Relay: NSObject, WCSessionDelegate {
  private let onClockChanged: () -> Void
  private var waiting: [String: Any]?

  init(onClockChanged: @escaping () -> Void) {
    self.onClockChanged = onClockChanged
    super.init()
    guard WCSession.isSupported() else { return }
    WCSession.default.delegate = self
    WCSession.default.activate()
  }

  /// False when there is no watch to send to; that's not a failure.
  func send(_ context: [String: Any]) -> Bool {
    guard WCSession.isSupported() else { return false }
    let session = WCSession.default
    guard session.activationState == .activated else {
      waiting = context  // sent once activation completes
      return true
    }
    guard session.isPaired, session.isWatchAppInstalled else { return false }
    do {
      try session.updateApplicationContext(context)
      return true
    } catch {
      return false
    }
  }

  /// The phone's latest clock, for the watch app and the watch face.
  ///
  /// The watch app open (reachable): a live message, there in a moment. The
  /// complication transfer used to go first whenever the face had one, but iOS
  /// queues it and allows only ~50 a day, so an open watch app could sit
  /// behind the phone for minutes. The face still gets its transfer as well,
  /// while the budget lasts; not reachable and no face, it queues, and only
  /// the newest is kept waiting. Getting the same clock twice is harmless:
  /// the watch keeps the newest (Face.adoptPushed).
  func sendClock(_ json: String) -> Bool {
    guard WCSession.isSupported() else { return false }
    let session = WCSession.default
    guard session.activationState == .activated, session.isPaired, session.isWatchAppInstalled else { return false }
    let info: [String: Any] = ["clock": json, "at": Date().timeIntervalSince1970]
    for transfer in session.outstandingUserInfoTransfers where transfer.userInfo["clock"] != nil {
      transfer.cancel()
    }
    let face = session.isComplicationEnabled && session.remainingComplicationUserInfoTransfers > 0
    if session.isReachable {
      session.sendMessage(info, replyHandler: nil) { _ in if !face { session.transferUserInfo(info) } }
    }
    if face {
      session.transferCurrentComplicationUserInfo(info)
    } else if !session.isReachable {
      session.transferUserInfo(info)
    }
    return true
  }

  func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
    if state == .activated, let context = waiting {
      waiting = nil
      _ = send(context)
    }
  }

  func sessionDidBecomeInactive(_ session: WCSession) {}

  func sessionDidDeactivate(_ session: WCSession) {
    // Switching to another paired watch: start again so the new one is reached.
    session.activate()
  }

  func sessionWatchStateDidChange(_ session: WCSession) {}

  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    if message["event"] as? String == "clock-changed" { DispatchQueue.main.async(execute: onClockChanged) }
  }

  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
    if userInfo["event"] as? String == "clock-changed" { DispatchQueue.main.async(execute: onClockChanged) }
  }
}
