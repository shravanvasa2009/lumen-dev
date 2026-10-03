import { NativeModule, requireOptionalNativeModule } from 'expo';

// What the standing-test live timer shows (LIVE-1): the Android ongoing notification and the iOS Live Activity.
// Every string comes from lockscreen.json, so neither carries a value or a condition name (WID-2).
type StandingTimerContent = {
  // Android only: the notification channel's name and the "Measure now" action button.
  channelName: string;
  actionLabel: string;
  title: string;
  text: string;
  // "Step n of 5" beside the title (the subtext on Android), and the "Tap to measure" line. Android shows that
  // line in place of the text while a reading is due. iOS always shows it, because a Live Activity has no
  // buttons on iOS 16, so the whole card opens lumen://standing.
  step: string;
  tapHint: string;
  // Milliseconds until the next reading opens; null while a reading is due (no countdown shown).
  countdownMs: number | null;
  // Android only: the share of the test's time already passed, 0 to 1, for the progress bar.
  progress: number;
  // Android only: the accent token for each phone theme, "#RRGGBB", tinting the icon and the bar.
  accentLight: string;
  accentDark: string;
};

declare class LumenWidgetsNative extends NativeModule {
  // snapshotJson is the Appendix B snapshot; displayJson holds the localized labels and the palette, so the
  // native widget code holds no copy.
  publishSnapshot(snapshotJson: string, displayJson: string): Promise<void>;
  startStandingTimer(content: StandingTimerContent): Promise<void>;
  updateStandingTimer(content: StandingTimerContent): Promise<void>;
  endStandingTimer(): Promise<void>;
}

// null where the module is not linked (Jest, Expo Go, and iOS until its widget target lands), so importing
// this file never throws.
export const LumenWidgets = requireOptionalNativeModule<LumenWidgetsNative>('LumenWidgets');
