import { NativeModule, requireOptionalNativeModule } from 'expo';

// What the ongoing standing-test notification shows (LIVE-1). Every string comes from lockscreen.json, so
// the notification never carries a value or a condition name (WID-2).
type StandingTimerContent = {
  channelName: string;
  title: string;
  text: string;
  actionLabel: string;
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

// null where the module is not linked (Jest, Expo Go, and iOS until its widget target lands), so importing
// this file never throws.
export const LumenWidgets = requireOptionalNativeModule<LumenWidgetsNative>('LumenWidgets');
