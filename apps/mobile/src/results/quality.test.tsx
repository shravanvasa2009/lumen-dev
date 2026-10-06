import { act } from '@testing-library/react-native';
import i18next from 'i18next';
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

import type { QualityReason, ReadingQuality } from './quality';

jest.mock('@/profile/riskScore', () => ({ useStoredRiskScore: () => null }));

const allReasons: QualityReason[] = [
  { kind: 'shortClean', haveS: 12, wantS: 90 },
  { kind: 'lowFps', fps: 30, wantFps: 60 },
  { kind: 'noSqi' },
  { kind: 'modelFallback' },
  { kind: 'quickMode' },
  { kind: 'contact', coveredPct: 72 },
  { kind: 'fewBeats', beats: 18, wantBeats: 40 },
  { kind: 'fewWindows', windows: 2, wantWindows: 5 },
];

type Injected = { quality?: ReadingQuality; lowMetrics: string[]; noRhythm: boolean };
const mockInjected: Injected = { lowMetrics: [], noRhythm: false };

jest.mock('./fixtures', () => {
  const actual = jest.requireActual('./fixtures');
  return {
    ...actual,
    readingById: (id: string) => {
      const reading = actual.readingById(id);
      const metrics = Object.fromEntries(
        Object.entries(reading.scan.metrics).map(([name, metric]) => [
          name,
          metric && mockInjected.lowMetrics.includes(name)
            ? { ...(metric as object), quality: 'low', qualityReasons: ['shortClean'] }
            : metric,
        ]),
      );
      if (mockInjected.noRhythm) Object.assign(metrics, { rhythm: null, rmssd: null });
      return { ...reading, scan: { ...reading.scan, metrics, quality: mockInjected.quality } };
    },
  };
});

function openResults(id: string) {
  renderRouter('./app', { initialUrl: `/results/${id}` });
}

beforeEach(() => {
  mockInjected.quality = undefined;
  mockInjected.lowMetrics = [];
  mockInjected.noRhythm = false;
});

describe('lower-quality tag', () => {
  it('hides the chip on a standard reading and on one stored without quality', () => {
    openResults('demo');
    expect(screen.queryByRole('button', { name: en['quality.chip'] })).toBeNull();
  });

  it('hides the chip when the level is standard', () => {
    mockInjected.quality = { level: 'standard', reasons: [] };
    openResults('demo');
    expect(screen.queryByRole('button', { name: en['quality.chip'] })).toBeNull();
  });

  it('renders a reading stored without quality in full', () => {
    openResults('demo-flag');
    expect(screen.getByText('88 bpm')).toBeOnTheScreen();
    expect(screen.getByText(en['results.breathing'])).toBeOnTheScreen();
  });

  it('shows the header chip for a low reading and lists every reason with its numbers', () => {
    mockInjected.quality = { level: 'low', reasons: allReasons };
    openResults('demo');
    fireEvent.press(screen.getByRole('button', { name: en['quality.chip'] }));
    expect(screen.getByRole('header', { name: en['quality.sheetTitle'] })).toBeOnTheScreen();
    expect(screen.getByText(/Only 12 of 90 clean seconds/)).toBeOnTheScreen();
    expect(screen.getByText(/30 frames per second.*than at 60/)).toBeOnTheScreen();
    expect(screen.getByText(en['quality.noSqi'], { exact: false })).toBeOnTheScreen();
    expect(screen.getByText(en['quality.modelFallback'], { exact: false })).toBeOnTheScreen();
    expect(screen.getByText(en['quality.quickMode'], { exact: false })).toBeOnTheScreen();
    expect(screen.getByText(/covered the lens 72% of the time/)).toBeOnTheScreen();
    expect(screen.getByText(/Only 18 beats were measured/)).toBeOnTheScreen();
    expect(screen.getByText(/Only 2 of 5 steady stretches/)).toBeOnTheScreen();
    expect(screen.getByText(en['quality.betterTitle'])).toBeOnTheScreen();
  });

  it('lists every reason in Spanish', async () => {
    await act(() => i18next.changeLanguage('es'));
    try {
      mockInjected.quality = { level: 'low', reasons: allReasons };
      openResults('demo');
      fireEvent.press(screen.getByRole('button', { name: es['quality.chip'] }));
      expect(screen.getByRole('header', { name: es['quality.sheetTitle'] })).toBeOnTheScreen();
      expect(screen.getByText(/Solo 12 de 90 segundos limpios/)).toBeOnTheScreen();
      expect(screen.getByText(/30 cuadros por segundo.*que a 60/)).toBeOnTheScreen();
      expect(screen.getByText(es['quality.noSqi'], { exact: false })).toBeOnTheScreen();
      expect(screen.getByText(es['quality.modelFallback'], { exact: false })).toBeOnTheScreen();
      expect(screen.getByText(es['quality.quickMode'], { exact: false })).toBeOnTheScreen();
      expect(screen.getByText(/cubrió el lente el 72% del tiempo/)).toBeOnTheScreen();
      expect(screen.getByText(/Solo se midieron 18 latidos/)).toBeOnTheScreen();
      expect(screen.getByText(/Solo 2 de 5 tramos estables/)).toBeOnTheScreen();
      expect(screen.getByText(es['quality.betterTitle'])).toBeOnTheScreen();
    } finally {
      await act(() => i18next.changeLanguage('en'));
    }
  });

  it('puts a chip only on the cards whose metric is low', () => {
    mockInjected.quality = { level: 'low', reasons: allReasons };
    mockInjected.lowMetrics = ['hr', 'resp'];
    openResults('demo');
    // The header chip plus one for heart rate and one for breathing.
    expect(screen.getAllByRole('button', { name: en['quality.chip'] })).toHaveLength(3);
  });

  it('shows only the reasons a card names in its own sheet', () => {
    mockInjected.quality = { level: 'standard', reasons: allReasons };
    mockInjected.lowMetrics = ['resp'];
    openResults('demo');
    fireEvent.press(screen.getByRole('button', { name: en['quality.chip'] }));
    expect(screen.getByText(/Only 12 of 90 clean seconds/)).toBeOnTheScreen();
    expect(screen.queryByText(/Only 18 beats/)).toBeNull();
  });

  it('adds the Full Scan advice to a low-quality irregular rhythm and keeps the flag', () => {
    mockInjected.quality = { level: 'low', reasons: allReasons };
    mockInjected.lowMetrics = ['rhythm'];
    openResults('demo-flag');
    expect(screen.getByText(en['quality.confirmAf'])).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: en['safety.yes'] })).toBeOnTheScreen();
  });

  it('never says No AFib for a regular rhythm', () => {
    openResults('demo');
    expect(screen.getByText(en['results.rhythmRegular'])).toBeOnTheScreen();
    expect(screen.queryByText(/No AFib/i)).toBeNull();
  });

  it('says why a card is empty when the reading names a cause', () => {
    mockInjected.quality = { level: 'low', reasons: [{ kind: 'shortClean', haveS: 12, wantS: 90 }] };
    mockInjected.noRhythm = true;
    openResults('demo');
    expect(screen.getAllByText(en['quality.missingShort']).length).toBeGreaterThan(0);
    expect(screen.getByText(en['quality.missingNoRhythm'])).toBeOnTheScreen();
  });
});

preloadAppRoutes();
