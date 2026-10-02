import { DSP_CONFIG } from './config';
import type { Tier } from './reading';

// Lumen Compatibility Rating, spec §5.1 and §5.2. Readings of the spec where it is silent: ADR 0058.

// The Appendix A `Capabilities` fields the rating reads (§5.1 calls the probe "DeviceProbe"). The app
// passes its `Capabilities` object as is; core cannot import the mobile module's type.
export interface RatingCapabilities {
  rearLenses: { id: string; maxFps: number; torchUsable: boolean }[];
  torch: { available: boolean };
  locks: { exposure: boolean; whiteBalance: boolean; focus: boolean };
}

export interface RatingMeasures {
  lensId: string | null; // §4.2 auto-selected lens; null on the phone check, before lens selection
  achievedFps: number | null; // frames per second actually delivered in practice
  frameIntervalSdMs: number | null; // SD of frame intervals in practice
  // Perfusion index (%) and spectral SNR (dB) of the practice pulse with the selected lens. 'no-pulse':
  // no pulse even in ambient mode after two tries. null: not measured yet.
  coupling: { perfusionIndexPct: number; snrDb: number } | 'no-pulse' | null;
}

export type RatingTier = Tier | 'unsupported';
export type HardFail = 'no-rear-camera' | 'below-24-fps' | 'no-pulse';
// One key per §5.2 table row; Basic's Full Scan omits HRV and pulse shape because those keys are absent.
export type RatingMode =
  | 'quickCheck'
  | 'rhythmFlags'
  | 'breathing'
  | 'standingTest'
  | 'extraBeats'
  | 'hrv'
  | 'deepHrv'
  | 'pulseShape'
  | 'diabetes'
  | 'fullScan';

export interface DeviceRating {
  components: { frameRate: number; coupling: number | null; locks: number; timing: number };
  score: number; // sum of the components; before practice, the phone check's capability points
  fpsLevel: number | null; // the §5.1 frame-rate level reached; null on a hard fail
  ambient: boolean;
  tier: RatingTier | null; // null until coupling is measured, unless a hard fail already decides it
  hardFail: HardFail | null;
  unlocks: readonly RatingMode[];
}

const UNLOCKS: Record<RatingTier, readonly RatingMode[]> = {
  full: [
    'quickCheck',
    'rhythmFlags',
    'breathing',
    'standingTest',
    'extraBeats',
    'hrv',
    'deepHrv',
    'pulseShape',
    'diabetes',
    'fullScan',
  ],
  basic: ['quickCheck', 'rhythmFlags', 'breathing', 'standingTest', 'extraBeats', 'fullScan'],
  // Quick Check at confidence ≤ moderate, so no rhythm flags.
  limited: ['quickCheck'],
  unsupported: [],
};

/** Modes a §5.2 tier unlocks. */
export function tierUnlocks(tier: RatingTier): readonly RatingMode[] {
  return UNLOCKS[tier];
}

function frameRateLevel(
  formatFps: number,
  achievedFps: number | null,
): { minFps: number; points: number } | null {
  const { fpsLevels, achievedFpsToleranceFps } = DSP_CONFIG.rating;
  const reached = fpsLevels.find(
    ({ minFps }) =>
      formatFps >= minFps && (achievedFps === null || achievedFps >= minFps - achievedFpsToleranceFps),
  );
  return reached ?? null;
}

function couplingPoints(perfusionIndexPct: number, snrDb: number): number {
  const config = DSP_CONFIG.rating;
  const piFactor = Math.min(1, Math.max(0, perfusionIndexPct / config.couplingFullPiPct));
  // Negative SNR (pulse below the noise) scores 0, not negative points (ADR 0058).
  const snrFactor = Math.min(1, Math.max(0, snrDb / config.couplingFullSnrDb));
  // Floored so whole-point components add up to the stored integer score and never round up a tier.
  return Math.floor(config.couplingPoints * piFactor * snrFactor);
}

function lockPoints(locks: RatingCapabilities['locks']): number {
  const config = DSP_CONFIG.rating;
  // Appendix A has no fixed-focus field, so a fixed-focus lens scores focus only if the module reports
  // locks.focus = true for it (ADR 0058).
  return (
    (locks.exposure ? config.exposureLockPoints : 0) +
    (locks.whiteBalance ? config.whiteBalanceLockPoints : 0) +
    (locks.focus ? config.focusLockPoints : 0)
  );
}

function timingPoints(frameIntervalSdMs: number | null): number {
  if (frameIntervalSdMs === null) return 0;
  const reached = DSP_CONFIG.rating.timingLevels.find(({ belowSdMs }) => frameIntervalSdMs < belowSdMs);
  return reached === undefined ? 0 : reached.points;
}

function tierFor(score: number, fpsLevel: number, ambient: boolean): RatingTier {
  const config = DSP_CONFIG.rating;
  // Score < 25 is Not supported even in ambient mode; ambient mode only caps the tier (ADR 0058).
  if (score < config.limitedMinScore) return 'unsupported';
  if (ambient) return 'limited';
  if (score >= config.fullMinScore && fpsLevel >= config.fullMinFps) return 'full';
  if (score >= config.basicMinScore && fpsLevel >= config.basicMinFps) return 'basic';
  return 'limited';
}

/** Lumen Compatibility Rating (§5.1 score, §5.2 tier and unlocked modes) from the probe and practice. */
export function rateDevice(capabilities: RatingCapabilities, measures: RatingMeasures): DeviceRating {
  const torchLenses = capabilities.rearLenses.filter((lens) => lens.torchUsable);
  let lens: RatingCapabilities['rearLenses'][number] | undefined;
  if (measures.lensId === null) {
    // Phone check: the fastest lens that lens selection could keep; a lens without the torch only if none has it.
    const candidates = torchLenses.length > 0 ? torchLenses : capabilities.rearLenses;
    lens = candidates.reduce<typeof lens>(
      (best, candidate) => (best === undefined || candidate.maxFps > best.maxFps ? candidate : best),
      undefined,
    );
  } else {
    lens = capabilities.rearLenses.find((candidate) => candidate.id === measures.lensId);
    if (lens === undefined) throw new Error(`rateDevice: lens ${measures.lensId} is not in the probe`);
  }

  const frameRate = lens === undefined ? null : frameRateLevel(lens.maxFps, measures.achievedFps);
  const fpsLevel = frameRate === null ? null : frameRate.minFps;
  const { ambientBelowCouplingPoints } = DSP_CONFIG.rating;
  const coupling =
    measures.coupling === null
      ? null
      : measures.coupling === 'no-pulse'
        ? 0
        : couplingPoints(measures.coupling.perfusionIndexPct, measures.coupling.snrDb);
  const components = {
    frameRate: frameRate === null ? 0 : frameRate.points,
    coupling,
    locks: lockPoints(capabilities.locks),
    timing: timingPoints(measures.frameIntervalSdMs),
  };
  const score = components.frameRate + (coupling ?? 0) + components.locks + components.timing;
  // §4.4: no torch on the lens means ambient-light mode, as does weak coupling.
  const ambient =
    !capabilities.torch.available ||
    lens === undefined ||
    !lens.torchUsable ||
    (coupling !== null && coupling < ambientBelowCouplingPoints);

  const hardFail: HardFail | null =
    lens === undefined
      ? 'no-rear-camera'
      : fpsLevel === null
        ? 'below-24-fps'
        : measures.coupling === 'no-pulse'
          ? 'no-pulse'
          : null;
  let tier: RatingTier | null = null;
  if (hardFail !== null) tier = 'unsupported';
  else if (coupling !== null && fpsLevel !== null) tier = tierFor(score, fpsLevel, ambient);

  return {
    components,
    score,
    fpsLevel,
    ambient,
    tier,
    hardFail,
    unlocks: tier === null ? [] : UNLOCKS[tier],
  };
}
