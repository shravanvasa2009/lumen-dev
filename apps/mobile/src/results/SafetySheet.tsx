import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

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

// After No the sheet stops taking presses but stays up this long before it closes. A second tap on the
// same spot (the first one gave no feedback on a slow phone) then lands on the sheet, not on whatever the
// next screen puts under the No button (Processing hands over to Retake at that spot).
const CLOSE_SHIELD_MS = 400;

// SAFE-1: shown when any flag fires (heart rate, rhythm, or the diabetes pattern card, §12.5).
// Yes opens emergency guidance at once; No closes it. A tap outside and Android Back do nothing, so a slip
// cannot skip the question (ADR 0093). Yes uses the amber flag tokens,
// because red belongs to the emergency screen alone.
export function SafetySheet({ visible, onNo, onYes }: SafetySheetProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, radius, spacing } = useTheme();
  const [answeredNo, setAnsweredNo] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (visible) setAnsweredNo(false);
  }, [visible]);
  useEffect(
    () => () => {
      if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    },
    [],
  );
  const closeAfterShield = () => {
    if (answeredNo) return;
    setAnsweredNo(true);
    closeTimer.current = setTimeout(onNo, CLOSE_SHIELD_MS);
  };
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
        pointerEvents={answeredNo ? 'none' : 'auto'}
        style={{ gap: spacing.lg, flexShrink: 1, opacity: answeredNo ? 0.5 : 1 }}
      >
        <View
          style={{
            alignSelf: 'center',
            width: 40,
            height: 4,
            borderRadius: 2,
            backgroundColor: colors.line2,
          }}
        />
        {/* Only the title and question scroll: at the largest font on a 360x640 phone they are taller than the
          sheet, and Yes and No must stay on screen below them. */}
        <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: spacing.lg }}>
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
        </ScrollView>
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
              onPress={closeAfterShield}
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
      </View>
    </BottomSheet>
  );
}
