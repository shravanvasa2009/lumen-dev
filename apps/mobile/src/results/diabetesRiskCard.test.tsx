import * as core from '@lumen/core';
import { act, fireEvent, renderRouter, screen, within } from 'expo-router/testing-library';
import { Dimensions, ScrollView } from 'react-native';

import { emptyMockDatabases } from '../../__mocks__/expo-sqlite';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import { evidenceFor } from '@/evidence';
import { EMPTY_RISK_DRAFT, type RiskDraft } from '@/profile/diabetesRisk';
import { saveRiskDraft } from '@/store/profile';
import { expectNavTitle } from '@/testing/navHeader';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';
import tokens from '@/theme/tokens.json';
import i18next from 'i18next';

let mockScheme: 'light' | 'dark';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme,
}));
jest.mock('@lumen/core', () => {
  const actual = jest.requireActual<typeof import('@lumen/core')>('@lumen/core');
  return { ...actual, adaRisk: jest.fn(actual.adaRisk) };
});

preloadAppRoutes();

const higher: RiskDraft = {
  ageYears: 52,
  sex: 'female',
  heightCm: 168,
  weightKg: 82,
  familyHistory: true,
  hypertension: true,
  physicallyActive: false,
  gestationalDiabetes: false,
};
const lower: RiskDraft = {
  ...higher,
  ageYears: 45,
  heightCm: 175,
  weightKg: 68,
  familyHistory: false,
  hypertension: false,
  physicallyActive: true,
};

async function openResultsWith(draft: RiskDraft) {
  await saveRiskDraft(draft);
  renderRouter('./app', { initialUrl: '/results/demo' });
}

const pointsOnScreen = (word = 'points?') =>
  screen
    .getAllByText(new RegExp(`^-?[0-9]+ ${word}$`))
    .map((row) => Number(String(row.props.children).split(' ')[0]));

beforeEach(() => {
  mockScheme = 'light';
  emptyMockDatabases();
  jest.mocked(core.adaRisk).mockClear();
});

describe('diabetes result card', () => {
  it('shows higher risk in amber with the score and the table that adds up to it', async () => {
    await openResultsWith(higher);
    const title = await screen.findByRole('header', { name: en['dr.result.higher'] });
    expect(title.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ color: tokens.light.flag })]),
    );
    expect(screen.getByText(en['dr.result.higherSub'])).toBeOnTheScreen();
    expect(
      screen.getByText(`${en['dr.score'].replace('{{points}}', '5')} · ${en['dr.cutoff']}`),
    ).toBeOnTheScreen();
    expect(screen.getByText(en['dr.howItAdds'], { exact: false })).toBeOnTheScreen();
    expect(screen.getByText('Age 50–59')).toBeOnTheScreen();
    expect(screen.getByText('BMI 29.1 (25 to under 30)')).toBeOnTheScreen();
    expect(screen.getByText(en['dr.gdmShort'])).toBeOnTheScreen();
    expect(screen.getByText(en['dr.notScored'])).toBeOnTheScreen();
    expect(screen.getByText(en['dr.screeningNote'], { exact: false })).toBeOnTheScreen();
    expect(screen.queryByText(en['dr.minimum'])).not.toBeOnTheScreen();
    const points = pointsOnScreen();
    expect(points).toHaveLength(6);
    expect(points.reduce((sum, item) => sum + item, 0)).toBe(5);
  });

  it('shows lower risk in neutral text, and a negative row still sums to the score', async () => {
    await openResultsWith(lower);
    const title = await screen.findByRole('header', { name: en['dr.result.lower'] });
    expect(JSON.stringify(title.props.style)).not.toContain(tokens.light.flag);
    expect(screen.getByText(en['dr.result.lowerSub'])).toBeOnTheScreen();
    expect(
      screen.getByText(`${en['dr.score'].replace('{{points}}', '0')} · ${en['dr.cutoff']}`),
    ).toBeOnTheScreen();
    expect(pointsOnScreen().reduce((sum, item) => sum + item, 0)).toBe(0);
  });

  it('says no risk score under 20, with no number and no table', async () => {
    await openResultsWith({ ...higher, ageYears: 15 });
    await screen.findByRole('header', { name: en['dr.noScore'] });
    expect(screen.getByText(en['dr.under20'])).toBeOnTheScreen();
    expect(screen.queryByText(/Risk score \d/)).not.toBeOnTheScreen();
    expect(screen.queryByText(en['dr.howItAdds'], { exact: false })).not.toBeOnTheScreen();
    expect(screen.queryAllByText(/\d+ points?$/)).toHaveLength(0);
    expect(screen.getByRole('button', { name: `${en['dr.edit']} ›` })).toBeOnTheScreen();
  });

  it.each([
    ['incomplete', EMPTY_RISK_DRAFT],
    ['invalid', { ...higher, heightCm: 40 }],
  ])(
    'asks for all answers when they are %s, links to Profile and never calls adaRisk',
    async (_name, draft) => {
      await openResultsWith(draft);
      await screen.findByRole('header', { name: en['dr.notReady'] });
      expect(screen.queryByText(/Risk score \d/)).not.toBeOnTheScreen();
      expect(screen.queryByText(en['dr.howItAdds'], { exact: false })).not.toBeOnTheScreen();
      expect(core.adaRisk).not.toHaveBeenCalled();
      fireEvent.press(screen.getByRole('button', { name: en['dr.notReadyLink'] }));
      expectNavTitle(en['profile.settingsTitle']);
      await screen.findByText(en['dr.family']);
    },
  );

  it('says the score is a minimum when sex was not given, and counts no sex point', async () => {
    await openResultsWith({ ...higher, sex: 'preferNot', gestationalDiabetes: null });
    await screen.findByText(en['dr.minimum']);
    expect(screen.getByText('Sex: not counted')).toBeOnTheScreen();
    expect(screen.queryByText(en['dr.gdmShort'])).not.toBeOnTheScreen();
  });

  it('opens Settings > Profile from Edit answers', async () => {
    await openResultsWith(higher);
    fireEvent.press(await screen.findByRole('button', { name: `${en['dr.edit']} ›` }));
    expectNavTitle(en['profile.settingsTitle']);
    await screen.findByText(en['dr.family']);
  });

  it('tags the questionnaire Experimental from the evidence reader, with no accuracy number', async () => {
    await openResultsWith(higher);
    await screen.findByRole('header', { name: en['dr.result.higher'] });
    const badges = screen.getAllByTestId('evidence-badge');
    expect(badges.length).toBeGreaterThanOrEqual(2);
    for (const badge of badges) expect(badge.props.accessibilityLabel).toBe(en['evidence.experimental']);
    expect(screen.queryByText(/%|AUC|accuracy \d/i)).not.toBeOnTheScreen();
  });

  it('reads the questionnaire as Experimental while evidence.json has no entry for it', () => {
    expect(evidenceFor('questionnaire')).toEqual({ label: 'experimental', measured: false });
  });

  it('shows the pulse pattern as an Experimental extra with no number', async () => {
    await openResultsWith(higher);
    await screen.findByRole('header', { name: en['dr.result.higher'] });
    const extra = within(screen.getByTestId('pulse-extra'));
    expect(extra.getByText(en['dr.pulseExtra'])).toBeOnTheScreen();
    expect(extra.getByText(en['results.pulsePattern'])).toBeOnTheScreen();
    expect(extra.getByText(`${en['dm.experimental']} ${en['dr.notInScore']}`)).toBeOnTheScreen();
    expect(extra.queryByText(/\d/)).not.toBeOnTheScreen();
  });

  it.each([
    ['light', tokens.light],
    ['dark', tokens.dark],
  ] as const)('uses no red token in the %s theme', async (scheme, colors) => {
    mockScheme = scheme;
    await openResultsWith(higher);
    await screen.findByRole('header', { name: en['dr.result.higher'] });
    const drawn = JSON.stringify(screen.toJSON()).toLowerCase();
    for (const red of [colors.criticalText, colors.criticalFill, colors.emergencyBg, colors.pulse])
      expect(drawn).not.toContain(red.toLowerCase());
    expect(drawn).toContain(colors.flag.toLowerCase());
  });

  it('reads in Spanish with the same structure', async () => {
    await i18next.changeLanguage('es');
    try {
      await openResultsWith(higher);
      await screen.findByRole('header', { name: es['dr.result.higher'] });
      expect(screen.getByText(es['dr.result.higherSub'])).toBeOnTheScreen();
      expect(screen.getByText(es['dr.howItAdds'], { exact: false })).toBeOnTheScreen();
      expect(screen.getByText(es['dr.pulseExtra'])).toBeOnTheScreen();
      expect(pointsOnScreen('puntos?').reduce((sum, item) => sum + item, 0)).toBe(5);
    } finally {
      await act(() => i18next.changeLanguage('en'));
    }
  });

  it('fits a 360 by 640 phone: the results scroll and the card is reachable', async () => {
    const originalWindow = Dimensions.get('window');
    act(() => Dimensions.set({ window: { width: 360, height: 640, scale: 2, fontScale: 1 } }));
    try {
      await openResultsWith(higher);
      await screen.findByRole('header', { name: en['dr.result.higher'] });
      expect(screen.UNSAFE_getByType(ScrollView)).toBeTruthy();
      expect(screen.getByRole('button', { name: `${en['dr.edit']} ›` })).toBeOnTheScreen();
    } finally {
      act(() => Dimensions.set({ window: originalWindow }));
    }
  });
});

describe('diabetes result strings', () => {
  const keys = Object.keys(en).filter((key) => key.startsWith('dr.')) as (keyof typeof en)[];

  it('never say "you have" in English or "tienes" in Spanish', () => {
    for (const key of keys) {
      expect({ key, hit: /you have/i.test(en[key]) }).toEqual({ key, hit: false });
      expect({ key, hit: /\btienes\b/i.test(es[key]) }).toEqual({ key, hit: false });
    }
  });

  it('have a Spanish translation different from the English for every sentence', () => {
    for (const key of keys.filter((name) => en[name].split(' ').length > 3))
      expect({ key, same: es[key] === en[key] }).toEqual({ key, same: false });
  });
});
