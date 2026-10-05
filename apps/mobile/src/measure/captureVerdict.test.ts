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
    expect(captureVerdict({ ...running, advancing: false, rejectedSpans: [open] }).coaching).toBe('coach.lighter');
  });

  it('ignores spans that ended earlier and causes with no coaching line', () => {
    const old = { startS: 1, endS: 5, reason: 'motion' as const };
    const exposure = { startS: 29, endS: 30, reason: 'exposure' as const };
    expect(captureVerdict({ ...running, advancing: false, rejectedSpans: [old, exposure] }).coaching).toBeNull();
  });

  it('has no level and no coaching before the capture runs', () => {
    expect(captureVerdict({ ...running, phase: 'starting' })).toEqual({ level: null, coaching: null });
  });
});
