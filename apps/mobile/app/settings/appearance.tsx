import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { RouteShell } from '@/components/RouteShell';
import { HomePreview } from '@/settings/HomePreview';
import { setPreference, usePreferences } from '@/theme/preferences';
import { Segmented } from '@/settings/Segmented';
import { useTheme } from '@/theme';

export default function AppearanceScreen() {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const { appearance } = usePreferences();
  const previews = [
    { scheme: 'light', caption: t('appearance.light') },
    { scheme: 'dark', caption: t('appearance.dark') },
  ] as const;
  return (
    <RouteShell title={t('appearance.title')}>
      <Segmented
        selected={appearance}
        onSelect={(choice) => setPreference('appearance', choice)}
        options={[
          { value: 'system', label: t('appearance.segmentSystem'), hint: t('appearance.system') },
          { value: 'light', label: t('appearance.light') },
          { value: 'dark', label: t('appearance.dark') },
        ]}
      />
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: spacing.xxl }}>
        {previews
          .filter(({ scheme }) => appearance === 'system' || appearance === scheme)
          .map(({ scheme, caption }) => (
            <HomePreview key={scheme} scheme={scheme} measureLabel={t('home.measure')} caption={caption} />
          ))}
      </View>
      {appearance === 'system' ? (
        <Card>
          <AppText variant="headline">{t('appearance.following')}</AppText>
          <AppText tone="textDim">{t('appearance.followingBody')}</AppText>
        </Card>
      ) : null}
      <AppText variant="caption" tone="textDim">
        {t('appearance.note')}
      </AppText>
    </RouteShell>
  );
}
