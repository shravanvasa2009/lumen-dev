import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { NavButton } from '@/components/NavButton';
import { RouteShell } from '@/components/RouteShell';
import { parseMode } from '@/measure/mode';

export default function InconclusiveScreen() {
  const { t } = useTranslation();
  const mode = parseMode(useLocalSearchParams<{ mode?: string }>().mode);
  return (
    <RouteShell
      title={t('result.inconclusive')}
      sections={[
        {
          heading: t('inconclusive.where'),
          lines: [t('inconclusive.movement'), t('inconclusive.pressure'), t('inconclusive.light')],
        },
        { heading: t('inconclusive.tipElbows'), lines: [t('inconclusive.tipBreathe')] },
      ]}
    >
      <NavButton label={t('inconclusive.retake')} href={`/measure/capture?mode=${mode}`} replace />
      <NavButton
        label={t('inconclusive.fix')}
        href={`/measure/fix-technique?mode=${mode}`}
        variant="secondary"
      />
      <NavButton
        label={t('inconclusive.tryQuick')}
        href="/measure/capture?mode=quick"
        variant="secondary"
        replace
      />
    </RouteShell>
  );
}
