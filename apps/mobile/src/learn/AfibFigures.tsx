import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Circle, G, Path, Rect, Text as SvgText } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme';

import { panelArt, pulseTracePath } from './chapterArt';
import { CardHeading, Figure, GraphicCard, PanelFigure, StepList, NoteBanner, TileRow } from './ChapterParts';

const regularBeats = [56.9, 110.4, 163.9, 217.5, 271, 324.5];
const unevenBeats = [40, 102, 147, 206.2, 240, 304.8];

export function RhythmTraces() {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const rows = [
    {
      beats: regularBeats,
      color: panelArt.teal,
      name: t('learn.ch3.regular'),
      note: t('learn.ch3.evenTimes'),
      top: 36,
      bottom: 76,
      legend: 22,
    },
    {
      beats: unevenBeats,
      color: panelArt.amber,
      name: t('learn.ch3.afib'),
      note: t('learn.ch3.unevenTimes'),
      top: 124,
      bottom: 164,
      legend: 110,
    },
  ];
  return (
    <GraphicCard label={t('learn.ch3.heroLabel')} inset="md">
      <PanelFigure width={338} height={184}>
        {rows.map((row) => (
          <G key={row.name}>
            <Circle cx={18} cy={row.legend - 5} r={5} fill={row.color} />
            <SvgText x={30} y={row.legend} fill={colors.onPlot} fontSize={13} fontWeight="600">
              {row.name}
            </SvgText>
            <SvgText
              x={322}
              y={row.legend}
              fill={panelArt.muted}
              fontSize={12}
              fontWeight="600"
              textAnchor="end"
            >
              {row.note}
            </SvgText>
            <Path
              d={pulseTracePath({ width: 338, top: row.top, bottom: row.bottom, beats: row.beats })}
              fill="none"
              stroke={row.color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {row.beats.map((x) => (
              <Circle
                key={x}
                cx={x}
                cy={row.top}
                r={3.5}
                fill={row.color}
                stroke={colors.plotPanel}
                strokeWidth={1.5}
              />
            ))}
          </G>
        ))}
        <Path d="M16 172H322" stroke={panelArt.grid} strokeWidth={1} />
        <Path d="M314 168 322 172 314 176" fill="none" stroke={panelArt.grid} strokeWidth={1.25} />
        <SvgText x={16} y={166} fill={panelArt.muted} fontSize={10}>
          {t('learn.ch3.timeWord')}
        </SvgText>
      </PanelFigure>
      <View style={{ paddingHorizontal: spacing.xs, paddingTop: spacing.md }}>
        <AppText variant="subheadline" tone="textDim">
          {t('learn.ch3.heroCaption')}
        </AppText>
      </View>
    </GraphicCard>
  );
}

const feltBeats = [14, 60, 80, 140, 160, 205];

export function SilentCard() {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  return (
    <GraphicCard label={t('learn.ch3.silentLabel')}>
      <View style={{ gap: spacing.md }}>
        <CardHeading
          icon="muted"
          tone="amber"
          title={t('learn.ch3.silentTitle')}
          subtitle={t('learn.ch3.silentSub')}
        />
        <Figure width={338} height={112}>
          <Path d="M22 112C22 84 40 70 62 70S102 84 102 112Z" fill={colors.buttonFill} />
          <Path d="M54 60h16v14a8 8 0 0 1-16 0Z" fill={colors.illustrationSkin} />
          <Circle cx={62} cy={40} r={22} fill={colors.illustrationSkin} />
          <Path
            d="M40 38C40 22 50 16 62 16S86 22 86 36C80 30 70 27 60 28 52 29 46 32 40 38Z"
            fill={colors.illustrationHair}
          />
          <Path d="M53 42h5M66 42h5" stroke={colors.illustrationHair} strokeWidth={2} strokeLinecap="round" />
          <Path
            d="M55 51C59 54 65 54 69 51"
            fill="none"
            stroke={colors.illustrationHair}
            strokeWidth={2}
            strokeLinecap="round"
          />
          <Circle cx={100} cy={36} r={3} fill={colors.accentTint} />
          <Circle cx={109} cy={28} r={4.5} fill={colors.accentTint} />
          <Rect x={118} y={6} width={128} height={36} rx={18} fill={colors.accentTint} />
          <SvgText x={182} y={29} fill={colors.accent} fontSize={15} fontWeight="600" textAnchor="middle">
            {t('learn.ch3.feelFine')}
          </SvgText>
          <Rect x={114} y={54} width={224} height={44} rx={12} fill={colors.flagBg} />
          <Path
            d={pulseTracePath({ width: 220, top: 62, bottom: 90, beats: feltBeats.map((x) => x + 2) })}
            transform="translate(116 0)"
            fill="none"
            stroke={colors.pulse}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <SvgText x={338} y={110} fill={colors.flag} fontSize={12} fontWeight="600" textAnchor="end">
            {t('learn.ch3.unevenBeats')}
          </SvgText>
        </Figure>
      </View>
    </GraphicCard>
  );
}

export function StrokeRiskCard() {
  const { t } = useTranslation();
  const { colors, isDark, spacing } = useTheme();
  const onBar = isDark ? colors.onAccentFill : colors.onButtonFill;
  return (
    <GraphicCard>
      <View style={{ gap: spacing.md }}>
        <CardHeading
          icon="heart"
          tone="pulse"
          title={t('learn.ch3.riskTitle')}
          subtitle={t('learn.ch3.riskSub')}
        />
        <View accessible accessibilityRole="image" accessibilityLabel={t('learn.ch3.riskLabel')}>
          <Figure width={338} height={76}>
            <SvgText x={0} y={21} fill={colors.text} fontSize={15} fontWeight="600">
              {t('learn.ch3.without')}
            </SvgText>
            <Rect x={112} y={6} width={40} height={20} rx={6} fill={colors.line2} />
            <SvgText x={160} y={21} fill={colors.textDim} fontSize={13} fontWeight="600">
              {t('learn.ch3.once')}
            </SvgText>
            <SvgText x={0} y={65} fill={colors.text} fontSize={15} fontWeight="600">
              {t('learn.ch3.with')}
            </SvgText>
            <Rect x={112} y={50} width={200} height={20} rx={6} fill={colors.pulse} />
            <SvgText x={304} y={65} fill={onBar} fontSize={13} fontWeight="700" textAnchor="end">
              {t('learn.ch3.fiveTimes')}
            </SvgText>
          </Figure>
        </View>
        <AppText variant="caption" tone="textDim">
          {t('learn.ch3.riskNote')}
        </AppText>
        <TileRow
          tone="teal"
          background="tint"
          solid
          sideBySide
          tiles={[
            { icon: 'clock', label: t('learn.ch3.earlyMatters') },
            { icon: 'doctor', label: t('learn.ch3.treatments') },
          ]}
        />
      </View>
    </GraphicCard>
  );
}

const READINGS = [
  { x: 60, steady: true },
  { x: 170, steady: false },
  { x: 280, steady: false },
] as const;

export function DayOfReadings() {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const dayNames = [t('learn.ch3.morning'), t('learn.ch3.midday'), t('learn.ch3.evening')];
  return (
    <GraphicCard>
      <View style={{ gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <AppText style={{ flex: 1, fontSize: 15, lineHeight: 20, fontWeight: '600' }}>
            {t('learn.ch3.dayTitle')}
          </AppText>
          <AppText variant="caption1" style={{ color: colors.flag, fontWeight: '600', flexShrink: 1 }}>
            {t('learn.ch3.repeatsWithin')}
          </AppText>
        </View>
        <View accessible accessibilityRole="image" accessibilityLabel={t('learn.ch3.dayLabel')}>
          <Figure width={338} height={58}>
            <Path d="M0 30H338" stroke={colors.surface3} strokeWidth={2} />
            <Path
              d="M170 8C190 0 260 0 280 8"
              fill="none"
              stroke={colors.flag}
              strokeWidth={1.5}
              strokeDasharray="3 3"
            />
            {READINGS.map(({ x, steady }, index) => (
              <G key={x}>
                <Circle cx={x} cy={30} r={15} fill={steady ? colors.accentTint : colors.flagBg} />
                <Circle cx={x} cy={30} r={11} fill={steady ? colors.buttonFill : colors.flag} />
                <Path
                  d={
                    steady
                      ? `M${x - 4.5} 30.5 ${x - 1} 34 ${x + 5} 27`
                      : `M${x - 6} 31h2.5l1.5-4 2 8 1.5-4h2.5`
                  }
                  fill="none"
                  stroke={steady ? colors.onButtonFill : colors.bg}
                  strokeWidth={steady ? 2.25 : 1.75}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <SvgText x={x} y={56} fill={colors.textDim} fontSize={12} textAnchor="middle">
                  {dayNames[index]}
                </SvgText>
              </G>
            ))}
          </Figure>
        </View>
        <StepList
          steps={[
            { icon: 'retake', tone: 'amber', solid: false, label: t('learn.ch3.stepRepeat') },
            { icon: 'rhythm', tone: 'amber', solid: true, label: t('learn.ch3.stepSays') },
            { icon: 'report', tone: 'teal', solid: false, label: t('learn.ch3.stepShare') },
            { icon: 'doctor', tone: 'teal', solid: true, label: t('learn.ch3.stepConfirm') },
          ]}
        />
        <NoteBanner icon="notice" tone="amber" text={t('learn.ch3.notDiagnosis')} />
      </View>
    </GraphicCard>
  );
}

export function FirstStepTiles() {
  const { t } = useTranslation();
  return (
    <TileRow
      tone="teal"
      background="card"
      tiles={[
        { icon: 'seated', label: t('learn.ch3.sitStill') },
        { icon: 'retake', label: t('learn.ch3.retake') },
        { icon: 'doctor', label: t('learn.ch3.repeatsSee') },
      ]}
    />
  );
}
