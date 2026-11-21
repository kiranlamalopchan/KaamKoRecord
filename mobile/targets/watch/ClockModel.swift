import Foundation
import Combine
import WatchKit

/// What the watch shows and does. A tap shows at once, is kept on the watch,
/// and is sent until the server has it — the same promise the phone's offline
/// queue makes, with the same `client_id` so a retry can never double up.
@MainActor
final class ClockModel: ObservableObject {
  @Published private(set) var state: ClockState?
  @Published private(set) var loading = false
  @Published private(set) var busy = false
  @Published private(set) var problem: String?
  @Published private(set) var pending: [PendingTap] = []
  @Published var chosenWorkplace: Int?

  /// How far the watch's clock is from the server's, so timers agree with the phone.
  private var skew: TimeInterval = 0
  private let defaults = UserDefaults.standard
  private var watchers = Set<AnyCancellable>()

  init() {
    pending = (defaults.data(forKey: "pending").flatMap { try? JSONDecoder().decode([PendingTap].self, from: $0) }) ?? []
    if let data = defaults.data(forKey: "state"), let saved = try? JSONDecoder().decode(ClockState.self, from: data) {
      state = saved
    }
    skew = defaults.double(forKey: "skew")
    NotificationCenter.default.publisher(for: .watchSessionChanged)
      .sink { [weak self] _ in Task { await self?.sessionChanged() } }
      .store(in: &watchers)
    // The phone moved the clock and Face.adoptPushed kept it: show it.
    NotificationCenter.default.publisher(for: .watchClockPushed)
      .sink { [weak self] note in
        guard let fresh = note.object as? ClockState else { return }
        Task { @MainActor in
          guard let self, self.pending.isEmpty else { return }
          self.state = fresh
          if fresh.shift != nil { self.chosenWorkplace = nil }
        }
      }
      .store(in: &watchers)
    // No NWPathMonitor here: watchOS only lets audio-streaming apps use it, so
    // for this app it says "offline" for good and saved taps never went out.
    // Instead every refresh simply tries (WatchApp asks every 20 s while the
    // app is on screen); with no connection URLSession fails at once.
    Task { await refresh() }
    #if DEBUG && targetEnvironment(simulator)
    // Simulator only, for checking taps reach the server without a tap tool:
    // `SIMCTL_CHILD_KKR_TAPS=clock_in,start_break,end_break,clock_out` presses
    // them one by one, 5 s apart. Never compiled into a device build.
    if let script = ProcessInfo.processInfo.environment["KKR_TAPS"] {
      let taps = script.split(separator: ",").compactMap { ClockAction(rawValue: String($0)) }
      Task {
        for action in taps {
          try? await Task.sleep(for: .seconds(5))
          switch action {
          case .clockIn: clockIn()
          case .startBreak: startBreak()
          case .endBreak: endBreak()
          case .clockOut: clockOut()
          }
        }
      }
    }
    #endif
  }

  var signedIn: Bool { Link.shared.signedIn }

  var workplace: WorkplaceBrief? {
    guard let state else { return nil }
    if let open = state.shift?.workplace { return open }
    let id = chosenWorkplace ?? state.selected
    return state.workplaces.first { $0.id == id } ?? state.workplaces.first
  }

  /// "now" on the server's clock.
  func now(_ date: Date = Date()) -> Date { date.addingTimeInterval(skew) }

  // MARK: - loading

  func refresh() async {
    guard signedIn else { return }
    await flush()
    guard pending.isEmpty else { return }  // still offline: keep showing the taps as made
    loading = state == nil
    defer { loading = false }
    do {
      take(try await Api.clock())
      problem = nil
    } catch {
      handle(error, quietWhenOffline: state != nil)
    }
  }

  private func sessionChanged() async {
    // Someone else signing in on the phone: nothing of the last person stays.
    state = nil
    pending = []
    chosenWorkplace = nil
    save()
    await refresh()
  }

  // MARK: - the four taps

  func clockIn() { act(PendingTap(.clockIn, workplace: workplace?.id)) }
  func startBreak() { act(PendingTap(.startBreak)) }
  func endBreak() { act(PendingTap(.endBreak)) }
  func clockOut() { act(PendingTap(.clockOut)) }

  private func act(_ tap: PendingTap) {
    guard !busy else { return }
    problem = nil
    pending.append(tap)
    if let state { self.state = Self.apply(tap, to: state) }
    save()
    WKInterfaceDevice.current().play(.click)
    Task {
      busy = true
      await flush()
      busy = false
      if pending.isEmpty { WKInterfaceDevice.current().play(.success) }
    }
  }

  /// Sending right now. A second flush while one runs (a tap during the
  /// on-screen refresh, the network coming back) would send the same tap
  /// twice at once; the running one already picks up anything added meanwhile.
  private var flushing = false

  /// Send what is waiting, oldest first. Stops at the first tap that can't get through.
  private func flush() async {
    guard !flushing else { return }
    flushing = true
    defer { flushing = false }
    while let tap = pending.first {
      do {
        let fresh = try await Api.perform(tap)
        pending.removeFirst()
        if pending.isEmpty { take(fresh) } else { save() }
        Link.shared.tellPhoneClockChanged()
      } catch let failure as ApiFailure where failure.isRefusal {
        // The server said no (say, already clocked out on the phone). Drop this
        // tap and the ones built on it, say why, and show the real state.
        Failures.report(failure)
        pending = []
        save()
        problem = Failures.describe(failure)
        WKInterfaceDevice.current().play(.failure)
        if let fresh = try? await Api.clock() { take(fresh) }
        return
      } catch {
        handle(error, quietWhenOffline: true)
        return
      }
    }
  }

  private func handle(_ error: Error, quietWhenOffline: Bool) {
    Failures.report(error)
    if let failure = error as? ApiFailure, failure.status == 401 {
      Link.shared.forgetToken()
      state = nil
      pending = []
      save()
    }
    // Offline with taps saved: the "saved on your watch" line says it all.
    if quietWhenOffline, (error as? ApiFailure)?.isNetwork == true { return }
    problem = Failures.describe(error)
  }

  private func take(_ fresh: ClockState) {
    if let serverNow = Iso.parse(fresh.server_now) { skew = serverNow.timeIntervalSince(Date()) }
    state = fresh
    if fresh.shift != nil { chosenWorkplace = nil }
    save()
  }

  private func save() {
    defaults.set(try? JSONEncoder().encode(pending), forKey: "pending")
    defaults.set(state.flatMap { try? JSONEncoder().encode($0) }, forKey: "state")
    defaults.set(skew, forKey: "skew")
    // The watch face reads what was just saved.
    Face.write(state, skew: skew, signedIn: Link.shared.signedIn, lang: Link.shared.lang)
  }

  // MARK: - drawing a tap before the server has it (as applyClockAction does on the phone)

  static func apply(_ tap: PendingTap, to state: ClockState) -> ClockState {
    var next = state
    switch tap.action {
    case .clockIn:
      let place = state.workplaces.first { $0.id == tap.workplace }
      next.selected = tap.workplace ?? state.selected
      next.shift = OpenShift(status: "WORKING", workplace: place, clock_in: tap.client_time, banked_break_seconds: 0, running_break: nil)
    case .startBreak:
      guard let shift = state.shift else { return state }
      next.shift = OpenShift(status: "ON_BREAK", workplace: shift.workplace, clock_in: shift.clock_in,
                             banked_break_seconds: shift.banked_break_seconds, running_break: RunningBreak(start: tap.client_time))
    case .endBreak:
      guard let shift = state.shift else { return state }
      var banked = shift.banked_break_seconds
      if let start = shift.running_break.flatMap({ Iso.parse($0.start) }), let end = Iso.parse(tap.client_time) {
        banked += max(0, Int(end.timeIntervalSince(start)))
      }
      next.shift = OpenShift(status: "WORKING", workplace: shift.workplace, clock_in: shift.clock_in, banked_break_seconds: banked, running_break: nil)
    case .clockOut:
      next.shift = nil
    }
    return next
  }

  // MARK: - timers

  /// Seconds worked so far: since clock-in, less every break (the running one included).
  func workedSeconds(at date: Date) -> Int {
    guard let shift = state?.shift, let start = Iso.parse(shift.clock_in) else { return 0 }
    let now = now(date)
    var seconds = now.timeIntervalSince(start) - Double(shift.banked_break_seconds)
    if let breakStart = shift.running_break.flatMap({ Iso.parse($0.start) }) { seconds -= now.timeIntervalSince(breakStart) }
    return max(0, Int(seconds))
  }

  // MARK: - this week and the cap (as the face works them out, see Face.swift)

  /// Seconds worked since `server_now` on a shift still running — what the saved totals lack.
  private func sinceSaved(at date: Date) -> Int {
    guard let state, state.shift?.status == "WORKING", let saved = Iso.parse(state.server_now) else { return 0 }
    let from = max(saved, Iso.parse(state.shift?.clock_in ?? "") ?? saved)
    return max(0, Int(now(date).timeIntervalSince(from)))
  }

  func weekSeconds(at date: Date) -> Int? {
    state?.week.map { $0.worked.seconds + sinceSaved(at: date) }
  }

  /// The cap's hours used, counting a shift running at that workplace.
  func limitUsed(at date: Date) -> Int? {
    guard let limit = state?.limit else { return nil }
    let here = state?.shift?.workplace?.id != nil && state?.shift?.workplace?.id == limit.workplace?.id
    return limit.used.seconds + (here ? sinceSaved(at: date) : 0)
  }

  /// ok, close or over, as the server works it out: close from 90%, over at the cap.
  func limitState(at date: Date) -> String? {
    guard let limit = state?.limit, let used = limitUsed(at: date) else { return nil }
    guard limit.cap.seconds > 0 else { return limit.state }
    if used >= limit.cap.seconds { return "over" }
    if used * 10 >= limit.cap.seconds * 9 { return "close" }
    return "ok"
  }

  func breakSeconds(at date: Date) -> Int {
    guard let start = state?.shift?.running_break.flatMap({ Iso.parse($0.start) }) else { return 0 }
    return max(0, Int(now(date).timeIntervalSince(start)))
  }
}
