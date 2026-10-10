import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { TickRing } from '@/measure/TickRing';
import { useTheme } from '@/theme';

const DIAL = 240;
const TICKS = 60;
const MAJOR_EVERY = 15;
const DIAL_PADDING = 12;

type StandingDialProps = {
  // 0 to 1: how much of this phase has passed; the elapsed ticks light up clockwise from the top.
  fraction: number;
  label: string;
  clock: string;
  caption: string;
  // The capture-style dark disc, shown while a reading is being taken.
  measuring?: boolean;
};

// The big timer of the lying, baseline and standing steps, dressed with the same ticks as the capture ring.
export function StandingDial({ fraction, label, clock, caption, measuring = false }: StandingDialProps) {
  const { colors } = useTheme();
  const ink = measuring ? colors.onPlot : colors.text;
  const dim = measuring ? colors.onPlot : colors.textDim;
  return (
    <View
      accessible
      accessibilityRole="timer"
      accessibilityLabel={`${label} ${clock}. ${caption}`}
      style={{ alignSelf: 'center' }}
    >
      <TickRing size={DIAL} count={TICKS} lit={Math.round(fraction * TICKS)} majorEvery={MAJOR_EVERY}>
        {(innerSize) => (
          <View
            style={{
              width: innerSize,
              height: innerSize,
              borderRadius: innerSize / 2,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: measuring ? colors.plotPanel : colors.surface,
              padding: DIAL_PADDING,
            }}
          >
            <AppText variant="caption" style={{ color: dim }}>
              {label}
            </AppText>
            <AppText variant="display" style={{ color: ink, fontSize: 48, lineHeight: 54 }}>
              {clock}
            </AppText>
            <AppText variant="caption" style={{ color: dim, textAlign: 'center' }}>
              {caption}
            </AppText>
          </View>
        )}
      </TickRing>
    </View>
  );
}
