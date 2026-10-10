import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { useTheme } from '@/theme';

const PILL_HEIGHT = 36;
const HIT_SLOP = 4;

// The mode Measure will start with; tapping it opens the mode list.
export function ModePill({ mode }: { mode: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, spacing, radius } = useTheme();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={t('home.changeModeFor', { mode })}
      hitSlop={HIT_SLOP}
      onPress={() => router.push('/measure/mode')}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        height: PILL_HEIGHT,
        paddingLeft: spacing.md + 2,
        paddingRight: spacing.md,
        borderRadius: radius.pill,
        backgroundColor: colors.surface2,
      }}
    >
      <AppText style={{ fontSize: 15, lineHeight: 20, fontWeight: '600' }}>{mode}</AppText>
      <Icon name="updown" size={14} color={colors.textDim} />
    </PressableScale>
  );
}
