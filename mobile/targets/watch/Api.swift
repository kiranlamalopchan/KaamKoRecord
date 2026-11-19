import Foundation
import os

// MARK: - what the server sends (apps/api/views/timeclock.py `clock_state`)

struct WorkplaceBrief: Codable, Equatable, Identifiable {
  let id: Int
  let name: String
}

struct RunningBreak: Codable, Equatable {
  let start: String
}

struct OpenShift: Codable, Equatable {
  let status: String  // WORKING | ON_BREAK
  let workplace: WorkplaceBrief?
  let clock_in: String
  let banked_break_seconds: Int
  let running_break: RunningBreak?
}

/// A length of time as the server sends it; only the seconds are needed here.
struct Span: Codable, Equatable {
  let seconds: Int
}

/// The chosen workplace's hours cap, as of `server_now` (apps/api `limit_card`).
struct LimitCard: Codable, Equatable {
  let workplace: WorkplaceBrief?
  let cap: Span
  let used: Span
  let period_label: String  // week | fortnight | month
  let state: String         // ok | close | over
  let resets_on: String?
}

/// Every workplace's hours since the week began, as of `server_now`.
struct WeekCard: Codable, Equatable {
  let worked: Span
}

struct ClockState: Codable, Equatable {
  let server_now: String
  var workplaces: [WorkplaceBrief]
  var selected: Int?
  var shift: OpenShift?
  var limit: LimitCard?
  var week: WeekCard?
}

// MARK: - one clock tap, kept until the server has it

enum ClockAction: String, Codable {
  case clockIn = "clock_in", startBreak = "start_break", endBreak = "end_break", clockOut = "clock_out"

  var path: String {
    switch self {
    case .clockIn: return "timesheet/clock-in/"
    case .startBreak: return "timesheet/break/start/"
    case .endBreak: return "timesheet/break/end/"
    case .clockOut: return "timesheet/clock-out/"
    }
  }
}

/// The same fields the phone's offline queue sends (src/offline/clock.ts):
/// `client_id` lets the server recognise a retry, `client_time` keeps the
/// moment of the tap rather than the moment it got through.
struct PendingTap: Codable, Equatable {
  let action: ClockAction
  let client_id: String
  let client_time: String
  let client_tz: String
  let workplace: Int?

  init(_ action: ClockAction, workplace: Int? = nil) {
    self.action = action
    self.workplace = workplace
    client_id = UUID().uuidString.lowercased()
    client_time = Iso.format(Date())
    client_tz = TimeZone.current.identifier
  }
}

// MARK: - failures, worded for people and reported for developers

struct ApiFailure: Error {
  let status: Int          // 0 = never reached the server
  let detail: String?      // the server's sentence, when it wrote one for people
  let method: String
  let path: String
  let requestId: String
  let underlying: String?

  var isNetwork: Bool { status == 0 }
  var isAuth: Bool { status == 401 || status == 403 }
  /// The server looked at the tap and said no (already clocked out, …): retrying won't help.
  var isRefusal: Bool { status == 400 || status == 409 }
}

enum Failures {
  private static let log = Logger(subsystem: "com.kiranlama.mywork.watch", category: "errors")

  /// The one way an error becomes words on the watch.
  static func describe(_ error: Error) -> String {
    guard let f = error as? ApiFailure else { return tr("Something went wrong. Please try again.") }
    if f.isNetwork { return tr("We couldn't connect. Check your internet and try again.") }
    if f.status >= 500 { return tr("Something went wrong on our side. Please try again.") }
    if f.status == 401 { return tr("Open KaamKoRecord on your phone and sign in. Your watch follows.") }
    if f.status == 429 { return tr("Too many tries. Wait a minute, then try again.") }
    if f.isRefusal, let detail = f.detail, isWrittenForPeople(detail) { return detail }
    return tr("Something went wrong. Please try again.")
  }

  /// A one-line JSON report for developers. Never the token, the body or a query string.
  static func report(_ error: Error) {
    var report: [String: Any] = [
      "at": Iso.format(Date()), "app": "KaamKoRecord", "platform": "watchos",
    ]
    if let f = error as? ApiFailure {
      report["kind"] = f.isNetwork ? "network" : f.isAuth ? "auth" : f.status >= 500 ? "server" : f.isRefusal ? "validation" : "request"
      report["status"] = f.status
      report["request"] = ["method": f.method, "path": f.path.components(separatedBy: "?")[0], "id": f.requestId]
      report["message"] = f.isRefusal ? "Request validation failed" : (f.underlying ?? "HTTP \(f.status)")
    } else {
      report["kind"] = "app"
      report["name"] = String(describing: type(of: error))
      report["message"] = String(describing: error)
    }
    if let data = try? JSONSerialization.data(withJSONObject: report), let line = String(data: data, encoding: .utf8) {
      log.error("\(line, privacy: .public)")
    }
  }

  private static func isWrittenForPeople(_ text: String) -> Bool {
    text.range(of: #"Traceback|Exception|\bat .+:\d+|HTTP \d|[<>]"#, options: .regularExpression) == nil
  }
}

// MARK: - the requests

enum Api {
  private static let session: URLSession = {
    let config = URLSessionConfiguration.default
    config.timeoutIntervalForRequest = 15
    config.waitsForConnectivity = false
    return URLSession(configuration: config)
  }()

  static func clock() async throws -> ClockState {
    try await send("GET", "timesheet/clock/", body: nil)
  }

  static func perform(_ tap: PendingTap) async throws -> ClockState {
    var body: [String: Any] = ["client_id": tap.client_id, "client_time": tap.client_time, "client_tz": tap.client_tz]
    if let workplace = tap.workplace { body["workplace"] = workplace }
    return try await send("POST", tap.action.path, body: body)
  }

  private static func send(_ method: String, _ path: String, body: [String: Any]?) async throws -> ClockState {
    let link = Link.shared
    let requestId = UUID().uuidString.lowercased()
    guard let token = link.token, let url = URL(string: "\(link.server)/api/v1/\(path)") else {
      throw ApiFailure(status: 401, detail: nil, method: method, path: path, requestId: requestId, underlying: "not signed in")
    }
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.setValue("Token \(token)", forHTTPHeaderField: "Authorization")
    request.setValue(requestId, forHTTPHeaderField: "X-Request-ID")
    request.setValue(link.lang, forHTTPHeaderField: "Accept-Language")
    if let body {
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = try JSONSerialization.data(withJSONObject: body)
    }

    let data: Data, response: URLResponse
    do {
      (data, response) = try await session.data(for: request)
    } catch {
      throw ApiFailure(status: 0, detail: nil, method: method, path: path, requestId: requestId, underlying: (error as NSError).domain + " \((error as NSError).code)")
    }
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(status) else {
      let detail = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["detail"] as? String
      throw ApiFailure(status: status, detail: detail, method: method, path: path, requestId: requestId, underlying: nil)
    }
    do {
      return try JSONDecoder().decode(ClockState.self, from: data)
    } catch {
      throw ApiFailure(status: 502, detail: nil, method: method, path: path, requestId: requestId, underlying: "unreadable reply")
    }
  }
}

// MARK: - dates as Django writes them ("2026-11-19T03:12:45.123456+00:00")

enum Iso {
  private static let withFraction: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
  }()
  private static let plain = ISO8601DateFormatter()

  static func parse(_ text: String) -> Date? {
    // Foundation reads at most milliseconds; Python writes microseconds.
    let trimmed = text.replacingOccurrences(of: #"(\.\d{3})\d+"#, with: "$1", options: .regularExpression)
    return withFraction.date(from: trimmed) ?? plain.date(from: trimmed)
  }

  static func format(_ date: Date) -> String { withFraction.string(from: date) }
}
