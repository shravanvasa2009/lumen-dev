import * as core from '@lumen/core';
import i18next from 'i18next';
import { Children } from 'react';
import { act, fireEvent, renderRouter, screen, within } from 'expo-router/testing-library';
import { Dimensions, ScrollView, StyleSheet } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { emptyMockDatabases } from '../../__mocks__/expo-sqlite';
import { evidenceFor } from '@/evidence';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import { EMPTY_RISK_DRAFT, type RiskDraft } from '@/profile/diabetesRisk';
import * as profileStore from '@/store/profile';
import { expectNavTitle } from '@/testing/navHeader';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';
import { saveTestReading } from '@/testing/savedReading';
import tokens from '@/theme/tokens.json';

let mockScheme: 'light' | 'dark';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme,
}));
jest.mock('@lumen/core', () => {
  const actual = jest.requireActual<typeof import('@lumen/core')>('@lumen/core');
  return { ...actual, adaRisk: jest.fn(actual.adaRisk) };
});
jest.mock('@/store/profile', () => {
  const actual = jest.requireActual<typeof import('@/store/profile')>('@/store/profile');
  return { ...actual, loadRiskDraft: jest.fn(actual.loadRiskDraft) };
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

// A reading taken on this phone (not a sample), with no pulse estimate in it.
async function openOwnReading(draft: RiskDraft, suffix: '' | '/diabetes') {
  await profileStore.saveRiskDraft(draft);
  const id = await saveTestReading(Date.UTC(2026, 9, 1), 64);
  renderRouter('./app', { initialUrl: `/results/${id}${suffix}` });
}
const openRow = (draft: RiskDraft) => openOwnReading(draft, '');
const openDetail = (draft: RiskDraft) => openOwnReading(draft, '/diabetes');

const pointsOnScreen = (word = 'points?') =>
  screen
    .getAllByText(new RegExp(`^-?[0-9]+ ${word}$`))
    .map((row) => Number(Children.toArray(row.props.children)[0]));

beforeEach(() => {
  mockScheme = 'light';
  emptyMockDatabases();
  jest.mocked(core.adaRisk).mockClear();
});

describe('Diabetes risk row on Results', () => {
  it('shows higher risk in amber with the score and no table, with no pulse estimate in the reading', async () => {
    await openRow(higher);
    const word = await screen.findByText(en['dr.result.higher']);
    expect(JSON.stringify(word.props.style)).toContain(tokens.light.flag);
    expect(screen.getByText('Risk score 5')).toBeOnTheScreen();
    expect(screen.getByText(en['dr.rowTitle'])).toBeOnTheScreen();
    expect(screen.queryByText(en['dr.howItAdds'], { exact: false })).not.toBeOnTheScreen();
    expect(screen.queryByText(en['dr.pulseExtra'])).not.toBeOnTheScreen();
  });

  it('has the From your answers line and an Edit answers link to Settings > Profile', async () => {
    await openRow(higher);
    await screen.findByText(en['dr.result.higher']);
    expect(screen.getByText(en['dr.fromAnswers'])).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: `${en['dr.edit']} ›` }));
    expectNavTitle(en['profile.settingsTitle']);
    await screen.findByText(en['dr.family']);
  });

  it('shows lower risk in neutral text', async () => {
    await openRow(lower);
    const word = await screen.findByText(en['dr.result.lower']);
    expect(JSON.stringify(word.props.style)).not.toContain(tokens.light.flag);
    expect(screen.getByText('Risk score 0')).toBeOnTheScreen();
  });

  it('shows no number under 20', async () => {
    await openRow({ ...higher, ageYears: 15 });
    await screen.findByText(en['dr.noScore']);
    expect(screen.queryByText(/Risk score \d/)).not.toBeOnTheScreen();
  });

  it('asks for all answers when they are incomplete, and never calls adaRisk', async () => {
    await openRow(EMPTY_RISK_DRAFT);
    await screen.findByText(en['dr.notReady']);
    expect(core.adaRisk).not.toHaveBeenCalled();
  });

  it('says the answers could not be loaded, not that they are missing, and reports why', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.mocked(profileStore.loadRiskDraft).mockRejectedValueOnce(new Error('disk'));
    await openRow(higher);
    await screen.findByText(en['profile.loadFailed']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('disk'));
    warn.mockRestore();
    expect(screen.queryByText(en['dr.notReady'])).not.toBeOnTheScreen();
    expect(core.adaRisk).not.toHaveBeenCalled();
  });

  it('opens the detail screen', async () => {
    await openRow(higher);
    fireEvent.press(await screen.findByRole('button', { name: new RegExp(en['dr.rowTitle']) }));
    await screen.findByRole('header', { name: en['dr.result.higher'] });
    expect(screen.getByRole('header', { name: en['dr.rowTitle'] })).toBeOnTheScreen();
  });

  it('does not show the saved answers on a demo reading', async () => {
    await profileStore.saveRiskDraft(higher);
    renderRouter('./app', { initialUrl: '/results/demo' });
    await screen.findByText(en['dr.demoRow']);
    expect(screen.queryByText(en['dr.result.higher'])).not.toBeOnTheScreen();
    expect(screen.queryByText(/Risk score \d/)).not.toBeOnTheScreen();
    expect(core.adaRisk).not.toHaveBeenCalled();
  });
});

describe('Diabetes risk row on a 360 by 640 phone in Spanish', () => {
  it('lets the score cell shrink so the title and Edit answers stay readable', async () => {
    const originalWindow = Dimensions.get('window');
    act(() => Dimensions.set({ window: { width: 360, height: 640, scale: 2, fontScale: 1.3 } }));
    await i18next.changeLanguage('es');
    try {
      await openRow(higher);
      const word = await screen.findByText(es['dr.result.higher']);
      let cell: ReactTestInstance | null = word;
      while (cell !== null && StyleSheet.flatten(cell.props.style)?.maxWidth === undefined)
        cell = cell.parent;
      const cellStyle = StyleSheet.flatten(cell?.props.style);
      expect(cellStyle.flexShrink).toBe(1);
      expect(cellStyle.maxWidth).toBe('50%');
      expect(screen.getByText(es['dr.rowTitle'])).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: `${es['dr.edit']} ›` })).toBeOnTheScreen();
    } finally {
      await act(() => i18next.changeLanguage('en'));
      act(() => Dimensions.set({ window: originalWindow }));
    }
  });
});

describe('diabetes result detail screen', () => {
  it('shows higher risk in amber with the score and the table that adds up to it', async () => {
    await openDetail(higher);
    const title = await screen.findByRole('header', { name: en['dr.result.higher'] });
    expect(title.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ color: tokens.light.flag })]),
    );
    expect(screen.getByText(en['dr.result.higherSub'])).toBeOnTheScreen();
    expect(
      screen.getByText(`${en['dr.score'].replace('{{points}}', '5')} · ${en['dr.cutoff']}`),
    ).toBeOnTheScreen();
    expect(screen.getByText(en['dr.howItAdds'], { exact: false })).toBeOnTheScreen();
    expect(screen.getByText('Age 52')).toBeOnTheScreen();
    expect(screen.getByText('BMI 29.0')).toBeOnTheScreen();
    expect(screen.getByText(en['dr.row.sex.female'])).toBeOnTheScreen();
    expect(screen.getByText(en['dr.gdmShort'])).toBeOnTheScreen();
    expect(screen.getByText(en['dr.notScored'])).toBeOnTheScreen();
    expect(screen.getByText(en['dr.screeningNote'], { exact: false })).toBeOnTheScreen();
    expect(screen.queryByText(en['dr.minimum'])).not.toBeOnTheScreen();
    const points = pointsOnScreen();
    expect(points).toHaveLength(6);
    expect(points.reduce((sum, item) => sum + item, 0)).toBe(5);
  });

  it('writes the body mass index row with a decimal comma in Spanish', async () => {
    await i18next.changeLanguage('es');
    try {
      await openDetail(higher);
      expect(await screen.findByText('IMC 29,0')).toBeOnTheScreen();
    } finally {
      await act(() => i18next.changeLanguage('en'));
    }
  });

  it('shows lower risk in neutral text, and a negative row still sums to the score', async () => {
    await openDetail(lower);
    const title = await screen.findByRole('header', { name: en['dr.result.lower'] });
    expect(JSON.stringify(title.props.style)).not.toContain(tokens.light.flag);
    expect(screen.getByText(en['dr.result.lowerSub'])).toBeOnTheScreen();
    expect(
      screen.getByText(`${en['dr.score'].replace('{{points}}', '0')} · ${en['dr.cutoff']}`),
    ).toBeOnTheScreen();
    expect(pointsOnScreen().reduce((sum, item) => sum + item, 0)).toBe(0);
  });

  it('says no risk score under 20, with no number and no table', async () => {
    await openDetail({ ...higher, ageYears: 15 });
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
      await openDetail(draft);
      await screen.findByRole('header', { name: en['dr.notReady'] });
      expect(screen.queryByText(/Risk score \d/)).not.toBeOnTheScreen();
      expect(screen.queryByText(en['dr.howItAdds'], { exact: false })).not.toBeOnTheScreen();
      expect(core.adaRisk).not.toHaveBeenCalled();
      fireEvent.press(screen.getByRole('button', { name: en['dr.notReadyLink'] }));
      expectNavTitle(en['profile.settingsTitle']);
      await screen.findByText(en['dr.family']);
    },
  );

  it('says the answers could not be loaded, with no score and no link', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.mocked(profileStore.loadRiskDraft).mockRejectedValueOnce(new Error('disk'));
    await openDetail(higher);
    await screen.findByRole('header', { name: en['profile.loadFailed'] });
    expect(screen.queryByText(en['dr.notReady'])).not.toBeOnTheScreen();
    expect(screen.queryByText(/Risk score \d/)).not.toBeOnTheScreen();
    expect(core.adaRisk).not.toHaveBeenCalled();
  });

  it('floors the body mass index so it never shows a band edge it did not score in', async () => {
    await openDetail({ ...higher, heightCm: 168, weightKg: 70.5 });
    await screen.findByText('BMI 24.9');
    expect(screen.queryByText('BMI 25.0')).not.toBeOnTheScreen();
    expect(pointsOnScreen().reduce((sum, item) => sum + item, 0)).toBe(4);
  });

  it('shows the not-found state, and no score, for an id with no saved reading', async () => {
    await profileStore.saveRiskDraft(higher);
    renderRouter('./app', { initialUrl: '/results/reading-missing/diabetes' });
    await screen.findByText(en['result.inconclusive']);
    expect(screen.queryByText(en['dr.result.higher'])).not.toBeOnTheScreen();
    expect(screen.queryByText(/Risk score \d/)).not.toBeOnTheScreen();
  });

  it('says the score is a minimum when sex was not given, and counts no sex point', async () => {
    await openDetail({ ...higher, sex: 'preferNot', gestationalDiabetes: null });
    await screen.findByText(en['dr.minimum']);
    expect(screen.getByText(en['dr.row.sex.notCounted'])).toBeOnTheScreen();
    expect(screen.queryByText(en['dr.gdmShort'])).not.toBeOnTheScreen();
  });

  it('opens Settings > Profile from Edit answers', async () => {
    await openDetail(higher);
    fireEvent.press(await screen.findByRole('button', { name: `${en['dr.edit']} ›` }));
    expectNavTitle(en['profile.settingsTitle']);
    await screen.findByText(en['dr.family']);
  });

  it('shows no Experimental badge on the questionnaire result, and no accuracy number', async () => {
    await openDetail(higher);
    await screen.findByRole('header', { name: en['dr.result.higher'] });
    expect(screen.queryAllByTestId('evidence-badge')).toEqual([]);
    expect(screen.queryByText(/%|AUC|accuracy \d/i)).not.toBeOnTheScreen();
  });

  it('reads the questionnaire as Experimental while evidence.json has no entry for it', () => {
    expect(evidenceFor('questionnaire')).toEqual({ label: 'experimental', measured: false });
  });

  it.each([
    ['light', tokens.light],
    ['dark', tokens.dark],
  ] as const)('uses no red token in the %s theme', async (scheme, colors) => {
    mockScheme = scheme;
    await openDetail(higher);
    await screen.findByRole('header', { name: en['dr.result.higher'] });
    const drawn = JSON.stringify(screen.toJSON()).toLowerCase();
    for (const red of [colors.criticalText, colors.criticalFill, colors.emergencyBg, colors.pulse])
      expect(drawn).not.toContain(red.toLowerCase());
    expect(drawn).toContain(colors.flag.toLowerCase());
  });

  it('reads in Spanish with the same structure', async () => {
    await i18next.changeLanguage('es');
    try {
      await openDetail(higher);
      await screen.findByRole('header', { name: es['dr.result.higher'] });
      expect(screen.getByText(es['dr.result.higherSub'])).toBeOnTheScreen();
      expect(screen.getByText(es['dr.howItAdds'], { exact: false })).toBeOnTheScreen();
      expect(screen.getByText('Edad 52')).toBeOnTheScreen();
      expect(pointsOnScreen('puntos?').reduce((sum, item) => sum + item, 0)).toBe(5);
    } finally {
      await act(() => i18next.changeLanguage('en'));
    }
  });

  it('fits a 360 by 640 phone: the screen scrolls and Edit answers is reachable', async () => {
    const originalWindow = Dimensions.get('window');
    act(() => Dimensions.set({ window: { width: 360, height: 640, scale: 2, fontScale: 1 } }));
    try {
      await openDetail(higher);
      await screen.findByRole('header', { name: en['dr.result.higher'] });
      expect(screen.UNSAFE_getByType(ScrollView)).toBeTruthy();
      expect(screen.getByRole('button', { name: `${en['dr.edit']} ›` })).toBeOnTheScreen();
    } finally {
      act(() => Dimensions.set({ window: originalWindow }));
    }
  });
});

describe('pulse pattern extra on the detail screen', () => {
  beforeEach(async () => {
    await profileStore.saveRiskDraft(higher);
    renderRouter('./app', { initialUrl: '/results/demo/diabetes' });
  });

  it('is an Experimental extra with no number, and a demo does not read the saved answers', async () => {
    const extra = within(await screen.findByTestId('pulse-extra'));
    expect(extra.getByText(en['dr.pulseExtra'])).toBeOnTheScreen();
    expect(extra.getByText(en['results.pulsePattern'])).toBeOnTheScreen();
    expect(extra.getByText(`${en['dm.experimental']} ${en['dr.notInScore']}`)).toBeOnTheScreen();
    expect(extra.queryByText(/\d/)).not.toBeOnTheScreen();
    expect(screen.getByText(en['dr.demoRow'])).toBeOnTheScreen();
    expect(screen.queryByText(en['dr.result.higher'])).not.toBeOnTheScreen();
    expect(core.adaRisk).not.toHaveBeenCalled();
  });

  it('shows no Experimental pill', async () => {
    await screen.findByTestId('pulse-extra');
    expect(screen.queryByTestId('evidence-badge')).toBeNull();
  });

  it('is never flagged and shows no accuracy number', async () => {
    await screen.findByTestId('pulse-extra');
    expect(screen.queryByText(en['dm.flag.title'])).not.toBeOnTheScreen();
    expect(screen.queryByText(/%|AUC/)).not.toBeOnTheScreen();
  });
});

describe('pulse preview on a Quick Check', () => {
  it('says the pulse preview needs a Full Scan', async () => {
    renderRouter('./app', { initialUrl: '/results/demo-flag/diabetes' });
    expect(await screen.findByText(en['dr.pulseNeedsFull'])).toBeOnTheScreen();
  });

  it('does not say it on a Full Scan', async () => {
    renderRouter('./app', { initialUrl: '/results/demo/diabetes' });
    await screen.findByTestId('pulse-extra');
    expect(screen.queryByText(en['dr.pulseNeedsFull'])).not.toBeOnTheScreen();
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
