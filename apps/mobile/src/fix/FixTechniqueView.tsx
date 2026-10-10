import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { NavButton } from '@/components/NavButton';
import { RouteShell } from '@/components/RouteShell';
import type { MeasureMode } from '@/measure/mode';
import { PlacementFigure } from '@/onboarding/PlacementFigure';
import { SeatedIllustration } from '@/onboarding/SeatedIllustration';
import { ProgressRing, SignalMeter } from '@/onboarding/practiceParts';
import { useTheme } from '@/theme';

import type { FixCause } from './causes';
import { CauseCard } from './CauseCard';
import { FingertipPair } from './FingertipPair';

// Spec §8.3: motion, pressure and coverage practise for 20 s; cold hands waits for PI above the device floor.
const STEADY_SECONDS_NEEDED = 20;

// No capture controller feeds the app yet, so the practice shows its starting state: no steady seconds.
const steadySeconds = 0;

type FixTechniqueViewProps = { mode: MeasureMode; cause: FixCause | null };

export function FixTechniqueView({ mode, cause }: FixTechniqueViewProps) {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  const copy = {
    pressure: {
      tryHeading: t('fix.tryCover'),
    },
    motion: {
      tryHeading: t('fix.try.motion'),
    },
    coverage: {
      tryHeading: t('fix.try.coverage'),
    },
    coldHands: {
      tryHeading: t('fix.try.coldHands'),
    },
  }[cause ?? 'pressure'];
  return (
    <RouteShell
      title={t('fix.title')}
      footer={<NavButton label={t('fix.done')} href={`/measure/capture?mode=${mode}`} replace />}
    >
      {cause ? <CauseCard cause={cause} /> : null}
      <Card>
        <View
          style={{
            backgroundColor: colors.accentTint,
            borderRadius: radius.card,
            padding: spacing.md,
            alignItems: 'center',
            gap: spacing.sm,
          }}
        >
          {lessonVisual(t, cause)}
        </View>
      </Card>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
          <View
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              backgroundColor: colors.accentFill,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="check" size={18} color={colors.onAccentFill} />
          </View>
          <View style={{ flex: 1, gap: spacing.xs }}>
            <AppText tone="textDim">{copy.tryHeading}</AppText>
            {cause === 'coldHands' ? (
              <>
                <AppText>{t('fix.tipWarm')}</AppText>
                <AppText>{t('fix.tipWarm2')}</AppText>
              </>
            ) : null}
            {cause === 'motion' ? <AppText>{t('fix.tipMotion')}</AppText> : null}
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
          {cause === 'coldHands' ? null : <ProgressRing fraction={steadySeconds / STEADY_SECONDS_NEEDED} />}
          <View style={{ flex: 1, gap: spacing.xs }}>
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
        </View>
        {cause === 'coldHands' ? (
          <AppText variant="headline">{t('fix.goal.coldHands')}</AppText>
        ) : (
          <AppText variant="headline">
            {t('practice.progress', { done: steadySeconds, total: STEADY_SECONDS_NEEDED })}
          </AppText>
        )}
      </Card>
      <AppText variant="caption" tone="textDim">
        {t('practice.pending')}
      </AppText>
    </RouteShell>
  );
}

function lessonVisual(t: TFunction, cause: FixCause | null): ReactNode {
  switch (cause) {
    case 'motion':
    case null:
      return (
        <>
          <SeatedIllustration
            phoneLabel={t('howToSit.labelPhone')}
            elbowLabel={t('howToSit.labelElbow')}
            pressInset={{ lensLabel: t('placement.lens'), flashLabel: t('placement.flash') }}
          />
          <AppText>{t('fix.introGeneric')}</AppText>
        </>
      );
    case 'coverage':
      return <PlacementFigure />;
    case 'coldHands':
      return null;
    default:
      return <FingertipPair />;
  }
}
