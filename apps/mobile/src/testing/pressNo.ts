import { act, fireEvent, screen } from 'expo-router/testing-library';

import en from '@/i18n/en.json';

// renderRouter runs on fake timers; SafetySheet closes a beat after No (CLOSE_SHIELD_MS).
export function pressNo() {
  fireEvent.press(screen.getByRole('button', { name: en['safety.no'] }));
  act(() => jest.advanceTimersByTime(500));
}
