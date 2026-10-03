import { waitFor } from '@testing-library/react-native';
import i18next from 'i18next';

import { emptyMockDatabases } from '../../__mocks__/expo-sqlite';
import '@/i18n';
import { lockscreenStrings } from '@/i18n/lockscreen';
import { memoryFiles, mockFileSystem } from '@/testing/memoryFiles';
import { makeReading } from '@/testing/reading';
import type { PlannedNotification } from '@/notifications/plan';
import { saveScheduleRecord } from '@/notifications/record';
import { type FollowUpAnswer, saveFollowUpAnswer } from '@/profile/followUp';
import type { MeasureMode } from '@/measure/mode';
import { lockTextLines } from '@/settings/lockText';
import { saveReading } from '@/store/readings';
import { setPreference } from '@/theme/preferences';

import { LumenWidgets } from '../../modules/lumen-widgets/src';
import { publishWidgets } from './publish';
import type { WidgetSnapshot, WidgetStatus } from './snapshot';

jest.mock('expo-file-system', () => mockFileSystem);
jest.mock('../../modules/lumen-widgets/src', () => ({
  LumenWidgets: { publishSnapshot: jest.fn(() => Promise.resolve()) },
}));

const NOW = Date.parse('2026-10-12T15:00:00Z');
const HOUR_MS = 3_600_000;

const publishSnapshot = () => jest.mocked(LumenWidgets!.publishSnapshot);

function publishedSnapshot(): WidgetSnapshot {
  const calls = publishSnapshot().mock.calls;
  return JSON.parse(calls[calls.length - 1]![0]) as WidgetSnapshot;
}

async function saveCheck(
  takenAt: number,
  hr: number,
  { flag = null, mode = 'full' }: { flag?: 'fastRegular' | null; mode?: MeasureMode } = {},
) {
  const { outcome } = makeReading(takenAt, hr, 40);
  if (outcome.metrics.hr) outcome.metrics.hr.flag = flag;
  await saveReading({
    id: `reading-${takenAt}`,
    createdAt: takenAt,
    mode,
    context: {
      captureFps: 60,
      tier: null,
      mode,
      restTimerDone: true,
      recordedAt: null,
      motionSpans: [],
      coldHandsSpans: [],
      sqi: null,
      validationRhythmLabel: null,
    },
    results: outcome,
    models: { rhythm: null, diabetes: null },
  });
}

const confirmation = (fireAt: number): PlannedNotification => ({
  id: `confirm-${fireAt}`,
  type: 'confirmation',
  fireAt: new Date(fireAt).toISOString(),
  route: 'lumen://check?mode=full',
  createdFor: 'reading-1',
});

beforeEach(() => {
  emptyMockDatabases();
  memoryFiles.clear();
  publishSnapshot().mockClear();
});

describe('publishing the widgets', () => {
  it('publishes the newest saved reading with the given preferences', async () => {
    await saveCheck(NOW - 2 * HOUR_MS, 70);
    await saveCheck(NOW - HOUR_MS, 64);
    await publishWidgets({ appearance: 'dark', hideWidgetValues: false }, NOW);
    expect(publishedSnapshot()).toMatchObject({
      lastReadingAt: '2026-10-12T14:00:00Z',
      status: 'regular',
      hrBpm: 64,
      hideValues: false,
      theme: 'dark',
      nextConfirmationAt: null,
    });
  });

  it('shows the soonest confirmation reminder that has not fired yet', async () => {
    saveScheduleRecord([
      confirmation(NOW - HOUR_MS),
      confirmation(NOW + 20 * HOUR_MS),
      confirmation(NOW + 4 * HOUR_MS),
      { ...confirmation(NOW + HOUR_MS), id: 'daily-1', type: 'daily', route: 'lumen://check' },
    ]);
    await publishWidgets({ appearance: 'system', hideWidgetValues: false }, NOW);
    expect(publishedSnapshot().nextConfirmationAt).toBe('2026-10-12T19:00:00Z');
  });

  it('keeps the saved readings when a preference changes', async () => {
    await saveCheck(NOW - HOUR_MS, 64);
    setPreference('appearance', 'dark');
    await waitFor(() => expect(publishSnapshot()).toHaveBeenCalledTimes(1));
    expect(publishedSnapshot()).toMatchObject({ hrBpm: 64, theme: 'dark' });
    setPreference('appearance', 'system');
    await waitFor(() => expect(publishSnapshot()).toHaveBeenCalledTimes(2));
  });

  it.each<[FollowUpAnswer, string]>([
    ['saw', 'regular'],
    ['booked', 'see-doctor'],
    ['notYet', 'see-doctor'],
  ])('a "%s" follow-up answer after a doctor result publishes %s', async (answer, status) => {
    await saveCheck(NOW - 3 * HOUR_MS, 150, { flag: 'fastRegular' });
    await saveFollowUpAnswer(answer, NOW - 2 * HOUR_MS);
    // A regular Quick Check never clears the doctor status by itself, so only the answer can.
    await saveCheck(NOW - HOUR_MS, 64, { mode: 'quick' });
    await publishWidgets({ appearance: 'system', hideWidgetValues: false }, NOW);
    expect(publishedSnapshot().status).toBe(status);
  });

  it('reports a failed publish after a preference change', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    publishSnapshot().mockRejectedValueOnce(new Error('widget store unavailable'));
    setPreference('appearance', 'dark');
    await waitFor(() => expect(warn).toHaveBeenCalledWith('Widget update failed: widget store unavailable'));
    setPreference('appearance', 'system');
    await waitFor(() => expect(publishSnapshot()).toHaveBeenCalledTimes(2));
    warn.mockRestore();
  });
});

const STATUSES: WidgetStatus[] = ['regular', 'check-again', 'see-doctor', 'inconclusive'];

type PublishedDisplay = {
  language: string;
  name: string;
  status: Record<WidgetStatus, string>;
  inline: Record<WidgetStatus, string>;
  nextCheck: string;
};

async function publishedDisplay(language: string): Promise<PublishedDisplay> {
  await i18next.changeLanguage(language);
  await publishWidgets({ appearance: 'system', hideWidgetValues: false }, NOW);
  const calls = publishSnapshot().mock.calls;
  return JSON.parse(calls[calls.length - 1]![1]) as PublishedDisplay;
}

// A lock-screen part is a whole lockscreen.json string or one side of a "Lumen · Status" string, so
// check-notification-copy.mjs has already screened it (WID-2).
function screenedParts(language: string): Set<string> {
  return new Set(
    Object.values(lockscreenStrings(language)).flatMap((text) => {
      const { name, status } = lockTextLines(text);
      return [text, name, status];
    }),
  );
}

describe('the lock-screen copy the widgets receive (WID-1, WID-2)', () => {
  afterAll(() => i18next.changeLanguage('en'));

  it.each(['en', 'es'])('builds the name and statuses only from lockscreen.json (%s)', async (language) => {
    const display = await publishedDisplay(language);
    const screened = screenedParts(language);
    for (const part of [display.name, ...STATUSES.map((status) => display.status[status])]) {
      expect({ part, screened: screened.has(part) }).toEqual({ part, screened: true });
    }
  });

  it.each(['en', 'es'])('says the same thing inline as on the rectangular widget (%s)', async (language) => {
    const display = await publishedDisplay(language);
    for (const status of STATUSES) {
      expect({ status, lines: lockTextLines(display.inline[status]) }).toEqual({
        status,
        lines: { name: display.name, status: display.status[status] },
      });
    }
  });

  it('passes the next-check template and the language through for Swift to fill in', async () => {
    const display = await publishedDisplay('es');
    expect(display.nextCheck).toBe(lockscreenStrings('es')['widget.lock.nextCheck']);
    expect(display.nextCheck).toContain('{{time}}');
    expect(display.language).toBe('es');
  });
});
