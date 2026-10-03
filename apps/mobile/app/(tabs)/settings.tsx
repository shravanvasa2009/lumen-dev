import Constants from 'expo-constants';
import { type Href, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ListRow } from '@/components/ListRow';
import { RouteShell } from '@/components/RouteShell';
import { useDemoActive } from '@/demo/demoSession';
import { useStartDemo } from '@/demo/useStartDemo';
import { shareReadingsCsv } from '@/export/shareReadings';
import { tierLabel } from '@/rating/labels';
import { AboutCard } from '@/settings/AboutCard';
import { LanguagePicker } from '@/settings/LanguagePicker';
import { deleteAllData } from '@/store/deleteAllData';
import { useStoredRating } from '@/store/useStoredRating';
import { usePreferences } from '@/theme/preferences';

// Seven quick taps open Lab mode; a pause longer than this starts the count over.
const LAB_TAPS = 7;
const LAB_TAP_WINDOW_MS = 2000;

type SettingsRow = {
  title: string;
  value?: string;
  href?: Href;
  onPress?: () => void;
  expanded?: boolean;
  busy?: boolean;
};

type DeleteStep = 'idle' | 'confirming' | 'deleting' | 'failed';
type ExportStep = 'idle' | 'busy' | 'empty' | 'unavailable' | 'failed';
type OpenPanel = 'language' | 'about' | null;

export default function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { appearance } = usePreferences();
  const rating = useStoredRating();
  const versionTaps = useRef({ count: 0, at: 0 });
  const [deleteStep, setDeleteStep] = useState<DeleteStep>('idle');
  const [exportStep, setExportStep] = useState<ExportStep>('idle');
  const [panel, setPanel] = useState<OpenPanel>(null);
  const startDemo = useStartDemo();
  const exportMessages = {
    empty: t('settings.exportEmpty'),
    unavailable: t('settings.exportUnavailable'),
    failed: t('settings.exportFailed'),
  };

  const appearanceNames = {
    system: t('appearance.segmentSystem'),
    light: t('appearance.light'),
    dark: t('appearance.dark'),
  };
  const accountRows: readonly SettingsRow[] = [
    { title: t('settings.profile'), href: '/profile' },
    {
      title: t('notifications.title'),
      value: t('settings.notActiveYet'),
      href: '/settings/notifications',
    },
    { title: t('appearance.title'), value: appearanceNames[appearance], href: '/settings/appearance' },
    {
      title: t('settings.language'),
      value: i18n.language === 'es' ? t('language.es') : t('language.en'),
      expanded: panel === 'language',
      onPress: () => setPanel(panel === 'language' ? null : 'language'),
    },
  ];
  const accuracyRows: readonly SettingsRow[] = [
    { title: t('settings.accuracy'), href: '/settings/accuracy' },
  ];
  const demo = useDemoActive();
  const phoneRows: readonly SettingsRow[] = [
    {
      title: t('settings.phone'),
      value:
        rating === undefined
          ? undefined
          : rating === null
            ? t('settings.phoneNotTested')
            : t('settings.phoneRated', { tier: tierLabel(t, rating.tier), score: rating.score }),
      href: '/settings/phone',
    },
    { title: t('settings.widgets'), href: '/settings/widgets' },
    // Onboarding cannot finish in demo, so Replay tutorial would be a dead end there.
    ...(demo ? [] : [{ title: t('settings.replayTutorial'), href: '/welcome' }]),
    // Already in a demo, so the row would only restart it.
    ...(demo ? [] : [{ title: t('settings.demoMode'), onPress: startDemo }]),
  ];
  const dataRows: readonly SettingsRow[] = [
    {
      title: t('settings.export'),
      busy: exportStep === 'busy',
      onPress: () => void exportReadings(),
    },
    {
      title: t('settings.delete'),
      expanded: deleteStep !== 'idle',
      busy: deleteStep === 'deleting',
      onPress: () => setDeleteStep(deleteStep === 'idle' ? 'confirming' : 'idle'),
    },
    {
      title: t('settings.about'),
      expanded: panel === 'about',
      onPress: () => setPanel(panel === 'about' ? null : 'about'),
    },
  ];

  function countVersionTap() {
    const now = Date.now();
    const inStreak = now - versionTaps.current.at <= LAB_TAP_WINDOW_MS;
    const count = inStreak ? versionTaps.current.count + 1 : 1;
    versionTaps.current = { count: count === LAB_TAPS ? 0 : count, at: now };
    if (count === LAB_TAPS) router.push('/settings/lab');
  }

  // The share sheet is the only way out: Lumen sends nothing itself. Closing it without sending is not an error.
  async function exportReadings() {
    setExportStep('busy');
    try {
      const outcome = await shareReadingsCsv();
      setExportStep(outcome === 'shared' ? 'idle' : outcome);
    } catch {
      setExportStep('failed');
    }
  }

  // Deleting is two steps: the row opens the confirmation, and only its own button deletes. A failure is
  // shown, never hidden, because the person has to know whether their data is gone.
  async function deleteEverything() {
    setDeleteStep('deleting');
    try {
      await deleteAllData(i18n.language);
    } catch {
      setDeleteStep('failed');
      return;
    }
    router.replace('/welcome');
  }

  function renderRows(rows: readonly SettingsRow[]) {
    return rows.map(({ title, value, href, onPress, expanded, busy }, index) => {
      return (
        <ListRow
          key={title}
          title={title}
          last={index === rows.length - 1}
          chevron={href !== undefined}
          disabled={busy}
          expanded={expanded}
          trailing={value ? <AppText tone="textDim">{value}</AppText> : undefined}
          onPress={onPress ?? (href === undefined ? undefined : () => router.push(href))}
        />
      );
    });
  }

  return (
    <RouteShell tabRoot title={t('settings.title')}>
      <Card flush>{renderRows(accountRows)}</Card>
      {panel === 'language' ? <LanguagePicker /> : null}
      <Card flush>{renderRows(accuracyRows)}</Card>
      <Card flush>{renderRows(phoneRows)}</Card>
      <Card flush>{renderRows(dataRows)}</Card>
      {exportStep === 'idle' || exportStep === 'busy' ? null : (
        <AppText accessibilityRole="alert" tone="textDim">
          {exportMessages[exportStep]}
        </AppText>
      )}
      {panel === 'about' ? <AboutCard /> : null}
      {deleteStep === 'idle' ? null : (
        <Card>
          <AppText variant="headline">{t('settings.deleteConfirmTitle')}</AppText>
          <AppText tone="textDim">{t('settings.deleteConfirmBody')}</AppText>
          {deleteStep === 'failed' ? (
            <AppText accessibilityRole="alert">{t('settings.deleteFailed')}</AppText>
          ) : null}
          <Button
            label={deleteStep === 'deleting' ? t('settings.deleting') : t('settings.deleteConfirm')}
            disabled={deleteStep === 'deleting'}
            onPress={() => void deleteEverything()}
          />
          <Button
            label={t('settings.deleteCancel')}
            variant="link"
            disabled={deleteStep === 'deleting'}
            onPress={() => setDeleteStep('idle')}
          />
        </Card>
      )}
      <Pressable accessibilityRole="button" onPress={countVersionTap}>
        <AppText variant="caption" tone="textFaint" style={{ textAlign: 'center' }}>
          {t('settings.version', { version: Constants.expoConfig?.version ?? '' })}
        </AppText>
      </Pressable>
    </RouteShell>
  );
}
