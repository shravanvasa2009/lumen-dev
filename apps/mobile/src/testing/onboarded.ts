import { emptyMockDatabases } from '../../__mocks__/expo-sqlite';
import { finishOnboarding } from '@/profile/onboarding';

// A returning user's profile: Home is the first screen on launch instead of Welcome.
export async function startOnboarded(): Promise<void> {
  emptyMockDatabases();
  await finishOnboarding();
}
