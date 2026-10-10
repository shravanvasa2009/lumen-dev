import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { formatNumber } from '@/i18n/formatNumber';
import { useTheme } from '@/theme';

import type { NearbyClinic } from './clinics';
import { ContactIcon } from './ContactIcons';

type ClinicRowProps = {
  clinic: NearbyClinic;
  selected: boolean;
  // The phone could not dial, so the number is shown as text to copy.
  callFailed: boolean;
  // No maps app opened for this clinic's directions.
  directionsFailed: boolean;
  last: boolean;
  onCall: () => void;
  onDirections: () => void;
};

const BUTTON_SIZE = 44;
const CIRCLE_SIZE = 36;

function RoundAction({
  icon,
  label,
  hint,
  disabled = false,
  onPress,
}: {
  icon: 'call' | 'directions';
  label: string;
  hint: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        width: BUTTON_SIZE,
        height: BUTTON_SIZE,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <View
        style={{
          width: CIRCLE_SIZE,
          height: CIRCLE_SIZE,
          borderRadius: CIRCLE_SIZE / 2,
          backgroundColor: colors.accentTint,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ContactIcon name={icon} size={18} color={colors.accent} />
      </View>
    </PressableScale>
  );
}

export function ClinicRow({
  clinic,
  selected,
  callFailed,
  directionsFailed,
  last,
  onCall,
  onDirections,
}: ClinicRowProps) {
  const { t, i18n } = useTranslation();
  const { colors, spacing } = useTheme();
  const miles = t('careMap.miles', { miles: formatNumber(clinic.miles, i18n.language, 1, 1) });
  // OpenStreetMap sites often lack a street, city or ZIP; only the parts present are shown.
  const address = [clinic.street, clinic.city, [clinic.state, clinic.zip].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
  const kind = clinic.kind === 'regular' ? t('careMap.legendRegular') : t('careMap.legendClinic');
  return (
    <View
      testID={`clinic-card-${clinic.id}`}
      style={{
        paddingLeft: spacing.lg,
        paddingRight: spacing.sm,
        paddingVertical: 10,
        backgroundColor: selected ? colors.accentTint : undefined,
        borderBottomColor: colors.line,
        borderBottomWidth: last ? 0 : 1,
        gap: spacing.xs,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <AppText variant="headline">{clinic.name}</AppText>
          <AppText variant="subheadline" tone="textDim" testID={`clinic-kind-${clinic.id}`}>
            {`${kind} · ${miles}`}
          </AppText>
          {address ? (
            <AppText variant="caption" tone="textDim">
              {address}
            </AppText>
          ) : null}
          {clinic.phone ? null : (
            <AppText variant="caption" tone="textDim">
              {t('careMap.noPhone')}
            </AppText>
          )}
        </View>
        <RoundAction
          icon="call"
          label={t('careMap.call')}
          hint={clinic.name}
          disabled={!clinic.phone}
          onPress={onCall}
        />
        <RoundAction
          icon="directions"
          label={t('careMap.directions')}
          hint={clinic.name}
          onPress={onDirections}
        />
      </View>
      {callFailed ? (
        <AppText accessibilityRole="alert" tone="textDim">
          {t('careMap.callFailed')} <AppText selectable>{clinic.phone}</AppText>
        </AppText>
      ) : null}
      {directionsFailed ? (
        <AppText accessibilityRole="alert" tone="textDim">
          {t('careMap.mapsFailed')}
        </AppText>
      ) : null}
    </View>
  );
}
