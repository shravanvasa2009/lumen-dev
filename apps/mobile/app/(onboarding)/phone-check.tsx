import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { ListRow } from '@/components/ListRow';
import { NavButton } from '@/components/NavButton';
import { OnboardingStep } from '@/components/OnboardingStep';
import { useReduceMotion } from '@/onboarding/useReduceMotion';
import { usePhoneProbe, type PhoneProbe } from '@/onboarding/usePhoneProbe';
import { useTheme } from '@/theme';

// Spec §5.2: a rear camera that cannot reach 24 fps is a hard fail.
const MIN_FPS = 24;
const BAR_HEIGHT = 8;

type RowStatus = 'pass' | 'fail' | 'pending' | 'checking';
type CapabilityRow = { title: string; value: string; status: RowStatus };

// The tick fills the whole icon column; the dot and ring are smaller so they read as a state, not an icon.
const MARK_DIAMETER = 12;
const MARK_RING = 2;

// Colour alone never carries the state: each mark has its own shape (tick, dot, ring). Red is reserved
// for the emergency screen, so a failed row uses the flag colour.
function StatusMark({ status }: { status: RowStatus }) {
  const { colors, control } = useTheme();
  const reduceMotion = useReduceMotion();
  const showSpinner = status === 'checking' && !reduceMotion;
  return (
    <View style={{ width: control.chevronSize, alignItems: 'center' }}>
      {status === 'pass' ? (
        <Icon name="check" size={control.chevronSize} color={colors.accent} />
      ) : showSpinner ? (
        <ActivityIndicator size="small" color={colors.textFaint} />
      ) : (
        <View
          style={{
            width: MARK_DIAMETER,
            height: MARK_DIAMETER,
            borderRadius: MARK_DIAMETER / 2,
            borderWidth: MARK_RING,
            borderColor: status === 'fail' ? colors.flag : colors.textFaint,
            backgroundColor: status === 'fail' ? colors.flag : 'transparent',
          }}
        />
      )}
    </View>
  );
}

// Frame timing is measured during practice (spec §5.1), so the probe alone never settles it.
function capabilityRows(probe: PhoneProbe, t: TFunction): CapabilityRow[] {
  const unchecked = (title: string): CapabilityRow =>
    probe.kind === 'checking'
      ? { title, value: t('phoneCheck.checking'), status: 'checking' }
      : { title, value: t('phoneCheck.notChecked'), status: 'pending' };
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
    {
      title: t('phoneCheck.cameraSpeed'),
      value: t('phoneCheck.fps', { fps }),
      status: fps >= MIN_FPS ? 'pass' : 'fail',
    },
    { title: t('phoneCheck.flashlight'), value: torchValue, status: torch.available ? 'pass' : 'fail' },
    { title: t('phoneCheck.exposureLock'), value: lockValue, status: locked === 3 ? 'pass' : 'fail' },
    { title: t('phoneCheck.frameTiming'), value: t('phoneCheck.timingLater'), status: 'pending' },
    {
      title: t('phoneCheck.lenses'),
      value: String(rearLenses.length),
      status: rearLenses.length > 0 ? 'pass' : 'fail',
    },
  ];
}

export default function PhoneCheckScreen() {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const probe = usePhoneProbe();
  const rows = capabilityRows(probe, t);
  const passedCount = rows.filter((row) => row.status === 'pass').length;
  return (
    <OnboardingStep
      step={3}
      title={t('phoneCheck.title')}
      subtitle={t('phoneCheck.subtitle')}
      footer={<NavButton label={t('phoneCheck.next')} href="/placement" />}
    >
      <Card flush>
        {rows.map(({ title, value, status }, index) => (
          <ListRow
            key={title}
            title={title}
            last={index === rows.length - 1}
            leading={<StatusMark status={status} />}
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
