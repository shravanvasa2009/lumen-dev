import { NativeModule, requireOptionalNativeModule } from 'expo';

// What the standing-test live timer shows (LIVE-1): the Android ongoing notification and the iOS Live Activity.
// Every string comes from lockscreen.json, so neither carries a value or a condition name (WID-2).
export type StandingTimerContent = {
  // Android only: the notification channel's name and the "Measure now" action button.
  channelName: string;
  actionLabel: string;
  title: string;
  text: string;
  // iOS only: "Step n of 5" beside the title, and the "Tap to measure" line (a Live Activity has no buttons on
  // iOS 16, so the whole card opens lumen://standing).
  step: string;
  tapHint: string;
  // Milliseconds until the next reading opens; null while a reading is due (no countdown shown).
  countdownMs: number | null;
};

declare class LumenWidgetsNative extends NativeModule {
  // snapshotJson is the Appendix B snapshot; displayJson holds the localized labels and the palette, so the
  // native widget code holds no copy.
  publishSnapshot(snapshotJson: string, displayJson: string): Promise<void>;
  startStandingTimer(content: StandingTimerContent): Promise<void>;
  updateStandingTimer(content: StandingTimerContent): Promise<void>;
  endStandingTimer(): Promise<void>;
}

// null where the module is not linked (Jest and Expo Go), so importing this file never throws.
export const LumenWidgets = requireOptionalNativeModule<LumenWidgetsNative>('LumenWidgets');
