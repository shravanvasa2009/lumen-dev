import type { TFunction } from 'i18next';
import { renderRouter, screen } from 'expo-router/testing-library';

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
      experimental: { ...demo.scan.experimental, extraBeatsPerMin: 0.73482 },
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

  it('floors clean seconds and rounds bpm in the report table', () => {
    const fractional = jest.requireMock('./fixtures').readingById('fractional') as FixtureReading;
    const [row] = tableRows((() => '') as unknown as TFunction, 'en', [fractional]);
    expect(row?.cells[2]).toBe('66');
    expect(row?.cells[4]).toBe('90');
  });
});

preloadAppRoutes();
