import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { NavButton } from '@/components/NavButton';
import { capabilityRows } from '@/onboarding/capabilityRows';
import { OnboardingFrame } from '@/onboarding/OnboardingFrame';
import { PhoneCheckDial } from '@/onboarding/PhoneCheckDial';
import { PhoneCheckRow } from '@/onboarding/PhoneCheckRow';
import { LensDots, PointsMeter, TorchBars } from '@/onboarding/PhoneCheckVisuals';
import { cameraPoints, lockPoints, PHONE_CHECK_MAX, PHONE_CHECK_TOTAL } from '@/onboarding/phonePoints';
import { usePhoneProbe } from '@/onboarding/usePhoneProbe';
import { useTheme } from '@/theme';

const BAR_HEIGHT = 8;
const DOT = 8;
const STEP_CIRCLE = 28;
const TORCH_DIMMABLE_BARS = 4;

function LegendDot({ color, dashed = false }: { color: string; dashed?: boolean }) {
  return (
    <View
      style={{
        width: DOT,
        height: DOT,
        borderRadius: DOT / 2,
        ...(dashed
          ? { borderWidth: 1.5, borderStyle: 'dashed', borderColor: color }
          : { backgroundColor: color }),
      }}
    />
  );
}

// Phone check is done, practice is next, and the rating comes last.
function NextSteps() {
  const { t } = useTranslation();
  const { colors, spacing, control } = useTheme();
  const steps = [t('rating.phoneCheck'), t('practice.title'), t('rating.title')];
  const railTop = STEP_CIRCLE / 2 - 1;
  return (
    <View style={{ marginTop: spacing.lg, flexDirection: 'row' }}>
      <View
        style={{
          position: 'absolute',
          left: '16.6%',
          right: '16.6%',
          top: railTop,
          height: 2,
          backgroundColor: colors.surface3,
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: '16.6%',
          width: '16.7%',
          top: railTop,
          height: 2,
          backgroundColor: colors.accent,
        }}
      />
      {steps.map((name, index) => (
        <View key={name} style={{ flex: 1, minWidth: 0, alignItems: 'center', gap: spacing.xs + 2 }}>
          <View
            style={{
              width: STEP_CIRCLE,
              height: STEP_CIRCLE,
              borderRadius: STEP_CIRCLE / 2,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor:
                index === 0 ? colors.buttonFill : index === 1 ? colors.accentTint : colors.surface2,
              borderWidth: index === 1 ? 2 : 0,
              borderColor: colors.accent,
            }}
          >
            {index === 0 ? (
              <Icon name="check" size={control.chevronSize - 6} color={colors.onButtonFill} />
            ) : (
              <View
                style={{
                  width: DOT,
                  height: DOT,
                  borderRadius: DOT / 2,
                  backgroundColor: index === 1 ? colors.accent : colors.line2,
                }}
              />
            )}
          </View>
          <AppText
            variant="caption1"
            tone={index === 2 ? 'textDim' : 'text'}
            style={{ fontWeight: '600', textAlign: 'center' }}
          >
            {name}
          </AppText>
        </View>
      ))}
    </View>
  );
}

export default function PhoneCheckScreen() {
  const { t } = useTranslation();
  const { colors, spacing, control } = useTheme();
  const { probe, recheck } = usePhoneProbe();
  const rows = capabilityRows(probe, t);
  const ready = probe.kind === 'ready' ? probe.capabilities : null;
  const checkedCount = rows.filter((row) => row.status === 'pass' || row.status === 'fail').length;
  const fps = ready ? Math.max(0, ...ready.rearLenses.map((lens) => lens.maxFps)) : 0;
  const camera = ready ? cameraPoints(fps) : 0;
  const locks = ready ? lockPoints(ready.locks) : 0;
  const tiles = [
    { icon: 'camera', fill: colors.buttonFill, glyph: colors.onButtonFill },
    { icon: 'torch', fill: colors.flag, glyph: colors.bg },
    { icon: 'lock', fill: colors.illustrationTorso, glyph: colors.bg },
    { icon: 'clock', fill: colors.glyph, glyph: colors.bg },
    { icon: 'lenses', fill: colors.textDim, glyph: colors.bg },
  ] as const;
  const extras = [
    <PointsMeter
      key="camera"
      earned={camera}
      max={PHONE_CHECK_MAX.camera}
      color={colors.accent}
      accessibleLabel={t('phoneCheck.meterLabel', {
        name: rows[0]?.title,
        points: camera,
        max: PHONE_CHECK_MAX.camera,
      })}
    />,
    <TorchBars
      key="torch"
      steps={ready?.torch.levels ? TORCH_DIMMABLE_BARS : ready?.torch.available ? 1 : 0}
    />,
    <PointsMeter
      key="locks"
      earned={locks}
      max={PHONE_CHECK_MAX.locks}
      color={colors.illustrationTorso}
      accessibleLabel={t('phoneCheck.meterLabel', {
        name: rows[2]?.title,
        points: locks,
        max: PHONE_CHECK_MAX.locks,
      })}
    />,
    <PointsMeter
      key="timing"
      earned={null}
      max={PHONE_CHECK_MAX.timing}
      color={colors.glyph}
      accessibleLabel={t('phoneCheck.timingMeterLabel', {
        name: rows[3]?.title,
        max: PHONE_CHECK_MAX.timing,
      })}
    />,
    <LensDots key="lenses" count={ready?.rearLenses.length ?? 0} />,
  ];
  const legend = [
    { name: t('phoneCheck.legendCamera'), color: colors.accent, dashed: false },
    { name: t('phoneCheck.legendLocks'), color: colors.illustrationTorso, dashed: false },
    { name: t('phoneCheck.legendTiming'), color: colors.line2, dashed: true },
  ];
  return (
    <OnboardingFrame
      step={3}
      title={t('phoneCheck.title')}
      subtitle={t('phoneCheck.subtitle')}
      footer={
        <>
          <NavButton label={t('phoneCheck.next')} href="/placement" />
          <Button
            label={t('phoneCheck.recheck')}
            variant="link"
            disabled={probe.kind === 'checking'}
            onPress={recheck}
          />
        </>
      }
    >
      <Card>
        <PhoneCheckDial
          camera={camera}
          locks={locks}
          caption={t('phoneCheck.dialCaption', { total: PHONE_CHECK_TOTAL })}
          accessibleLabel={t('phoneCheck.dialLabel', { points: camera + locks, total: PHONE_CHECK_TOTAL })}
        />
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            justifyContent: 'center',
            columnGap: spacing.md + 2,
            rowGap: spacing.xs,
          }}
        >
          {legend.map(({ name, color, dashed }) => (
            <View key={name} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 1 }}>
              <LegendDot color={color} dashed={dashed} />
              <AppText variant="caption1" tone="textDim" style={{ fontWeight: '600' }}>
                {name}
              </AppText>
            </View>
          ))}
        </View>
        <View style={{ marginTop: spacing.sm }}>
          <View
            accessibilityRole="progressbar"
            accessibilityLabel={t('phoneCheck.progressLabel')}
            accessibilityValue={{ min: 0, max: rows.length, now: checkedCount }}
            style={{
              height: BAR_HEIGHT,
              borderRadius: BAR_HEIGHT / 2,
              backgroundColor: colors.surface3,
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                width: `${(checkedCount / rows.length) * 100}%`,
                height: BAR_HEIGHT,
                backgroundColor: colors.accent,
              }}
            />
          </View>
          <AppText
            variant="caption"
            tone="textDim"
            style={{ marginTop: spacing.sm, fontVariant: ['tabular-nums'] }}
          >
            {ready
              ? t('phoneCheck.progressSettled', { done: checkedCount, total: rows.length })
              : t('phoneCheck.progress', { done: checkedCount, total: rows.length })}
          </AppText>
        </View>
      </Card>
      <Card flush>
        {rows.map(({ title, value, status }, index) => (
          <PhoneCheckRow
            key={title}
            icon={tiles[index]?.icon ?? 'camera'}
            tile={tiles[index] ?? tiles[0]}
            title={title}
            status={status}
            value={value}
            unchecked={probe.kind === 'unavailable'}
            markLabel={
              status === 'pass'
                ? t('phoneCheck.passed')
                : status === 'fail'
                  ? t('phoneCheck.failed')
                  : t('phoneCheck.notYet')
            }
            last={index === rows.length - 1}
          >
            {extras[index]}
          </PhoneCheckRow>
        ))}
      </Card>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.buttonFill,
            }}
          >
            <Icon name="hint" size={control.chevronSize} color={colors.onButtonFill} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <AppText variant="headline">{t('phoneCheck.capabilities')}</AppText>
            <AppText variant="subheadline" tone="textDim">
              {t('phoneCheck.nextStep')}
            </AppText>
            {probe.kind === 'unavailable' ? (
              <AppText variant="caption" tone="textFaint" style={{ marginTop: spacing.xs }}>
                {t('phoneCheck.probeUnavailable')}
              </AppText>
            ) : null}
          </View>
        </View>
        <NextSteps />
      </Card>
    </OnboardingFrame>
  );
}
