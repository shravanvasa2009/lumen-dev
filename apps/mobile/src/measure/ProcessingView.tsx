import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { NavButton } from '@/components/NavButton';
import { Screen } from '@/components/Screen';
import { ProgressRing } from '@/onboarding/practiceParts';
import { useTheme } from '@/theme';

import { type AnalysisProgress, completedPercent, pendingProgress, STEP_ORDER } from './analysisProgress';
import { StepRow } from './StepRow';
import type { ReadingAnalysis } from './useReadingAnalysis';

const RING_SIZE = 120;
const RING_STROKE = 9;
const NO_VALUE = '—';

// Only the demo reading has an id the app can show without an analysis (ADR 0046).
const SAMPLE_RESULTS = '/results/demo';

export function ProcessingView({ analysis }: { analysis: ReadingAnalysis }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { spacing } = useTheme();
  const unavailable = analysis.phase === 'unavailable';
  const progress: AnalysisProgress = unavailable ? pendingProgress : analysis.progress;
  const percent = unavailable ? null : completedPercent(progress);
  const percentText = percent === null ? NO_VALUE : `${percent}%`;

  const labels = {
    beats:
      progress.beats === null
        ? t('processing.cleaned')
        : t('processing.cleanedCount', { count: progress.beats }),
    rhythm: t('processing.rhythm'),
    breathing: t('processing.breathing'),
    baseline: t('processing.baseline'),
  };
  const stateLabels = {
    done: t('processing.stateDone'),
    active: t('processing.stateActive'),
    pending: t('processing.statePending'),
  };

  return (
    <Screen
      headerless
      footer={
        <>
          {unavailable ? (
            <>
              <NavButton label={t('processing.seeResults')} href={SAMPLE_RESULTS} replace />
              <Button label={t('processing.backHome')} variant="link" onPress={() => router.replace('/')} />
            </>
          ) : null}
          {analysis.phase === 'done' ? (
            <NavButton label={t('processing.seeResults')} href={`/results/${analysis.readingId}`} replace />
          ) : null}
          <AppText variant="caption" tone="textDim" style={{ textAlign: 'center' }}>
            {t('processing.onPhone')}
          </AppText>
        </>
      }
    >
      <View style={{ flex: 1, justifyContent: 'center', gap: spacing.xxl }}>
        <View style={{ alignItems: 'center', gap: spacing.md }}>
          <View
            accessible
            accessibilityLabel={percentText}
            style={{ alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg }}
          >
            <ProgressRing fraction={(percent ?? 0) / 100} size={RING_SIZE} strokeWidth={RING_STROKE} />
            <View style={{ position: 'absolute' }}>
              <AppText variant="headline">{percentText}</AppText>
            </View>
          </View>
          <AppText variant="title" accessibilityRole="header" style={{ textAlign: 'center' }}>
            {t('processing.title')}
          </AppText>
          <AppText tone="textDim" style={{ textAlign: 'center' }}>
            {unavailable ? t('processing.unavailable') : t('processing.subtitle')}
          </AppText>
        </View>

        <Card flush>
          {STEP_ORDER.map((step, index) => (
            <StepRow
              key={step}
              label={labels[step]}
              state={progress.steps[step]}
              stateLabel={stateLabels[progress.steps[step]]}
              note={
                step === 'beats' && progress.rejectedBeats !== null
                  ? t('processing.rejected', { count: progress.rejectedBeats })
                  : undefined
              }
              last={index === STEP_ORDER.length - 1}
            />
          ))}
        </Card>
      </View>
    </Screen>
  );
}
