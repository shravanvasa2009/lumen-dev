import { type ReactNode, useContext } from 'react';
import { Modal, Pressable, View } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';

import { useTheme } from '@/theme';
import { easeOut, motion, reduceMotionMode, StillMotion, useReduceMotion } from '@/theme/motion';

type BottomSheetProps = {
  visible: boolean;
  onDismiss: () => void;
  // Spoken label of the dimmed area; a tap there dismisses the sheet.
  dismissLabel: string;
  children: ReactNode;
};

// The in-app modal sheet. The Modal itself does not animate (the OS would pick its own duration); the dimmed
// area fades in and the panel slides up on the UI thread, both at the 200 ms token. Under Reduce Motion they
// just appear; on the capture screen nothing animates (ADR 0075). The content unmounts the moment `visible`
// is false and no button waits for an animation, so SafetySheet's route to the emergency screen is never delayed.
export function BottomSheet({ visible, onDismiss, dismissLabel, children }: BottomSheetProps) {
  const { colors, radius, spacing } = useTheme();
  const reduceMotion = useReduceMotion();
  const onCaptureScreen = useContext(StillMotion);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onDismiss}
    >
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Animated.View
          testID="sheet-scrim"
          entering={
            onCaptureScreen
              ? undefined
              : FadeIn.duration(motion.durationMs)
                  .easing(easeOut)
                  .reduceMotion(reduceMotionMode(reduceMotion))
          }
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            backgroundColor: colors.scrim,
          }}
        >
          <Pressable accessibilityLabel={dismissLabel} onPress={onDismiss} style={{ flex: 1 }} />
        </Animated.View>
        <Animated.View
          testID="sheet-panel"
          entering={
            onCaptureScreen
              ? undefined
              : SlideInDown.duration(motion.durationMs)
                  .easing(easeOut)
                  .reduceMotion(reduceMotionMode(reduceMotion))
          }
          style={{
            backgroundColor: colors.surface,
            borderColor: colors.line,
            borderWidth: 1,
            borderTopLeftRadius: radius.sheet,
            borderTopRightRadius: radius.sheet,
            padding: spacing.xxl,
            paddingBottom: spacing.xxxl,
            gap: spacing.lg,
          }}
        >
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}
