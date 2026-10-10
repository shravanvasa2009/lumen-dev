import ActivityKit
import SwiftUI
import WidgetKit

// Widgets mockup: the standing-test live timer on the lock screen and in the Dynamic Island (LIVE-1). The app
// starts, updates and ends it; the system counts down by itself from the dates in the content, so no update is
// needed between steps. Every tap opens the standing test. It shows a countdown, never a reading.
// https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities
// https://developer.apple.com/documentation/widgetkit/activityconfiguration
struct StandingLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: StandingActivityAttributes.self) { context in
      StandingLockView(state: context.state).widgetURL(LumenLink.standing)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          LumenMark().frame(width: 22, height: 22).foregroundColor(darkColors.accent)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(context.state.step).font(.footnote).foregroundColor(darkColors.textDim)
        }
        DynamicIslandExpandedRegion(.center) {
          Text(context.state.title).font(.subheadline.weight(.semibold)).foregroundColor(darkColors.text)
        }
        DynamicIslandExpandedRegion(.bottom) {
          StandingCountdown(state: context.state, colors: darkColors, timerSize: 28, showsTapHint: false)
        }
      } compactLeading: {
        LumenMark().frame(width: 18, height: 18).foregroundColor(darkColors.accent)
      } compactTrailing: {
        if let countdown = context.state.countdown {
          Text(timerInterval: countdown, countsDown: true)
            .font(.system(size: 15, weight: .semibold, design: .rounded))
            .monospacedDigit()
            .frame(maxWidth: 44)
            .foregroundColor(darkColors.accent)
        }
      } minimal: {
        LumenMark().frame(width: 18, height: 18).foregroundColor(darkColors.accent)
      }
      .widgetURL(LumenLink.standing)
      .keylineTint(darkColors.accent)
    }
  }
}

// The colors the timer draws with. The Dynamic Island is black in both themes, and the mockup's lock-screen card is
// the see-through dark one, so both take the dark palette the app published; before the first publish, or if the
// store is unreadable (the widget provider logs why), the system colors stand in.
private struct TimerColors {
  let text: Color
  let textDim: Color
  let accent: Color
  let surface: Color?
}

private var darkColors: TimerColors {
  guard let palette = (try? WidgetStore.read())?.display.palette.dark else {
    return TimerColors(text: .white, textDim: .gray, accent: .accentColor, surface: nil)
  }
  let colors = WidgetColors(palette)
  return TimerColors(
    text: colors.text, textDim: colors.textDim, accent: colors.accent, surface: colors.surface)
}

// The mockup's card is the dark surface at about 82%, over the lock screen's wallpaper.
private let lockCardOpacity = 0.82

private struct StandingLockView: View {
  let state: StandingActivityAttributes.ContentState

  var body: some View {
    let colors = darkColors
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 4) {
        LumenMark().frame(width: 20, height: 20).foregroundColor(colors.accent)
        Text(state.title).font(.headline).foregroundColor(colors.text).lineLimit(1)
        Spacer(minLength: 8)
        Text(state.step).font(.subheadline).foregroundColor(colors.textDim)
      }
      StandingCountdown(state: state, colors: colors, timerSize: 34, showsTapHint: true)
    }
    .padding(16)
    .activityBackgroundTint(colors.surface?.opacity(lockCardOpacity))
    .activitySystemActionForegroundColor(colors.text)
  }
}

// "Next reading in 1:42", the bar filling toward the next reading, and "Tap to measure". While a reading is due
// there is no countdown, only the text.
private struct StandingCountdown: View {
  let state: StandingActivityAttributes.ContentState
  let colors: TimerColors
  let timerSize: CGFloat
  let showsTapHint: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(alignment: .firstTextBaseline) {
        Text(state.text).font(.subheadline).foregroundColor(colors.text)
        Spacer()
        if let countdown = state.countdown {
          Text(timerInterval: countdown, countsDown: true)
            .font(.system(size: timerSize, weight: .semibold, design: .rounded))
            .monospacedDigit()
            .foregroundColor(colors.accent)
            .multilineTextAlignment(.trailing)
        }
      }
      if let countdown = state.countdown {
        ProgressView(timerInterval: countdown, countsDown: false) {
          EmptyView()
        } currentValueLabel: {
          EmptyView()
        }
        .tint(colors.accent)
      }
      if showsTapHint || state.countdown == nil {
        Text(state.tapHint).font(.footnote).foregroundColor(colors.textDim)
      }
    }
  }
}
