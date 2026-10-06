import { act, fireEvent, screen } from 'expo-router/testing-library';

import en from '@/i18n/en.json';
import { CLOSE_SHIELD_MS } from '@/results/SafetySheet';

// renderRouter runs on fake timers. By default this waits out the whole close delay; pass a shorter time to
// look at the sheet while it is still closing.
export function pressNo(waitMs = CLOSE_SHIELD_MS) {
  fireEvent.press(screen.getByRole('button', { name: en['safety.no'] }));
  act(() => jest.advanceTimersByTime(waitMs));
}
