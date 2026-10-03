import type { Capabilities, LabDiagnostics, SampleBatch } from '../../modules/lumen-capture/src';

import { captureRequestBody } from './captureRequest';

// SYNTHETIC values: they test field mapping only and are not a recording.
const capabilities: Capabilities = {
  platform: 'ios',
  modelId: 'iPhone17,3',
  osVersion: '26.0',
  rearLenses: [{ id: 'wide', kind: 'wide', maxFps: 60, torchUsable: true }],
  torch: { available: true, levels: true },
  locks: { exposure: true, whiteBalance: true, focus: true },
};
const batches: SampleBatch[] = [
  {
    samples: [
      { tNs: 1000, r: 0.61, g: 0.11, b: 0.05 },
      { tNs: 2000, r: 0.62, g: 0.12, b: 0.06 },
    ],
    stats: [{ tNs: 1000, spatialStdR: 0.02, clipFrac: 0, exposureNs: 8e6 }],
  },
  {
    samples: [{ tNs: 3000, r: 0.63, g: 0.13, b: 0.07 }],
    stats: [
      { tNs: 2000, spatialStdR: 0.03, clipFrac: 0.01, exposureNs: 8e6 },
      { tNs: 3000, spatialStdR: 0.04, clipFrac: 0.02, exposureNs: 9e6 },
    ],
  },
];
const summary = { startedNs: 1000, stoppedNs: 3000, lensId: 'wide', frames: 3, dropped: 0 };
const lab: LabDiagnostics = {
  lensId: 'wide',
  formatWidth: 1920,
  formatHeight: 1080,
  targetFps: 60,
  frameWorkMsMean: 1.2,
  frameWorkMsMax: 3.4,
  iso: 100,
  exposureNs: 8e6,
  torchOn: true,
  torchLevel: 1,
  locked: { exposure: true, whiteBalance: true, focus: true },
};

test('builds the Appendix B receiver request: meta plus column arrays in frame order', () => {
  expect(captureRequestBody(batches, { appVersion: '0.1.0', capabilities, summary, lab })).toStrictEqual({
    meta: {
      app: '0.1.0',
      platform: 'ios',
      modelId: 'iPhone17,3',
      os: '26.0',
      mode: 'full',
      lensId: 'wide',
      fps: 60,
      torchLevel: 1,
    },
    samples: { tNs: [1000, 2000, 3000], r: [0.61, 0.62, 0.63], g: [0.11, 0.12, 0.13], b: [0.05, 0.06, 0.07] },
    stats: {
      tNs: [1000, 2000, 3000],
      spatialStdR: [0.02, 0.03, 0.04],
      clipFrac: [0, 0.01, 0.02],
      exposureNs: [8e6, 8e6, 9e6],
    },
  });
});

test('leaves out what it does not know instead of inventing it', () => {
  const body = captureRequestBody(batches, { capabilities, summary: { ...summary, lensId: undefined } });
  expect(Object.keys(body)).toEqual(['meta', 'samples', 'stats']);
  expect(body.meta).toStrictEqual({ platform: 'ios', modelId: 'iPhone17,3', os: '26.0', mode: 'full' });
});

test('reports torchLevel 0 when the native module says the torch is off', () => {
  const body = captureRequestBody(batches, { capabilities, summary, lab: { ...lab, torchOn: false } });
  expect(body.meta.torchLevel).toBe(0);
});

test('passes strap RR through as polarRr when a strap was recorded', () => {
  const polarRr = { tNs: [1500, 2300], rrMs: [800, 812.5] };
  const body = captureRequestBody(batches, { capabilities, summary, polarRr });
  expect(body.polarRr).toStrictEqual(polarRr);
});

test('writes recordedAt as local time with its UTC offset, naming the same instant', () => {
  // Whole seconds: the field has no fraction.
  const when = new Date(Date.UTC(2026, 9, 4, 12, 41, 58));
  const { recordedAt } = captureRequestBody(batches, { capabilities, summary, recordedAt: when }).meta;
  expect(recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  expect(new Date(recordedAt ?? '').getTime()).toBe(when.getTime());
});

test('sends the rest-timer answer and the paced breathing rate when Lab has them', () => {
  const { meta } = captureRequestBody(batches, { capabilities, summary, restTimerDone: true, pacedBrpm: 6 });
  expect(meta.restTimerDone).toBe(true);
  expect(meta.labels).toStrictEqual({ pacedBrpm: 6 });
  const unrested = captureRequestBody(batches, { capabilities, summary, restTimerDone: false }).meta;
  expect(unrested.restTimerDone).toBe(false);
  expect(unrested).not.toHaveProperty('labels');
});
