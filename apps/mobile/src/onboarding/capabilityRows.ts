import type { TFunction } from 'i18next';

import type { PhoneProbe } from './usePhoneProbe';

// Spec §5.2: a rear camera that cannot reach 24 fps is a hard fail.
const MIN_FPS = 24;

export type RowStatus = 'pass' | 'fail' | 'pending' | 'checking';
export type CapabilityRow = { title: string; value: string; status: RowStatus };

// Frame timing is measured during practice (spec §5.1), so the probe alone never settles it.
export function capabilityRows(probe: PhoneProbe, t: TFunction): CapabilityRow[] {
  const unchecked = (title: string): CapabilityRow =>
    probe.kind === 'checking'
      ? { title, value: t('phoneCheck.checking'), status: 'checking' }
      : { title, value: t('phoneCheck.notChecked'), status: 'pending' };
  if (probe.kind !== 'ready')
    return [
      unchecked(t('phoneCheck.cameraSpeed')),
      unchecked(t('phoneCheck.flashlight')),
      unchecked(t('phoneCheck.exposureLock')),
      unchecked(t('phoneCheck.frameTiming')),
      unchecked(t('phoneCheck.lenses')),
    ];
  const { rearLenses, torch, locks } = probe.capabilities;
  const fps = Math.max(0, ...rearLenses.map((lens) => lens.maxFps));
  const locked = [locks.exposure, locks.whiteBalance, locks.focus].filter(Boolean).length;
  const torchValue = torch.levels
    ? t('phoneCheck.torchAdjustable')
    : torch.available
      ? t('phoneCheck.torchOnOff')
      : t('phoneCheck.torchNone');
  const lockValue =
    locked === 3
      ? t('phoneCheck.locksAll')
      : locked === 0
        ? t('phoneCheck.locksNone')
        : t('phoneCheck.locksSome', { locked });
  return [
    {
      title: t('phoneCheck.cameraSpeed'),
      value: t('phoneCheck.fps', { fps }),
      status: fps >= MIN_FPS ? 'pass' : 'fail',
    },
    { title: t('phoneCheck.flashlight'), value: torchValue, status: torch.available ? 'pass' : 'fail' },
    { title: t('phoneCheck.exposureLock'), value: lockValue, status: locked === 3 ? 'pass' : 'fail' },
    { title: t('phoneCheck.frameTiming'), value: t('phoneCheck.timingLater'), status: 'pending' },
    {
      title: t('phoneCheck.lenses'),
      value: String(rearLenses.length),
      status: rearLenses.length > 0 ? 'pass' : 'fail',
    },
  ];
}
