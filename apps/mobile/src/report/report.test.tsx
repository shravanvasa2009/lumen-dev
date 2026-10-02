import { renderRouter, screen } from 'expo-router/testing-library';
import { StyleSheet } from 'react-native';

import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import { readingById } from '@/results/fixtures';
import { formatClock } from '@/results/format';
import tokens from '@/theme/tokens.json';

let mockScheme: 'light' | 'dark';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme,
}));

function openReport(id: string) {
  renderRouter('./app', { initialUrl: `/report/${id}` });
}

const drawn = () => JSON.stringify(screen.toJSON());

// Only the words and numbers a person can read, without style values.
function visibleText(node: unknown): string[] {
  if (typeof node === 'string') return [node];
  if (typeof node !== 'object' || node === null) return [];
  const { children } = node as { children?: unknown[] | null };
  return (children ?? []).flatMap(visibleText);
}

const readableText = () => visibleText(screen.toJSON()).join(' ');

describe.each([
  ['dark', tokens.dark],
  ['light', tokens.light],
] as const)('Doctor report in the %s theme', (scheme, colors) => {
  beforeEach(() => {
    mockScheme = scheme;
  });

  it('titles the screen in the theme and draws the report card in the light tokens', () => {
    openReport('demo');
    const heading = screen.getByRole('header', { name: en['report.title'] });
    expect(StyleSheet.flatten(heading.props.style)).toMatchObject({ color: colors.text });
    const card = screen.getByRole('header', { name: en['report.heading'] });
    expect(StyleSheet.flatten(card.props.style)).toMatchObject({ color: tokens.light.text });
    expect(drawn()).toContain(tokens.light.surface);
  });

  it('uses no red outside the emergency screen (SAFE-1)', () => {
    openReport('demo');
    expect(drawn().includes(colors.criticalFill)).toBe(false);
    expect(drawn().includes(colors.criticalText)).toBe(false);
    expect(drawn().includes(tokens.light.criticalText)).toBe(false);
  });
});

describe('Doctor report content', () => {
  beforeEach(() => {
    mockScheme = 'dark';
  });

  it('opens with the prototype header, the lumen heading, the date and the Demo marks', () => {
    openReport('demo');
    expect(screen.getByText(en['prototype.banner'])).toBeOnTheScreen();
    expect(screen.getByText(en['report.heading'])).toBeOnTheScreen();
    expect(screen.getByText('Sep 27, 2026')).toBeOnTheScreen();
    expect(screen.getByText(en['demo.banner'])).toBeOnTheScreen();
    expect(screen.getByText(en['report.demoMark'])).toBeOnTheScreen();
  });

  it('invents no profile line', () => {
    openReport('demo');
    expect(screen.queryByText(/Age|Male|Female|medications/)).toBeNull();
  });

  it("tabulates that day's readings, with dashes where a card had no result", () => {
    openReport('demo');
    const clock = formatClock(readingById('demo')?.createdAt ?? new Date(), 'en');
    expect(screen.getAllByText(clock)).toHaveLength(3);
    for (const text of ['64', '88', '92', '58', '38', 'Full', 'Quick']) {
      expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.getByText(en['results.rhythmIrregular'])).toBeOnTheScreen();
  });

  it('writes the flag sentence from the readings, without "you have" or a named condition as fact', () => {
    openReport('demo');
    expect(
      screen.getByText('irregular rhythm on 1 of 2 readings that day (AFib-like pattern).', { exact: false }),
    ).toBeOnTheScreen();
    expect(drawn()).not.toMatch(/you have/i);
  });

  it('labels the strips as beat intervals, not a raw pulse waveform', () => {
    openReport('demo');
    expect(screen.getAllByText(/^Beat intervals \(/)).toHaveLength(2);
    expect(screen.getByText(en['report.intervalNote'])).toBeOnTheScreen();
    expect(screen.getByText(en['demo.synthetic'])).toBeOnTheScreen();
  });

  it('shows Experimental and "Not yet tested" with no evidence file, and no accuracy figures (EVID-1)', () => {
    openReport('demo');
    expect(screen.getByText(/^Evidence: Heart rate: Experimental\. Not yet tested\./)).toBeOnTheScreen();
    expect(screen.getByText(/Rhythm check: Experimental\. Not yet tested\./)).toBeOnTheScreen();
    expect(readableText()).not.toMatch(/\d+(\.\d+)?%|Average error|Sensitivity|AUROC/);
  });

  it('leaves experimental measurements and the diabetes line out while the evidence is not passed', () => {
    openReport('demo');
    expect(screen.queryByText(en['report.diabetesLabel'])).toBeNull();
    expect(screen.queryByText(/Diabetes/)).toBeNull();
    expect(screen.queryByText(/extra beats|pulse shape/i)).toBeNull();
    expect(screen.getByText(en['report.leftOut'])).toBeOnTheScreen();
  });

  it('pins a disabled Share PDF button with the note that sharing arrives later', () => {
    openReport('demo');
    const button = screen.getByRole('button', { name: en['report.sharePdf'] });
    expect(button).toBeDisabled();
    expect(screen.getByText(en['report.sharedOnly'])).toBeOnTheScreen();
    expect(screen.getByText(en['report.shareLater'])).toBeOnTheScreen();
  });

  it('shows no numbers for an id that is not a reading', () => {
    openReport('nope');
    expect(screen.getByRole('header', { name: en['report.title'] })).toBeOnTheScreen();
    expect(screen.getByText(en['result.inconclusive'])).toBeOnTheScreen();
    expect(screen.getByText(en['report.notFound'])).toBeOnTheScreen();
    expect(screen.queryByText(en['report.heading'])).toBeNull();
    expect(screen.queryByText(en['demo.banner'])).toBeNull();
    expect(readableText()).not.toMatch(/\d/);
  });

  it('builds the page from the day of an inconclusive reading too', () => {
    openReport('demo-inconclusive');
    expect(screen.getByText(en['prototype.banner'])).toBeOnTheScreen();
    expect(screen.getByText('38')).toBeOnTheScreen();
  });

  it('has the same keys in Spanish', () => {
    for (const key of Object.keys(en).filter((name) => name.startsWith('report.'))) {
      expect(es).toHaveProperty([key]);
    }
  });
});
