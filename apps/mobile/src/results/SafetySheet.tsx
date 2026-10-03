import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/Button';
import { PressableScale } from '@/components/PressableScale';
import { useTheme } from '@/theme';

type SafetySheetProps = { visible: boolean; onDismiss: () => void };

// SAFE-1: shown when any flag fires (heart rate, rhythm, or the diabetes pattern card, §12.5).
// Yes opens emergency guidance; No or a tap outside closes it. The Yes button uses the flag colour,
// because red belongs to the emergency screen alone.
export function SafetySheet({ visible, onDismiss }: SafetySheetProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, radius, spacing, control } = useTheme();
  const openEmergency = () => {
    onDismiss();
    router.push('/emergency');
  };
  return (
    <BottomSheet visible={visible} onDismiss={onDismiss} dismissLabel={t('safety.dismiss')}>
      <View
        style={{
          alignSelf: 'center',
          width: 40,
          height: 4,
          borderRadius: 2,
          backgroundColor: colors.line2,
        }}
      />
      <AppText variant="title" accessibilityRole="header">
        {t('safety.title')}
      </AppText>
      <AppText variant="headline" style={{ fontWeight: '400' }}>
        {t('safety.question')}
      </AppText>
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <View style={{ flex: 1 }}>
          <PressableScale
            accessibilityRole="button"
            onPress={openEmergency}
            style={{
              minHeight: control.primaryButtonHeight,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: colors.flag,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <AppText variant="headline" style={{ color: colors.flag }}>
              {t('safety.yes')}
            </AppText>
          </PressableScale>
        </View>
        <View style={{ flex: 1 }}>
          <Button label={t('safety.no')} variant="secondary" onPress={onDismiss} />
        </View>
      </View>
      <AppText variant="caption" tone="textDim" style={{ textAlign: 'center' }}>
        {t('safety.yesOpens')}
      </AppText>
    </BottomSheet>
  );
}
