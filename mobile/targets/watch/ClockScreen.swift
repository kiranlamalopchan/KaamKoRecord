import SwiftUI

struct ClockScreen: View {
  @EnvironmentObject private var clock: ClockModel
  @ObservedObject private var link = Link.shared
  @State private var askClockOut = false

  var body: some View {
    NavigationStack {
      // Swipe up (or turn the crown) for this week at a glance.
      TabView {
        Group {
          if !link.signedIn {
            SignInOnPhone()
          } else if let state = clock.state {
            if state.workplaces.isEmpty {
              Note(symbol: "building.2", title: tr("Workplace"), text: tr("Add a workplace on your phone first."))
            } else if let shift = state.shift {
              OnShift(shift: shift, askClockOut: $askClockOut)
            } else {
              OffShift()
            }
          } else if let problem = clock.problem {
            Problem(text: problem)
          } else {
            ProgressView()
          }
        }
        .navigationTitle("KaamKoRecord")
        if link.signedIn, clock.state != nil {
          WeekScreen()
        }
      }
      .tabViewStyle(.verticalPage)
    }
    .tint(Color("brand"))
    .confirmationDialog(tr("Clock out?"), isPresented: $askClockOut, titleVisibility: .visible) {
      Button(tr("Clock out"), role: .destructive) { clock.clockOut() }
      Button(tr("Cancel"), role: .cancel) {}
    }
  }
}

// MARK: - off the clock

private struct OffShift: View {
  @EnvironmentObject private var clock: ClockModel

  var body: some View {
    ScrollView {
      VStack(spacing: 10) {
        if let state = clock.state, state.workplaces.count > 1 {
          NavigationLink {
            WorkplacePicker()
          } label: {
            PlaceLine(name: clock.workplace?.name ?? "", chevron: true)
          }
          .buttonStyle(.plain)
        } else {
          PlaceLine(name: clock.workplace?.name ?? "", chevron: false)
        }
        BigButton(title: tr("Clock in"), symbol: "play.fill", fill: Color("brand"), ink: Color("brandInk")) {
          clock.clockIn()
        }
        .disabled(clock.workplace == nil || clock.busy)
        Footer()
      }
    }
  }
}

private struct WorkplacePicker: View {
  @EnvironmentObject private var clock: ClockModel
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    List(clock.state?.workplaces ?? []) { place in
      Button {
        clock.chosenWorkplace = place.id
        dismiss()
      } label: {
        HStack {
          Text(place.name).lineLimit(2)
          Spacer()
          if place.id == clock.workplace?.id { Image(systemName: "checkmark").foregroundStyle(Color("brand")) }
        }
      }
    }
    .navigationTitle(tr("Workplace"))
  }
}

// MARK: - on the clock

private struct OnShift: View {
  @EnvironmentObject private var clock: ClockModel
  let shift: OpenShift
  @Binding var askClockOut: Bool

  private var onBreak: Bool { shift.status == "ON_BREAK" }

  var body: some View {
    ScrollView {
      VStack(spacing: 8) {
        PlaceLine(name: shift.workplace?.name ?? "", chevron: false)
        TimelineView(.periodic(from: .now, by: 1)) { context in
          VStack(spacing: 2) {
            Text(onBreak ? tr("On break") : tr("Working"))
              .font(.footnote.weight(.semibold))
              .foregroundStyle(onBreak ? Color("warn") : Color("brand"))
            Text(Clockface.hms(onBreak ? clock.breakSeconds(at: context.date) : clock.workedSeconds(at: context.date)))
              .font(.system(size: 34, weight: .semibold, design: .rounded).monospacedDigit())
              .minimumScaleFactor(0.6)
              .lineLimit(1)
              .accessibilityLabel(onBreak ? tr("On break") : tr("Working"))
            Text(caption(at: context.date))
              .font(.caption2)
              .foregroundStyle(.secondary)
          }
        }
        if onBreak {
          BigButton(title: tr("End break"), symbol: "play.fill", fill: Color("brand"), ink: Color("brandInk")) { clock.endBreak() }
            .disabled(clock.busy)
        } else {
          BigButton(title: tr("Start break"), symbol: "cup.and.saucer.fill", fill: Color("warn"), ink: .black) { clock.startBreak() }
            .disabled(clock.busy)
        }
        BigButton(title: tr("Clock out"), symbol: "stop.fill", fill: Color("danger").opacity(0.22), ink: Color("danger")) { askClockOut = true }
          .disabled(clock.busy)
        Footer()
      }
    }
  }

  private func caption(at date: Date) -> String {
    if onBreak {
      return tr("Worked {time}", ["time": Clockface.hm(clock.workedSeconds(at: date))])
    }
    let since = Iso.parse(shift.clock_in).map { $0.formatted(date: .omitted, time: .shortened) } ?? ""
    return tr("Since {time}", ["time": since])
  }
}

// MARK: - pieces

private struct PlaceLine: View {
  let name: String
  let chevron: Bool

  var body: some View {
    HStack(spacing: 4) {
      Image(systemName: "mappin.circle.fill").foregroundStyle(Color("brand"))
      Text(name).font(.footnote).lineLimit(1)
      if chevron { Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.secondary) }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .combine)
    .accessibilityHint(chevron ? tr("Workplace") : "")
  }
}

private struct BigButton: View {
  let title: String
  let symbol: String
  let fill: Color
  let ink: Color
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Label(title, systemImage: symbol)
        .font(.headline)
        .frame(maxWidth: .infinity, minHeight: 44)
    }
    .buttonStyle(.borderedProminent)
    .tint(fill)
    .foregroundStyle(ink)
  }
}

/// The saved-offline line and the last problem, under the buttons.
private struct Footer: View {
  @EnvironmentObject private var clock: ClockModel

  var body: some View {
    VStack(spacing: 4) {
      if !clock.pending.isEmpty {
        Label(tr("Saved on your watch · Syncing when connected"), systemImage: "icloud.slash")
          .font(.caption2)
          .foregroundStyle(.secondary)
      }
      if let problem = clock.problem {
        Text(problem)
          .font(.caption2)
          .foregroundStyle(Color("danger"))
          .multilineTextAlignment(.center)
          .accessibilityAddTraits(.updatesFrequently)
      }
    }
    .padding(.top, 2)
  }
}

private struct SignInOnPhone: View {
  var body: some View {
    Note(symbol: "iphone", title: tr("Sign in on your phone"), text: tr("Open KaamKoRecord on your phone and sign in. Your watch follows."))
  }
}

private struct Problem: View {
  @EnvironmentObject private var clock: ClockModel
  let text: String

  var body: some View {
    ScrollView {
      VStack(spacing: 8) {
        Image(systemName: "wifi.exclamationmark").font(.title2).foregroundStyle(.secondary)
        Text(text).font(.footnote).multilineTextAlignment(.center)
        Button(tr("Try again")) { Task { await clock.refresh() } }
      }
    }
  }
}

private struct Note: View {
  let symbol: String
  let title: String
  let text: String

  var body: some View {
    ScrollView {
      VStack(spacing: 6) {
        Image(systemName: symbol).font(.title2).foregroundStyle(Color("brand"))
        Text(title).font(.headline).multilineTextAlignment(.center)
        Text(text).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
      }
    }
  }
}

enum Clockface {
  static func hms(_ seconds: Int) -> String {
    String(format: "%d:%02d:%02d", seconds / 3600, (seconds % 3600) / 60, seconds % 60)
  }

  static func hm(_ seconds: Int) -> String {
    let h = seconds / 3600, m = (seconds % 3600) / 60
    return h > 0 ? "\(h)h \(m)m" : "\(m)m"
  }
}
