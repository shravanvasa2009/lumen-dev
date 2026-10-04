import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import { Dimensions, ScrollView } from 'react-native';

import { emptyMockDatabases } from '../../__mocks__/expo-sqlite';
import en from '@/i18n/en.json';
import { EMPTY_RISK_DRAFT, type RiskDraft } from '@/profile/diabetesRisk';
import { loadRiskDraft, profileValue, saveRiskDraft } from '@/store/profile';
import { expectNavTitle } from '@/testing/navHeader';
import { startOnboarded } from '@/testing/onboarded';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';
import tokens from '@/theme/tokens.json';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'dark',
}));
jest.mock('@/notifications/scheduler', () => ({ syncNotifications: jest.fn(async () => undefined) }));

preloadAppRoutes();

const saved: RiskDraft = {
  ageYears: 52,
  sex: 'female',
  heightCm: 168,
  weightKg: 82,
  familyHistory: true,
  hypertension: true,
  physicallyActive: false,
  gestationalDiabetes: false,
};

beforeEach(emptyMockDatabases);

describe('Settings > Profile', () => {
  it('opens from the Settings row', async () => {
    await startOnboarded();
    renderRouter('./app', { initialUrl: '/settings' });
    fireEvent.press(screen.getByRole('button', { name: new RegExp(en['profile.diabetesRisk']) }));
    expectNavTitle(en['profile.settingsTitle']);
  });

  it('shows the saved answers and the body mass index', async () => {
    await saveRiskDraft(saved);
    renderRouter('./app', { initialUrl: '/settings/profile' });
    expect(await screen.findByText(en['dr.family'])).toBeOnTheScreen();
    expect(screen.getByText('52 years')).toBeOnTheScreen();
    expect(screen.getByText(en['profile.female'])).toBeOnTheScreen();
    expect(screen.getByText('168 cm')).toBeOnTheScreen();
    expect(screen.getByText('82 kg')).toBeOnTheScreen();
    expect(screen.getByText('29.1')).toBeOnTheScreen();
    expect(screen.getByText(en['dr.gdmShort'])).toBeOnTheScreen();
    expect(screen.getByText(en['dr.notScored'])).toBeOnTheScreen();
  });

  it('shows Not answered for what was never asked, and hides the pregnancy row unless Female', async () => {
    await saveRiskDraft({ ...EMPTY_RISK_DRAFT, sex: 'male', ageYears: 30 });
    renderRouter('./app', { initialUrl: '/settings/profile' });
    await screen.findByText(en['dr.family']);
    expect(screen.getAllByText(en['profile.notAnswered']).length).toBeGreaterThanOrEqual(5);
    expect(screen.queryByText(en['dr.gdmShort'])).not.toBeOnTheScreen();
  });

  it('edits with the same form and stores the change', async () => {
    await saveRiskDraft(saved);
    renderRouter('./app', { initialUrl: '/settings/profile' });
    fireEvent.press(await screen.findByRole('button', { name: en['dr.edit'] }));
    const family = screen.getByLabelText(en['dr.family']);
    expect(within(family).getByRole('radio', { name: en['common.yes'] })).toBeChecked();
    fireEvent.press(within(family).getByRole('radio', { name: en['common.no'] }));
    fireEvent.changeText(screen.getByLabelText(en['profile.weight']), '70');
    fireEvent.press(screen.getByRole('button', { name: en['common.done'] }));
    expect(await screen.findByText('70 kg')).toBeOnTheScreen();
    expect(await loadRiskDraft()).toMatchObject({ familyHistory: false, weightKg: 70, hypertension: true });
  });

  it('keeps Done off while a height is out of range', async () => {
    await saveRiskDraft(saved);
    renderRouter('./app', { initialUrl: '/settings/profile' });
    fireEvent.press(await screen.findByRole('button', { name: en['dr.edit'] }));
    fireEvent.changeText(screen.getByLabelText(en['profile.height']), '30');
    expect(screen.getByRole('button', { name: en['common.done'] })).toBeDisabled();
    await waitFor(() => expect(screen.getByText('Enter a height between 100 and 250 cm.')).toBeOnTheScreen());
  });

  it('stores a question tap without storing an unchecked age', async () => {
    await saveRiskDraft(saved);
    renderRouter('./app', { initialUrl: '/settings/profile' });
    fireEvent.press(await screen.findByRole('button', { name: en['dr.edit'] }));
    fireEvent.changeText(screen.getByLabelText(en['profile.age']), '9');
    const family = screen.getByLabelText(en['dr.family']);
    fireEvent.press(within(family).getByRole('radio', { name: en['common.no'] }));
    await waitFor(async () => expect((await loadRiskDraft()).familyHistory).toBe(false));
    expect((await loadRiskDraft()).ageYears).toBe(52);
  });

  it('removes the pregnancy answer once sex is changed from Female', async () => {
    await saveRiskDraft({ ...saved, gestationalDiabetes: true });
    renderRouter('./app', { initialUrl: '/settings/profile' });
    fireEvent.press(await screen.findByRole('button', { name: en['dr.edit'] }));
    fireEvent.press(screen.getByRole('radio', { name: en['profile.male'] }));
    fireEvent.press(screen.getByRole('button', { name: en['common.done'] }));
    await screen.findByText('52 years');
    expect((await loadRiskDraft()).gestationalDiabetes).toBeNull();
    expect(await profileValue('gestationalDiabetes')).toBeNull();
  });

  it('shows the latest score from the saved answers, in amber for higher risk', async () => {
    await saveRiskDraft(saved);
    renderRouter('./app', { initialUrl: '/settings/profile' });
    const label = await screen.findByText(en['dr.lastScore']);
    expect(label).toBeOnTheScreen();
    const higher = screen.getByText(en['dr.result.higher']);
    expect(JSON.stringify(higher.props.style)).toContain(tokens.dark.flag);
    expect(screen.getByText('Risk score 5')).toBeOnTheScreen();
    expect(screen.getByText(en['dr.cutoff'])).toBeOnTheScreen();
    expect(screen.getByText(en['dr.screeningNote'])).toBeOnTheScreen();
  });

  it('shows lower risk, and a minimum note when sex was not given', async () => {
    await saveRiskDraft({ ...saved, sex: 'preferNot', familyHistory: false, hypertension: false });
    renderRouter('./app', { initialUrl: '/settings/profile' });
    await screen.findByText(en['dr.lastScore']);
    expect(screen.getByText(en['dr.result.lower'])).toBeOnTheScreen();
    expect(screen.getByText('Risk score 3')).toBeOnTheScreen();
    expect(screen.getByText(`${en['dr.cutoff']} · ${en['dr.minimum']}`)).toBeOnTheScreen();
  });

  it('shows no number on the latest score until every question is answered', async () => {
    await saveRiskDraft({ ...saved, hypertension: null });
    renderRouter('./app', { initialUrl: '/settings/profile' });
    await screen.findByText(en['dr.lastScore']);
    expect(screen.getByText(en['dr.notReady'])).toBeOnTheScreen();
    expect(screen.queryByText(/Risk score \d/)).not.toBeOnTheScreen();
  });

  it('shows no number on the latest score under age 20', async () => {
    await saveRiskDraft({ ...saved, ageYears: 15 });
    renderRouter('./app', { initialUrl: '/settings/profile' });
    await screen.findByText(en['dr.lastScore']);
    expect(screen.getByText(en['dr.noScore'])).toBeOnTheScreen();
    expect(screen.queryByText(/Risk score \d/)).not.toBeOnTheScreen();
  });

  it('keeps the stored pregnancy answer when a question is tapped after changing sex, until Done', async () => {
    await saveRiskDraft({ ...saved, gestationalDiabetes: true });
    renderRouter('./app', { initialUrl: '/settings/profile' });
    fireEvent.press(await screen.findByRole('button', { name: en['dr.edit'] }));
    fireEvent.press(screen.getByRole('radio', { name: en['profile.male'] }));
    const family = screen.getByLabelText(en['dr.family']);
    fireEvent.press(within(family).getByRole('radio', { name: en['common.no'] }));
    await waitFor(async () => expect((await loadRiskDraft()).familyHistory).toBe(false));
    expect(await profileValue('gestationalDiabetes')).toBe('true');
    expect((await loadRiskDraft()).sex).toBe('female');
    fireEvent.press(screen.getByRole('button', { name: en['common.done'] }));
    await screen.findByText('52 years');
    expect(await profileValue('gestationalDiabetes')).toBeNull();
  });

  it('fits a 360 by 640 phone: both views scroll', async () => {
    const originalWindow = Dimensions.get('window');
    act(() => Dimensions.set({ window: { width: 360, height: 640, scale: 2, fontScale: 1 } }));
    try {
      await saveRiskDraft(saved);
      renderRouter('./app', { initialUrl: '/settings/profile' });
      fireEvent.press(await screen.findByRole('button', { name: en['dr.edit'] }));
      expect(screen.UNSAFE_getByType(ScrollView)).toBeTruthy();
      expect(screen.getByRole('button', { name: en['common.done'] })).toBeOnTheScreen();
    } finally {
      act(() => Dimensions.set({ window: originalWindow }));
    }
  });
});
