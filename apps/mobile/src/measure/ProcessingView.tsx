import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EvidenceBadge } from '@/components/EvidenceBadge';
import { Icon, type IconName } from '@/components/Icon';
import { NavButton } from '@/components/NavButton';
import { Screen } from '@/components/Screen';
import { ProgressRing } from '@/onboarding/practiceParts';
import { useTheme } from '@/theme';

import { type AnalysisProgress, completedPercent, pendingProgress, STEP_ORDER } from './analysisProgress';
import type { MeasureMode } from './mode';
import { StepRow } from './StepRow';
import type { AnalysisState } from './useReadingAnalysis';

const RING_SIZE = 160;
const RING_STROKE = 12;
const NO_VALUE = '—';

// Only the demo reading has an id the app can show without an analysis (ADR 0046).
const SAMPLE_RESULTS = '/results/demo';

type CheckLine = { icon: IconName; name: string; state: string; experimental?: boolean };

// Each check's live state follows the analysis step it depends on: AFib the rhythm step, HRV the breathing
// and HRV step. Diabetes waits for the whole analysis. Which checks a scan runs follows spec 06 and 12.
function CheckSummary({ mode, progress }: { mode: MeasureMode; progress: AnalysisProgress }) {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const words = {
    done: t('checks.state.ready'),
    active: t('checks.state.working'),
    pending: t('checks.state.waiting'),
  };
  const full = mode === 'full';
  const lines: CheckLine[] = [
    { icon: 'pulse', name: t('checks.afib.name'), state: words[progress.steps.rhythm] },
    {
      icon: 'trends',
      name: t('checks.hrv.name'),
      state: full ? words[progress.steps.breathing] : t('checks.state.off'),
    },
    {
      icon: 'lens',
      name: t('checks.diabetes.name'),
      state: full ? words[progress.steps.baseline] : t('checks.state.off'),
      experimental: true,
    },
    { icon: 'finger', name: t('checks.pots.name'), state: t('checks.from.standing') },
  ];
  return (
    <Card>
      <AppText variant="caption" tone="textDim" style={{ fontWeight: '600', textTransform: 'uppercase' }}>
        {t('checks.inReading')}
      </AppText>
      {lines.map(({ icon, name, state, experimental }) => (
        <View
          key={name}
          style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 32 }}
        >
          <Icon name={icon} size={20} color={colors.accent} />
          <AppText variant="headline">{name}</AppText>
          {experimental ? <EvidenceBadge metric="diabetes" /> : null}
          <AppText variant="caption" tone="textDim" style={{ flex: 1, textAlign: 'right' }}>
            {state}
          </AppText>
        </View>
      ))}
    </Card>
  );
}

export function ProcessingView({ analysis, mode }: { analysis: AnalysisState; mode: MeasureMode }) {
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
  const tags: Partial<Record<(typeof STEP_ORDER)[number], { icon: IconName; name: string }>> = {
    rhythm: { icon: 'pulse', name: t('checks.afib.name') },
    ...(mode === 'full' ? { breathing: { icon: 'trends', name: t('checks.hrv.name') } } : {}),
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
          {unavailable || analysis.phase === 'failed' ? (
            <>
              {unavailable ? (
                <NavButton label={t('processing.seeSample')} href={SAMPLE_RESULTS} replace />
              ) : null}
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
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', gap: spacing.lg }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ alignItems: 'center', gap: spacing.sm }}>
          <View
            accessible
            accessibilityLabel={percentText}
            style={{ alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm }}
          >
            <ProgressRing fraction={(percent ?? 0) / 100} size={RING_SIZE} strokeWidth={RING_STROKE} />
            <View style={{ position: 'absolute' }}>
              <AppText variant="title">{percentText}</AppText>
            </View>
          </View>
          <AppText variant="title" accessibilityRole="header" style={{ textAlign: 'center' }}>
            {t('processing.title')}
          </AppText>
          <AppText tone="textDim" style={{ textAlign: 'center' }}>
            {analysis.phase === 'unavailable'
              ? t('processing.unavailable')
              : analysis.phase === 'failed'
                ? t('processing.failed')
                : t('processing.subtitle')}
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
              tag={tags[step]}
              last={index === STEP_ORDER.length - 1}
            />
          ))}
        </Card>
        <CheckSummary mode={mode} progress={progress} />
      </ScrollView>
    </Screen>
  );
}
