import i18next from 'i18next';

import { lockscreenStrings } from '@/i18n/lockscreen';
import { loadScheduleRecord } from '@/notifications/record';
import { followUpAnsweredAt } from '@/profile/followUp';
import { lockTextLines } from '@/settings/lockText';
import { listReadings } from '@/store/readings';
import type { Appearance } from '@/theme/preferences';
import tokens from '@/theme/tokens.json';

import { LumenWidgets } from '../../modules/lumen-widgets/src';
import { widgetSnapshot, type WidgetStatus } from './snapshot';

type WidgetPreferences = { appearance: Appearance; hideWidgetValues: boolean };

type Palette = Record<keyof typeof PALETTE_TOKENS, string>;

// Each color role the native widgets draw with, and the token it takes, so tokens.json stays their only source
// (Widgets mockup). The ring's arc is accent, flag or criticalText by status, on a ringTrack circle; the buttons
// are buttonFill (Check now) and tonalFill (Full Scan).
export const PALETTE_TOKENS = {
  surface: 'surface',
  text: 'text',
  textDim: 'textDim',
  accent: 'accent',
  ringTrack: 'surface3',
  buttonFill: 'buttonFill',
  onButtonFill: 'onButtonFill',
  tonalFill: 'accentTint',
  onTonalFill: 'accent',
  flag: 'flag',
  criticalText: 'criticalText',
} as const satisfies Record<string, keyof typeof tokens.light>;

function paletteOf(colors: typeof tokens.light): Palette {
  return Object.fromEntries(
    Object.entries(PALETTE_TOKENS).map(([role, token]) => [role, colors[token]]),
  ) as Palette;
}

// The widgets' copy, in the app's language. Kotlin keeps only a fallback copy of the empty state (in the
// phone's language, for a widget placed before the app first publishes) and Swift none, so this is what a
// widget shows. "Last check" and the inline "next check" stay templates: the widget fills in the
// hours or the time when it draws, and those drift between publishes. i18next does not re-interpolate a value,
// so "{{hours}}" survives t(). The iOS lock-screen widgets use only name, status, inline, and nextCheck, which
// all come from lockscreen.json (WID-2).
function widgetDisplay(language: string) {
  const lock = lockscreenStrings(language);
  const t = i18next.getFixedT(language);
  const upToDate = lockTextLines(lock['widget.lock.upToDate']);
  const checkAgain = lockTextLines(lock['widget.lock.checkAgain']).status;
  const status: Record<WidgetStatus, string> = {
    regular: upToDate.status,
    'check-again': checkAgain,
    'see-doctor': lock['widget.status.doctor'],
    // Couldn't tell: the same ask as check-again, a retake.
    inconclusive: checkAgain,
  };
  // The inline lock-screen widget's single line. lockscreen.json has no full line for a doctor visit, so it
  // is put together the way the other two read ("Lumen · Status").
  const inline: Record<WidgetStatus, string> = {
    regular: lock['widget.lock.upToDate'],
    'check-again': lock['widget.lock.checkAgain'],
    'see-doctor': `${upToDate.name} · ${status['see-doctor']}`,
    inconclusive: lock['widget.lock.checkAgain'],
  };
  return {
    // Swift formats the next-check time in the app's language, not the phone's.
    language,
    name: upToDate.name,
    status,
    inline,
    nextCheck: lock['widget.lock.nextCheck'],
    lastCheck: t('widgets.lastCheck', { hours: '{{hours}}' }),
    bpm: t('widgets.bpm'),
    checkNow: t('widgets.checkNow'),
    fullScan: t('mode.full'),
    empty: { title: lock['widget.empty.title'], body: lock['widget.empty.body'] },
    // The Android lock-screen widget's own copy, all from lockscreen.json (WID-2): with the name and the empty title,
    // it's everything that widget shows. "{{hours}}" stays a template, like lastCheck.
    lock: { lastCheck: lock['widget.lock.lastCheck'], checkNow: lock['widget.lock.checkNow'] },
    palette: { light: paletteOf(tokens.light), dark: paletteOf(tokens.dark) },
  };
}

// The soonest confirmation reminder the last notification sync scheduled. A reminder that already fired
// is not "next".
function nextConfirmationAt(now: number): number | null {
  const upcoming = loadScheduleRecord()
    .filter((entry) => entry.type === 'confirmation')
    .map((entry) => Date.parse(entry.fireAt))
    .filter((fireAt) => fireAt > now);
  return upcoming.length === 0 ? null : Math.min(...upcoming);
}

// Spec §9.6: called after every saved reading and whenever a preference the snapshot carries changes. It
// reads the saved readings each time, so a preference change never publishes an empty history. Resolves
// without doing anything where the native module is not linked (Jest, Expo Go).
export async function publishWidgets(preferences: WidgetPreferences, now = Date.now()): Promise<void> {
  if (!LumenWidgets) return;
  const snapshot = widgetSnapshot({
    readings: await listReadings(),
    nextConfirmationAt: nextConfirmationAt(now),
    // Only "Yes, I saw a doctor" gives a time, and only one after the flagged reading clears it (ADR 0005).
    followUpAnsweredAt: await followUpAnsweredAt(),
    hideValues: preferences.hideWidgetValues,
    theme: preferences.appearance,
    now,
  });
  await LumenWidgets.publishSnapshot(
    JSON.stringify(snapshot),
    JSON.stringify(widgetDisplay(i18next.language)),
  );
}

// At every launch: without it, a widget placed before the first reading keeps the native fallback in the phone's
// language, a widget whose stored copy an app update made unreadable stays on the fallback, and the picker has no
// generated preview. Only the copy goes, so a launch never changes what a widget says about readings.
export async function publishWidgetCopy(): Promise<void> {
  if (!LumenWidgets) return;
  await LumenWidgets.publishDisplay(JSON.stringify(widgetDisplay(i18next.language)));
}
