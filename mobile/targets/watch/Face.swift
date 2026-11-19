import Foundation
import WidgetKit

/// What the watch-face complication shows. The complication runs on its own
/// and can't reach the app's storage, so the app writes this small snapshot
/// into the shared app group and asks the face to draw again.
///
/// Keep in step with targets/watch-face/FaceWidget.swift, which reads it.
struct FaceSnapshot: Codable, Equatable {
  var signedIn: Bool
  var lang: String
  var status: String          // out (signed out) | none (nothing loaded yet) | off | working | break
  var workplace: String?
  var workStart: Date?        // on this watch's clock: when the worked timer would read zero
  var breakStart: Date?
  var savedAt: Date?          // `server_now` on this watch's clock: the totals below are as of then
  var weekSeconds: Int?
  var limitCap: Int?
  var limitUsed: Int?
  var limitHere: Bool         // the running shift counts toward the cap
  var limitPeriod: String?
}

enum Face {
  static let group = "group.com.kiranlama.mywork"
  static let key = "watch.face"

  /// The snapshot for a clock state; `skew` is how far the server's clock is ahead of this watch's.
  static func snapshot(_ state: ClockState?, skew: TimeInterval, signedIn: Bool, lang: String) -> FaceSnapshot {
    var face = FaceSnapshot(signedIn: signedIn, lang: lang, status: signedIn ? "none" : "out", limitHere: false)
    guard signedIn, let state else { return face }
    func local(_ text: String?) -> Date? { text.flatMap(Iso.parse).map { $0.addingTimeInterval(-skew) } }
    face.savedAt = local(state.server_now)
    face.weekSeconds = state.week?.worked.seconds
    if let limit = state.limit {
      face.limitCap = limit.cap.seconds
      face.limitUsed = limit.used.seconds
      face.limitPeriod = limit.period_label
    }
    guard let shift = state.shift else {
      face.status = "off"
      return face
    }
    face.workplace = shift.workplace?.name
    face.workStart = local(shift.clock_in)?.addingTimeInterval(TimeInterval(shift.banked_break_seconds))
    face.limitHere = shift.workplace?.id != nil && shift.workplace?.id == state.limit?.workplace?.id
    if shift.status == "ON_BREAK" {
      face.status = "break"
      face.breakStart = local(shift.running_break?.start)
    } else {
      face.status = "working"
    }
    return face
  }

  static func write(_ state: ClockState?, skew: TimeInterval, signedIn: Bool, lang: String) {
    let face = snapshot(state, skew: skew, signedIn: signedIn, lang: lang)
    guard let shared = UserDefaults(suiteName: group), let data = try? JSONEncoder().encode(face) else { return }
    if shared.data(forKey: key) == data { return }  // nothing new to draw
    shared.set(data, forKey: key)
    WidgetCenter.shared.reloadAllTimelines()
  }

  /// Again from what the app last saved — for when the app itself isn't running.
  static func rewrite(signedIn: Bool, lang: String) {
    let defaults = UserDefaults.standard
    let state = defaults.data(forKey: "state").flatMap { try? JSONDecoder().decode(ClockState.self, from: $0) }
    write(state, skew: defaults.double(forKey: "skew"), signedIn: signedIn, lang: lang)
  }

  /// The phone moved the clock: keep its state, unless taps made here are still on their way.
  /// True when it was kept, so a running ClockModel can show it.
  @discardableResult
  static func adoptPushed(_ fresh: ClockState, signedIn: Bool, lang: String) -> Bool {
    let defaults = UserDefaults.standard
    let pending = defaults.data(forKey: "pending").flatMap { try? JSONDecoder().decode([PendingTap].self, from: $0) } ?? []
    guard signedIn, pending.isEmpty else { return false }
    if let saved = defaults.data(forKey: "state").flatMap({ try? JSONDecoder().decode(ClockState.self, from: $0) }),
       let was = Iso.parse(saved.server_now), let now = Iso.parse(fresh.server_now), now < was {
      return false  // older than what the watch already has
    }
    defaults.set(try? JSONEncoder().encode(fresh), forKey: "state")
    write(fresh, skew: defaults.double(forKey: "skew"), signedIn: signedIn, lang: lang)
    return true
  }
}
