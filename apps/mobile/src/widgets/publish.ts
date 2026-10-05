import i18next from 'i18next';

import { evidenceFor } from '@/evidence';
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

type Palette = Record<(typeof PALETTE_KEYS)[number], string>;

// The token colors the native widgets draw with, so tokens.json stays their only source. accent tints the mark
// and the up-to-date dot; flag and criticalText color the check-again and see-doctor dots; the badge pair colors
// the Diabetes Experimental tag.
export const PALETTE_KEYS = [
  'surface',
  'line',
  'line2',
  'text',
  'textDim',
  'accent',
  'accentFill',
  'onAccentFill',
  'flag',
  'criticalText',
  'badgeExperimentalFg',
  'badgeExperimentalBg',
] as const;

function paletteOf(colors: typeof tokens.light): Palette {
  return Object.fromEntries(PALETTE_KEYS.map((key) => [key, colors[key]])) as Palette;
}

// The widgets' copy, in the app's language. Kotlin keeps only a fallback copy of the empty state (in the
// phone's language, for a widget placed before the app first publishes), so this is what a widget shows.
// "Last check" and the streak stay templates: the widget fills in the hours when it draws, and those
// drift between publishes. i18next does not re-interpolate a value, so "{{hours}}" survives t().
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
  return {
    name: upToDate.name,
    status,
    lastCheck: t('widgets.lastCheck', { hours: '{{hours}}' }),
    bpm: t('widgets.bpm'),
    streak: t('widgets.streak', { days: '{{days}}' }),
    checkNow: t('widgets.checkNow'),
    fullScan: t('mode.full'),
    empty: { title: lock['widget.empty.title'], body: lock['widget.empty.body'] },
    // The four checks the medium widget lists (owner, 2026-10-03, proposal A; ADR 0083). Home screen only: the lock
    // screen and notifications never name a condition (WID-2). The Diabetes tag is the evidence label's word
    // (EVID-1), shown only while that label is Experimental.
    checks: [
      t('widgets.checkAfib'),
      t('widgets.checkPots'),
      t('widgets.checkHrv'),
      t('widgets.checkDiabetes'),
    ],
    diabetesTag: evidenceFor('diabetes').label === 'experimental' ? t('evidence.experimental') : null,
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
// without doing anything where the native module is not linked (iOS until its widget target lands, Jest).
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

// At every launch: without it, a widget placed before the first reading draws the native fallback, which has no
// four-checks row (seen on the owner's Samsung, 2026-10-04), and the picker has no generated preview. Only the
// copy goes: "hide values" isn't saved across launches yet, so re-sending the snapshot could show a hidden bpm.
export async function publishWidgetCopy(): Promise<void> {
  if (!LumenWidgets) return;
  await LumenWidgets.publishDisplay(JSON.stringify(widgetDisplay(i18next.language)));
}
