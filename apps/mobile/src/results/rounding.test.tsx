import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import i18n, { type TFunction } from 'i18next';

import es from '@/i18n/es.json';
import { tableRows } from '@/report/model';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

import type { FixtureReading } from './fixtures';

jest.mock('@/profile/riskScore', () => ({ useStoredRiskScore: () => null }));

// A live reading carries unrounded floats from the signal code; the screen rounds them at display.
jest.mock('./fixtures', () => {
  const actual = jest.requireActual('./fixtures');
  const demo = actual.readingById('demo') as FixtureReading;
  const { hr, rmssd } = demo.scan.metrics;
  const fractional: FixtureReading = {
    ...demo,
    id: 'fractional',
    scan: {
      ...demo.scan,
      cleanSeconds: 90.08333333333337,
      metrics: {
        ...demo.scan.metrics,
        hr: hr && { ...hr, value: 66.07093847 },
        rmssd: rmssd && { ...rmssd, value: 48.4421, band: [41.2, 54.8] },
      },
      experimental: { ...demo.scan.experimental, extraBeatsPerMin: 0.66607 },
    },
  };
  return {
    ...actual,
    readingById: (id: string) => (id === 'fractional' ? fractional : actual.readingById(id)),
  };
});

describe('results rounding', () => {
  it('floors clean seconds and rounds bpm, HRV and its band on the Results screen', () => {
    renderRouter('./app', { initialUrl: '/results/fractional' });
    expect(screen.getByText(/^Full Scan · 90 clean s/)).toBeOnTheScreen();
    expect(screen.getByText('66 bpm')).toBeOnTheScreen();
    expect(screen.getByText('Regular rhythm, 66 bpm.')).toBeOnTheScreen();
    expect(screen.getByText('48 ms')).toBeOnTheScreen();
    expect(screen.getByText('your band 41–55')).toBeOnTheScreen();
    expect(screen.queryByText(/66\.07|90\.08|48\.44/)).toBeNull();
  });

  it('shows the extra-beat rate at one decimal on Why', async () => {
    renderRouter('./app', { initialUrl: '/results/fractional/why' });
    expect(await screen.findByText(/^0\.7 per minute/)).toBeOnTheScreen();
    expect(screen.queryByText(/0\.666/)).toBeNull();
  });

  it('writes the extra-beat rate with a decimal comma in Spanish, on Why and on Results', async () => {
    await act(() => i18n.changeLanguage('es'));
    try {
      renderRouter('./app', { initialUrl: '/results/fractional/why' });
      expect(await screen.findByText(/^0,7 por minuto/)).toBeOnTheScreen();
      screen.unmount();
      renderRouter('./app', { initialUrl: '/results/fractional' });
      fireEvent.press(screen.getByText(es['results.extraAndShape']));
      expect(screen.getByText('Latidos extra u omitidos: 0,7 por minuto')).toBeOnTheScreen();
    } finally {
      await act(() => i18n.changeLanguage('en'));
    }
  });

  it('floors clean seconds and rounds bpm in the report table', () => {
    const fractional = jest.requireMock('./fixtures').readingById('fractional') as FixtureReading;
    const [row] = tableRows((() => '') as unknown as TFunction, 'en', [fractional]);
    expect(row?.cells[2]).toBe('66');
    expect(row?.cells[4]).toBe('90');
  });
});

preloadAppRoutes();
