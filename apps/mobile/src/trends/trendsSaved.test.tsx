import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import type { RhythmMetric } from '@lumen/core';

import { enterDemo, exitDemo } from '@/demo/demoSession';
import en from '@/i18n/en.json';
import { fixClockAtMorning } from '@/testing/fixClockAtMorning';
import { startOnboarded } from '@/testing/onboarded';
import { expectNavTitle } from '@/testing/navHeader';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';
import { makeReading } from '@/testing/reading';
import { saveTestReading } from '@/testing/savedReading';

import { historyFromStored } from './storedHistory';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'dark',
}));

preloadAppRoutes();
fixClockAtMorning();

// The fixed clock is Thursday, Oct 1, 2026, 9:00.
const lastMonth = (day: number) => new Date(2026, 8, day, 7, 0).getTime();
const today = new Date(2026, 9, 1, 7, 0).getTime();

beforeEach(startOnboarded);
afterEach(exitDemo);

describe('Trends from readings saved on this phone', () => {
  it('shows the honest empty state, with no sample data and no Demo banner, when nothing is saved', async () => {
    renderRouter('./app', { initialUrl: '/trends' });
    expect(await screen.findByText(en['trends.emptyTitle'])).toBeOnTheScreen();
    expect(screen.getByText(en['trends.emptyBody'])).toBeOnTheScreen();
    expect(screen.queryByText(en['demo.banner'])).toBeNull();
    expect(screen.queryByText(en['trends.demoNote'])).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('plots saved readings with their median and count, without the Demo banner', async () => {
    await saveTestReading(lastMonth(25), 60);
    await saveTestReading(lastMonth(28), 64);
    await saveTestReading(today, 70);
    renderRouter('./app', { initialUrl: '/trends' });
    expect(await screen.findByLabelText('Median: 64 bpm')).toBeOnTheScreen();
    expect(screen.getAllByRole('button', { name: /^(Today |[A-Z][a-z]{2} \d+, )/ })).toHaveLength(3);
    expect(screen.queryByText(en['demo.banner'])).toBeNull();
    expect(screen.queryByText(en['trends.emptyTitle'])).toBeNull();
    expect(screen.queryByText(en['trends.synthetic'])).toBeNull();
  });

  it('shows a second Quick Check that is lower quality, marked, outside the median', async () => {
    await saveTestReading(lastMonth(25), 62, { mode: 'quick' });
    await saveTestReading(today, 95, { mode: 'quick', lowerQuality: true });
    renderRouter('./app', { initialUrl: '/trends' });
    expect(await screen.findByLabelText('Median: 62 bpm')).toBeOnTheScreen();
    expect(screen.getByLabelText('Heart rate chart, 2 readings')).toBeOnTheScreen();
    expect(screen.getAllByRole('button', { name: /^(Today |[A-Z][a-z]{2} \d+, )/ })).toHaveLength(2);
    expect(screen.getByHintText(en['quality.chipHint'])).toBeOnTheScreen();
    expect(screen.getByText(en['trends.lowerLegend'])).toBeOnTheScreen();
  });

  it('calls a reading from today "Today", counts the baseline from saved readings, and opens it', async () => {
    await saveTestReading(today, 70);
    renderRouter('./app', { initialUrl: '/trends' });
    const row = await screen.findByRole('button', { name: /^Today / });
    expect(screen.getByText('Learning your baseline: 1 of 7')).toBeOnTheScreen();
    fireEvent.press(row);
    await waitFor(() => expectNavTitle(en['results.title']));
    expect(screen.queryByText(en['demo.banner'])).toBeNull();
  });

  it('keeps the sample history inside a demo session and ignores saved readings there', async () => {
    await saveTestReading(today, 99);
    enterDemo();
    renderRouter('./app', { initialUrl: '/trends' });
    expect(await screen.findByText(en['demo.banner'])).toBeOnTheScreen();
    expect(screen.queryByLabelText('Median: 99 bpm')).toBeNull();
    act(() => exitDemo());
    await waitFor(() => expect(screen.queryByText(en['demo.banner'])).toBeNull());
    expect(screen.getByLabelText('Median: 99 bpm')).toBeOnTheScreen();
  });
});

const lowRhythm = (rhythmClass: RhythmMetric['class'], flag: RhythmMetric['flag']): RhythmMetric => ({
  class: rhythmClass,
  pAF: 0.5,
  evidence: 'experimental',
  confidence: 'low',
  quality: 'low',
  qualityReasons: [],
  qualityDetails: [],
  flag,
});

describe('historyFromStored', () => {
  it('keeps the measured values, leaves missing ones null, and never invents a caffeine answer', () => {
    const [mapped] = historyFromStored([makeReading(lastMonth(25), 61, null)]);
    expect(mapped).toMatchObject({
      hr: 61,
      rmssd: null,
      resp: null,
      rhythm: null,
      mode: 'quick',
      caffeine: false,
    });
    expect(mapped?.createdAt.getTime()).toBe(lastMonth(25));
  });

  it('leaves a lower-quality value out of the trend, its median and band (ADR 0104)', () => {
    const low = makeReading(lastMonth(25), 61, 40);
    low.outcome.metrics.hr!.quality = 'low';
    expect(historyFromStored([low])[0]).toMatchObject({
      hr: null,
      rmssd: 40,
      lowerQuality: { hr: 61, rmssd: null, resp: null },
    });
  });

  it('keeps a flagged lower-quality rhythm, marked, and leaves a lower-quality one without a flag out', () => {
    const flagged = makeReading(lastMonth(25), 61, 40);
    flagged.outcome.metrics.rhythm = lowRhythm('af', 'irregular');
    const unflagged = makeReading(lastMonth(26), 62, 40);
    unflagged.outcome.metrics.rhythm = lowRhythm('other', null);
    const [kept, left] = historyFromStored([flagged, unflagged]);
    expect(kept).toMatchObject({ rhythm: null, flaggedLowRhythm: 'af' });
    expect(left).toMatchObject({ rhythm: null, flaggedLowRhythm: null });
  });

  it('carries the kept beat intervals for the rhythm map tiles, and [] for a reading without them', () => {
    const kept = { ...makeReading(lastMonth(25), 61, 40), intervalsMs: [810, 790, 805] };
    const older = makeReading(lastMonth(26), 62, 40);
    const [withIntervals, without] = historyFromStored([kept, older]);
    expect(withIntervals?.intervalsMs).toEqual([810, 790, 805]);
    expect(without?.intervalsMs).toEqual([]);
  });
});
