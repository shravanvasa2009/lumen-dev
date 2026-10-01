import { useTranslation } from 'react-i18next';

import { RouteShell } from '@/components/RouteShell';
import { LabPanel } from '@/dev/LabPanel';

import { LumenCapture } from '../../modules/lumen-capture/src';

export default function LabScreen() {
  const { t } = useTranslation();
  return (
    <RouteShell
      title={t('lab.title')}
      subtitle={t('lab.badge')}
      sections={[{ heading: t('lab.rawRgb') }, { heading: t('lab.sqi') }, { heading: t('lab.reference') }]}
    >
      {/* The capture sender exists only in development builds (PRIV-1, ADR 0026). */}
      {__DEV__ ? <LabPanel capture={LumenCapture} /> : null}
    </RouteShell>
  );
}
