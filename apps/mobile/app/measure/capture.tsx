import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { NavButton } from '@/components/NavButton';
import { RouteShell } from '@/components/RouteShell';
import { parseMode } from '@/measure/mode';

export default function CaptureScreen() {
  const { t } = useTranslation();
  const mode = parseMode(useLocalSearchParams<{ mode?: string }>().mode);
  return (
    <RouteShell
      title={mode === 'quick' ? t('mode.quick') : t('mode.full')}
      sections={[
        {
          heading: t('capture.pulse'),
          lines: [t('capture.finger'), t('capture.still'), t('capture.pressure')],
        },
      ]}
    >
      <NavButton label={t('capture.finish')} href="/measure/processing" />
      <NavButton
        label={t('capture.noSignal')}
        href={`/measure/inconclusive?mode=${mode}`}
        variant="secondary"
      />
    </RouteShell>
  );
}
