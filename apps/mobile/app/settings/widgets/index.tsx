import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { NavButton } from '@/components/NavButton';
import { RouteShell } from '@/components/RouteShell';
import { lockscreenStrings } from '@/i18n/lockscreen';
import { lockTextLines } from '@/settings/lockText';
import { usePreferences } from '@/settings/preferences';
import { SectionLabel } from '@/settings/SectionLabel';
import {
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
  return (
    <RouteShell title={t('widgets.title')}>
      <SectionLabel>{t('widgets.iphoneHome')}</SectionLabel>
      <View style={{ flexDirection: 'row', gap: spacing.lg }}>
        <SmallWidgetPreview
          status={upToDate.status}
          detail={t('widgets.lastCheck', { hours: SAMPLE_HOURS_AGO })}
          action={t('widgets.checkNow')}
        />
        <View style={{ flex: 1, gap: spacing.md }}>
          <AppText variant="caption" tone="textDim">
            {t('widgets.howToAdd')}
          </AppText>
          <AppText variant="caption" tone="textDim">
            {t('widgets.buttons')}
          </AppText>
        </View>
      </View>
      <MediumWidgetPreview
        name={upToDate.name}
        reading={hideWidgetValues ? '—' : String(SAMPLE_BPM)}
        unit={t('widgets.bpm')}
        status={`${upToDate.status} · ${t('widgets.streak', { days: SAMPLE_STREAK_DAYS })}`}
        checkNow={t('widgets.checkNow')}
        fullScan={t('mode.full')}
      />
      <SectionLabel>{t('widgets.iphoneLock')}</SectionLabel>
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <LockCirclePreview />
        <LockRectanglePreview name={checkAgain.name} status={checkAgain.status} />
      </View>
      <AppText tone="textDim">{t('widgets.inline', { text: inline })}</AppText>
      <SectionLabel>{t('widgets.android')}</SectionLabel>
      <AppText tone="textDim">{t('widgets.androidBody')}</AppText>
      <AppText variant="caption" tone="textFaint">
        {t('widgets.sample')}
      </AppText>
      <NavButton
        label={t('widgets.lockScreenLink')}
        href="/settings/widgets/lock-screen"
        variant="secondary"
      />
    </RouteShell>
  );
}
