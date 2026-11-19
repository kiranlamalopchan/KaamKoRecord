import SwiftUI
import WidgetKit

// The Apple Watch face complication. The watch app writes a FaceSnapshot to
// the shared app group whenever the clock changes (targets/watch/Face.swift)
// and asks for a redraw; the timers here count by themselves in between.

/// Keep in step with targets/watch/Face.swift, which writes it.
struct FaceSnapshot: Codable, Equatable {
  var signedIn: Bool
  var lang: String
  var status: String          // out | none | off | working | break
  var workplace: String?
  var workStart: Date?
  var breakStart: Date?
  var savedAt: Date?
  var weekSeconds: Int?
  var limitCap: Int?
  var limitUsed: Int?
  var limitHere: Bool
  var limitPeriod: String?

  static let group = "group.com.kiranlama.mywork"
  static let key = "watch.face"

  static func read() -> FaceSnapshot? {
    guard let data = UserDefaults(suiteName: group)?.data(forKey: key) else { return nil }
    return try? JSONDecoder().decode(FaceSnapshot.self, from: data)
  }

  static let preview = FaceSnapshot(
    signedIn: true, lang: "en", status: "working", workplace: "Woolworths",
    workStart: Date().addingTimeInterval(-(3 * 3600 + 42 * 60)), breakStart: nil, savedAt: Date(),
    weekSeconds: 18 * 3600 + 30 * 60, limitCap: 24 * 3600, limitUsed: 18 * 3600 + 30 * 60, limitHere: true, limitPeriod: "week")

  /// Worked since the totals were saved, on a shift still running.
  private func sinceSaved(at date: Date) -> Int {
    guard status == "working", let savedAt else { return 0 }
    let from = max(savedAt, workStart ?? savedAt)
    return max(0, Int(date.timeIntervalSince(from)))
  }

  func week(at date: Date) -> Int? { weekSeconds.map { $0 + sinceSaved(at: date) } }
  func used(at date: Date) -> Int? { limitUsed.map { $0 + (limitHere ? sinceSaved(at: date) : 0) } }
}

/// The few words the face needs, in English or Nepali as the phone is set.
private func say(_ text: String, _ lang: String) -> String {
  guard lang == "ne" else { return text }
  let ne = [
    "Working": "काम गर्दै", "On break": "ब्रेकमा", "Off shift": "सिफ्टमा छैन", "Work": "काम",
    "Break": "ब्रेक", "Off": "बन्द", "Week": "हप्ता", "Sign in on your phone": "फोनमा साइन इन गर्नुहोस्",
    "Open the app": "एप खोल्नुहोस्",
  ]
  return ne[text] ?? text
}

private func hm(_ seconds: Int) -> String {
  let s = max(0, seconds), h = s / 3600, m = (s % 3600) / 60
  if h > 0 && m > 0 { return "\(h)h \(m)m" }
  return h > 0 ? "\(h)h" : "\(m)m"
}

// MARK: - timeline

struct FaceEntry: TimelineEntry {
  let date: Date
  let face: FaceSnapshot?
}

struct FaceProvider: TimelineProvider {
  func placeholder(in context: Context) -> FaceEntry { FaceEntry(date: Date(), face: .preview) }

  func getSnapshot(in context: Context, completion: @escaping (FaceEntry) -> Void) {
    completion(FaceEntry(date: Date(), face: context.isPreview ? .preview : FaceSnapshot.read()))
  }

  /// The timers count by themselves; the week's hours step on every quarter hour
  /// while a shift runs. The app asks for a new timeline whenever the clock moves.
  func getTimeline(in context: Context, completion: @escaping (Timeline<FaceEntry>) -> Void) {
    let face = FaceSnapshot.read()
    let now = Date()
    if face?.status == "working" {
      let entries = (0..<48).map { FaceEntry(date: now.addingTimeInterval(TimeInterval($0) * 15 * 60), face: face) }
      completion(Timeline(entries: entries, policy: .atEnd))
    } else {
      completion(Timeline(entries: [FaceEntry(date: now, face: face)], policy: .never))
    }
  }
}

// MARK: - views

struct FaceView: View {
  @Environment(\.widgetFamily) private var family
  let entry: FaceEntry

  private var face: FaceSnapshot? { entry.face }
  private var lang: String { face?.lang ?? "en" }
  private var timerStart: Date? { face?.status == "break" ? face?.breakStart : face?.status == "working" ? face?.workStart : nil }
  private var tint: Color { face?.status == "break" ? Color("warn") : Color("brand") }
  private var symbol: String {
    switch face?.status {
    case "working": return "briefcase.fill"
    case "break": return "cup.and.saucer.fill"
    case "out": return "iphone"
    default: return "clock"
    }
  }
  private var label: String {
    switch face?.status {
    case "working": return say("Working", lang)
    case "break": return say("On break", lang)
    case "out": return say("Sign in on your phone", lang)
    case "off": return say("Off shift", lang)
    default: return "KaamKoRecord"
    }
  }
  private var short: String {
    switch face?.status {
    case "working": return say("Work", lang)
    case "break": return say("Break", lang)
    default: return say("Off", lang)
    }
  }
  private var weekLine: String? {
    guard let face, let week = face.week(at: entry.date) else { return nil }
    var line = "\(say("Week", lang)) \(hm(week))"
    if let cap = face.limitCap, let used = face.used(at: entry.date) { line = "\(say("Week", lang)) \(hm(used))/\(hm(cap))" }
    return line
  }

  var body: some View {
    switch family {
    case .accessoryRectangular: rectangular
    case .accessoryInline: inline
    case .accessoryCorner: corner
    default: circular
    }
  }

  private var circular: some View {
    ZStack {
      AccessoryWidgetBackground()
      VStack(spacing: 0) {
        Image(systemName: symbol).font(.system(size: 13, weight: .semibold)).foregroundStyle(tint)
        if let timerStart {
          Text(timerStart, style: .timer)
            .font(.system(size: 12, weight: .semibold, design: .rounded).monospacedDigit())
            .multilineTextAlignment(.center)
            .minimumScaleFactor(0.6)
        } else {
          Text(short).font(.system(size: 12, weight: .semibold))
        }
      }
      .padding(2)
    }
    .widgetAccentable()
  }

  private var rectangular: some View {
    VStack(alignment: .leading, spacing: 1) {
      HStack(spacing: 4) {
        Image(systemName: symbol).foregroundStyle(tint)
        Text([label, face?.workplace].compactMap { $0 }.joined(separator: " · ")).lineLimit(1)
      }
      .font(.system(size: 13, weight: .semibold))
      .widgetAccentable()
      if let timerStart {
        Text(timerStart, style: .timer)
          .font(.system(size: 22, weight: .semibold, design: .rounded).monospacedDigit())
          .lineLimit(1)
      }
      if let weekLine {
        Text(weekLine).font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(1)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  @ViewBuilder private var inline: some View {
    if let timerStart {
      Text("\(short) ") + Text(timerStart, style: .timer)
    } else {
      Text("KaamKoRecord · \(short)")
    }
  }

  @ViewBuilder private var corner: some View {
    if let timerStart {
      Text(timerStart, style: .timer)
        .font(.system(size: 14, weight: .semibold).monospacedDigit())
        .widgetLabel(label)
    } else {
      Image(systemName: symbol)
        .font(.system(size: 18, weight: .semibold))
        .widgetLabel(label)
    }
  }
}

@main
struct KaamKoRecordFace: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "KaamKoRecordFace", provider: FaceProvider()) { entry in
      FaceView(entry: entry)
        .containerBackground(for: .widget) { Color.clear }
    }
    .configurationDisplayName("KaamKoRecord")
    .description("Your shift time and this week's hours.")
    .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline, .accessoryCorner])
  }
}
