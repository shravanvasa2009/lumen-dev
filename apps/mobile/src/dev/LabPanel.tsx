import Constants from 'expo-constants';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme';

import {
  ReplayCapture,
  type CameraPermission,
  type Capabilities,
  type CaptureConfig,
  type CaptureStatus,
  type CaptureSummary,
  type LabDiagnostics,
  type LensInfo,
  type LumenCaptureModule,
  type Sample,
  type SampleBatch,
} from '../../modules/lumen-capture/src';

import { captureRequestBody, type PolarRr } from './captureRequest';
import type { HeartRateMeasurement } from './heartRateMeasurement';
import { keepLiveWindow, readLiveHeartRate, type LiveHeartRate } from './liveHeartRate';
import { connectStrap, type StrapConnection } from './polarStrap';
import { sendCapture } from './sendCapture';
import { jsClockNs, lowerOffsetNs, stampStrapRr, type StrapNotification } from './strapClock';

// About 5 s at 60 fps or 10 s at 30 fps: enough to see several pulses.
const TRACE_POINTS = 300;
const TRACE_HEIGHT = 96;
const DOT_SIZE = 2;
// M0 wants exposure locked; 1 s lets auto exposure settle on the finger before native steers and locks it
// (DSP-5, ADR 0029).
const AUTO_LOCK_MS = 1000;
// "Default" sends no targetFps: iOS then uses the lens maximum capped at 120, Android 60 where supported,
// else 30. An explicit value up to 240 is honoured, which "Lens max" uses (ADR 0029, revised 2026-10-01).
type FpsChoice = 'default' | 'lensMax' | 30 | 60;
const FIXED_FPS = [30, 60] as const;
const TORCH_LEVELS = [0, 0.25, 0.5, 1];
const TORCH_ON_OFF = [0, 1];
// ADR 0027: core's live estimate is meant to run about once a second, timed here by the frames' own clock.
const LIVE_HR_EVERY_NS = 1e9;
// Paced-breathing metronomes run well inside this range; anything else is a typo.
const MAX_PACED_BRPM = 60;

type Subscription = { remove(): void };
type Recorded = {
  capabilities: Capabilities;
  summary: CaptureSummary;
  lab?: LabDiagnostics;
  polarRr?: PolarRr;
  recordedAt?: Date;
};
type SendState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; folder: string }
  | { kind: 'failed'; reason: string };
type StrapState =
  | { kind: 'off' }
  | { kind: 'connecting' }
  | { kind: 'connected'; name: string }
  | { kind: 'failed'; reason: string };

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

// Used once the screen is gone, so a failure can only go to the dev console.
function stopUnattended(capture: LumenCaptureModule) {
  capture.stop().catch((error: unknown) => console.warn(`Lab capture did not stop: ${reasonOf(error)}`));
}

function disconnectUnattended(connection: StrapConnection) {
  connection
    .disconnect()
    .catch((error: unknown) => console.warn(`Chest strap did not disconnect: ${reasonOf(error)}`));
}

// Raw red means scaled to the visible window's own range, so the pulse is visible at any brightness. This
// is display scaling only; the signal math lives in @lumen/core.
function RedTrace({ values }: { values: readonly number[] }) {
  const { colors, radius } = useTheme();
  const low = Math.min(...values);
  const span = Math.max(...values) - low;
  return (
    <View
      testID="lab-red-trace"
      style={[
        styles.trace,
        { height: TRACE_HEIGHT, backgroundColor: colors.surface2, borderRadius: radius.card },
      ]}
    >
      {values.map((value, index) => (
        <View key={index} style={styles.traceColumn}>
          <View
            style={{
              height: DOT_SIZE,
              marginBottom: (span > 0 ? (value - low) / span : 0.5) * (TRACE_HEIGHT - DOT_SIZE),
              backgroundColor: colors.accent,
            }}
          />
        </View>
      ))}
    </View>
  );
}

type Choice<T> = { key: string; label: string; value: T; disabled?: boolean };

function ChoiceRow<T>({
  choices,
  chosen,
  onChoose,
  disabled,
}: {
  choices: Choice<T>[];
  chosen: T;
  onChoose: (value: T) => void;
  disabled: boolean;
}) {
  const { colors, radius, control, spacing } = useTheme();
  return (
    <View style={[styles.choices, { gap: spacing.sm }]}>
      {choices.map((choice) => {
        const selected = choice.value === chosen;
        const inactive = disabled || choice.disabled === true;
        return (
          <Pressable
            key={choice.key}
            accessibilityRole="button"
            accessibilityState={{ selected, disabled: inactive }}
            disabled={inactive}
            onPress={() => onChoose(choice.value)}
            style={[
              styles.choice,
              {
                minHeight: control.minTarget,
                paddingHorizontal: spacing.lg,
                borderRadius: radius.pill,
                borderColor: selected ? colors.accentFill : colors.line2,
                backgroundColor: selected ? colors.accentFill : 'transparent',
                opacity: inactive ? 0.5 : 1,
              },
            ]}
          >
            <AppText style={{ color: selected ? colors.onAccentFill : colors.text }}>{choice.label}</AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

function Diagnostics({ lab }: { lab: LabDiagnostics }) {
  const { t } = useTranslation();
  const yesNo = (locked: boolean) => (locked ? t('lab.yes') : t('lab.no'));
  return (
    <>
      <AppText tone="textDim">
        {t('lab.diagFormat', {
          lens: lab.lensId,
          width: lab.formatWidth,
          height: lab.formatHeight,
          fps: lab.targetFps,
        })}
      </AppText>
      <AppText tone="textDim">
        {t('lab.diagWork', { mean: lab.frameWorkMsMean.toFixed(2), max: lab.frameWorkMsMax.toFixed(2) })}
      </AppText>
      <AppText tone="textDim">
        {t('lab.diagExposure', { iso: Math.round(lab.iso), exposure: (lab.exposureNs / 1e6).toFixed(2) })}
      </AppText>
      <AppText tone="textDim">
        {lab.torchOn ? t('lab.diagTorchOn', { level: lab.torchLevel.toFixed(2) }) : t('lab.diagTorchOff')}
      </AppText>
      <AppText tone="textDim">
        {t('lab.diagLocks', {
          exposure: yesNo(lab.locked.exposure),
          whiteBalance: yesNo(lab.locked.whiteBalance),
          focus: yesNo(lab.locked.focus),
        })}
      </AppText>
    </>
  );
}

// Development builds only (spec §12 Lab mode, §13.5): records a capture from the rear camera, or from a
// recording through ReplayCapture, shows the live red trace and capture health, and sends the capture to
// the PC receiver. The live heart rate is @lumen/core's Lab estimate (ADR 0027); no signal math lives here.
export function LabPanel({ capture }: { capture: LumenCaptureModule | null }) {
  const { t } = useTranslation();
  const { colors, spacing, radius, control } = useTheme();
  const subscriptions = useRef<Subscription[]>([]);
  const batches = useRef<SampleBatch[]>([]);
  const reds = useRef<number[]>([]);
  const liveWindow = useRef<Sample[]>([]);
  const lastEstimateNs = useRef<number | null>(null);
  const lastLab = useRef<LabDiagnostics | undefined>(undefined);
  const startedAt = useRef<Date | undefined>(undefined);
  const phone = useRef<Capabilities | null>(null);
  const capturing = useRef(false);
  const mounted = useRef(true);
  // A ref, not state: two presses in the same frame both see the state from before the first press.
  const switchingRef = useRef(false);
  const [switching, setSwitching] = useState(false);
  const [permission, setPermission] = useState<CameraPermission | null>(null);
  const [running, setRunning] = useState(false);
  const [trace, setTrace] = useState<number[]>([]);
  const [frames, setFrames] = useState(0);
  const [status, setStatus] = useState<CaptureStatus | null>(null);
  const [lab, setLab] = useState<LabDiagnostics | null>(null);
  const [liveHr, setLiveHr] = useState<LiveHeartRate>({ kind: 'none' });
  const [recorded, setRecorded] = useState<Recorded | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  const [token, setToken] = useState('');
  const [rested, setRested] = useState(false);
  const [pacedText, setPacedText] = useState('');
  const [sendState, setSendState] = useState<SendState>({ kind: 'idle' });
  const [phoneShown, setPhoneShown] = useState<Capabilities | null>(null);
  const [lensId, setLensId] = useState<string | undefined>(undefined);
  const [fpsChoice, setFpsChoice] = useState<FpsChoice>('default');
  // Native's own default is the torch at full (ADR 0029 addendum); the panel starts from the same level, and
  // Start waits for the capabilities so a phone without a torch is never sent level 1.
  const [torchLevel, setTorchLevel] = useState(1);
  const [autoLock, setAutoLock] = useState(true);
  const [locking, setLocking] = useState(false);
  const [lockDone, setLockDone] = useState(false);
  const autoLockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const strap = useRef<StrapConnection | null>(null);
  const strapNotifications = useRef<StrapNotification[]>([]);
  const strapOffsetNs = useRef<number | null>(null);
  const [strapState, setStrapState] = useState<StrapState>({ kind: 'off' });
  const [strapReading, setStrapReading] = useState<HeartRateMeasurement | null>(null);

  const cancelAutoLock = () => {
    if (autoLockTimer.current) clearTimeout(autoLockTimer.current);
    autoLockTimer.current = null;
  };

  const removeListeners = () => {
    subscriptions.current.forEach((subscription) => subscription.remove());
    subscriptions.current = [];
  };

  // Leaving the screen mid-capture must not leave the camera and torch running.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelAutoLock();
      removeListeners();
      if (capturing.current && capture) stopUnattended(capture);
    };
  }, [capture]);

  useEffect(
    () => () => {
      if (strap.current) disconnectUnattended(strap.current);
      strap.current = null;
    },
    [],
  );

  // The lens and torch choices come from the phone itself, never from a typed list (spec §4.3).
  useEffect(() => {
    if (!capture) return;
    capture
      .getCapabilities()
      .then((capabilities) => {
        if (!mounted.current) return;
        setPhoneShown(capabilities);
        // Native rejects start() with a torch level when the phone has no torch (ADR 0029 addendum).
        if (!capabilities.torch.available) setTorchLevel(0);
      })
      .catch((error: unknown) => {
        if (mounted.current) setFailure(reasonOf(error));
      });
  }, [capture]);

  if (!capture) return <AppText tone="textDim">{t('lab.noSource')}</AppText>;

  const askPermission = async () => {
    setFailure(null);
    try {
      setPermission(await capture.requestPermission());
    } catch (error) {
      setFailure(reasonOf(error));
    }
  };

  const beginSwitch = () => {
    if (switchingRef.current) return false;
    switchingRef.current = true;
    setSwitching(true);
    return true;
  };
  const endSwitch = () => {
    switchingRef.current = false;
    if (mounted.current) setSwitching(false);
  };
  const reportFailure = (error: unknown) => {
    if (mounted.current) setFailure(reasonOf(error));
    else console.warn(`Lab capture failed after the screen closed: ${reasonOf(error)}`);
  };

  const lockNow = async () => {
    cancelAutoLock();
    setFailure(null);
    setLocking(true);
    setLockDone(false);
    try {
      await capture.lockExposure();
      if (mounted.current) setLockDone(true);
    } catch (error) {
      reportFailure(error);
    } finally {
      if (mounted.current) setLocking(false);
    }
  };

  const pickedLens = phoneShown?.rearLenses.find((lens) => lens.id === lensId);
  const targetFps =
    fpsChoice === 'default' ? undefined : fpsChoice === 'lensMax' ? pickedLens?.maxFps : fpsChoice;

  const chooseLens = (id: string | undefined) => {
    setLensId(id);
    const lens = phoneShown?.rearLenses.find((candidate) => candidate.id === id);
    // Without a picked lens the panel cannot know which maximum native would use.
    if (!lens) setFpsChoice((choice) => (choice === 'lensMax' ? 'default' : choice));
    // Native rejects start() with a torch on a lens that has none (ADR 0029 addendum).
    if (lens && !lens.torchUsable) setTorchLevel(0);
  };

  const chooseTorch = async (level: number) => {
    setTorchLevel(level);
    if (!running) return;
    setFailure(null);
    try {
      await capture.setTorch(level);
    } catch (error) {
      reportFailure(error);
    }
  };

  const startCapture = async () => {
    if (!beginSwitch()) return;
    setFailure(null);
    setSendState({ kind: 'idle' });
    try {
      phone.current = await capture.getCapabilities();
      if (!mounted.current) return;
      batches.current = [];
      reds.current = [];
      liveWindow.current = [];
      lastEstimateNs.current = null;
      lastLab.current = undefined;
      strapNotifications.current = [];
      strapOffsetNs.current = null;
      setLiveHr({ kind: 'none' });
      setTrace([]);
      setFrames(0);
      setStatus(null);
      setLab(null);
      setRecorded(null);
      setLockDone(false);
      subscriptions.current = [
        capture.addListener('samples', (batch) => {
          batches.current.push(batch);
          reds.current = [...reds.current, ...batch.samples.map((sample) => sample.r)].slice(-TRACE_POINTS);
          setTrace(reds.current);
          setFrames((count) => count + batch.samples.length);
          liveWindow.current = keepLiveWindow(liveWindow.current, batch.samples);
          const newest = batch.samples[batch.samples.length - 1];
          if (newest) strapOffsetNs.current = lowerOffsetNs(strapOffsetNs.current, jsClockNs(), newest.tNs);
          if (
            newest &&
            (lastEstimateNs.current === null ||
              // abs: a backward clock step must not stall the estimate (Appendix A does not promise order).
              Math.abs(newest.tNs - lastEstimateNs.current) >= LIVE_HR_EVERY_NS)
          ) {
            lastEstimateNs.current = newest.tNs;
            setLiveHr(readLiveHeartRate(liveWindow.current));
          }
        }),
        capture.addListener('status', setStatus),
        capture.addListener('lab', (diagnostics) => {
          lastLab.current = diagnostics;
          setLab(diagnostics);
        }),
      ];
      startedAt.current = new Date();
      const config: CaptureConfig = { torchLevel };
      if (lensId !== undefined) config.lensId = lensId;
      if (targetFps !== undefined) config.targetFps = targetFps;
      await capture.start(config);
      if (!mounted.current) {
        // The screen closed while the camera was starting, so its cleanup had nothing to stop yet.
        removeListeners();
        stopUnattended(capture);
        return;
      }
      capturing.current = true;
      setRunning(true);
      if (autoLock)
        autoLockTimer.current = setTimeout(() => {
          autoLockTimer.current = null;
          if (capturing.current) lockNow();
        }, AUTO_LOCK_MS);
    } catch (error) {
      removeListeners();
      reportFailure(error);
    } finally {
      endSwitch();
    }
  };

  const stopCapture = async () => {
    if (!beginSwitch()) return;
    setFailure(null);
    // The stop is already in flight, so an unmount meanwhile must not stop a second time.
    capturing.current = false;
    cancelAutoLock();
    try {
      const summary = await capture.stop();
      removeListeners();
      setRunning(false);
      if (phone.current)
        setRecorded({
          capabilities: phone.current,
          summary,
          lab: lastLab.current,
          polarRr: stampStrapRr(strapNotifications.current, strapOffsetNs.current),
          recordedAt: startedAt.current,
        });
    } catch (error) {
      capturing.current = true;
      reportFailure(error);
    } finally {
      endSwitch();
    }
  };

  const connectToStrap = async () => {
    setStrapState({ kind: 'connecting' });
    try {
      const connection = await connectStrap({
        onMeasurement: (measurement) => {
          // Stamped on arrival; strapClock maps this JS time onto the camera clock when the capture stops.
          if (capturing.current && measurement.rrMs.length)
            strapNotifications.current.push({ jsNs: jsClockNs(), rrMs: measurement.rrMs });
          if (mounted.current) setStrapReading(measurement);
        },
        onLost: (reason) => {
          strap.current = null;
          if (!mounted.current) return;
          setStrapReading(null);
          setStrapState({ kind: 'failed', reason });
        },
      });
      if (!mounted.current) {
        // Closing the screen does not cancel a scan or connect in flight (up to 15 s); the strap is
        // released here once it connects. Acceptable in the dev-only Lab.
        disconnectUnattended(connection);
        return;
      }
      strap.current = connection;
      setStrapState({ kind: 'connected', name: connection.name });
    } catch (error) {
      if (mounted.current) setStrapState({ kind: 'failed', reason: reasonOf(error) });
    }
  };

  const disconnectStrap = async () => {
    const connection = strap.current;
    strap.current = null;
    setStrapReading(null);
    setStrapState({ kind: 'off' });
    try {
      await connection?.disconnect();
    } catch (error) {
      if (mounted.current) setStrapState({ kind: 'failed', reason: reasonOf(error) });
    }
  };

  const thermalText = (thermal: CaptureStatus['thermal']) =>
    thermal === 'nominal'
      ? t('lab.thermalNominal')
      : thermal === 'fair'
        ? t('lab.thermalFair')
        : thermal === 'serious'
          ? t('lab.thermalSerious')
          : t('lab.thermalCritical');

  const pacedTyped = pacedText.trim().replace(',', '.');
  const pacedBrpm = pacedTyped === '' ? undefined : Number(pacedTyped);
  const pacedValid =
    pacedBrpm === undefined || (Number.isFinite(pacedBrpm) && pacedBrpm > 0 && pacedBrpm <= MAX_PACED_BRPM);

  const sendToPc = async () => {
    if (!recorded) return;
    setSendState({ kind: 'sending' });
    try {
      const body = captureRequestBody(batches.current, {
        appVersion: Constants.expoConfig?.version,
        ...recorded,
        restTimerDone: rested,
        pacedBrpm,
      });
      setSendState({ kind: 'sent', folder: await sendCapture(address.trim(), token.trim(), body) });
    } catch (error) {
      setSendState({ kind: 'failed', reason: reasonOf(error) });
    }
  };

  const inputStyle = {
    minHeight: control.minTarget,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderRadius: radius.card,
    borderColor: colors.line2,
    backgroundColor: colors.surface2,
    color: colors.text,
  };
  const kindNames: Record<LensInfo['kind'], string> = {
    wide: t('lab.lensWide'),
    ultrawide: t('lab.lensUltrawide'),
    tele: t('lab.lensTele'),
    unknown: t('lab.lensUnknown'),
  };
  const lensChoices: Choice<string | undefined>[] = [
    { key: 'default', label: t('lab.lensDefault'), value: undefined },
    ...(phoneShown?.rearLenses ?? []).map((lens) => {
      const values = { kind: kindNames[lens.kind], id: lens.id, fps: lens.maxFps };
      return {
        key: lens.id,
        label: lens.torchUsable ? t('lab.lensOption', values) : t('lab.lensOptionNoTorch', values),
        value: lens.id,
      };
    }),
  ];
  const fpsChoices: Choice<FpsChoice>[] = [
    { key: 'default', label: t('lab.fpsDefault'), value: 'default' },
    ...FIXED_FPS.map((fps) => ({ key: String(fps), label: t('lab.fpsTarget', { fps }), value: fps })),
    ...(pickedLens
      ? [
          {
            key: 'lensMax',
            label: t('lab.fpsLensMax', { fps: pickedLens.maxFps }),
            value: 'lensMax' as const,
          },
        ]
      : []),
  ];
  // Phones without torch levels only take on (1) or off (0).
  const hasLevels = phoneShown?.torch.levels === true;
  const torchUsable = phoneShown?.torch.available !== false && pickedLens?.torchUsable !== false;
  const torchChoices: Choice<number>[] = (hasLevels ? TORCH_LEVELS : TORCH_ON_OFF).map((level) => ({
    key: String(level),
    label: level === 0 ? t('lab.torchOff') : hasLevels ? t('lab.torchLevel', { level }) : t('lab.torchOn'),
    value: level,
    disabled: level !== 0 && !torchUsable,
  }));

  const canSend =
    !running &&
    recorded !== null &&
    frames > 0 &&
    address.trim() !== '' &&
    token.trim() !== '' &&
    pacedValid;

  return (
    <View style={{ gap: spacing.md }}>
      <AppText tone="textDim">
        {capture instanceof ReplayCapture ? t('lab.sourceReplay') : t('lab.sourceCamera')}
      </AppText>
      <Button variant="secondary" label={t('lab.askPermission')} onPress={askPermission} />
      {permission ? (
        <AppText>{permission.granted ? t('lab.permissionGranted') : t('lab.permissionDenied')}</AppText>
      ) : null}
      {phoneShown ? (
        <AppText tone="textDim">
          {t('lab.phone', { model: phoneShown.modelId, os: phoneShown.osVersion })}
        </AppText>
      ) : null}

      <AppText variant="headline">{t('lab.lens')}</AppText>
      <ChoiceRow
        choices={lensChoices}
        chosen={lensId}
        onChoose={chooseLens}
        disabled={running || switching}
      />
      <AppText variant="headline">{t('lab.targetFps')}</AppText>
      <ChoiceRow
        choices={fpsChoices}
        chosen={fpsChoice}
        onChoose={setFpsChoice}
        disabled={running || switching}
      />
      <AppText variant="headline">{t('lab.torch')}</AppText>
      <ChoiceRow choices={torchChoices} chosen={torchLevel} onChoose={chooseTorch} disabled={switching} />
      <Button
        variant="secondary"
        label={autoLock ? t('lab.autoLockOn') : t('lab.autoLockOff')}
        onPress={() => setAutoLock((on) => !on)}
        disabled={running || switching}
      />

      <Button
        label={running ? t('lab.stop') : t('lab.start')}
        onPress={running ? stopCapture : startCapture}
        disabled={switching || phoneShown === null}
      />
      <Button
        variant="secondary"
        label={locking ? t('lab.locking') : t('lab.lockExposure')}
        onPress={lockNow}
        disabled={!running || locking || switching}
      />
      {lockDone ? <AppText tone="textDim">{t('lab.lockDone')}</AppText> : null}
      {failure ? <AppText>{t('lab.failed', { reason: failure })}</AppText> : null}

      <AppText variant="headline">{t('lab.redTrace')}</AppText>
      <RedTrace values={trace} />
      <AppText tone="textDim">{t('lab.frames', { frames })}</AppText>
      {status ? (
        <>
          <AppText>
            {t('lab.status', { fps: status.fps.toFixed(1), dropped: (status.droppedFrac * 100).toFixed(2) })}
          </AppText>
          <AppText tone="textDim">{thermalText(status.thermal)}</AppText>
        </>
      ) : null}

      <AppText>
        {liveHr.kind === 'bpm'
          ? t('lab.liveHr', { bpm: Math.round(liveHr.bpm), snr: liveHr.snrDb.toFixed(1) })
          : t('lab.liveHrNone')}
      </AppText>
      {liveHr.kind === 'error' ? <AppText>{t('lab.liveHrError', { reason: liveHr.reason })}</AppText> : null}

      <AppText variant="headline">{t('lab.strap')}</AppText>
      <Button
        variant="secondary"
        label={
          strapState.kind === 'connected'
            ? t('lab.strapDisconnect')
            : strapState.kind === 'connecting'
              ? t('lab.strapConnecting')
              : t('lab.strapConnect')
        }
        onPress={strapState.kind === 'connected' ? disconnectStrap : connectToStrap}
        disabled={strapState.kind === 'connecting'}
      />
      {strapState.kind === 'connected' ? (
        <>
          <AppText tone="textDim">{t('lab.strapConnected', { name: strapState.name })}</AppText>
          <AppText>
            {strapReading ? t('lab.strapHr', { bpm: strapReading.bpm }) : t('lab.strapHrNone')}
          </AppText>
          {strapReading?.contact === 'notDetected' ? <AppText>{t('lab.strapNoContact')}</AppText> : null}
        </>
      ) : null}
      {strapState.kind === 'failed' ? (
        <AppText>{t('lab.strapFailed', { reason: strapState.reason })}</AppText>
      ) : null}
      {recorded?.polarRr ? (
        <AppText tone="textDim">{t('lab.strapRecorded', { count: recorded.polarRr.rrMs.length })}</AppText>
      ) : null}

      <AppText variant="headline">{t('lab.diagnostics')}</AppText>
      {lab ? <Diagnostics lab={lab} /> : <AppText tone="textDim">{t('lab.noDiagnostics')}</AppText>}

      <AppText variant="headline">{t('lab.captureLabels')}</AppText>
      <Button
        variant="secondary"
        label={rested ? t('lab.restedOn') : t('lab.restedOff')}
        onPress={() => setRested((done) => !done)}
      />
      <AppText variant="caption" tone="textDim">
        {t('lab.paced')}
      </AppText>
      <TextInput
        accessibilityLabel={t('lab.paced')}
        value={pacedText}
        onChangeText={setPacedText}
        keyboardType="decimal-pad"
        style={inputStyle}
      />
      {pacedValid ? null : <AppText>{t('lab.pacedInvalid', { max: MAX_PACED_BRPM })}</AppText>}

      <AppText variant="headline">{t('lab.send')}</AppText>
      <AppText variant="caption" tone="textDim">
        {t('lab.address')}
      </AppText>
      <TextInput
        accessibilityLabel={t('lab.address')}
        value={address}
        onChangeText={setAddress}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        style={inputStyle}
      />
      <AppText variant="caption" tone="textDim">
        {t('lab.token')}
      </AppText>
      <TextInput
        accessibilityLabel={t('lab.token')}
        value={token}
        onChangeText={setToken}
        autoCapitalize="none"
        autoCorrect={false}
        style={inputStyle}
      />
      <Button
        variant="secondary"
        label={sendState.kind === 'sending' ? t('lab.sending') : t('lab.send')}
        onPress={sendToPc}
        disabled={!canSend || sendState.kind === 'sending'}
      />
      {sendState.kind === 'sent' ? <AppText>{t('lab.sent', { folder: sendState.folder })}</AppText> : null}
      {sendState.kind === 'failed' ? (
        <AppText>{t('lab.sendFailed', { reason: sendState.reason })}</AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  trace: { flexDirection: 'row', alignItems: 'flex-end', overflow: 'hidden' },
  traceColumn: { flex: 1, justifyContent: 'flex-end' },
  choices: { flexDirection: 'row', flexWrap: 'wrap' },
  choice: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
});
