import ActivityKit
import ExpoModulesCore
import WidgetKit

// Mirrors StandingTimerContent in src/index.ts. channelName and actionLabel are for the Android notification.
struct StandingTimerRecord: Record {
  @Field var title: String = ""
  @Field var text: String = ""
  @Field var step: String = ""
  @Field var tapHint: String = ""
  @Field var countdownMs: Double?

  func state(at now: Date) -> StandingActivityAttributes.ContentState {
    StandingActivityAttributes.ContentState(
      title: title,
      text: text,
      step: step,
      tapHint: tapHint,
      // A late update can see a reading that has just opened; a range never runs backwards.
      countdown: countdownMs.map { now...now.addingTimeInterval(max(0, $0) / 1000) }
    )
  }
}

private typealias StandingActivity = Activity<StandingActivityAttributes>

// ADR 0005: a local Live Activity with no push. The app is open for the whole test, which ActivityKit needs to
// start one.
// https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities
private enum StandingTimer {
  static func start(_ state: StandingActivityAttributes.ContentState) async throws {
    // A timer left over from a test the app never finished (it was closed mid-test) must not stay up.
    await end()
    // The user turned Live Activities off for Lumen; the in-app timer still runs, so there is nothing to report.
    guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
    _ = try StandingActivity.request(
      attributes: StandingActivityAttributes(),
      content: ActivityContent(state: state, staleDate: nil),
      pushType: nil
    )
  }

  // Like the Android notification, an update brings the timer back if it is not showing.
  static func update(_ state: StandingActivityAttributes.ContentState) async throws {
    let running = StandingActivity.activities
    if running.isEmpty {
      try await start(state)
      return
    }
    for activity in running {
      await activity.update(ActivityContent(state: state, staleDate: nil))
    }
  }

  static func end() async {
    for activity in StandingActivity.activities {
      await activity.end(nil, dismissalPolicy: .immediate)
    }
  }
}

// The iOS side of src/index.ts: the same five calls as the Android module (LumenWidgetsModule.kt).
public final class LumenWidgetsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LumenWidgets")

    AsyncFunction("publishSnapshot") { (snapshotJson: String, displayJson: String) in
      // Parsed once here so a bad payload rejects the call instead of breaking the widgets later.
      _ = try WidgetContent(snapshotJson: snapshotJson, displayJson: displayJson)
      try WidgetStore.write(snapshotJson: snapshotJson, displayJson: displayJson)
      WidgetCenter.shared.reloadAllTimelines()
    }

    // The copy alone, at every launch (publishWidgetCopy in publish.ts): a widget placed before the first reading
    // then draws the app's empty state, in the app's language and palette, instead of only the mark. Android has
    // the same call (LumenWidgetsModule.kt). https://developer.apple.com/documentation/widgetkit/widgetcenter
    AsyncFunction("publishDisplay") { (displayJson: String) in
      _ = try WidgetContent(snapshotJson: nil, displayJson: displayJson)
      try WidgetStore.writeDisplay(displayJson)
      WidgetCenter.shared.reloadAllTimelines()
    }

    // Async closures run as Swift concurrency tasks (ConcurrentFunctionFactories.swift in expo-modules-core 57),
    // which ActivityKit's async update and end need.
    AsyncFunction("startStandingTimer") { (content: StandingTimerRecord) async throws in
      try await StandingTimer.start(content.state(at: Date()))
    }

    AsyncFunction("updateStandingTimer") { (content: StandingTimerRecord) async throws in
      try await StandingTimer.update(content.state(at: Date()))
    }

    AsyncFunction("endStandingTimer") { () async in
      await StandingTimer.end()
    }
  }
}
