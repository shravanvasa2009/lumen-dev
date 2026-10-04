import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { AppText } from '@/components/AppText';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { LumenLockup } from '@/components/LumenLockup';
import { NavButton } from '@/components/NavButton';
import { Screen } from '@/components/Screen';
import { TryDemoButton } from '@/demo/TryDemoButton';
import { FourChecks } from '@/onboarding/FourChecks';
import { useTheme } from '@/theme';

// Mockup 01 v2 draws the lockup at 73% of the screen width and the tagline at 20 pt.
const LOCKUP_SCREEN_SHARE = 0.73;
// Below this window height (a 360 x 640 phone) the drawn lockup shrinks and the check tiles go compact; text keeps its size.
const COMPACT_HEIGHT = 700;
const COMPACT_LOCKUP_SHARE = 0.45;
const TAGLINE_MAX_WIDTH = 300;

export default function WelcomeScreen() {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const compact = screenHeight < COMPACT_HEIGHT;
  return (
    <Screen
      headerless
      footer={
        <>
          <NavButton label={t('welcome.getStarted')} href="/consent" />
          <TryDemoButton />
          <LanguageSwitch />
          <AppText variant="caption" tone="textFaint" style={styles.centeredText}>
            {t('welcome.footer')}
          </AppText>
        </>
      }
    >
      <ScrollView
        contentContainerStyle={[styles.body, { gap: compact ? spacing.md : spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.group, { gap: spacing.md }]}>
          <LumenLockup width={screenWidth * (compact ? COMPACT_LOCKUP_SHARE : LOCKUP_SCREEN_SHARE)} />
          <AppText accessibilityRole="header" style={styles.screenReaderOnly}>
            {t('app.name')}
          </AppText>
          <AppText variant="headline" tone="textDim" style={[styles.centeredText, styles.tagline]}>
            {t('app.tagline')}
          </AppText>
        </View>
        <FourChecks compact={compact} />
      </ScrollView>
    </Screen>
  );
}

// The lockup is a drawing, so the app name is also given to screen readers as the screen heading.
const styles = StyleSheet.create({
  screenReaderOnly: { position: 'absolute', width: 1, height: 1, overflow: 'hidden' },
  body: { flexGrow: 1, justifyContent: 'center' },
  group: { alignItems: 'center' },
  centeredText: { textAlign: 'center' },
  tagline: { fontWeight: '400', fontSize: 20, lineHeight: 28, maxWidth: TAGLINE_MAX_WIDTH },
});
