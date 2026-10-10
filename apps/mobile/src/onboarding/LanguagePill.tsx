import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { useTheme } from '@/theme';

const LANGUAGES = ['en', 'es'] as const;

function Globe({ color }: { color: string }) {
  return (
    <Svg width={17} height={17} viewBox="0 0 24 24" fill="none" accessibilityElementsHidden>
      <Circle cx={12} cy={12} r={8.75} stroke={color} strokeWidth={2} />
      <Path d="M3.25 12h17.5" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Path
        d="M12 3.25c2.4 2.4 3.6 5.3 3.6 8.75s-1.2 6.35-3.6 8.75c-2.4-2.4-3.6-5.3-3.6-8.75S9.6 5.65 12 3.25Z"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// Welcome's language menu: a pill with the current language that opens the two choices beneath it.
export function LanguagePill() {
  const { t, i18n } = useTranslation();
  const { colors, spacing, radius, control } = useTheme();
  const [open, setOpen] = useState(false);
  const current = i18n.language === 'es' ? 'es' : 'en';
  const languageName = { en: t('language.en'), es: t('language.es') };
  return (
    <View style={{ alignItems: 'flex-end', gap: spacing.sm }}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t('language.label')}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((was) => !was)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          height: control.minTarget,
          paddingHorizontal: spacing.md,
          borderRadius: radius.pill,
          backgroundColor: colors.surface,
          borderColor: colors.line,
          borderWidth: 1,
        }}
      >
        <Globe color={colors.text} />
        <AppText variant="headline" style={{ fontSize: 15 }}>
          {languageName[current]}
        </AppText>
        <View style={{ transform: [{ rotate: open ? '-90deg' : '90deg' }] }}>
          <Icon name="chevron" size={14} color={colors.textDim} />
        </View>
      </PressableScale>
      {open ? (
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={t('language.label')}
          style={{
            backgroundColor: colors.surface,
            borderColor: colors.line,
            borderWidth: 1,
            borderRadius: radius.card,
            overflow: 'hidden',
          }}
        >
          {LANGUAGES.map((code) => (
            <PressableScale
              key={code}
              accessibilityRole="radio"
              accessibilityState={{ checked: current === code }}
              onPress={() => {
                void i18n.changeLanguage(code);
                setOpen(false);
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
                minHeight: control.minTarget,
                paddingHorizontal: spacing.lg,
              }}
            >
              <AppText tone={current === code ? 'accent' : 'text'}>{languageName[code]}</AppText>
              {current === code ? <Icon name="check" size={16} color={colors.accent} /> : null}
            </PressableScale>
          ))}
        </View>
      ) : null}
    </View>
  );
}
