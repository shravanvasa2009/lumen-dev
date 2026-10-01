import Constants from 'expo-constants';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme';

import {
  ReplayCapture,
  type CameraPermission,
  type Capabilities,
  type CaptureStatus,
  type CaptureSummary,
  type LabDiagnostics,
  type LumenCaptureModule,
  type SampleBatch,
} from '../../modules/lumen-capture/src';

import { captureRequestBody } from './captureRequest';
import { sendCapture } from './sendCapture';

// About 5 s at 60 fps or 10 s at 30 fps: enough to see several pulses.
const TRACE_POINTS = 300;
const TRACE_HEIGHT = 96;
const DOT_SIZE = 2;

type Subscription = { remove(): void };
type Recorded = { capabilities: Capabilities; summary: CaptureSummary; lab?: LabDiagnostics };
type SendState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; folder: string }
  | { kind: 'failed'; reason: string };

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

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
// the PC receiver. No heart rate is computed here; that belongs to @lumen/core.
export function LabPanel({ capture }: { capture: LumenCaptureModule | null }) {
  const { t } = useTranslation();
  const { colors, spacing, radius, control } = useTheme();
  const subscriptions = useRef<Subscription[]>([]);
  const batches = useRef<SampleBatch[]>([]);
  const reds = useRef<number[]>([]);
  const lastLab = useRef<LabDiagnostics | undefined>(undefined);
  const phone = useRef<Capabilities | null>(null);
  const capturing = useRef(false);
  const [permission, setPermission] = useState<CameraPermission | null>(null);
  const [running, setRunning] = useState(false);
  const [trace, setTrace] = useState<number[]>([]);
  const [frames, setFrames] = useState(0);
  const [status, setStatus] = useState<CaptureStatus | null>(null);
  const [lab, setLab] = useState<LabDiagnostics | null>(null);
  const [recorded, setRecorded] = useState<Recorded | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  const [token, setToken] = useState('');
  const [sendState, setSendState] = useState<SendState>({ kind: 'idle' });

  const removeListeners = () => {
    subscriptions.current.forEach((subscription) => subscription.remove());
    subscriptions.current = [];
  };

  // Leaving the screen mid-capture must not leave the camera and torch running.
  useEffect(
    () => () => {
      removeListeners();
      if (capturing.current && capture)
        capture
          .stop()
          .catch((error: unknown) => console.warn(`Lab capture did not stop: ${reasonOf(error)}`));
    },
    [capture],
  );

  if (!capture) return <AppText tone="textDim">{t('lab.noSource')}</AppText>;

  const askPermission = async () => {
    setFailure(null);
    try {
      setPermission(await capture.requestPermission());
    } catch (error) {
      setFailure(reasonOf(error));
    }
  };

  const startCapture = async () => {
    setFailure(null);
    setSendState({ kind: 'idle' });
    try {
      phone.current = await capture.getCapabilities();
      batches.current = [];
      reds.current = [];
      lastLab.current = undefined;
      setTrace([]);
      setFrames(0);
      setStatus(null);
      setLab(null);
      setRecorded(null);
      subscriptions.current = [
        capture.addListener('samples', (batch) => {
          batches.current.push(batch);
          reds.current = [...reds.current, ...batch.samples.map((sample) => sample.r)].slice(-TRACE_POINTS);
          setTrace(reds.current);
          setFrames((count) => count + batch.samples.length);
        }),
        capture.addListener('status', setStatus),
        capture.addListener('lab', (diagnostics) => {
          lastLab.current = diagnostics;
          setLab(diagnostics);
        }),
      ];
      await capture.start({});
      capturing.current = true;
      setRunning(true);
    } catch (error) {
      removeListeners();
      setFailure(reasonOf(error));
    }
  };

  const stopCapture = async () => {
    setFailure(null);
    try {
      const summary = await capture.stop();
      capturing.current = false;
      removeListeners();
      setRunning(false);
      if (phone.current) setRecorded({ capabilities: phone.current, summary, lab: lastLab.current });
    } catch (error) {
      setFailure(reasonOf(error));
    }
  };

  const sendToPc = async () => {
    if (!recorded) return;
    setSendState({ kind: 'sending' });
    try {
      const body = captureRequestBody(batches.current, {
        appVersion: Constants.expoConfig?.version,
        ...recorded,
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
  const canSend = !running && recorded !== null && frames > 0 && address.trim() !== '' && token.trim() !== '';

  return (
    <View style={{ gap: spacing.md }}>
      <AppText tone="textDim">
        {capture instanceof ReplayCapture ? t('lab.sourceReplay') : t('lab.sourceCamera')}
      </AppText>
      <Button variant="secondary" label={t('lab.askPermission')} onPress={askPermission} />
      {permission ? (
        <AppText>{permission.granted ? t('lab.permissionGranted') : t('lab.permissionDenied')}</AppText>
      ) : null}
      <Button
        label={running ? t('lab.stop') : t('lab.start')}
        onPress={running ? stopCapture : startCapture}
      />
      {failure ? <AppText>{t('lab.failed', { reason: failure })}</AppText> : null}

      <AppText variant="headline">{t('lab.redTrace')}</AppText>
      <RedTrace values={trace} />
      <AppText tone="textDim">{t('lab.frames', { frames })}</AppText>
      {status ? (
        <AppText>
          {t('lab.status', { fps: status.fps.toFixed(1), dropped: (status.droppedFrac * 100).toFixed(2) })}
        </AppText>
      ) : null}

      <AppText variant="headline">{t('lab.diagnostics')}</AppText>
      {lab ? <Diagnostics lab={lab} /> : <AppText tone="textDim">{t('lab.noDiagnostics')}</AppText>}

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
});
