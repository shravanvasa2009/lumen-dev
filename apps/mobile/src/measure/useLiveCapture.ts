import {
  createLiveSession,
  DSP_CONFIG,
  type CoachingKey,
  type LiveSession,
  type RejectedSpan,
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
import { keepCapture, keepLiveCapture, liveCaptureChanged } from './keptCapture';

// The live waveform card shows the last 6 s (spec §12).
const WAVEFORM_WINDOW_NS = 6e9;
// Spec §9.2 (Locks) and §4.2 step 3: with the finger on the phone, auto-exposure settles for 1 s, then
// exposure, white balance and focus are locked. Native adds its own short wait before steering (DSP-5).
const EXPOSURE_SETTLE_MS = 1000;

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

// A wide lens that can light the torch, else any lens that can; no lens means the module's own default,
// and then no torch, because native rejects a torch level on a phone that has none (ADR 0029 addendum).
function chosenLens(capabilities: Capabilities): LensInfo | undefined {
  const lit = capabilities.rearLenses.filter((lens) => lens.torchUsable);
  return lit.find((candidate) => candidate.kind === 'wide') ?? lit[0];
}

// Spec 09-architecture §9.2 (frame rate): iOS up to 120 fps where formats allow (native caps iOS at 120 too);
// Android requests 60. This is only the request; the session uses the rate start() reports (ADR 0067).
const CAPTURE_FPS_CEILING: Record<Capabilities['platform'], number> = { ios: 120, android: 60 };

const captureFpsFor = (platform: Capabilities['platform'], lens: LensInfo): number =>
  Math.min(lens.maxFps, CAPTURE_FPS_CEILING[platform]);

function captureConfig(capabilities: Capabilities, lens: LensInfo | undefined, fps: number): CaptureConfig {
  return {
    ...(lens ? { lensId: lens.id, targetFps: fps } : {}),
    torchLevel: lens && capabilities.torch.available ? 1 : 0,
  };
}

// Runs the rear camera and torch for as long as the screen is mounted, feeds every batch and status to a
// LiveSession, and keeps the frames for the Processing screen. `demo` marks them as Demo mode's synthetic
// recording.
export function useLiveCapture(
  capture: LumenCaptureModule | null = LumenCapture,
  { demo = false }: { demo?: boolean } = {},
): LiveCapture {
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
    let lensId: string | null = null;
    let keptFrames = false;
    // The cut-off is null while no SQI model ships; then no window is scored and the session's threshold of 0
    // can reject nothing, so a missing model never invents a quality verdict.
    const threshold = sqiThreshold();
    let scoredEndS: number | null = null;
    let scoring = false;
    // Only a torch capture is locked; ambient mode (spec §4.4) has its own exposure plan.
    let lockWanted = false;
    let lockTimer: ReturnType<typeof setTimeout> | null = null;

    const cancelLock = () => {
      if (lockTimer) clearTimeout(lockTimer);
      lockTimer = null;
    };

    // Every exposure change greys out the next second (DSP-5), so a capture left on auto-exposure may never
    // count clean seconds. The lock is asked for once; a finger lifted during the settle restarts it.
    const lockAfterSettle = (status: CaptureStatus) => {
      if (!started || !lockWanted) return;
      if (!status.fingerCovered) {
        cancelLock();
        return;
      }
      lockTimer ??= setTimeout(() => {
        lockTimer = null;
        lockWanted = false;
        capture
          .lockExposure()
          .catch((error: unknown) => console.warn(`Exposure did not lock: ${reasonOf(error)}`));
      }, EXPOSURE_SETTLE_MS);
    };

    const stopCamera = () => {
      cancelLock();
      lockWanted = false;
      subscriptions.forEach((subscription) => subscription.remove());
      subscriptions = [];
      if (started)
        capture.stop().catch((error: unknown) => console.warn(`Capture did not stop: ${reasonOf(error)}`));
      started = false;
      session = null;
    };

    const scoreWindow = async (scored: LiveSession, window: SqiWindow) => {
      scoring = true;
      try {
        const score = await scoreSqiWindow(window.input);
        // A screen that closed, or a session that failed, while the model ran has no use for the score.
        if (score.source !== 'model' || scored !== session) return;
        scored.setSqi(window.endS, score.pClean);
        liveCaptureChanged();
      } catch (error) {
        console.warn(`SQI scoring failed: ${reasonOf(error)}`);
      } finally {
        scoring = false;
      }
    };

    // A batch the session refuses (stats that do not match the samples, time going backwards) ends its
    // counting: the frames after it can no longer be trusted to line up, so nothing is estimated in its place.
    const feedSession = (batch: SampleBatch): string | null => {
      if (!session) return null;
      try {
        session.pushSamples(batch);
      } catch (error) {
        session = null;
        return reasonOf(error);
      }
      // Nothing is kept for Processing until the first frames have reached the session.
      if (keptFrames) liveCaptureChanged();
      else {
        const fed = session;
        keepLiveCapture({
          captureFps,
          lensId,
          readingInput: () => fed.readingInput(),
          ...(demo ? { demo: true as const } : {}),
        });
        keptFrames = true;
      }
      const window = session.sqiWindow;
      if (threshold !== null && window && !scoring && window.endS !== scoredEndS) {
        scoredEndS = window.endS;
        void scoreWindow(session, window);
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
      const refusal = feedSession(batch);
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
        const requestedFps = lens ? captureFpsFor(capabilities.platform, lens) : 0;
        keepCapture(null);
        subscriptions = [
          capture.addListener('samples', onSamples),
          capture.addListener('status', (status) => {
            session?.pushStatus(status);
            lockAfterSettle(status);
            if (keptFrames) liveCaptureChanged();
            setLive((previous) => ({ ...previous, status }));
          }),
        ];
        const { activeFps } = await capture.start(captureConfig(capabilities, lens, requestedFps));
        started = true;
        // The screen closed while the camera was starting, so its cleanup had nothing to stop yet.
        if (!mounted) {
          stopCamera();
          return;
        }
        // The live filter is designed for the rate the camera runs at, which can be below the request (ADR
        // 0067), so the session starts only now. Batches before this are not fed to it; on Android they can
        // arrive before the torch is on. With no torch-capable lens the module runs its own default lens dark and no
        // session is started, as before ADR 0067.
        if (lens) {
          captureFps = activeFps;
          lensId = lens.id;
          lockWanted = true;
          session = createLiveSession({
            captureFps,
            sqiThreshold: threshold ?? 0,
            perfusionFloorPct: DSP_CONFIG.live.defaultPerfusionFloorPct,
          });
        }
        setLive((previous) => ({ ...previous, phase: 'running' }));
      } catch (error) {
        // A session the reported rate cannot support fails after the camera started, so it is stopped too.
        stopCamera();
        if (mounted) setLive({ ...idle('failed'), failure: reasonOf(error) });
        else console.warn(`Capture failed after the screen closed: ${reasonOf(error)}`);
      }
    };
    begin();

    return () => {
      mounted = false;
      stopCamera();
    };
  }, [capture, demo]);

  return live;
}
