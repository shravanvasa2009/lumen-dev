import {
  createLiveSession,
  displayPulse,
  DSP_CONFIG,
  estimateLiveHeartRate,
  frameProblem,
  type CoachingKey,
  type LiveSession,
  type RejectedSpan,
  type Sample,
  type SqiWindow,
} from '@lumen/core';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

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
import { signalLevel } from './signalLevel';
import { WAVEFORM_WINDOW_NS } from './waveformWindow';

// The signal meter is re-read once per second of frames; its spectrum needs the last liveHr.windowS seconds.
const LEVEL_EVERY_NS = 1e9;
// Clean seconds are summed from accepted frames, so between two rises there can be a short gap; two seconds
// of frame time without a rise means the counter has stopped.
const ADVANCE_HOLD_NS = 2e9;
const LEVEL_WINDOW_NS = DSP_CONFIG.liveHr.windowS * 1e9;
// Spec §9.2 (Locks) and §4.2 step 3: with the finger on the phone, auto-exposure settles for 1 s, then
// exposure, white balance and focus are locked. Native adds its own short wait before steering (DSP-5).
const EXPOSURE_SETTLE_MS = 1000;
// A capture takes minutes with no touch, so the screen must not time out and stop the camera mid-reading.
const KEEP_AWAKE_TAG = 'lumen-capture';

type LivePhase =
  // 'unavailable': the capture module is not linked (Jest, Expo Go). 'stopped': `enabled` went false.
  'unavailable' | 'starting' | 'running' | 'denied' | 'failed' | 'stopped';

export interface LiveCapture {
  phase: LivePhase;
  failure: string | null;
  status: CaptureStatus | null;
  // Raw red means of the last 6 s, as the module reports them; the screen only scales them to fit.
  recentRed: readonly number[];
  // The same 6 s of the session's pulse drawn with one smooth bump per beat (display only); empty without a
  // session.
  recentPulse: readonly number[];
  // Seconds on the frames' own clock since the first frame; not a timer.
  elapsedS: number;
  // The live session's own values (ADR 0042), never estimated here; null while it is not running.
  cleanSeconds: number | null;
  coachingKey: CoachingKey | null;
  // The session's filtered pulse of the last 6 s, and the spans it greyed out, in seconds from the first frame.
  recentWaveform: { tS: number[]; ppg: number[] };
  rejectedSpans: RejectedSpan[];
  // Where the Weak to Strong meter sits, 0 to 1, from the live perfusion index and pulse SNR (spec 04 section 4.2);
  // null until the session has a pulse window.
  signalLevel: number | null;
  // True when frames come from the device's own LumenCapture module, so the native preview view has a session
  // to show. Replay and Demo feed recorded samples and have none.
  nativeCamera: boolean;
  // True while clean seconds are actually going up (they rose within the last ADVANCE_HOLD_NS of frame time).
  // The live level and the coaching line can look fine while every frame is rejected (clipped red, a
  // settling exposure), so "good" on screen must follow this, not the level.
  advancing: boolean;
  // From the finger covering the lens until lockExposure settles: the camera is steering its brightness
  // (1–3 compensation steps on a Galaxy A17, each greying about 1 s under DSP-5).
  adjustingExposure: boolean;
}

type LiveState = Omit<LiveCapture, 'nativeCamera'>;

const idle = (phase: LivePhase): LiveState => ({
  phase,
  failure: null,
  status: null,
  recentRed: [],
  recentPulse: [],
  elapsedS: 0,
  cleanSeconds: null,
  coachingKey: null,
  recentWaveform: { tS: [], ppg: [] },
  rejectedSpans: [],
  signalLevel: null,
  advancing: false,
  adjustingExposure: false,
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
// recording. With `enabled` false the camera is off; a stack screen stays mounted under the next one, so the
// practice step turns it off when it loses focus.
export function useLiveCapture(
  capture: LumenCaptureModule | null = LumenCapture,
  { demo = false, enabled = true }: { demo?: boolean; enabled?: boolean } = {},
): LiveCapture {
  const [live, setLive] = useState<LiveState>(idle(capture ? 'starting' : 'unavailable'));
  // Raised when the user comes back from Settings with the camera allowed, to start the capture again.
  const [permissionGrants, setPermissionGrants] = useState(0);

  // After a denial the system may not ask again (Android 11+ asks once more), so the user can turn the camera
  // on in Settings. getPermission does not prompt, which keeps the dialog from raising another foreground event.
  useEffect(() => {
    if (!capture || live.phase !== 'denied') return;
    let mounted = true;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      capture
        .getPermission()
        .then((permission) => {
          if (!mounted || !permission.granted) return;
          setLive(idle('starting'));
          setPermissionGrants((count) => count + 1);
        })
        .catch((error: unknown) => console.warn(`Camera permission check failed: ${reasonOf(error)}`));
    });
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, [capture, live.phase]);

  useEffect(() => {
    if (!capture) return;
    if (!enabled) {
      // The camera and torch are off, so nothing live may still be claimed; the counted clean seconds stay.
      setLive((previous) =>
        previous.phase === 'running' || previous.phase === 'starting'
          ? { ...idle('stopped'), cleanSeconds: previous.cleanSeconds }
          : previous,
      );
      return;
    }
    // Coming back to the screen starts a new capture; the old numbers must not show while it warms up.
    setLive((previous) => (previous.phase === 'starting' ? previous : idle('starting')));
    let mounted = true;
    let started = false;
    let subscriptions: { remove(): void }[] = [];
    let recent: { tNs: number; r: number }[] = [];
    let levelFrames: Sample[] = [];
    // When the current unbroken run of covered frames began; the filter's step when a finger goes on is not a pulse.
    let coveredSinceNs: number | null = null;
    let levelAtNs = -Infinity;
    let lastCleanS = 0;
    let lastRiseNs: number | null = null;
    let level: number | null = null;
    // The live rate the display pulse is smoothed around; null until the spectrum finds one.
    let pulseRateBpm: number | null = null;
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
    // Only a torch capture is locked here. A dark capture is not: spec §4.4 asks ambient mode for a different
    // plan (unlocked for 2 s, then locked at a brighter target), which this path does not implement yet.
    let lockWanted = false;
    let lockTimer: ReturnType<typeof setTimeout> | null = null;
    let adjusting = false;
    const setAdjusting = (now: boolean) => {
      if (adjusting === now) return;
      adjusting = now;
      setLive((previous) => ({ ...previous, adjustingExposure: now }));
    };

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
        setAdjusting(false);
        return;
      }
      setAdjusting(true);
      lockTimer ??= setTimeout(() => {
        lockTimer = null;
        lockWanted = false;
        capture
          .lockExposure()
          .catch((error: unknown) => console.warn(`Exposure did not lock: ${reasonOf(error)}`))
          .finally(() => {
            if (started) setAdjusting(false);
          });
      }, EXPOSURE_SETTLE_MS);
    };

    const stopCamera = () => {
      cancelLock();
      lockWanted = false;
      adjusting = false;
      subscriptions.forEach((subscription) => subscription.remove());
      subscriptions = [];
      if (started) {
        capture.stop().catch((error: unknown) => console.warn(`Capture did not stop: ${reasonOf(error)}`));
        deactivateKeepAwake(KEEP_AWAKE_TAG).catch((error: unknown) =>
          console.warn(`Screen sleep was not restored: ${reasonOf(error)}`),
        );
      }
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
        level = null;
        pulseRateBpm = null;
        levelAtNs = -Infinity;
        lastRiseNs = null;
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

    // Batches from before start() resolves are not shown either: on Android they can be dark frames from before
    // the torch was on, and the elapsed time counts from the first frame shown.
    const onSamples = (batch: SampleBatch) => {
      const newest = batch.samples[batch.samples.length - 1];
      if (!started || !newest) return;
      firstNs ??= batch.samples[0]?.tNs ?? newest.tNs;
      const startNs = firstNs;
      recent = [...recent, ...batch.samples.map(({ tNs, r }) => ({ tNs, r }))].filter(
        (sample) => newest.tNs - sample.tNs <= WAVEFORM_WINDOW_NS,
      );
      batch.samples.forEach((sample, index) => {
        const stat = batch.stats[index];
        const covered = stat === undefined || frameProblem(sample, stat) !== 'coverage';
        coveredSinceNs = covered ? (coveredSinceNs ?? sample.tNs) : null;
      });
      levelFrames = [...levelFrames, ...batch.samples].filter(
        (sample) =>
          newest.tNs - sample.tNs <= LEVEL_WINDOW_NS &&
          coveredSinceNs !== null &&
          sample.tNs >= coveredSinceNs,
      );
      const hadSession = session !== null;
      const refusal = feedSession(batch);
      if (session && newest.tNs - levelAtNs >= LEVEL_EVERY_NS) {
        levelAtNs = newest.tNs;
        // Core's perfusionPct counts covered frames only, but the band filter still rings for about one window
        // after a finger goes on, and that ringing reads as a strong pulse; so the level waits for a second window.
        const settled =
          coveredSinceNs !== null &&
          newest.tNs - coveredSinceNs >= 2 * DSP_CONFIG.live.perfusionWindowS * 1e9;
        level = settled ? signalLevel(session.perfusionPct, levelFrames) : null;
        pulseRateBpm = estimateLiveHeartRate(levelFrames)?.bpm ?? null;
      }
      if (session && session.cleanSeconds > lastCleanS) lastRiseNs = newest.tNs;
      lastCleanS = session?.cleanSeconds ?? 0;
      const advancing = lastRiseNs !== null && newest.tNs - lastRiseNs <= ADVANCE_HOLD_NS;
      const waveform = session?.recentWaveform ?? null;
      setLive((previous) => ({
        ...previous,
        advancing: session !== null && advancing,
        recentRed: recent.map((sample) => sample.r),
        elapsedS: (newest.tNs - startNs) / 1e9,
        ...(session && waveform
          ? {
              cleanSeconds: session.cleanSeconds,
              coachingKey: session.coachingKey,
              recentWaveform: waveform,
              recentPulse: displayPulse(waveform.tS, waveform.ppg, pulseRateBpm),
              rejectedSpans: session.rejectedSpans,
              signalLevel: level,
            }
          : hadSession
            ? { cleanSeconds: null, coachingKey: null, signalLevel: null, recentPulse: [], failure: refusal }
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
        activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch((error: unknown) =>
          console.warn(`Screen could not be kept awake: ${reasonOf(error)}`),
        );
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
  }, [capture, demo, enabled, permissionGrants]);

  return { ...live, nativeCamera: capture !== null && capture === LumenCapture };
}
