import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { NavButton } from '@/components/NavButton';
import { PhoneBackIllustration } from '@/components/PhoneBackIllustration';
import { RouteShell } from '@/components/RouteShell';
import type { MeasureMode } from '@/measure/mode';
import { SeatedIllustration } from '@/onboarding/SeatedIllustration';
import { ProgressRing, SignalMeter } from '@/onboarding/practiceParts';
import { useTheme } from '@/theme';

import type { FixCause } from './causes';
import { FingertipPair } from './FingertipPair';

// Spec §8.3: every targeted lesson ends with a 20-second steady practice.
const STEADY_SECONDS_NEEDED = 20;

// No capture controller feeds the app yet, so the practice shows its starting state: no steady seconds.
const steadySeconds = 0;

type FixTechniqueViewProps = { mode: MeasureMode; cause: FixCause | null };

export function FixTechniqueView({ mode, cause }: FixTechniqueViewProps) {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const copy = {
    pressure: {
      name: t('fix.cause.pressure'),
      why: t('fix.why.pressure'),
      tryHeading: t('fix.tryCover'),
    },
    motion: {
      name: t('fix.cause.motion'),
      why: t('fix.why.motion'),
      tryHeading: t('fix.try.motion'),
    },
    coverage: {
      name: t('fix.cause.coverage'),
      why: t('fix.why.coverage'),
      tryHeading: t('fix.try.coverage'),
    },
    coldHands: {
      name: t('fix.cause.coldHands'),
      why: t('fix.why.coldHands'),
      tryHeading: t('fix.try.coldHands'),
    },
  }[cause ?? 'pressure'];
  return (
    <RouteShell
      title={t('fix.title')}
      footer={<NavButton label={t('fix.done')} href={`/measure/capture?mode=${mode}`} replace />}
    >
      <AppText>
        {cause ? (
          <>
            {t('fix.lead')} <AppText style={{ color: colors.flag, fontWeight: '700' }}>{copy.name}</AppText>.{' '}
            {copy.why}
          </>
        ) : (
          t('fix.introGeneric')
        )}
      </AppText>
      {lessonVisual(t, cause)}
      <Card>
        <AppText tone="textDim">{copy.tryHeading}</AppText>
        {cause === 'coldHands' ? (
          <>
            <AppText>{t('fix.tipWarm')}</AppText>
            <AppText>{t('fix.tipWarm2')}</AppText>
          </>
        ) : null}
        {cause === 'motion' ? <AppText>{t('fix.tipMotion')}</AppText> : null}
        <View style={{ gap: spacing.xs }}>
          <SignalMeter />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <AppText variant="caption" tone="textDim">
              {t('signal.weak')}
            </AppText>
            <AppText variant="caption" tone="textDim">
              {t('signal.ok')}
            </AppText>
            <AppText variant="caption" tone="accent" style={{ fontWeight: '600' }}>
              {t('signal.strong')}
            </AppText>
          </View>
        </View>
      </Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md }}>
        <ProgressRing fraction={steadySeconds / STEADY_SECONDS_NEEDED} />
        <AppText variant="headline">
          {t('practice.progress', { done: steadySeconds, total: STEADY_SECONDS_NEEDED })}
        </AppText>
      </View>
      <AppText variant="caption" tone="textDim">
        {t('practice.pending')}
      </AppText>
    </RouteShell>
  );
}

function lessonVisual(t: TFunction, cause: FixCause | null): ReactNode {
  switch (cause) {
    case 'motion':
      return (
        <SeatedIllustration phoneLabel={t('howToSit.labelPhone')} elbowLabel={t('howToSit.labelElbow')} />
      );
    case 'coverage':
      return <PhoneBackIllustration lensLabel={t('placement.lens')} flashLabel={t('placement.flash')} />;
    case 'coldHands':
      return null;
    default:
      return <FingertipPair />;
  }
}
