import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { NavButton } from '@/components/NavButton';
import { RouteShell } from '@/components/RouteShell';
import { parseMode } from '@/measure/mode';

export default function FixTechniqueScreen() {
  const { t } = useTranslation();
  const mode = parseMode(useLocalSearchParams<{ mode?: string }>().mode);
  return (
    <RouteShell
      title={t('fix.title')}
      sections={[
        { heading: t('fix.tooHard') },
        { heading: t('fix.justRight') },
        {
          heading: t('fix.tryCover'),
          lines: [t('signal.weak'), t('signal.ok'), t('signal.strong'), t('fix.steady')],
        },
      ]}
    >
      <NavButton label={t('fix.done')} href={`/measure/capture?mode=${mode}`} replace />
    </RouteShell>
  );
}
