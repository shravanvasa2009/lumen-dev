import { act } from '@testing-library/react-native';
import i18next from 'i18next';
import { router } from 'expo-router';
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import type { QualityReason, ReadingQuality, ReadingResult } from '@lumen/core';

import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

import tokens from '@/theme/tokens.json';

import { metricReasons } from './quality';

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
  { kind: 'estimatesDisagree' },
  { kind: 'phoneTier', tier: 'basic', wantTier: 'full' },
  { kind: 'rhythmUnjudged' },
  { kind: 'sqiFlagged', windows: 7, total: 40 },
  { kind: 'sqiUnscored', seconds: 84.6 },
];

type Injected = {
  quality?: ReadingQuality;
  lowMetrics: string[];
  noRhythm: boolean;
  rhythmTooShort: boolean;
  retakePrompt?: ReadingResult['retakePrompt'];
};
const mockInjected: Injected = { lowMetrics: [], noRhythm: false, rhythmTooShort: false };

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
      // As buildReadingResult makes it under 20 intervals (ADR 0104 answer 5).
      if (mockInjected.rhythmTooShort)
        Object.assign(metrics, {
          rhythm: {
            ...(reading.scan.metrics.rhythm as object),
            class: null,
            pAF: null,
            flag: null,
            confidence: 'low',
            quality: 'low',
            qualityReasons: ['fewBeats'],
            qualityDetails: [{ kind: 'fewBeats', beats: 12, wantBeats: 40 }],
          },
          rmssd: null,
        });
      const scan = { ...reading.scan, metrics, quality: mockInjected.quality };
      if (mockInjected.retakePrompt !== undefined)
        Object.assign(scan, { retakePrompt: mockInjected.retakePrompt });
      if (mockInjected.rhythmTooShort) Object.assign(scan, { headlineKey: 'result.hrOnly' });
      return { ...reading, scan };
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
  mockInjected.rhythmTooShort = false;
  mockInjected.retakePrompt = undefined;
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
    expect(screen.getByText(/Only 72% of the scan was clean/)).toBeOnTheScreen();
    expect(screen.getByText(en['quality.rhythmUnjudged'], { exact: false })).toBeOnTheScreen();
    expect(screen.getByText(/Only 18 beats were measured/)).toBeOnTheScreen();
    expect(screen.getByText(/Only 2 of 5 steady stretches/)).toBeOnTheScreen();
    expect(screen.getByText(en['quality.estimatesDisagree'], { exact: false })).toBeOnTheScreen();
    expect(screen.getByText(/rated Basic; this check is made for Full phones/)).toBeOnTheScreen();
    expect(screen.getByText(/signal-quality check flagged 7 of 40 parts/)).toBeOnTheScreen();
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
      expect(screen.getByText(/Solo el 72% del escaneo fue limpio/)).toBeOnTheScreen();
      expect(screen.getByText(es['quality.rhythmUnjudged'], { exact: false })).toBeOnTheScreen();
      expect(screen.getByText(/Solo se midieron 18 latidos/)).toBeOnTheScreen();
      expect(screen.getByText(/Solo 2 de 5 tramos estables/)).toBeOnTheScreen();
      expect(screen.getByText(es['quality.estimatesDisagree'], { exact: false })).toBeOnTheScreen();
      expect(
        screen.getByText(/calificación Básica; esta revisión está hecha para teléfonos Completa/),
      ).toBeOnTheScreen();
      expect(screen.getByText(/calidad de la señal marcó 7 de 40 partes/)).toBeOnTheScreen();
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

// Owner 2026-10-06 (ADR 0104 answer 2): a short reading's extreme rate asks for a retake now, not the Emergency screen.
describe('retake prompt for a short, extreme rate', () => {
  it.each([
    ['shortSlow', 'results.retakeShortSlow'],
    ['shortFast', 'results.retakeShortFast'],
  ] as const)('%s: says so prominently and offers a retake', (prompt, key) => {
    mockInjected.quality = { level: 'low', reasons: [{ kind: 'shortClean', haveS: 12, wantS: 15 }] };
    mockInjected.lowMetrics = ['hr'];
    mockInjected.retakePrompt = prompt;
    openResults('demo');
    expect(screen.getByText(en[key])).toBeOnTheScreen();
    const replace = jest.spyOn(router, 'replace');
    fireEvent.press(screen.getByRole('button', { name: en['results.retakeNow'] }));
    expect(replace).toHaveBeenCalledWith('/measure/capture?mode=full');
    expect(replace).not.toHaveBeenCalledWith(expect.stringContaining('emergency'));
    replace.mockRestore();
  });

  it('shows nothing for no prompt, or for a reading saved before the field', () => {
    mockInjected.retakePrompt = null;
    openResults('demo');
    expect(screen.queryByText(en['results.retakeShortSlow'])).toBeNull();
    expect(screen.queryByRole('button', { name: en['results.retakeNow'] })).toBeNull();
  });

  it('has Spanish drafts', async () => {
    await act(() => i18next.changeLanguage('es'));
    try {
      mockInjected.retakePrompt = 'shortFast';
      openResults('demo');
      expect(screen.getByText(es['results.retakeShortFast'])).toBeOnTheScreen();
    } finally {
      await act(() => i18next.changeLanguage('en'));
    }
  });
});

// Owner 2026-10-06 (ADR 0104 answer 5): under 20 intervals the rhythm card gives no class.
describe('rhythm too short to judge', () => {
  it('says so with the tag, and never "regular" or "irregular"', () => {
    mockInjected.quality = { level: 'low', reasons: [{ kind: 'fewBeats', beats: 12, wantBeats: 40 }] };
    mockInjected.rhythmTooShort = true;
    openResults('demo');
    expect(screen.getByText(en['results.rhythmTooShort'])).toBeOnTheScreen();
    expect(screen.queryByText(en['results.rhythmRegular'])).toBeNull();
    expect(screen.queryByText(en['results.rhythmIrregular'])).toBeNull();
    expect(screen.queryByText(en['quality.confirmAf'])).toBeNull();
    // The header chip and the rhythm card's.
    expect(screen.getAllByRole('button', { name: en['quality.chip'] })).toHaveLength(2);
    expect(screen.getByText(en['quality.missingNoRhythm'])).toBeOnTheScreen();
  });
});

const drawsColor = (drawn: string, name: 'badgeExperimentalBg' | 'badgeFlagBg') =>
  drawn.includes(tokens.dark[name]) || drawn.includes(tokens.light[name]);

describe('a flag on a lower-quality value (ADR 0104, owner 2026-10-09)', () => {
  it('keeps the flag, leads with the quality message, quiets the badge and moves Find care below the cards', () => {
    mockInjected.lowMetrics = ['rhythm'];
    openResults('demo-flag');
    expect(screen.getByText(en['results.lowQualityLead'])).toBeOnTheScreen();
    expect(screen.getByText(en['result.irregularRetake'])).toBeOnTheScreen();
    expect(screen.getByText(en['results.flag'])).toBeOnTheScreen();
    // The lower-quality chip is amber too, so the flag badge itself is what is checked.
    let badgeNode = screen.getByText(en['results.flag']).parent;
    while (badgeNode && !JSON.stringify(badgeNode.props.style ?? '').includes('backgroundColor'))
      badgeNode = badgeNode.parent;
    const badge = JSON.stringify(badgeNode?.props.style);
    expect(drawsColor(badge, 'badgeExperimentalBg')).toBe(true);
    expect(screen.getByRole('button', { name: en['results.findCare'] })).toBeOnTheScreen();
    // The safety sheet is unchanged.
    expect(screen.getByText(en['safety.question'])).toBeOnTheScreen();
  });

  it('puts Find care after the last metric card, and standard cards before the lower-quality one', () => {
    mockInjected.lowMetrics = ['rhythm'];
    openResults('demo-flag');
    const order = JSON.stringify(screen.toJSON());
    const at = (text: string) => order.indexOf(text);
    expect(at(en['results.heartRate'])).toBeGreaterThan(-1);
    expect(at(en['results.heartRate'])).toBeLessThan(at(en['results.heartRhythm']));
    expect(at(en['results.heartRhythm'])).toBeLessThan(at(en['results.findCare']));
  });

  it('keeps today�s order, headline and amber badge when the flagged value is standard quality', () => {
    openResults('demo-flag');
    expect(screen.queryByText(en['results.lowQualityLead'])).toBeNull();
    const order = JSON.stringify(screen.toJSON());
    expect(order.indexOf(en['results.findCare'])).toBeLessThan(order.indexOf(en['results.heartRhythm']));
    expect(drawsColor(order, 'badgeFlagBg')).toBe(true);
  });
});

describe('metricReasons', () => {
  const reading: ReadingQuality = { level: 'low', reasons: [{ kind: 'shortClean', haveS: 12, wantS: 90 }] };

  it('quotes the card’s own floor (heart rate 15 s), not the reading’s largest (90 s)', () => {
    const hr = {
      quality: 'low',
      qualityReasons: ['shortClean'],
      qualityDetails: [{ kind: 'shortClean', haveS: 12, wantS: 15 }],
    };
    expect(metricReasons(hr, reading)).toEqual([{ kind: 'shortClean', haveS: 12, wantS: 15 }]);
  });

  it('falls back to the reading’s reasons of the same kinds for a reading saved before the details', () => {
    expect(metricReasons({ quality: 'low', qualityReasons: ['shortClean'] }, reading)).toEqual(
      reading.reasons,
    );
    expect(metricReasons({ quality: 'standard' }, reading)).toBeNull();
  });
});

preloadAppRoutes();
