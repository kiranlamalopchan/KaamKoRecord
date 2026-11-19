import SwiftUI
import WatchKit

@main
struct KaamKoRecordWatchApp: App {
  @WKApplicationDelegateAdaptor(AppDelegate.self) private var delegate
  @StateObject private var clock = ClockModel()
  @Environment(\.scenePhase) private var phase
  static let liveEvery: Double = 20

  var body: some Scene {
    WindowGroup {
      ClockScreen()
        .environmentObject(clock)
        // On screen: ask the server again every LIVE_EVERY, so a change made
        // on the phone or the website shows here even if the phone's message
        // didn't come (the phone also sends each change the moment it happens).
        // Off screen it stops, which keeps the battery for the day.
        .task(id: phase) {
          guard phase == .active else { return }
          await clock.refresh()
          while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(KaamKoRecordWatchApp.liveEvery))
            if Task.isCancelled { break }
            await clock.refresh()
          }
        }
    }
  }
}

/// watchOS wakes the app in the background when the phone sends the clock
/// for the watch face; the link keeps the task until it has all arrived.
final class AppDelegate: NSObject, WKApplicationDelegate {
  func applicationDidFinishLaunching() {
    _ = Link.shared
  }

  func handle(_ backgroundTasks: Set<WKRefreshBackgroundTask>) {
    for task in backgroundTasks {
      if let link = task as? WKWatchConnectivityRefreshBackgroundTask {
        Link.shared.hold(link)
      } else if let snapshot = task as? WKSnapshotRefreshBackgroundTask {
        snapshot.setTaskCompleted(restoredDefaultState: true, estimatedSnapshotExpiration: .distantFuture, userInfo: nil)
      } else {
        task.setTaskCompletedWithSnapshot(false)
      }
    }
  }
}
