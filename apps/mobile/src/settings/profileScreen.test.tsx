import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import { Dimensions, ScrollView } from 'react-native';

import { emptyMockDatabases } from '../../__mocks__/expo-sqlite';
import en from '@/i18n/en.json';
import { EMPTY_RISK_DRAFT, type RiskDraft } from '@/profile/diabetesRisk';
import { loadRiskDraft, saveRiskDraft } from '@/store/profile';
import { expectNavTitle } from '@/testing/navHeader';
import { startOnboarded } from '@/testing/onboarded';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

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

  it('shows the saved answers and the body mass index, with no score', async () => {
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
    expect(screen.queryByText(/risk score|higher risk|lower risk/i)).not.toBeOnTheScreen();
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
