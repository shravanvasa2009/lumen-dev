import SwiftUI
import WidgetKit

// The extension's entry point: the home and lock-screen widget, and the standing-test Live Activity UI.
@main
struct LumenWidgetBundle: WidgetBundle {
  var body: some Widget {
    LumenWidget()
    StandingLiveActivity()
  }
}
