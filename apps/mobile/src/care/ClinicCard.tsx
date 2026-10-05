import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { formatNumber } from '@/i18n/formatNumber';
import { useTheme } from '@/theme';

import type { NearbyClinic } from './clinics';

type ClinicCardProps = {
  clinic: NearbyClinic;
  selected: boolean;
  // The phone could not dial, so the number is shown as text to copy.
  callFailed: boolean;
  // No maps app opened for this clinic's directions.
  directionsFailed: boolean;
  onCall: () => void;
  onDirections: () => void;
};

export function ClinicCard({
  clinic,
  selected,
  callFailed,
  directionsFailed,
  onCall,
  onDirections,
}: ClinicCardProps) {
  const { t, i18n } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  const miles = t('careMap.miles', { miles: formatNumber(clinic.miles, i18n.language, 1, 1) });
  // OpenStreetMap sites often lack a street, city or ZIP; only the parts present are shown.
  const address = [clinic.street, clinic.city, [clinic.state, clinic.zip].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
  return (
    <View
      testID={`clinic-card-${clinic.id}`}
      style={{ borderRadius: radius.card, borderWidth: selected ? 2 : 0, borderColor: colors.accent }}
    >
      <Card>
        <AppText variant="caption" tone="textDim" testID={`clinic-kind-${clinic.id}`}>
          {clinic.kind === 'regular' ? t('careMap.legendRegular') : t('careMap.legendClinic')}
        </AppText>
        <AppText variant="headline">{clinic.name}</AppText>
        <AppText tone="textDim">{[address, miles].filter(Boolean).join(' · ')}</AppText>
        {clinic.phone ? (
          <AppText selectable>{clinic.phone}</AppText>
        ) : (
          <AppText tone="textDim">{t('careMap.noPhone')}</AppText>
        )}
        {callFailed ? (
          <AppText accessibilityRole="alert" tone="textDim">
            {t('careMap.callFailed')} <AppText selectable>{clinic.phone}</AppText>
          </AppText>
        ) : null}
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Button label={t('careMap.call')} variant="secondary" disabled={!clinic.phone} onPress={onCall} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label={t('careMap.directions')} variant="secondary" onPress={onDirections} />
          </View>
        </View>
        {directionsFailed ? (
          <AppText accessibilityRole="alert" tone="textDim">
            {t('careMap.mapsFailed')}
          </AppText>
        ) : null}
      </Card>
    </View>
  );
}
