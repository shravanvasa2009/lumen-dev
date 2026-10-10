import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Svg, { Circle, Path, Text as SvgText } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme';

import {
  extraBeatMapGapsMs,
  gapPairs,
  irregularMapGapsMs,
  mapAxis,
  steadyMapGapsMs,
} from './rhythmFigureMath';

const LOW_MS = 500;
const HIGH_MS = 1300;
const DOT_RADIUS = 3.4;

type MapProps = {
  gapsMs: readonly number[];
  color: string;
  // Viewbox side; the picture scales to the width it is given.
  size: number;
  inset: number;
  withAxisLabels?: boolean;
};

function RhythmMap({ gapsMs, color, size, inset, withAxisLabels = false }: MapProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const lowerLeft = size - inset;
  return (
    <Svg width="100%" viewBox={`0 0 ${size} ${size}`} style={{ aspectRatio: 1 }}>
      <Path
        d={`M${inset} ${lowerLeft}L${lowerLeft} ${inset}`}
        stroke={colors.line2}
        strokeWidth={1}
        strokeDasharray="3 3"
      />
      {gapPairs(gapsMs).map(([gap, nextGap], index) => (
        <Circle
          key={`${index}-${gap}-${nextGap}`}
          cx={mapAxis(gap, LOW_MS, HIGH_MS, size, inset)}
          cy={size - mapAxis(nextGap, LOW_MS, HIGH_MS, size, inset)}
          r={DOT_RADIUS}
          fill={color}
          fillOpacity={0.8}
        />
      ))}
      {withAxisLabels ? (
        <>
          <SvgText
            x={size - 8}
            y={size - 6}
            textAnchor="end"
            fontSize={10}
            fill={colors.onPlot}
            opacity={0.7}
          >
            {t('learn.rhythm.thisGap')}
          </SvgText>
          <SvgText
            x={0}
            y={0}
            transform={`translate(14 ${size / 2}) rotate(-90)`}
            textAnchor="middle"
            fontSize={10}
            fill={colors.onPlot}
            opacity={0.7}
          >
            {t('learn.rhythm.nextGap')}
          </SvgText>
        </>
      ) : null}
    </Svg>
  );
}

function MapTile({ children, radius }: { children: React.ReactNode; radius: number }) {
  const { colors } = useTheme();
  return (
    <View style={{ borderRadius: radius, backgroundColor: colors.plotPanel, overflow: 'hidden' }}>
      {children}
    </View>
  );
}

export function RhythmMapPair() {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: spacing.lg }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <MapTile radius={18}>
          <RhythmMap
            gapsMs={steadyMapGapsMs}
            color={colors.accentFill}
            size={161}
            inset={12.88}
            withAxisLabels
          />
        </MapTile>
        <AppText variant="subheadline" style={{ marginTop: 10, fontWeight: '700', color: colors.accent }}>
          {t('learn.rhythm.mapSteady')}
        </AppText>
        <AppText variant="caption" tone="textDim">
          {t('learn.rhythm.mapSteadyNote')}
        </AppText>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <MapTile radius={18}>
          <RhythmMap
            gapsMs={irregularMapGapsMs}
            color={colors.flagFill}
            size={161}
            inset={12.88}
            withAxisLabels
          />
        </MapTile>
        <AppText variant="subheadline" style={{ marginTop: 10, fontWeight: '700', color: colors.flag }}>
          {t('learn.rhythm.mapIrregular')}
        </AppText>
        <AppText variant="caption" tone="textDim">
          {t('learn.rhythm.mapIrregularNote')}
        </AppText>
      </View>
    </View>
  );
}

export function ExtraBeatMapPair() {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', gap: spacing.md }}
    >
      <View style={{ flex: 1, maxWidth: 118, alignItems: 'center', gap: 6 }}>
        <View style={{ alignSelf: 'stretch' }}>
          <MapTile radius={16}>
            <RhythmMap gapsMs={extraBeatMapGapsMs} color={colors.flagFill} size={118} inset={9} />
          </MapTile>
        </View>
        <AppText variant="caption" style={{ fontWeight: '600' }}>
          {t('learn.rhythm.chipExtra')}
        </AppText>
      </View>
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          marginTop: 41,
          backgroundColor: colors.flagBg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <AppText style={{ color: colors.flag, fontWeight: '700', fontSize: 20, lineHeight: 24 }}>?</AppText>
      </View>
      <View style={{ flex: 1, maxWidth: 118, alignItems: 'center', gap: 6 }}>
        <View style={{ alignSelf: 'stretch' }}>
          <MapTile radius={16}>
            <RhythmMap gapsMs={irregularMapGapsMs} color={colors.flagFill} size={118} inset={9} />
          </MapTile>
        </View>
        <AppText variant="caption" style={{ fontWeight: '600' }}>
          {t('learn.rhythm.afib')}
        </AppText>
      </View>
    </View>
  );
}
