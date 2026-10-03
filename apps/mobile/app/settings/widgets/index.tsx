import { useTranslation } from 'react-i18next';
import { Platform, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { NavButton } from '@/components/NavButton';
import { RouteShell } from '@/components/RouteShell';
import { lockscreenStrings } from '@/i18n/lockscreen';
import { lockTextLines } from '@/settings/lockText';
import { NumberedSteps } from '@/settings/NumberedSteps';
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
  const stepsTitle = (
    <AppText variant="headline" accessibilityRole="header">
      {t('widgets.stepsTitle')}
    </AppText>
  );
  // The Lock Screen list gets its own heading so a screen reader doesn't hear "How to add" twice.
  const lockStepsTitle = (
    <AppText variant="headline" accessibilityRole="header">
      {t('widgets.stepsTitleLock')}
    </AppText>
  );
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
        {stepsTitle}
        <NumberedSteps
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
      <SmallWidgetPreview status={upToDate.status} detail={lastCheck} action={t('widgets.checkNow')} />
      <MediumWidgetPreview
        name={upToDate.name}
        reading={reading}
        unit={t('widgets.bpm')}
        status={`${upToDate.status} · ${streak}`}
        checkNow={t('widgets.checkNow')}
        fullScan={t('mode.full')}
      />
      {stepsTitle}
      <NumberedSteps
        steps={[
          t('widgets.iphoneHomeStep1'),
          t('widgets.iphoneHomeStep2'),
          t('widgets.iphoneHomeStep3'),
          t('widgets.iphoneHomeStep4'),
          t('widgets.iphoneHomeStep5'),
        ]}
      />
      {buttonsNote}
      <SectionLabel>{t('widgets.iphoneLock')}</SectionLabel>
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <LockCirclePreview />
        <LockRectanglePreview name={checkAgain.name} status={checkAgain.status} />
      </View>
      <AppText tone="textDim">{t('widgets.inline', { text: inline })}</AppText>
      {lockStepsTitle}
      <NumberedSteps
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
