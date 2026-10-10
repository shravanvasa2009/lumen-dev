import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Svg, { ClipPath, G, Rect } from 'react-native-svg';

import type { LostSeconds } from '@lumen/core';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { SectionLabel } from '@/settings/SectionLabel';
import { useTheme } from '@/theme';

type LostCause = 'movement' | 'pressure' | 'light';

// Light leaking around the finger is counted as coverage; cold hands have no row in mockup 19.
function secondsLost(lost: LostSeconds, cause: LostCause): number {
  return { movement: lost.motion, pressure: lost.pressure, light: lost.coverage }[cause];
}

const lostCauses: readonly LostCause[] = ['movement', 'pressure', 'light'];

// Whole-number shares that add to 100, so the legend never reads 99% or 101%: round every share down, then give
// each point still missing to the shares with the largest fractional part.
export function percentShares(seconds: readonly number[]): number[] {
  const total = seconds.reduce((sum, value) => sum + value, 0);
  const exact = seconds.map((value) => (value / total) * 100);
  const shares = exact.map(Math.floor);
  const missing = 100 - shares.reduce((sum, value) => sum + value, 0);
  const largestFractionFirst = exact
    .map((value, index) => ({ index, fraction: value - shares[index]! }))
    .sort((a, b) => b.fraction - a.fraction);
  for (const { index } of largestFractionFirst.slice(0, missing)) shares[index]!++;
  return shares;
}

const BAR_HEIGHT = 12;
const BAR_GAP = 2;

// Without a lost-time breakdown there is nothing to explain, so the card is left out.
export function LostTime({ lost }: { lost: LostSeconds | null }) {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const [barWidth, setBarWidth] = useState(0);
  if (!lost) return null;
  const seconds = lostCauses.map((cause) => secondsLost(lost, cause));
  if (seconds.every((value) => value <= 0)) return null;
  const names = {
    movement: t('inconclusive.movement'),
    pressure: t('inconclusive.pressure'),
    light: t('inconclusive.light'),
  };
  // The safety-check and emergency reds stay out of this card (SAFE-1), so Pressure keeps the accent teal.
  const shades = { movement: colors.flag, pressure: colors.accent, light: colors.glyph };
  const percents = percentShares(seconds);
  const total = seconds.reduce((sum, value) => sum + value, 0);
  const shown = lostCauses.filter((_, index) => seconds[index]! > 0);
  const room = Math.max(0, barWidth - BAR_GAP * (shown.length - 1));
  let drawn = 0;
  const segments = shown.map((cause) => {
    const width = (seconds[lostCauses.indexOf(cause)]! / total) * room;
    const segment = { cause, x: drawn, width };
    drawn += width + BAR_GAP;
    return segment;
  });
  return (
    <View style={{ gap: spacing.sm }}>
      <SectionLabel>{t('inconclusive.where')}</SectionLabel>
      <Card>
        <View testID="lost-time-chart" onLayout={(event) => setBarWidth(event.nativeEvent.layout.width)}>
          <Svg width={barWidth} height={BAR_HEIGHT} accessibilityElementsHidden>
            <ClipPath id="lost-time-clip">
              <Rect x={0} y={0} width={barWidth} height={BAR_HEIGHT} rx={BAR_HEIGHT / 2} />
            </ClipPath>
            <G clipPath="url(#lost-time-clip)">
              {segments.map(({ cause, x, width }) => (
                <Rect key={cause} x={x} y={0} width={width} height={BAR_HEIGHT} fill={shades[cause]} />
              ))}
            </G>
          </Svg>
        </View>
        <View style={{ marginTop: spacing.xs }}>
          {lostCauses.map((cause, index) => (
            <View
              key={cause}
              accessible
              accessibilityLabel={t('inconclusive.rowPercent', {
                label: names[cause],
                percent: percents[index],
              })}
              style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 20 }}
            >
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: shades[cause] }} />
              <AppText variant="subheadline" importantForAccessibility="no" style={{ flex: 1 }}>
                {names[cause]}
              </AppText>
              <AppText variant="subheadline" tone="textDim" importantForAccessibility="no">
                {`${percents[index]}%`}
              </AppText>
            </View>
          ))}
        </View>
      </Card>
    </View>
  );
}
