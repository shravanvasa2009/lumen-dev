import { renderRouter, screen } from 'expo-router/testing-library';

import en from '@/i18n/en.json';
import type { StoredReading } from '@/home/readings';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

import { readingById } from './fixtures';
import { markSymptomsAsked } from './symptomsAsked';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'dark',
}));
jest.mock('@/profile/riskScore', () => ({ useStoredRiskScore: () => null }));

let mockStored: StoredReading | null | undefined;
jest.mock('@/store/useStoredReadings', () => ({
  ...jest.requireActual('@/store/useStoredReadings'),
  useStoredReading: () => mockStored,
}));

const STORED_ID = 'stored-slow-rate';

preloadAppRoutes();

describe('the asked mark does not outlive its Results visit (SAFE-1)', () => {
  it('asks again when the reading is reopened after the first visit ended while it loaded', () => {
    markSymptomsAsked(STORED_ID);
    mockStored = undefined;
    const loading = renderRouter('./app', { initialUrl: `/results/${STORED_ID}` });
    expect(screen.queryByText(en['safety.question'])).toBeNull();
    loading.unmount();

    mockStored = {
      id: STORED_ID,
      takenAt: Date.now(),
      outcome: readingById('demo-hr-flag')!.scan,
    };
    renderRouter('./app', { initialUrl: `/results/${STORED_ID}` });
    expect(screen.getByText(en['safety.question'])).toBeOnTheScreen();
  });
});
