import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { NavButton } from '@/components/NavButton';
import { RouteShell } from '@/components/RouteShell';
import { lockscreenStrings } from '@/i18n/lockscreen';
import { lockTextLines } from '@/settings/lockText';
import { CollapsibleSteps } from '@/settings/CollapsibleSteps';
import { usePreferences } from '@/theme/preferences';
import { SectionLabel } from '@/settings/SectionLabel';
import {
  AndroidMediumWidgetPreview,
  AndroidSmallWidgetPreview,
  LockCirclePreview,
  LockRectanglePreview,
  MediumWidgetPreview,
  SmallWidgetPreview,
} from '@/settings/WidgetPreviews';
import { useTheme } from '@/theme';

// Sample numbers for the previews only; the real widgets read the saved snapshot (Appendix B).
const SAMPLE_BPM = 64;
const SAMPLE_STREAK_DAYS = 5;
const SAMPLE_HOURS_AGO = 2;
const IPHONE_HOME_STEPS = 5;
const ANDROID_STEPS = 4;

export default function WidgetsScreen() {
  const { t, i18n } = useTranslation();
  const { spacing } = useTheme();
  const { hideWidgetValues } = usePreferences();
  const lockText = lockscreenStrings(i18n.language);
  const upToDate = lockTextLines(lockText['widget.lock.upToDate']);
  const checkAgain = lockTextLines(lockText['widget.lock.checkAgain']);
  const inline = lockText['widget.lock.nextCheck'].replace('{{time}}', t('widgets.sampleTime'));
  const reading = hideWidgetValues ? '—' : String(SAMPLE_BPM);
  const lastCheck = t('widgets.lastCheck', { hours: SAMPLE_HOURS_AGO });
  const streak = t('widgets.streak', { days: SAMPLE_STREAK_DAYS });
  const stepsTitle = (steps: number) => t('widgets.stepsTitleCount', { steps });
  const buttonsNote = (
    <AppText variant="caption" tone="textDim">
      {t('widgets.buttons')}
    </AppText>
  );

  if (Platform.OS === 'android') {
    return (
      <RouteShell title={t('widgets.title')}>
        <AppText variant="caption" tone="textDim">
          {t('widgets.sample')}
        </AppText>
        <SectionLabel>{t('widgets.android')}</SectionLabel>
        <AndroidSmallWidgetPreview
          name={upToDate.name}
          status={upToDate.status}
          lastCheck={lastCheck}
          checkNow={t('widgets.checkNow')}
        />
        <AndroidMediumWidgetPreview
          name={upToDate.name}
          reading={hideWidgetValues ? null : String(SAMPLE_BPM)}
          unit={t('widgets.bpm')}
          status={upToDate.status}
          lastCheck={lastCheck}
          streak={streak}
          checkNow={t('widgets.checkNow')}
          fullScan={t('mode.full')}
        />
        <CollapsibleSteps
          title={stepsTitle(ANDROID_STEPS)}
          steps={[
            t('widgets.androidStep1'),
            t('widgets.androidStep2'),
            t('widgets.androidStep3'),
            t('widgets.androidStep4'),
          ]}
        />
        {buttonsNote}
      </RouteShell>
    );
  }

  return (
    <RouteShell title={t('widgets.title')}>
      <AppText variant="caption" tone="textDim">
        {t('widgets.sample')}
      </AppText>
      <SectionLabel>{t('widgets.iphoneHome')}</SectionLabel>
      <View style={[styles.smallRow, { gap: spacing.md }]}>
        <SmallWidgetPreview status={upToDate.status} detail={lastCheck} action={t('widgets.checkNow')} />
        <View style={[styles.smallNotes, { gap: spacing.md }]}>
          <AppText>
            <AppText style={styles.lead}>{t('widgets.howToLead')}</AppText> {t('widgets.howToShort')}
          </AppText>
          {buttonsNote}
        </View>
      </View>
      <MediumWidgetPreview
        name={upToDate.name}
        reading={reading}
        unit={t('widgets.bpm')}
        status={`${upToDate.status} · ${streak}`}
        checkNow={t('widgets.checkNow')}
        fullScan={t('mode.full')}
      />
      <CollapsibleSteps
        title={stepsTitle(IPHONE_HOME_STEPS)}
        steps={[
          t('widgets.iphoneHomeStep1'),
          t('widgets.iphoneHomeStep2'),
          t('widgets.iphoneHomeStep3'),
          t('widgets.iphoneHomeStep4'),
          t('widgets.iphoneHomeStep5'),
        ]}
      />
      <SectionLabel>{t('widgets.iphoneLock')}</SectionLabel>
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <LockCirclePreview />
        <LockRectanglePreview name={checkAgain.name} status={checkAgain.status} />
      </View>
      <AppText tone="textDim">{t('widgets.inline', { text: inline })}</AppText>
      <CollapsibleSteps
        title={t('widgets.stepsTitleLock')}
        steps={[
          t('widgets.iphoneLockStep1'),
          t('widgets.iphoneLockStep2'),
          t('widgets.iphoneLockStep3'),
          t('widgets.iphoneLockStep4'),
        ]}
      />
      <NavButton
        label={t('widgets.lockScreenLink')}
        href="/settings/widgets/lock-screen"
        variant="secondary"
      />
    </RouteShell>
  );
}

const styles = StyleSheet.create({
  smallRow: { flexDirection: 'row', alignItems: 'flex-start' },
  smallNotes: { flex: 1 },
  lead: { fontWeight: '700' },
});
