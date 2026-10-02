import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { ListRow } from '@/components/ListRow';
import { NavButton } from '@/components/NavButton';
import { OnboardingStep } from '@/components/OnboardingStep';
import { usePhoneProbe, type PhoneProbe } from '@/onboarding/usePhoneProbe';
import { useTheme } from '@/theme';

// Spec §5.2: a rear camera that cannot reach 24 fps is a hard fail.
const MIN_FPS = 24;
const BAR_HEIGHT = 8;

type CapabilityRow = { title: string; value: string; passed: boolean };

// Frame timing is measured during practice (spec §5.1), so the probe alone never settles it.
function capabilityRows(probe: PhoneProbe, t: TFunction): CapabilityRow[] {
  const unchecked = (title: string): CapabilityRow => ({
    title,
    value: t('phoneCheck.notChecked'),
    passed: false,
  });
  if (probe.kind !== 'ready')
    return [
      unchecked(t('phoneCheck.cameraSpeed')),
      unchecked(t('phoneCheck.flashlight')),
      unchecked(t('phoneCheck.exposureLock')),
      unchecked(t('phoneCheck.frameTiming')),
      unchecked(t('phoneCheck.lenses')),
    ];
  const { rearLenses, torch, locks } = probe.capabilities;
  const fps = Math.max(0, ...rearLenses.map((lens) => lens.maxFps));
  const locked = [locks.exposure, locks.whiteBalance, locks.focus].filter(Boolean).length;
  const torchValue = torch.levels
    ? t('phoneCheck.torchAdjustable')
    : torch.available
      ? t('phoneCheck.torchOnOff')
      : t('phoneCheck.torchNone');
  const lockValue =
    locked === 3
      ? t('phoneCheck.locksAll')
      : locked === 0
        ? t('phoneCheck.locksNone')
        : t('phoneCheck.locksSome', { locked });
  return [
    { title: t('phoneCheck.cameraSpeed'), value: t('phoneCheck.fps', { fps }), passed: fps >= MIN_FPS },
    { title: t('phoneCheck.flashlight'), value: torchValue, passed: torch.available },
    { title: t('phoneCheck.exposureLock'), value: lockValue, passed: locked === 3 },
    { title: t('phoneCheck.frameTiming'), value: t('phoneCheck.timingLater'), passed: false },
    { title: t('phoneCheck.lenses'), value: String(rearLenses.length), passed: rearLenses.length > 0 },
  ];
}

export default function PhoneCheckScreen() {
  const { t } = useTranslation();
  const { colors, spacing, control } = useTheme();
  const probe = usePhoneProbe();
  const rows = capabilityRows(probe, t);
  const passedCount = rows.filter((row) => row.passed).length;
  return (
    <OnboardingStep
      step={3}
      title={t('phoneCheck.title')}
      subtitle={t('phoneCheck.subtitle')}
      footer={<NavButton label={t('phoneCheck.next')} href="/placement" />}
    >
      <Card flush>
        {rows.map(({ title, value, passed }, index) => (
          <ListRow
            key={title}
            title={title}
            last={index === rows.length - 1}
            leading={
              <View style={{ width: control.chevronSize }}>
                {passed ? <Icon name="check" size={control.chevronSize} color={colors.accent} /> : null}
              </View>
            }
            trailing={<AppText tone="textDim">{value}</AppText>}
          />
        ))}
      </Card>
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: rows.length, now: passedCount }}
        style={{ height: BAR_HEIGHT, borderRadius: BAR_HEIGHT / 2, backgroundColor: colors.surface3 }}
      >
        <View
          style={{
            width: `${(passedCount / rows.length) * 100}%`,
            height: BAR_HEIGHT,
            borderRadius: BAR_HEIGHT / 2,
            backgroundColor: colors.accent,
          }}
        />
      </View>
      <Card>
        <AppText variant="headline">{t('phoneCheck.capabilities')}</AppText>
        <AppText tone="textDim">{t('phoneCheck.nextStep')}</AppText>
        {probe.kind === 'unavailable' ? (
          <AppText variant="caption" tone="textFaint" style={{ marginTop: spacing.xs }}>
            {t('phoneCheck.probeUnavailable')}
          </AppText>
        ) : null}
      </Card>
    </OnboardingStep>
  );
}
