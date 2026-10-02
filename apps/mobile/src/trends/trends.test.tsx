import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { StyleSheet } from 'react-native';

import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import { readingById } from '@/results/fixtures';
import tokens from '@/theme/tokens.json';

import { demoHistory, demoNow } from './demoHistory';
import type { HistoryReading } from './series';
import { TrendsView } from './TrendsView';

let mockScheme: 'light' | 'dark';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme,
}));

function openView(readings: readonly HistoryReading[], demo = true, now = demoNow) {
  renderRouter({ index: () => <TrendsView readings={readings} now={now} demo={demo} /> });
}

describe.each([
  ['dark', tokens.dark],
  ['light', tokens.light],
] as const)('Trends in the %s theme', (scheme, colors) => {
  beforeEach(() => {
    mockScheme = scheme;
  });

  it('draws the Display title, the demo banner and the 30D default', () => {
    renderRouter('./app', { initialUrl: '/trends' });
    const heading = screen.getByRole('header', { name: en['trends.title'] });
    expect(StyleSheet.flatten(heading.props.style)).toMatchObject({ color: colors.text });
    expect(screen.getByText(en['demo.banner'])).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: en['trends.range30'] })).toBeChecked();
    expect(screen.getByRole('radio', { name: en['trends.restingHr'] })).toBeChecked();
  });

  it('shades the personal band in the theme colour and shows the three tiles', () => {
    openView(demoHistory);
    expect(JSON.stringify(screen.toJSON()).includes(colors.badgeCheckedBg)).toBe(true);
    expect(screen.getByLabelText('Median: 64 bpm')).toBeOnTheScreen();
    expect(screen.getByLabelText(/^Your band: \d+–\d+$/)).toBeOnTheScreen();
    expect(screen.getByLabelText('Readings: 25')).toBeOnTheScreen();
  });

  it('marks caffeine readings on the chart and in the rows', () => {
    openView(demoHistory);
    expect(screen.getAllByTestId('context-marker')).toHaveLength(3);
  });
});

describe('Trends content', () => {
  beforeEach(() => {
    mockScheme = 'dark';
  });

  it('labels the axis with the first date and not "Today" for sample data', () => {
    openView(demoHistory);
    const drawn = JSON.stringify(screen.toJSON());
    expect(drawn).toContain('Aug 29');
    expect(drawn).toContain('Sep 27');
    expect(drawn).not.toContain(en['trends.today']);
  });

  it('says Today for a live reading from the same day', () => {
    const live: HistoryReading[] = [
      { ...demoHistory[0]!, id: 'a', createdAt: new Date(2026, 9, 1, 7, 0) },
      { ...demoHistory[1]!, id: 'b', createdAt: new Date(2026, 9, 3, 7, 0) },
    ];
    openView(live, false, new Date(2026, 9, 3, 9, 0));
    expect(JSON.stringify(screen.toJSON())).toContain(en['trends.today']);
    expect(screen.getByText(/^Today /)).toBeOnTheScreen();
    expect(screen.queryByText(en['demo.banner'])).toBeNull();
  });

  it('shows the empty state, with no controls or numbers, when there are no readings', () => {
    openView([], false);
    expect(screen.getByText(en['trends.emptyTitle'])).toBeOnTheScreen();
    expect(screen.getByText(en['trends.emptyBody'])).toBeOnTheScreen();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByText(en['trends.median'])).toBeNull();
    expect(screen.queryByText(en['demo.banner'])).toBeNull();
  });

  it('keeps the banner over the empty state when sample data is on', () => {
    openView([], true);
    expect(screen.getByText(en['demo.banner'])).toBeOnTheScreen();
  });

  it('offers only heart rate, HRV and breathing; experimental measurements are not trended', () => {
    openView(demoHistory);
    // Three range buttons and three metric chips.
    expect(screen.getAllByRole('radio')).toHaveLength(6);
    for (const key of ['trends.restingHr', 'trends.hrv', 'trends.breathing'] as const) {
      expect(screen.getByRole('radio', { name: en[key] })).toBeOnTheScreen();
    }
    expect(screen.queryByText(/extra|pulse shape|diabetes/i)).toBeNull();
  });

  it('labels the chart metric with the evidence file badge, Experimental without a passed file (EVID-1)', () => {
    openView(demoHistory);
    expect(screen.getAllByTestId('evidence-badge')).toHaveLength(1);
    expect(screen.getByText(en['evidence.experimental'])).toBeOnTheScreen();
    expect(screen.queryByText(en['evidence.checked'])).toBeNull();
  });

  it('switches to HRV and keeps the band from the whole history on 7D (§7)', () => {
    openView(demoHistory);
    fireEvent.press(screen.getByRole('radio', { name: en['trends.hrv'] }));
    const band30 = screen.getByLabelText(/^Your band: \d/).props.accessibilityLabel;
    fireEvent.press(screen.getByRole('radio', { name: en['trends.range7'] }));
    expect(screen.getByLabelText('Readings: 3')).toBeOnTheScreen();
    expect(screen.getByLabelText(band30)).toBeOnTheScreen();
    expect(screen.queryByText(/Learning your baseline/)).toBeNull();
  });

  it('counts the learning readings across the whole history, whatever the range', () => {
    openView(demoHistory.filter(({ rmssd }) => rmssd !== null).slice(0, 5));
    fireEvent.press(screen.getByRole('radio', { name: en['trends.hrv'] }));
    fireEvent.press(screen.getByRole('radio', { name: en['trends.range7'] }));
    expect(screen.getByText('Learning your baseline: 5 of 7')).toBeOnTheScreen();
    expect(screen.getByLabelText('Your band: —')).toBeOnTheScreen();
  });

  it('says so when a range has no readings of the chosen kind', () => {
    openView([demoHistory[0]!]);
    fireEvent.press(screen.getByRole('radio', { name: en['trends.breathing'] }));
    expect(screen.getByText(en['trends.noneInRange'])).toBeOnTheScreen();
  });

  it('links a row to Results only when that reading exists', () => {
    renderRouter('./app', { initialUrl: '/trends' });
    const rows = screen.getAllByRole('button', { name: /^Sep \d+, / });
    expect(rows).toHaveLength(2);
    expect(readingById('demo')).toBeDefined();
    fireEvent.press(rows[1]!);
    expect(screen.getByRole('header', { name: en['results.title'] })).toBeOnTheScreen();
  });

  it('tags only the synthetic fixture row, in both languages', () => {
    openView(demoHistory);
    expect(screen.getAllByText(en['trends.synthetic'])).toHaveLength(1);
    expect(readingById('demo-flag')?.synthetic).toBe(true);
    expect(es['trends.synthetic']).not.toBe(en['trends.synthetic']);
  });

  it('has the same keys in Spanish', () => {
    for (const key of Object.keys(en).filter((name) => name.startsWith('trends.'))) {
      expect(es).toHaveProperty([key]);
    }
  });
});
