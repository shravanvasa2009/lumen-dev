import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { LumenLockup } from '@/components/LumenLockup';
import { NavButton } from '@/components/NavButton';
import { Screen } from '@/components/Screen';
import { useTheme } from '@/theme';

const LOCKUP_WIDTH = 290;

export default function WelcomeScreen() {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  return (
    <Screen
      headerless
      centered
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
      <View style={{ alignItems: 'center', gap: spacing.lg }}>
        <LumenLockup width={LOCKUP_WIDTH} />
        <AppText accessibilityRole="header" style={styles.screenReaderOnly}>
          {t('app.name')}
        </AppText>
        <AppText variant="headline" tone="textDim" style={[styles.centeredText, styles.tagline]}>
          {t('app.tagline')}
        </AppText>
      </View>
    </Screen>
  );
}

// The lockup is a drawing, so the app name is also given to screen readers as the screen heading.
const styles = StyleSheet.create({
  screenReaderOnly: { position: 'absolute', width: 1, height: 1, overflow: 'hidden' },
  centeredText: { textAlign: 'center' },
  tagline: { fontWeight: '400' },
});
