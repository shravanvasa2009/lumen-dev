import {
  createLiveSession,
  DSP_CONFIG,
  type CoachingKey,
  type FrameStat,
  type LiveSession,
  type NsSpan,
  type RejectedSpan,
  type RejectionReason,
  type Sample,
  type SqiWindow,
} from '@lumen/core';
import { useEffect, useState } from 'react';

import {
  LumenCapture,
  type Capabilities,
  type CaptureConfig,
  type CaptureStatus,
  type LensInfo,
  type LumenCaptureModule,
  type SampleBatch,
} from '../../modules/lumen-capture/src';
import { scoreSqiWindow, sqiThreshold } from '../ml/runtime';
import { keepCapture } from './keptCapture';

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
  // The live session's own values (ADR 0042), never estimated here; null while it is not running.
  cleanSeconds: number | null;
  coachingKey: CoachingKey | null;
  // The session's filtered pulse of the last 6 s, and the spans it greyed out, in seconds from the first frame.
  recentWaveform: { tS: number[]; ppg: number[] };
  rejectedSpans: RejectedSpan[];
}

const idle = (phase: LivePhase): LiveCapture => ({
  phase,
  failure: null,
  status: null,
  recentRed: [],
  elapsedS: 0,
  cleanSeconds: null,
  coachingKey: null,
  recentWaveform: { tS: [], ppg: [] },
  rejectedSpans: [],
});

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const spansOf = (spans: RejectedSpan[], reason: RejectionReason, startNs: number): NsSpan[] =>
  spans
    .filter((span) => span.reason === reason)
    .map((span) => ({
      startNs: startNs + Math.round(span.startS * 1e9),
      endNs: startNs + Math.round(span.endS * 1e9),
    }));

// A wide lens that can light the torch, else any lens that can; no lens means the module's own default,
// and then no torch, because native rejects a torch level on a phone that has none (ADR 0029 addendum).
function chosenLens(capabilities: Capabilities): LensInfo | undefined {
  const lit = capabilities.rearLenses.filter((lens) => lens.torchUsable);
  return lit.find((candidate) => candidate.kind === 'wide') ?? lit[0];
}

function captureConfig(capabilities: Capabilities, lens: LensInfo | undefined): CaptureConfig {
  return {
    ...(lens ? { lensId: lens.id } : {}),
    torchLevel: lens && capabilities.torch.available ? 1 : 0,
  };
}

// Runs the rear camera and torch for as long as the screen is mounted, feeds every batch and status to a
// LiveSession, and keeps the frames for the Processing screen.
export function useLiveCapture(capture: LumenCaptureModule | null = LumenCapture): LiveCapture {
  const [live, setLive] = useState<LiveCapture>(idle(capture ? 'starting' : 'unavailable'));

  useEffect(() => {
    if (!capture) return;
    let mounted = true;
    let started = false;
    let subscriptions: { remove(): void }[] = [];
    let recent: { tNs: number; r: number }[] = [];
    let firstNs: number | null = null;
    let session: LiveSession | null = null;
    let captureFps = 0;
    const samples: Sample[] = [];
    const stats: FrameStat[] = [];
    const sqiWindows: { endNs: number; pClean: number }[] = [];
    // The cut-off is null while no SQI model ships; then no window is scored and the session's threshold of 0
    // can reject nothing, so a missing model never invents a quality verdict.
    const threshold = sqiThreshold();
    let scoredEndS: number | null = null;
    let scoring = false;

    const stopCamera = () => {
      subscriptions.forEach((subscription) => subscription.remove());
      subscriptions = [];
      if (started)
        capture.stop().catch((error: unknown) => console.warn(`Capture did not stop: ${reasonOf(error)}`));
      started = false;
      session = null;
    };

    const scoreWindow = async (scored: LiveSession, window: SqiWindow, startNs: number) => {
      scoring = true;
      try {
        const score = await scoreSqiWindow(window.input);
        // A screen that closed, or a session that failed, while the model ran has no use for the score.
        if (score.source !== 'model' || scored !== session) return;
        scored.setSqi(window.endS, score.pClean);
        sqiWindows.push({ endNs: startNs + Math.round(window.endS * 1e9), pClean: score.pClean });
      } catch (error) {
        console.warn(`SQI scoring failed: ${reasonOf(error)}`);
      } finally {
        scoring = false;
      }
    };

    // A batch the session refuses (stats that do not match the samples, time going backwards) ends its
    // counting: the frames after it can no longer be trusted to line up, so nothing is estimated in its place.
    const feedSession = (batch: SampleBatch, startNs: number): string | null => {
      if (!session) return null;
      try {
        session.pushSamples(batch);
      } catch (error) {
        session = null;
        return reasonOf(error);
      }
      samples.push(...batch.samples);
      stats.push(...batch.stats);
      const window = session.sqiWindow;
      if (threshold !== null && window && !scoring && window.endS !== scoredEndS) {
        scoredEndS = window.endS;
        void scoreWindow(session, window, startNs);
      }
      return null;
    };

    const onSamples = (batch: SampleBatch) => {
      const newest = batch.samples[batch.samples.length - 1];
      if (!newest) return;
      firstNs ??= batch.samples[0]?.tNs ?? newest.tNs;
      const startNs = firstNs;
      recent = [...recent, ...batch.samples.map(({ tNs, r }) => ({ tNs, r }))].filter(
        (sample) => newest.tNs - sample.tNs <= WAVEFORM_WINDOW_NS,
      );
      const hadSession = session !== null;
      const refusal = feedSession(batch, startNs);
      if (session) {
        const rejectedSpans = session.rejectedSpans;
        keepCapture({
          captureFps,
          samples,
          stats,
          motionSpans: spansOf(rejectedSpans, 'motion', startNs),
          coldHandsSpans: spansOf(rejectedSpans, 'coldHands', startNs),
          sqi: sqiWindows.length > 0 && threshold !== null ? { threshold, windows: sqiWindows } : null,
        });
      }
      setLive((previous) => ({
        ...previous,
        recentRed: recent.map((sample) => sample.r),
        elapsedS: (newest.tNs - startNs) / 1e9,
        ...(session
          ? {
              cleanSeconds: session.cleanSeconds,
              coachingKey: session.coachingKey,
              recentWaveform: session.recentWaveform,
              rejectedSpans: session.rejectedSpans,
            }
          : hadSession
            ? { cleanSeconds: null, coachingKey: null, failure: refusal }
            : {}),
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
        const capabilities = await capture.getCapabilities();
        if (!mounted) return;
        const lens = chosenLens(capabilities);
        // The module's frame rate is not reported to JS; with no torch-capable lens there is no rate to give
        // the session, so that phone runs without clean seconds rather than with a guessed rate.
        if (lens) {
          captureFps = lens.maxFps;
          session = createLiveSession({
            captureFps,
            sqiThreshold: threshold ?? 0,
            perfusionFloorPct: DSP_CONFIG.live.defaultPerfusionFloorPct,
          });
        }
        keepCapture(null);
        subscriptions = [
          capture.addListener('samples', onSamples),
          capture.addListener('status', (status) => {
            session?.pushStatus(status);
            setLive((previous) => ({ ...previous, status }));
          }),
        ];
        await capture.start(captureConfig(capabilities, lens));
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
