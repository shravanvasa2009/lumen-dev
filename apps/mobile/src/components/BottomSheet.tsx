import { type ReactNode, useContext, useEffect, useRef } from 'react';
import { Animated as DragAnimated, type GestureResponderEvent, Modal, Pressable, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { useWindowBottomInset } from '@/demo/DemoStrip';
import { useTheme } from '@/theme';
import { easeOut, motion, reduceMotionMode, StillMotion, useReduceMotion } from '@/theme/motion';

// Spoken label of the dimmed area; a tap there, or Android Back, dismisses the sheet. A sheet given neither is
// answered only by its own buttons (SafetySheet, ADR 0093). `onSwipeDown` answers a downward swipe on the panel;
// without it a swipe dismisses like the dimmed area does.
type BottomSheetProps = {
  visible: boolean;
  children: ReactNode;
  onSwipeDown?: () => void;
} & ({ onDismiss: () => void; dismissLabel: string } | { onDismiss?: undefined; dismissLabel?: undefined });

// Android needs an onRequestClose handler on a Modal; this one keeps the sheet open.
function keepOpen() {}

// A downward drag this far (dp), or a flick this fast (dp per ms), answers the swipe; anything less springs back.
const SWIPE_CLOSE_DP = 80;
const SWIPE_CLOSE_VELOCITY = 0.8;
// A vertical move must pass this (dp) before the panel follows the finger, so a tap on a button stays a tap.
const SWIPE_START_DP = 10;

// The in-app modal sheet. The Modal itself does not animate (the OS would pick its own duration); the dimmed
// area and the panel fade in on the UI thread at the 200 ms token. The panel does not slide in: on Android a
// Reanimated slide left the panel's touch geometry at its start, below the screen, so any finger movement
// during a tap counted as leaving the button and the press was dropped (owner, Galaxy A17, 2026-10-09: No
// "didnt work" until a perfectly still tap). Under Reduce Motion they just appear; on the capture screen
// nothing animates (ADR 0075). The content unmounts the moment `visible` is false and no button waits for an
// animation, so SafetySheet's route to the emergency screen is never delayed.
export function BottomSheet({ visible, onDismiss, dismissLabel, onSwipeDown, children }: BottomSheetProps) {
  const { colors, radius, spacing } = useTheme();
  const reduceMotion = useReduceMotion();
  const onCaptureScreen = useContext(StillMotion);
  // The Modal is drawn edge to edge on Android 15+, so the panel's last line would sit under the navigation bar.
  const bottomInset = useWindowBottomInset();
  const swipeAnswer = useRef(onSwipeDown ?? onDismiss);
  swipeAnswer.current = onSwipeDown ?? onDismiss;
  // The drag goes through the JS-driven Animated value, not the native driver, so every committed position is
  // the one touches are tested against.
  const dragY = useRef(new DragAnimated.Value(0)).current;
  useEffect(() => {
    if (visible) dragY.setValue(0);
  }, [visible, dragY]);
  // Raw touch events, not the responder system: on the A17 the panel never won the responder for a swipe
  // inside the Modal, so the drag is read from the touches every ancestor sees.
  const swipeStart = useRef<{ pageY: number; timeMs: number } | null>(null);
  const followFinger = (event: GestureResponderEvent) => {
    const start = swipeStart.current;
    if (start === null || swipeAnswer.current === undefined) return;
    const dy = event.nativeEvent.pageY - start.pageY;
    dragY.setValue(dy > SWIPE_START_DP ? dy - SWIPE_START_DP : 0);
  };
  const endSwipe = (event: GestureResponderEvent) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (start === null || swipeAnswer.current === undefined) return;
    const dy = event.nativeEvent.pageY - start.pageY;
    const velocity = dy / Math.max(1, event.nativeEvent.timestamp - start.timeMs);
    if (dy > SWIPE_CLOSE_DP || (dy > SWIPE_START_DP && velocity > SWIPE_CLOSE_VELOCITY)) {
      swipeAnswer.current();
      return;
    }
    DragAnimated.spring(dragY, { toValue: 0, useNativeDriver: false }).start();
  };
  // The OS took the touch away (a system gesture, a call): spring back, never answer.
  const cancelSwipe = () => {
    swipeStart.current = null;
    DragAnimated.spring(dragY, { toValue: 0, useNativeDriver: false }).start();
  };
  const fadeIn = onCaptureScreen
    ? undefined
    : FadeIn.duration(motion.durationMs).easing(easeOut).reduceMotion(reduceMotionMode(reduceMotion));
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onDismiss ?? keepOpen}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Animated.View
          testID="sheet-scrim"
          entering={fadeIn}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            backgroundColor: colors.scrim,
          }}
        >
          <Pressable
            testID="sheet-scrim-press"
            accessible={onDismiss !== undefined}
            accessibilityLabel={dismissLabel}
            onPress={onDismiss}
            style={{ flex: 1 }}
          />
        </Animated.View>
        <DragAnimated.View
          onTouchStart={(event) => {
            swipeStart.current = { pageY: event.nativeEvent.pageY, timeMs: event.nativeEvent.timestamp };
          }}
          onTouchMove={followFinger}
          onTouchEnd={endSwipe}
          onTouchCancel={cancelSwipe}
          testID="sheet-drag"
          style={{ maxHeight: '90%', flexShrink: 1, transform: [{ translateY: dragY }] }}
        >
          <Animated.View
            testID="sheet-panel"
            entering={fadeIn}
            style={{
              backgroundColor: colors.surface,
              borderColor: colors.line,
              borderWidth: 1,
              borderTopLeftRadius: radius.sheet,
              borderTopRightRadius: radius.sheet,
              // Leaves the status bar visible; a body taller than this scrolls instead of running off the top.
              maxHeight: '100%',
              flexShrink: 1,
              padding: spacing.xxl,
              paddingBottom: spacing.xxxl + bottomInset,
              gap: spacing.lg,
            }}
          >
            {children}
          </Animated.View>
        </DragAnimated.View>
      </View>
    </Modal>
  );
}
