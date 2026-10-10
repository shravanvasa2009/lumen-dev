import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { ListRow } from '@/components/ListRow';
import { NavButton } from '@/components/NavButton';
import { RouteShell } from '@/components/RouteShell';
import { lockscreenStrings } from '@/i18n/lockscreen';
import { lockTextLines } from '@/settings/lockText';
import { CollapsibleSteps } from '@/settings/CollapsibleSteps';
import { SectionLabel } from '@/settings/SectionLabel';
import { Toggle } from '@/settings/Toggle';
import {
  AndroidLockPreview,
  LockCirclePreview,
  LockRectanglePreview,
  MediumWidgetPreview,
  SmallWidgetPreview,
} from '@/settings/WidgetPreviews';
import { setPreference, usePreferences } from '@/theme/preferences';
import { useTheme } from '@/theme';

// Sample numbers for the previews only; the real widgets read the saved snapshot (Appendix B).
const SAMPLE_BPM = 64;
const SAMPLE_HOURS_AGO = 2;

// Widgets mockup, "In the app": the previews, then "Hide values on widgets" and how to add them.
export default function WidgetsScreen() {
  const { t, i18n } = useTranslation();
  const { spacing } = useTheme();
  const { hideWidgetValues } = usePreferences();
  const lockText = lockscreenStrings(i18n.language);
  const upToDate = lockTextLines(lockText['widget.lock.upToDate']);
  const inline = lockText['widget.lock.nextCheck'].replace('{{time}}', t('widgets.sampleTime'));
  const lastCheck = t('widgets.lastCheck', { hours: SAMPLE_HOURS_AGO });
  const stepsTitle = (steps: readonly string[]) => t('widgets.stepsTitleCount', { steps: steps.length });
  const android = Platform.OS === 'android';
  const homeSteps = android
    ? [
        t('widgets.androidStep1'),
        t('widgets.androidStep2'),
        t('widgets.androidStep3'),
        t('widgets.androidStep4'),
      ]
    : [
        t('widgets.iphoneHomeStep1'),
        t('widgets.iphoneHomeStep2'),
        t('widgets.iphoneHomeStep3'),
        t('widgets.iphoneHomeStep4'),
        t('widgets.iphoneHomeStep5'),
      ];
  const small = (
    <SmallWidgetPreview status={upToDate.status} detail={lastCheck} action={t('widgets.checkNow')} />
  );

  return (
    <RouteShell title={t('widgets.title')}>
      <AppText variant="caption" tone="textDim">
        {t('widgets.sample')}
      </AppText>
      <SectionLabel>{android ? t('widgets.android') : t('widgets.iphoneHome')}</SectionLabel>
      {android ? (
        small
      ) : (
        <View style={[styles.smallRow, { gap: spacing.md }]}>
          {small}
          <AppText style={styles.smallNotes}>
            <AppText style={styles.lead}>{t('widgets.howToLead')}</AppText> {t('widgets.howToShort')}
          </AppText>
        </View>
      )}
      <MediumWidgetPreview
        name={upToDate.name}
        reading={hideWidgetValues ? null : String(SAMPLE_BPM)}
        unit={t('widgets.bpm')}
        status={upToDate.status}
        detail={lastCheck}
        checkNow={t('widgets.checkNow')}
        fullScan={t('mode.full')}
      />
      <SectionLabel>{android ? t('widgets.androidLock') : t('widgets.iphoneLock')}</SectionLabel>
      {android ? (
        <AndroidLockPreview
          name={upToDate.name}
          line={lockText['widget.lock.lastCheck'].replace('{{hours}}', String(SAMPLE_HOURS_AGO))}
          action={lockText['widget.lock.checkNow']}
        />
      ) : (
        <>
          <View style={[styles.lockRow, { gap: spacing.md }]}>
            <LockCirclePreview />
            <LockRectanglePreview name={upToDate.name} status={upToDate.status} />
          </View>
          <AppText tone="textDim">{t('widgets.inline', { text: inline })}</AppText>
        </>
      )}
      <Card flush>
        <ListRow
          title={t('notifications.hideValues')}
          last
          trailing={
            <Toggle
              label={t('notifications.hideValues')}
              value={hideWidgetValues}
              onValueChange={(hidden) => setPreference('hideWidgetValues', hidden)}
            />
          }
        />
      </Card>
      <CollapsibleSteps title={stepsTitle(homeSteps)} steps={homeSteps} />
      {android ? null : (
        <CollapsibleSteps
          title={t('widgets.stepsTitleLock')}
          steps={[
            t('widgets.iphoneLockStep1'),
            t('widgets.iphoneLockStep2'),
            t('widgets.iphoneLockStep3'),
            t('widgets.iphoneLockStep4'),
          ]}
        />
      )}
      <AppText variant="caption" tone="textDim">
        {t('widgets.buttons')}
      </AppText>
      {android ? null : (
        <NavButton
          label={t('widgets.lockScreenLink')}
          href="/settings/widgets/lock-screen"
          variant="secondary"
        />
      )}
    </RouteShell>
  );
}

const styles = StyleSheet.create({
  smallRow: { flexDirection: 'row', alignItems: 'flex-start' },
  smallNotes: { flex: 1 },
  lead: { fontWeight: '700' },
  lockRow: { flexDirection: 'row', alignItems: 'center' },
});
