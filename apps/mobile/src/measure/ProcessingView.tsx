import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { CHECK_ICON, CHECK_IDS, type CheckId, checkCell, planPhone } from '@/checks/checkPlan';
import { lockText } from '@/checks/lockText';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon, type IconName } from '@/components/Icon';
import { ValueSettle } from '@/components/Reveal';
import { NavButton } from '@/components/NavButton';
import { Screen } from '@/components/Screen';
import { ProgressRing } from '@/onboarding/practiceParts';
import { useStoredRating } from '@/store/useStoredRating';
import { useTheme } from '@/theme';

import { type AnalysisProgress, completedPercent, pendingProgress, STEP_ORDER } from './analysisProgress';
import type { MeasureMode } from './mode';
import { StepRow } from './StepRow';
import { TickRing } from './TickRing';
import type { AnalysisState } from './useReadingAnalysis';

const RING_SIZE = 180;
const TICK_COUNT = 60;
const RING_STROKE = 12;
const NO_VALUE = '—';

// Only the demo reading has an id the app can show without an analysis (ADR 0046).
const SAMPLE_RESULTS = '/results/demo';

const STEP_OF_CHECK = { afib: 'rhythm', hrv: 'breathing', diabetes: null, pots: null } as const;

// What each check shows comes from the shared checks table (mode and tier). A check reads Ready only once the
// finished reading holds its result; before that it reads Checking or Waiting, and afterwards a check that
// produced nothing says so.
function CheckSummary({ mode, progress }: { mode: MeasureMode; progress: AnalysisProgress }) {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const phone = planPhone(useStoredRating());
  const names: Record<CheckId, string> = {
    afib: t('checks.afib.name'),
    hrv: t('checks.hrv.name'),
    diabetes: t('checks.diabetes.name'),
    pots: t('checks.pots.name'),
  };
  const stateOf = (check: CheckId): string => {
    const cell = checkCell(mode, check, phone);
    if (cell.state === 'locked') return lockText(t, cell.why);
    if (cell.state === 'notInScan')
      return check === 'pots' ? t('checks.from.standing') : t('checks.state.off');
    if (progress.outputs !== null && check !== 'pots') {
      return progress.outputs[check] ? t('checks.state.ready') : t('checks.state.notRun');
    }
    const step = STEP_OF_CHECK[check];
    return step !== null && progress.steps[step] !== 'pending'
      ? t('checks.state.working')
      : t('checks.state.waiting');
  };
  return (
    <Card>
      <AppText variant="caption" tone="textDim" style={{ fontWeight: '600', textTransform: 'uppercase' }}>
        {t('checks.inReading')}
      </AppText>
      {CHECK_IDS.map((check) => (
        <View
          key={check}
          style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 32 }}
        >
          <Icon name={CHECK_ICON[check]} size={20} color={colors.accent} />
          <AppText variant="headline">{names[check]}</AppText>
          <ValueSettle value={stateOf(check)} style={{ flex: 1 }}>
            <AppText variant="caption" tone="textDim" style={{ textAlign: 'right' }}>
              {stateOf(check)}
            </AppText>
          </ValueSettle>
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
  const phone = planPhone(useStoredRating());
  const tagFor = (check: CheckId, icon: IconName, name: string) =>
    checkCell(mode, check, phone).state === 'runs' ? { icon, name } : undefined;
  const tags: Partial<Record<(typeof STEP_ORDER)[number], { icon: IconName; name: string }>> = {
    rhythm: tagFor('afib', 'pulse', t('checks.afib.name')),
    breathing: tagFor('hrv', 'trends', t('checks.hrv.name')),
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
            <TickRing
              size={RING_SIZE}
              count={TICK_COUNT}
              lit={Math.round(((percent ?? 0) / 100) * TICK_COUNT)}
              majorEvery={TICK_COUNT / 4}
            >
              {(innerSize) => (
                <ProgressRing fraction={(percent ?? 0) / 100} size={innerSize} strokeWidth={RING_STROKE} />
              )}
            </TickRing>
            <View style={{ position: 'absolute' }}>
              <ValueSettle value={percentText}>
                <AppText variant="title">{percentText}</AppText>
              </ValueSettle>
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
