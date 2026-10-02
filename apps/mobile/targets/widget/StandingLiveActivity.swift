import ActivityKit
import SwiftUI
import WidgetKit

// Mockup 33: the standing-test live timer on the lock screen and in the Dynamic Island (LIVE-1). The app
// starts, updates and ends it; the system counts down by itself from the dates in the content, so no update is
// needed between steps. Every tap opens the standing test.
// https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities
struct StandingLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: StandingActivityAttributes.self) { context in
      StandingLockView(state: context.state).widgetURL(LumenLink.standing)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Label {
            Text(context.state.title)
          } icon: {
            LumenMark().frame(width: 18, height: 18)
          }
          .font(.headline)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(context.state.step).font(.subheadline).foregroundColor(.secondary)
        }
        DynamicIslandExpandedRegion(.bottom) {
          StandingCountdown(state: context.state, accent: islandAccent)
        }
      } compactLeading: {
        LumenMark().frame(width: 18, height: 18).foregroundColor(islandAccent)
      } compactTrailing: {
        if let countdown = context.state.countdown {
          Text(timerInterval: countdown, countsDown: true)
            .monospacedDigit()
            .frame(maxWidth: 44)
            .foregroundColor(islandAccent)
        }
      } minimal: {
        LumenMark().frame(width: 16, height: 16).foregroundColor(islandAccent)
      }
      .widgetURL(LumenLink.standing)
      .keylineTint(islandAccent)
    }
  }
}

// The Dynamic Island is always black, so it takes the dark theme's accent from the published palette.
private var islandAccent: Color {
  palettes().map { Color(hex: $0.dark.accentFill) } ?? .accentColor
}

// The live timer has no snapshot of its own; it borrows the widgets' published palette. Before the first
// publish, or if the store is unreadable (the widget provider logs why), it falls back to the system colors.
private func palettes() -> WidgetPalettes? {
  (try? WidgetStore.read())?.display.palette
}

private struct StandingLockView: View {
  @Environment(\.colorScheme) private var scheme
  let state: StandingActivityAttributes.ContentState

  var body: some View {
    let palette = palettes().map { scheme == .dark ? $0.dark : $0.light }
    let accent = palette.map { Color(hex: $0.accentFill) } ?? .accentColor
    VStack(alignment: .leading, spacing: 10) {
      HStack {
        LumenMark().frame(width: 20, height: 20).foregroundColor(accent)
        Text(state.title).font(.headline)
        Spacer()
        Text(state.step).font(.subheadline).foregroundColor(.secondary)
      }
      StandingCountdown(state: state, accent: accent)
    }
    .padding(16)
    .foregroundColor(palette.map { Color(hex: $0.text) } ?? .primary)
    .activityBackgroundTint(palette.map { Color(hex: $0.surface) })
  }
}

// "Next reading in 1:42", the bar filling toward the next reading, and "Tap to measure". While a reading is
// due there is no countdown, only the text.
private struct StandingCountdown: View {
  let state: StandingActivityAttributes.ContentState
  let accent: Color

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(alignment: .firstTextBaseline) {
        Text(state.text).font(.body)
        Spacer()
        if let countdown = state.countdown {
          Text(timerInterval: countdown, countsDown: true)
            .font(.system(size: 28, weight: .bold))
            .monospacedDigit()
            .foregroundColor(accent)
            .multilineTextAlignment(.trailing)
        }
      }
      if let countdown = state.countdown {
        ProgressView(timerInterval: countdown, countsDown: false) {
          EmptyView()
        } currentValueLabel: {
          EmptyView()
        }
        .tint(accent)
      }
      Text(state.tapHint).font(.subheadline).foregroundColor(.secondary)
    }
  }
}
