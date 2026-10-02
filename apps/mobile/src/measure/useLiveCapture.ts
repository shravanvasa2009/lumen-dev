import type { CoachingKey } from '@lumen/core';
import { useEffect, useState } from 'react';

import {
  LumenCapture,
  type Capabilities,
  type CaptureConfig,
  type CaptureStatus,
  type LumenCaptureModule,
  type SampleBatch,
} from '../../modules/lumen-capture/src';

// The live waveform card shows the last 6 s (spec §12).
const WAVEFORM_WINDOW_NS = 6e9;

type LivePhase =
  // The capture module is not linked (Jest, Expo Go).
  'unavailable' | 'starting' | 'running' | 'denied' | 'failed';

export interface LiveCapture {
  phase: LivePhase;
  failure: string | null;
  status: CaptureStatus | null;
  // Raw red means of the last 6 s, as the module reports them; the screen only scales them to fit.
  recentRed: readonly number[];
  // Seconds on the frames' own clock since the first frame; not a timer.
  elapsedS: number;
  // Null until a LiveSession from @lumen/core feeds this hook (ADR 0042): they are never estimated here.
  cleanSeconds: number | null;
  coachingKey: CoachingKey | null;
}

const idle = (phase: LivePhase): LiveCapture => ({
  phase,
  failure: null,
  status: null,
  recentRed: [],
  elapsedS: 0,
  cleanSeconds: null,
  coachingKey: null,
});

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

// A wide lens that can light the torch, else any lens that can; no lens means the module's own default,
// and then no torch, because native rejects a torch level on a phone that has none (ADR 0029 addendum).
function captureConfig(capabilities: Capabilities): CaptureConfig {
  const lit = capabilities.rearLenses.filter((lens) => lens.torchUsable);
  const lens = lit.find((candidate) => candidate.kind === 'wide') ?? lit[0];
  return {
    ...(lens ? { lensId: lens.id } : {}),
    torchLevel: lens && capabilities.torch.available ? 1 : 0,
  };
}

// Runs the rear camera and torch for as long as the screen is mounted and reports what the module sends.
export function useLiveCapture(capture: LumenCaptureModule | null = LumenCapture): LiveCapture {
  const [live, setLive] = useState<LiveCapture>(idle(capture ? 'starting' : 'unavailable'));

  useEffect(() => {
    if (!capture) return;
    let mounted = true;
    let started = false;
    let subscriptions: { remove(): void }[] = [];
    let recent: { tNs: number; r: number }[] = [];
    let firstNs: number | null = null;

    const stopCamera = () => {
      subscriptions.forEach((subscription) => subscription.remove());
      subscriptions = [];
      if (started)
        capture.stop().catch((error: unknown) => console.warn(`Capture did not stop: ${reasonOf(error)}`));
      started = false;
    };

    const onSamples = (batch: SampleBatch) => {
      const newest = batch.samples[batch.samples.length - 1];
      if (!newest) return;
      firstNs ??= batch.samples[0]?.tNs ?? newest.tNs;
      recent = [...recent, ...batch.samples.map(({ tNs, r }) => ({ tNs, r }))].filter(
        (sample) => newest.tNs - sample.tNs <= WAVEFORM_WINDOW_NS,
      );
      const startNs = firstNs;
      setLive((previous) => ({
        ...previous,
        recentRed: recent.map((sample) => sample.r),
        elapsedS: (newest.tNs - startNs) / 1e9,
      }));
    };

    const begin = async () => {
      try {
        const permission = await capture.requestPermission();
        if (!mounted) return;
        if (!permission.granted) {
          setLive(idle('denied'));
          return;
        }
        const config = captureConfig(await capture.getCapabilities());
        if (!mounted) return;
        subscriptions = [
          capture.addListener('samples', onSamples),
          capture.addListener('status', (status) => setLive((previous) => ({ ...previous, status }))),
        ];
        await capture.start(config);
        started = true;
        // The screen closed while the camera was starting, so its cleanup had nothing to stop yet.
        if (!mounted) stopCamera();
        else setLive((previous) => ({ ...previous, phase: 'running' }));
      } catch (error) {
        subscriptions.forEach((subscription) => subscription.remove());
        subscriptions = [];
        if (mounted) setLive({ ...idle('failed'), failure: reasonOf(error) });
        else console.warn(`Capture failed after the screen closed: ${reasonOf(error)}`);
      }
    };
    begin();

    return () => {
      mounted = false;
      stopCamera();
    };
  }, [capture]);

  return live;
}
