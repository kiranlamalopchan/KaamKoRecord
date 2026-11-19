import SwiftUI

/// The second page (swipe up or turn the crown): hours so far this week and
/// the workplace's cap — amber when close, red when over. Counts on while a
/// shift runs.
struct WeekScreen: View {
  @EnvironmentObject private var clock: ClockModel

  var body: some View {
    TimelineView(.periodic(from: .now, by: 30)) { context in
      ScrollView {
        VStack(spacing: 6) {
          Text(tr("This week"))
            .font(.footnote.weight(.semibold))
            .foregroundStyle(.secondary)
          if let week = clock.weekSeconds(at: context.date) {
            Text(Clockface.hm(week))
              .font(.system(size: 32, weight: .semibold, design: .rounded).monospacedDigit())
              .accessibilityLabel(tr("This week") + ", " + Clockface.hm(week))
          }
          if let limit = clock.state?.limit, let used = clock.limitUsed(at: context.date) {
            Limit(limit: limit, used: used, state: clock.limitState(at: context.date) ?? limit.state)
          } else {
            Text(tr("No hours limit set"))
              .font(.caption2)
              .foregroundStyle(.secondary)
              .multilineTextAlignment(.center)
          }
        }
        .frame(maxWidth: .infinity)
      }
    }
    .navigationTitle(tr("This week"))
  }
}

private struct Limit: View {
  let limit: LimitCard
  let used: Int
  let state: String

  private var colour: Color {
    switch state {
    case "over": return Color("danger")
    case "close": return Color("warn")
    default: return Color("brand")
    }
  }

  private var title: String {
    switch limit.period_label {
    case "fortnight": return tr("Fortnightly limit")
    case "month": return tr("Monthly limit")
    default: return tr("Weekly limit")
    }
  }

  var body: some View {
    let cap = max(limit.cap.seconds, 1)
    let left = limit.cap.seconds - used
    VStack(spacing: 4) {
      ProgressView(value: Double(min(used, cap)), total: Double(cap))
        .tint(colour)
        .accessibilityHidden(true)
      Text(title).font(.caption2).foregroundStyle(.secondary)
      Text(tr("{used} of {cap}", ["used": Clockface.hm(used), "cap": Clockface.hm(limit.cap.seconds)]))
        .font(.headline)
        .foregroundStyle(colour)
      Text(left >= 0 ? tr("{time} left", ["time": Clockface.hm(left)]) : tr("{time} over", ["time": Clockface.hm(-left)]))
        .font(.footnote)
        .foregroundStyle(colour)
      if let resets = limit.resets_on {
        Text(tr("Resets {day}", ["day": resets])).font(.caption2).foregroundStyle(.secondary)
      }
    }
    .padding(.top, 4)
    .accessibilityElement(children: .combine)
  }
}
