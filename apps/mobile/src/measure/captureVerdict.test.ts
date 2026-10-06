import type { LiveCapture } from './useLiveCapture';
import { captureVerdict } from './captureVerdict';

const running: LiveCapture = {
  phase: 'running',
  failure: null,
  status: null,
  recentRed: [],
  recentPulse: [],
  elapsedS: 30,
  cleanSeconds: 5,
  coachingKey: null,
  recentWaveform: { tS: [], ppg: [] },
  rejectedSpans: [],
  signalLevel: 0.9,
  nativeCamera: false,
  advancing: true,
  adjustingExposure: false,
};

describe('captureVerdict', () => {
  it('passes the level and the coaching line through while the seconds count', () => {
    expect(captureVerdict({ ...running, coachingKey: 'coach.still' })).toEqual({
      level: 0.9,
      coaching: 'coach.still',
    });
  });

  it('caps the level at OK when the count has stopped', () => {
    expect(captureVerdict({ ...running, advancing: false }).level).toBe(0.5);
    expect(captureVerdict({ ...running, advancing: false, signalLevel: 0.2 }).level).toBe(0.2);
  });

  it('names the rejection open now when the session shows no coaching line yet', () => {
    const open = { startS: 25, endS: 30, reason: 'clipping' as const };
    expect(captureVerdict({ ...running, advancing: false, rejectedSpans: [open] }).coaching).toBe(
      'coach.lighter',
    );
  });

  // Owner 2026-10-06: "either tell the user they arent clean seconds or let the recording progress".
  it('never leaves a stopped count silent: an old span and no coaching line say "not clean yet"', () => {
    const old = { startS: 1, endS: 5, reason: 'motion' as const };
    expect(captureVerdict({ ...running, advancing: false, rejectedSpans: [old] }).coaching).toBe(
      'coach.notClean',
    );
    expect(captureVerdict({ ...running, advancing: false }).coaching).toBe('coach.notClean');
  });

  it('says the camera is adjusting brightness while the exposure lock steers, and for its grey seconds', () => {
    expect(captureVerdict({ ...running, advancing: false, adjustingExposure: true }).coaching).toBe(
      'coach.brightness',
    );
    const exposure = { startS: 29, endS: 30, reason: 'exposure' as const };
    expect(captureVerdict({ ...running, advancing: false, rejectedSpans: [exposure] }).coaching).toBe(
      'coach.brightness',
    );
    // A named cause wins over the steering.
    const motion = { startS: 28, endS: 30, reason: 'motion' as const };
    const both = { ...running, advancing: false, adjustingExposure: true, rejectedSpans: [motion] };
    expect(captureVerdict(both).coaching).toBe('coach.still');
  });

  it('shows no line while the count advances, even while the lock steers', () => {
    expect(captureVerdict({ ...running, adjustingExposure: true }).coaching).toBeNull();
  });

  it('has no level and no coaching before the capture runs', () => {
    expect(captureVerdict({ ...running, phase: 'starting' })).toEqual({ level: null, coaching: null });
  });
});
