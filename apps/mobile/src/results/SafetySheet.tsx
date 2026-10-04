import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { BottomSheet } from '@/components/BottomSheet';
import { Icon } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { useTheme } from '@/theme';

// A caller that must replace its own screen with the emergency screen (Processing) passes onYes; the Results
// screen stays underneath and takes the default push.
type SafetySheetProps = { visible: boolean; onNo: () => void; onYes?: () => void };

// Answer buttons are well above the 44 dp minimum so the question can be answered at a glance.
const ANSWER_HEIGHT = 72;

// SAFE-1: shown when any flag fires (heart rate, rhythm, or the diabetes pattern card, §12.5).
// Yes opens emergency guidance at once; No closes it. A tap outside and Android Back do nothing, so a slip
// cannot skip the question (ADR 0093). Yes uses the amber flag tokens,
// because red belongs to the emergency screen alone.
export function SafetySheet({ visible, onNo, onYes }: SafetySheetProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, radius, spacing } = useTheme();
  const openEmergency = () => {
    if (onYes !== undefined) {
      onYes();
      return;
    }
    onNo();
    router.push('/emergency');
  };
  return (
    <BottomSheet visible={visible}>
      <View
        style={{
          alignSelf: 'center',
          width: 40,
          height: 4,
          borderRadius: 2,
          backgroundColor: colors.line2,
        }}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: radius.pill,
            backgroundColor: colors.flagBg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="warning" size={32} color={colors.flag} mark={colors.flagBg} />
        </View>
        <AppText variant="display" accessibilityRole="header" style={{ flex: 1 }}>
          {t('safety.title')}
        </AppText>
      </View>
      <AppText variant="title" style={{ fontWeight: '500' }}>
        {t('safety.question')}
      </AppText>
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <View style={{ flex: 1 }}>
          <PressableScale
            accessibilityRole="button"
            onPress={openEmergency}
            style={{
              minHeight: ANSWER_HEIGHT,
              borderRadius: radius.pill,
              borderWidth: 3,
              borderColor: colors.flag,
              backgroundColor: colors.flagBg,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <AppText variant="title" style={{ color: colors.flag }}>
              {t('safety.yes')}
            </AppText>
          </PressableScale>
        </View>
        <View style={{ flex: 1 }}>
          <PressableScale
            accessibilityRole="button"
            onPress={onNo}
            style={{
              minHeight: ANSWER_HEIGHT,
              borderRadius: radius.pill,
              borderWidth: 3,
              borderColor: colors.line2,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <AppText variant="title">{t('safety.no')}</AppText>
          </PressableScale>
        </View>
      </View>
      <AppText tone="textDim" style={{ textAlign: 'center' }}>
        {t('safety.yesOpens')}
      </AppText>
    </BottomSheet>
  );
}
