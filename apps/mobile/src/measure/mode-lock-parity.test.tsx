import { type RatingTier, tierUnlocks } from '@lumen/core';
import { act, renderRouter, screen } from 'expo-router/testing-library';
import type { TFunction } from 'i18next';

import { type CheckId, checkCell, type PlanMode, planPhone } from '@/checks/checkPlan';
import { lockText } from '@/checks/lockText';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import { lockReason } from '@/rating/modeLock';
import type { StoredRating } from '@/store/deviceRating';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'light',
}));

let mockRating: StoredRating | null = null;
jest.mock('@/store/useStoredRating', () => ({ useStoredRating: () => mockRating }));

preloadAppRoutes();

const strings = (words: Record<string, string>) => ((key: string) => words[key]) as unknown as TFunction;

// The picker's mode lock and the checks table decide a lock in two functions; each mode below has the one check
// whose lock is the mode's own, so the two must give the same reason (or none) for every phone.
const MODE_CHECK: readonly [PlanMode, CheckId][] = [
  ['full', 'afib'],
  ['deep', 'hrv'],
  ['standing', 'pots'],
];
const PICKER_NAME: Record<PlanMode, string> = {
  quick: en['mode.quick'],
  full: en['mode.full'],
  deep: en['mode.deep'],
  standing: en['mode.standing'],
};

const TIERS: readonly RatingTier[] = ['full', 'basic', 'limited', 'unsupported'];
const profiles = TIERS.flatMap((tier) =>
  [false, true].flatMap((ambient) =>
    [30, 60].map((fpsLevel) => ({ tier, ambient, fpsLevel, label: `${tier} ambient=${ambient} ${fpsLevel} fps` })),
  ),
);

const ratingOf = (tier: RatingTier, ambient: boolean, fpsLevel: number) =>
  ({ tier, ambient, fpsLevel, unlocks: tierUnlocks(tier), score: 70 }) as unknown as StoredRating;

describe('the mode picker and the checks table give the same lock reason', () => {
  it.each(profiles)('$label', async ({ tier, ambient, fpsLevel }) => {
    mockRating = ratingOf(tier, ambient, fpsLevel);
    renderRouter('./app', { initialUrl: '/measure/mode' });
    await act(async () => undefined);
    const lockTexts = new Set(
      Object.entries(en)
        .filter(([key]) => key.startsWith('mode.locked'))
        .map(([, text]) => text),
    );

    for (const mode of ['quick', 'full', 'deep', 'standing'] as const) {
      const reason = lockReason(mockRating, mode);
      const hint = screen.getByRole('button', { name: PICKER_NAME[mode] }).props.accessibilityHint as string | undefined;
      if (reason === null) expect(lockTexts.has(hint ?? '')).toBe(false);
      else expect(hint).toBe(lockText(strings(en), reason));
    }

    for (const [mode, check] of MODE_CHECK) {
      const cell = checkCell(mode, check, planPhone(mockRating));
      expect(cell.state === 'locked' ? cell.why : null).toBe(lockReason(mockRating, mode));
    }
  });

  it('gives the Spanish text for a flash-less phone at 30 fps in both', () => {
    const cell = checkCell('deep', 'hrv', planPhone(ratingOf('limited', true, 30)));
    expect(cell).toEqual({ state: 'locked', why: 'flash' });
    expect(lockText(strings(es), 'flash')).toBe(es['mode.lockedFlash']);
  });
});
