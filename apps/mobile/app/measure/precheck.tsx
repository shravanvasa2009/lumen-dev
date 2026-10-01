import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { NavButton } from '@/components/NavButton';
import { RouteShell } from '@/components/RouteShell';
import { parseMode } from '@/measure/mode';

export default function PrecheckScreen() {
  const { t } = useTranslation();
  const mode = parseMode(useLocalSearchParams<{ mode?: string }>().mode);
  return (
    <RouteShell
      title={t('precheck.title')}
      sections={[
        { heading: t('precheck.rest') },
        {
          heading: t('precheck.lastHours'),
          lines: [
            t('precheck.caffeine'),
            t('precheck.exercise'),
            t('precheck.ill'),
            t('precheck.medication'),
          ],
        },
        {
          heading: t('precheck.reminders'),
          lines: [t('precheck.reminderFlat'), t('precheck.reminderElbows'), t('precheck.reminderWarm')],
        },
      ]}
    >
      <NavButton label={t('precheck.start')} href={`/measure/capture?mode=${mode}`} />
    </RouteShell>
  );
}
