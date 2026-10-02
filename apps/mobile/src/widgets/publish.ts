import i18next from 'i18next';

import type { StoredReading } from '@/home/readings';
import { lockscreenStrings } from '@/i18n/lockscreen';
import { lockTextLines } from '@/settings/lockText';
import type { Appearance } from '@/theme/preferences';
import tokens from '@/theme/tokens.json';

import { LumenWidgets } from '../../modules/lumen-widgets/src';
import { widgetSnapshot, type WidgetStatus } from './snapshot';

type WidgetPreferences = { appearance: Appearance; hideWidgetValues: boolean };

type ReadingHistory = { readings: readonly StoredReading[]; nextConfirmationAt: number | null };

type Palette = Record<(typeof PALETTE_KEYS)[number], string>;

// The token colors the native widgets draw with, so tokens.json stays their only source.
const PALETTE_KEYS = ['surface', 'line', 'text', 'textDim', 'accentFill', 'onAccentFill'] as const;

function paletteOf(colors: typeof tokens.light): Palette {
  return Object.fromEntries(PALETTE_KEYS.map((key) => [key, colors[key]])) as Palette;
}

// The widgets' copy, in the app's language. Kotlin and Swift hold no strings, so this is all a widget can
// show. "Last check", the streak, and the inline "next check" stay templates: the widget fills in the hours
// or the time when it draws, and those drift between publishes. i18next does not re-interpolate a value, so
// "{{hours}}" survives t(). The iOS lock-screen widgets use only name, status, inline, and nextCheck, which
// all come from lockscreen.json (WID-2).
export function widgetDisplay(language: string) {
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
    streak: t('widgets.streak', { days: '{{days}}' }),
    checkNow: t('widgets.checkNow'),
    fullScan: t('mode.full'),
    palette: { light: paletteOf(tokens.light), dark: paletteOf(tokens.dark) },
  };
}

// Held in memory like the readings themselves (no reading storage exists yet), so a preference change
// re-publishes the readings this session last published.
let lastHistory: ReadingHistory = { readings: [], nextConfirmationAt: null };

// Spec §9.6: called after every saved reading (with its history) and whenever a preference the snapshot
// carries changes. Resolves without doing anything where the native module is not linked (Jest, Expo Go).
export function publishWidgets(
  preferences: WidgetPreferences,
  history: ReadingHistory = lastHistory,
  now = Date.now(),
): Promise<void> {
  lastHistory = history;
  if (!LumenWidgets) return Promise.resolve();
  const snapshot = widgetSnapshot({
    readings: history.readings,
    nextConfirmationAt: history.nextConfirmationAt,
    hideValues: preferences.hideWidgetValues,
    theme: preferences.appearance,
    now,
  });
  return LumenWidgets.publishSnapshot(
    JSON.stringify(snapshot),
    JSON.stringify(widgetDisplay(i18next.language)),
  );
}
