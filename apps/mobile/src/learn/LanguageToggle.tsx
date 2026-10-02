import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme';

// Switches the app language for the session; the language row in Settings owns any saved choice.
export function LanguageToggle() {
  const { t, i18n } = useTranslation();
  const { colors, radius, spacing, control } = useTheme();
  const choices = [
    { code: 'en', short: t('learn.langEn'), name: t('learn.langEnglish') },
    { code: 'es', short: t('learn.langEs'), name: t('learn.langSpanish') },
  ];
  return (
    <View
      accessibilityRole="radiogroup"
      style={[
        styles.group,
        {
          backgroundColor: colors.surface2,
          borderColor: colors.line,
          borderRadius: radius.card,
          padding: spacing.xs,
        },
      ]}
    >
      {choices.map(({ code, short, name }) => {
        const selected = i18n.language === code;
        return (
          <Pressable
            key={code}
            accessibilityRole="radio"
            accessibilityLabel={name}
            accessibilityState={{ checked: selected }}
            onPress={() => void i18n.changeLanguage(code)}
            style={[
              styles.choice,
              {
                minHeight: control.minTarget - spacing.sm,
                paddingHorizontal: spacing.lg,
                borderRadius: radius.card - spacing.xs,
                backgroundColor: selected ? colors.surface3 : 'transparent',
              },
            ]}
          >
            <AppText tone={selected ? 'text' : 'textDim'}>{short}</AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { flexDirection: 'row', borderWidth: 1 },
  choice: { alignItems: 'center', justifyContent: 'center' },
});
