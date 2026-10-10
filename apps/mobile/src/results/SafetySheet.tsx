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

// Answer buttons stay at 72 dp (owner request) so the question can be answered at a glance; stacked, each spans the sheet.
const ANSWER_HEIGHT = 72;

// After No the sheet stops taking presses but stays up this long before it closes. A second tap on the
// same spot (the first one gave no feedback on a slow phone) then lands on the sheet, not on whatever the
// next screen puts under the No button (Processing hands over to Retake at that spot).
export const CLOSE_SHIELD_MS = 400;

// SAFE-1: shown when any flag fires (heart rate, rhythm, or the diabetes pattern card, §12.5).
// Yes opens emergency guidance at once; No closes it, and so does a downward swipe on the sheet (owner,
// 2026-10-09: "the swipe down doesnt work either. fix this."). When the question overflows and scrolls, the
// swipe is off, so dragging the text back cannot answer it. A tap outside and Android Back still do nothing
// (ADR 0093). Owner 2026-10-09: Yes and the warning mark use the safety-check red (alert tokens), because
// Yes opens that screen and orange read as a caution, not as the way to help.
export function SafetySheet({ visible, onNo, onYes }: SafetySheetProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, radius, spacing } = useTheme();
  const [answeredNo, setAnsweredNo] = useState(false);
  // Android's scroll view claims every vertical drag, even with nothing to scroll, which swallowed the swipe
  // down. It only scrolls when the title and question overflow (the largest font on a small phone).
  const [scrollBoxHeight, setScrollBoxHeight] = useState(0);
  const [scrollContentHeight, setScrollContentHeight] = useState(0);
  const overflowing = scrollContentHeight > scrollBoxHeight + 1;
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set once Yes is pressed, so a flick that started on Yes cannot also answer No as a swipe.
  const answeredYes = useRef(false);
  useEffect(() => {
    if (visible) {
      setAnsweredNo(false);
      closeTimer.current = null;
      answeredYes.current = false;
    }
  }, [visible]);
  useEffect(
    () => () => {
      if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    },
    [],
  );
  const closeAfterShield = () => {
    if (closeTimer.current !== null) return;
    setAnsweredNo(true);
    closeTimer.current = setTimeout(onNo, CLOSE_SHIELD_MS);
  };
  const swipeNo = () => {
    if (!answeredYes.current) closeAfterShield();
  };
  const openEmergency = () => {
    answeredYes.current = true;
    if (onYes !== undefined) {
      onYes();
      return;
    }
    onNo();
    router.push('/emergency');
  };
  return (
    <BottomSheet visible={visible} onSwipeDown={overflowing ? undefined : swipeNo} appearance="floating">
      <View
        pointerEvents={answeredNo ? 'none' : 'auto'}
        style={{ gap: spacing.sm, flexShrink: 1, opacity: answeredNo ? 0.5 : 1 }}
      >
        {/* Only the icon, title and question scroll: at the largest font on a 360x640 phone they are taller than
          the sheet, and Yes and No must stay on screen below them. */}
        <ScrollView
          scrollEnabled={overflowing}
          onLayout={(event) => setScrollBoxHeight(event.nativeEvent.layout.height)}
          onContentSizeChange={(_width, height) => setScrollContentHeight(height)}
          style={{ flexShrink: 1 }}
          contentContainerStyle={{ alignItems: 'center', gap: spacing.md, paddingBottom: spacing.xl }}
        >
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: radius.pill,
              backgroundColor: colors.alertTint,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="warning" size={32} color={colors.alertText} mark={colors.alertTint} />
          </View>
          <AppText variant="title" accessibilityRole="header" style={{ textAlign: 'center' }}>
            {t('safety.title')}
          </AppText>
          <AppText variant="title3" style={{ textAlign: 'center' }}>
            {t('safety.question')}
          </AppText>
        </ScrollView>
        <PressableScale
          accessibilityRole="button"
          onPress={openEmergency}
          style={{
            minHeight: ANSWER_HEIGHT,
            borderRadius: radius.pill,
            backgroundColor: colors.alertFill,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <AppText variant="headline" style={{ color: colors.onAlertFill }}>
            {t('safety.yes')}
          </AppText>
        </PressableScale>
        <PressableScale
          accessibilityRole="button"
          onPress={closeAfterShield}
          style={{
            minHeight: ANSWER_HEIGHT,
            borderRadius: radius.pill,
            backgroundColor: colors.surface2,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <AppText variant="headline">{t('safety.no')}</AppText>
        </PressableScale>
        <AppText variant="caption" tone="textDim" style={{ textAlign: 'center', paddingTop: spacing.sm }}>
          {t('safety.yesOpens')}
        </AppText>
      </View>
    </BottomSheet>
  );
}
