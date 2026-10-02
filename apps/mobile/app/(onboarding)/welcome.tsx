import { useTranslation } from 'react-i18next';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { AppText } from '@/components/AppText';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { LumenLockup } from '@/components/LumenLockup';
import { NavButton } from '@/components/NavButton';
import { Screen } from '@/components/Screen';
import { useTheme } from '@/theme';

// Mockup 01 draws the lockup at 73% of the screen width and the tagline at 20 pt, wrapping inside 300.
const LOCKUP_SCREEN_SHARE = 0.73;
const TAGLINE_MAX_WIDTH = 300;
// The mockup centres the group slightly above the middle of the space over the buttons (45%).
const SPACE_ABOVE_GROUP = 9;
const SPACE_BELOW_GROUP = 11;

export default function WelcomeScreen() {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const { width: screenWidth } = useWindowDimensions();
  return (
    <Screen
      headerless
      footer={
        <>
          <NavButton label={t('welcome.getStarted')} href="/consent" />
          <NavButton label={t('welcome.tryDemo')} href="/" variant="secondary" replace />
          <LanguageSwitch />
          <AppText variant="caption" tone="textFaint" style={styles.centeredText}>
            {t('welcome.footer')}
          </AppText>
        </>
      }
    >
      <View style={styles.body}>
        <View style={{ flex: SPACE_ABOVE_GROUP }} />
        <View style={[styles.group, { gap: spacing.lg }]}>
          <LumenLockup width={screenWidth * LOCKUP_SCREEN_SHARE} />
          <AppText accessibilityRole="header" style={styles.screenReaderOnly}>
            {t('app.name')}
          </AppText>
          <AppText variant="headline" tone="textDim" style={[styles.centeredText, styles.tagline]}>
            {t('app.tagline')}
          </AppText>
        </View>
        <View style={{ flex: SPACE_BELOW_GROUP }} />
      </View>
    </Screen>
  );
}

// The lockup is a drawing, so the app name is also given to screen readers as the screen heading.
const styles = StyleSheet.create({
  screenReaderOnly: { position: 'absolute', width: 1, height: 1, overflow: 'hidden' },
  body: { flex: 1 },
  group: { alignItems: 'center' },
  centeredText: { textAlign: 'center' },
  tagline: { fontWeight: '400', fontSize: 20, lineHeight: 28, maxWidth: TAGLINE_MAX_WIDTH },
});
