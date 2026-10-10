import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme';
import { glideConfig, useReduceMotion } from '@/theme/motion';

import { labelAt } from './practiceParts';

const BAR_HEIGHT = 6;
const THUMB = 14;
// Keeps the thumb inside the bar at both ends.
const INSET_PCT = 4;
const SPAN_PCT = 100 - 2 * INSET_PCT;

// Mockup 06's Signal bar: a flat fill up to the level with a round thumb at its end, and Weak, OK, Strong under
// it. `level` is 0 to 1; with none, the bar stays empty and the thumb is left out. The level arrives about once
// a second, so the thumb glides to it.
export function PracticeSignal({ level }: { level: number | null }) {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const reduceMotion = useReduceMotion();
  const marked = level === null ? null : Math.min(1, Math.max(0, level));
  const targetPct = INSET_PCT + (marked ?? 0.5) * SPAN_PCT;
  const positionPct = useSharedValue(targetPct);
  const hasLevel = marked !== null;
  const wasMarked = useRef(hasLevel);
  useEffect(() => {
    if (!hasLevel) {
      wasMarked.current = false;
      return;
    }
    positionPct.value = wasMarked.current ? withTiming(targetPct, glideConfig(reduceMotion)) : targetPct;
    wasMarked.current = true;
  }, [hasLevel, targetPct, reduceMotion, positionPct]);
  const thumbStyle = useAnimatedStyle(() => ({ left: `${positionPct.value}%` }));
  const fillStyle = useAnimatedStyle(() => ({ width: `${positionPct.value}%` }));
  const current = labelAt(level);
  const signalLabel = { weak: t('signal.weak'), ok: t('signal.ok'), strong: t('signal.strong') };
  const scaleLabel = (name: 'weak' | 'ok' | 'strong') => (
    <AppText
      variant="caption"
      tone={current === name ? 'accent' : 'textDim'}
      style={current === name ? { fontWeight: '600' } : undefined}
    >
      {signalLabel[name]}
    </AppText>
  );
  return (
    <View style={{ gap: spacing.xs }}>
      <AppText variant="caption" tone="textDim">
        {t('practice.signal')}
      </AppText>
      <View style={{ height: THUMB, justifyContent: 'center' }}>
        <View style={{ height: BAR_HEIGHT, borderRadius: BAR_HEIGHT / 2, backgroundColor: colors.surface3 }}>
          {hasLevel ? (
            <Animated.View
              style={[
                { height: BAR_HEIGHT, borderRadius: BAR_HEIGHT / 2, backgroundColor: colors.accent },
                fillStyle,
              ]}
            />
          ) : null}
        </View>
        {hasLevel ? (
          <Animated.View
            testID="signal-marker"
            pointerEvents="none"
            style={[
              {
                position: 'absolute',
                marginLeft: -THUMB / 2,
                width: THUMB,
                height: THUMB,
                borderRadius: THUMB / 2,
                backgroundColor: colors.text,
              },
              thumbStyle,
            ]}
          />
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {scaleLabel('weak')}
        {scaleLabel('ok')}
        {scaleLabel('strong')}
      </View>
    </View>
  );
}
