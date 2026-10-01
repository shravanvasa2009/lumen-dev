import type { Sample } from '@lumen/core';

import { keepLiveWindow, readLiveHeartRate } from './liveHeartRate';

const FPS = 30;
const FRAME_NS = 1e9 / FPS;

// SYNTHETIC: a clean 1.2 Hz (72 bpm) sine in red at 30 fps, not a recording.
function pulse(seconds: number, startNs = 1e12): Sample[] {
  return Array.from({ length: Math.round(seconds * FPS) }, (_, i) => ({
    tNs: startNs + i * FRAME_NS,
    r: 0.6 + 0.01 * Math.sin(2 * Math.PI * 1.2 * (i / FPS)),
    g: 0.1,
    b: 0.1,
  }));
}

test('keeps only the last 10 s of samples (ADR 0027 window)', () => {
  const all = pulse(15);
  const kept = all.reduce<Sample[]>((window, sample) => keepLiveWindow(window, [sample]), []);
  const newest = all[all.length - 1]!.tNs;
  expect(kept[kept.length - 1]).toBe(all[all.length - 1]);
  expect(kept[0]!.tNs).toBeGreaterThanOrEqual(newest - 10e9);
  expect(kept[0]!.tNs - FRAME_NS).toBeLessThan(newest - 10e9);
});

// Appendix A does not promise that tNs increases; samples from before a clock step belong to another timeline.
test('drops every sample before the last backward clock step', () => {
  const afterLastStep = pulse(1, 1e12 - 40e9);
  const kept = keepLiveWindow(pulse(8), [...pulse(1, 1e12 - 20e9), ...afterLastStep]);
  expect(kept).toEqual(afterLastStep);
});

test('drops the samples before a backward step even when the step is shorter than the window', () => {
  const afterStep = pulse(1, 1e12 + 7.5e9);
  expect(keepLiveWindow(pulse(8), afterStep)).toEqual(afterStep);
});

test('reads the bpm and SNR of a clean pulse', () => {
  const reading = readLiveHeartRate(pulse(12));
  expect(reading.kind).toBe('bpm');
  if (reading.kind !== 'bpm') return;
  expect(reading.bpm).toBeCloseTo(72, 0);
  expect(reading.snrDb).toBeGreaterThan(6);
});

test('reads nothing when the window is shorter than core needs', () => {
  expect(readLiveHeartRate(pulse(3))).toEqual({ kind: 'none' });
});

test('turns the RangeError for a repeated timestamp into an error reading', () => {
  const samples = pulse(12);
  samples[200] = { ...samples[200]!, tNs: samples[199]!.tNs };
  const reading = readLiveHeartRate(samples);
  expect(reading.kind).toBe('error');
  if (reading.kind === 'error') expect(reading.reason).not.toBe('');
});

test('reads nothing for a flat red trace, such as a clipped finger (core since #40)', () => {
  expect(readLiveHeartRate(pulse(12).map((sample) => ({ ...sample, r: 1 })))).toEqual({ kind: 'none' });
});
