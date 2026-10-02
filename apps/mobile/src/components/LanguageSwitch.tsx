import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { useTheme } from '@/theme';

import { AppText } from './AppText';

export function LanguageSwitch() {
  const { t, i18n } = useTranslation();
  const { spacing, control } = useTheme();
  const languages = [
    { code: 'en', name: t('language.en') },
    { code: 'es', name: t('language.es') },
  ];
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={t('language.label')}
      style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: spacing.sm }}
    >
      {languages.map(({ code, name }, index) => (
        <View key={code} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          {index > 0 ? <AppText tone="textDim">·</AppText> : null}
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ checked: i18n.language === code }}
            hitSlop={(control.minTarget - 24) / 2}
            onPress={() => void i18n.changeLanguage(code)}
          >
            <AppText tone={i18n.language === code ? 'textDim' : 'accent'}>{name}</AppText>
          </Pressable>
        </View>
      ))}
    </View>
  );
}
