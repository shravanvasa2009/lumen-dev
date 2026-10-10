import type { TFunction } from 'i18next';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { useTheme } from '@/theme';

// The acronym letters are the same in both languages; only the words under them are translated.
const signs = [
  { letter: 'B', word: (t: TFunction) => t('learn.stroke.h2') },
  { letter: 'E', word: (t: TFunction) => t('learn.stroke.h3') },
  { letter: 'F', word: (t: TFunction) => t('learn.stroke.h4') },
  { letter: 'A', word: (t: TFunction) => t('learn.stroke.h5') },
  { letter: 'S', word: (t: TFunction) => t('learn.stroke.h6') },
  { letter: 'T', word: (t: TFunction) => t('learn.beFastTime') },
] as const;

// Opens the Get help now screen, where Call 911 is one tap.
export function BeFastCard() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, control, radius, spacing } = useTheme();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={t('learn.beFastLabel')}
      onPress={() => router.push('/emergency')}
      style={{
        backgroundColor: colors.flagBg,
        borderRadius: radius.card,
        padding: spacing.lg,
        gap: spacing.md,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <Icon name="warning" size={22} color={colors.flag} />
        <AppText variant="headline" style={{ flex: 1 }}>
          {t('learn.lessonStroke')}
        </AppText>
        <Icon name="chevron" size={control.chevronSize} color={colors.textFaint} />
      </View>
      <View style={{ flexDirection: 'row' }}>
        {signs.map(({ letter, word }) => (
          <View key={letter} style={{ flex: 1, alignItems: 'center' }}>
            <AppText variant="title" style={{ color: colors.flag }}>
              {letter}
            </AppText>
            <AppText variant="caption" numberOfLines={1} adjustsFontSizeToFit>
              {word(t)}
            </AppText>
          </View>
        ))}
      </View>
      <AppText>{t('learn.beFastBody')}</AppText>
    </PressableScale>
  );
}
