import { useTranslation } from 'react-i18next';
import type { ColorValue } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';

import { useTheme } from '@/theme';

const WIDTH = 338;
const HEIGHT = 84;
const INSET = 8;
const DOT_Y = 62;
const BRACKET_Y = 26;

type BeatStripProps = { intervalsMs: readonly number[]; color: ColorValue };

// Beats on a time line: a dot where each beat landed and the gap in ms between neighbours above it. It draws
// only the interval data a reading keeps, so spacing is true to the beat times and nothing else is implied.
export function BeatStrip({ intervalsMs, color }: BeatStripProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const totalMs = intervalsMs.reduce((sum, ms) => sum + ms, 0);
  const toX = (ms: number) => INSET + (ms / totalMs) * (WIDTH - 2 * INSET);
  const beatsMs = intervalsMs.reduce<number[]>(
    (times, ms) => [...times, (times[times.length - 1] ?? 0) + ms],
    [0],
  );
  return (
    <Svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width="100%"
      style={{ aspectRatio: WIDTH / HEIGHT }}
      accessibilityLabel={t('why.beatStripLabel', { gaps: intervalsMs.join(', ') })}
    >
      <Line x1={INSET} x2={WIDTH - INSET} y1={DOT_Y} y2={DOT_Y} stroke={colors.line2} strokeWidth={1} />
      {intervalsMs.map((ms, index) => {
        const left = toX(beatsMs[index] ?? 0);
        const right = toX(beatsMs[index + 1] ?? 0);
        return (
          <Path
            key={`bracket${index}`}
            d={`M${left + 2} ${BRACKET_Y - 4}v4h${right - left - 4}v-4`}
            fill="none"
            stroke={colors.line2}
            strokeWidth={1}
          />
        );
      })}
      {intervalsMs.map((ms, index) => (
        <SvgText
          key={`gap${index}`}
          x={(toX(beatsMs[index] ?? 0) + toX(beatsMs[index + 1] ?? 0)) / 2}
          y={BRACKET_Y - 10}
          fontSize={11}
          fontWeight="500"
          fill={colors.textDim}
          textAnchor="middle"
        >
          {Math.round(ms)}
        </SvgText>
      ))}
      {beatsMs.map((time, index) => (
        <Circle
          key={`beat${index}`}
          cx={toX(time)}
          cy={DOT_Y}
          r={5}
          fill={color}
          stroke={colors.surface}
          strokeWidth={1.5}
        />
      ))}
    </Svg>
  );
}
