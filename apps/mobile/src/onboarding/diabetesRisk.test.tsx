import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import { Dimensions, ScrollView } from 'react-native';

import { emptyMockDatabases } from '../../__mocks__/expo-sqlite';
import en from '@/i18n/en.json';
import { EMPTY_RISK_DRAFT } from '@/profile/diabetesRisk';
import { lumenDatabase } from '@/store/database';
import { loadRiskDraft, saveRiskDraft } from '@/store/profile';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'dark',
}));

preloadAppRoutes();

describe('diabetes risk questions (set 2)', () => {
  beforeEach(emptyMockDatabases);

  it('shows the title, the intro and the question set', async () => {
    renderRouter('./app', { initialUrl: '/diabetes-risk' });
    expect(await screen.findByText(en['dr.family'])).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: en['dr.title'] })).toBeOnTheScreen();
    expect(screen.getByText(en['dr.intro'])).toBeOnTheScreen();
    expect(screen.getByText('Question set 2 of 2')).toBeOnTheScreen();
    for (const key of ['dr.family', 'dr.bp', 'dr.active'] as const)
      expect(screen.getByLabelText(en[key])).toBeOnTheScreen();
  });

  it('asks the pregnancy question only when sex is Female, and says it is not scored', async () => {
    await saveRiskDraft({ ...EMPTY_RISK_DRAFT, sex: 'female' });
    const female = renderRouter('./app', { initialUrl: '/diabetes-risk' });
    expect(await screen.findByLabelText(en['dr.gdm'])).toBeOnTheScreen();
    expect(screen.getByText(en['dr.gdmNote'])).toBeOnTheScreen();
    female.unmount();
    for (const sex of ['male', 'preferNot', null] as const) {
      await saveRiskDraft({ ...EMPTY_RISK_DRAFT, sex });
      const other = renderRouter('./app', { initialUrl: '/diabetes-risk' });
      await screen.findByText(en['dr.family']);
      expect(screen.queryByText(en['dr.gdm'])).not.toBeOnTheScreen();
      other.unmount();
    }
  });

  it('marks the chosen answer and stores each tap at once', async () => {
    renderRouter('./app', { initialUrl: '/diabetes-risk' });
    const family = await screen.findByLabelText(en['dr.family']);
    fireEvent.press(within(family).getByRole('radio', { name: en['common.yes'] }));
    const active = screen.getByLabelText(en['dr.active']);
    fireEvent.press(within(active).getByRole('radio', { name: en['common.no'] }));
    expect(within(family).getByRole('radio', { name: en['common.yes'] })).toBeChecked();
    expect(within(family).getByRole('radio', { name: en['common.no'] })).not.toBeChecked();
    await waitFor(async () => {
      const stored = await loadRiskDraft();
      expect(stored.familyHistory).toBe(true);
      expect(stored.physicallyActive).toBe(false);
      expect(stored.hypertension).toBeNull();
    });
  });

  it('keeps the answers after Back and when the screen is opened again', async () => {
    renderRouter('./app', { initialUrl: '/profile' });
    fireEvent.changeText(await screen.findByLabelText(en['profile.age']), '40');
    fireEvent.press(screen.getByRole('button', { name: en['common.next'] }));
    const family = await screen.findByLabelText(en['dr.family']);
    fireEvent.press(within(family).getByRole('radio', { name: en['common.yes'] }));
    fireEvent.press(screen.getByRole('button', { name: en['common.back'] }));
    expect(await screen.findByLabelText(en['profile.age'])).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: en['common.next'] }));
    const again = await screen.findByLabelText(en['dr.family']);
    await waitFor(() => expect(within(again).getByRole('radio', { name: en['common.yes'] })).toBeChecked());
  });

  it('continues to the phone check', async () => {
    renderRouter('./app', { initialUrl: '/diabetes-risk' });
    await screen.findByText(en['dr.family']);
    fireEvent.press(screen.getByRole('button', { name: en['common.continue'] }));
    expect(await screen.findByRole('header', { name: en['phoneCheck.title'] })).toBeOnTheScreen();
  });

  it('says the answers could not be stored, and keeps the tap on the screen', async () => {
    renderRouter('./app', { initialUrl: '/diabetes-risk' });
    const family = await screen.findByLabelText(en['dr.family']);
    const database = await lumenDatabase();
    jest.spyOn(database, 'withTransactionAsync').mockRejectedValue(new Error('disk full'));
    fireEvent.press(within(family).getByRole('radio', { name: en['common.no'] }));
    await waitFor(() => expect(screen.getByText(en['profile.saveFailed'])).toBeOnTheScreen());
    expect(within(family).getByRole('radio', { name: en['common.no'] })).toBeChecked();
    jest.restoreAllMocks();
  });

  it('fits a 360 by 640 phone: the questions scroll and Back and Continue stay in reach', async () => {
    const originalWindow = Dimensions.get('window');
    act(() => Dimensions.set({ window: { width: 360, height: 640, scale: 2, fontScale: 1 } }));
    try {
      await saveRiskDraft({ ...EMPTY_RISK_DRAFT, sex: 'female' });
      renderRouter('./app', { initialUrl: '/diabetes-risk' });
      expect(await screen.findByLabelText(en['dr.gdm'])).toBeOnTheScreen();
      expect(screen.UNSAFE_getByType(ScrollView)).toBeTruthy();
      expect(screen.getByRole('button', { name: en['common.back'] })).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: en['common.continue'] })).toBeOnTheScreen();
    } finally {
      act(() => Dimensions.set({ window: originalWindow }));
    }
  });
});
