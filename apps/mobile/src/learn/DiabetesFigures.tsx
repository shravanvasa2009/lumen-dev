import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { G, Path, Rect, Circle, Text as SvgText } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme';

import { panelArt, pulseTracePath, singleBeatPath } from './chapterArt';
import { ChapterIcon } from './chapterIcons';
import {
  CardHeading,
  Figure,
  GraphicCard,
  IconTile,
  NoteBanner,
  PanelFigure,
  StepList,
  useToneLook,
} from './ChapterParts';

const TRACE_BEATS = [63, 133, 203, 273];

export function PulseWaveHero() {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  return (
    <GraphicCard label={t('learn.diabetes.heroLabel')} inset="md">
      <PanelFigure width={338} height={184}>
        <SvgText x={16} y={18} fill={colors.onPlot} fontSize={13} fontWeight="600">
          {t('learn.diabetes.heroTitle')}
        </SvgText>
        <Path
          d={pulseTracePath({ width: 306, top: 4, bottom: 48, beats: TRACE_BEATS })}
          transform="translate(16 22)"
          fill="none"
          stroke={panelArt.pulseRed}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Rect
          x={59}
          y={26}
          width={55}
          height={44}
          rx={8}
          fill="#FFFFFF"
          fillOpacity={0.06}
          stroke="#FFFFFF"
          strokeOpacity={0.7}
          strokeWidth={1.25}
          strokeDasharray="3 3"
        />
        <Path d="M59 70 100 98M114 70 238 98" stroke="#FFFFFF" strokeOpacity={0.35} strokeWidth={1} />
        <Rect x={100} y={98} width={138} height={76} rx={12} fill={panelArt.inset} />
        <Path
          d={singleBeatPath(138, 76, false)}
          transform="translate(100 98)"
          fill="none"
          stroke={panelArt.pulseRed}
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <SvgText x={248} y={130} fill={panelArt.teal} fontSize={12} fontWeight="600">
          {t('learn.diabetes.eachBeat')}
        </SvgText>
        <SvgText x={248} y={146} fill={panelArt.teal} fontSize={12} fontWeight="600">
          {t('learn.diabetes.hasShape')}
        </SvgText>
      </PanelFigure>
      <View style={{ paddingHorizontal: spacing.xs, paddingTop: spacing.md }}>
        <AppText variant="subheadline" tone="textDim">
          {t('learn.diabetes.heroCaption')}
        </AppText>
      </View>
    </GraphicCard>
  );
}

function ShapeSample({ changed, label }: { changed: boolean; label: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, minWidth: 0, gap: 8 }}>
      <PanelFigure width={163} height={100}>
        <Path d="M12 86H151" stroke={panelArt.grid} strokeWidth={1} />
        <Path
          d={singleBeatPath(112, 64, changed)}
          transform="translate(25.5 22)"
          fill="none"
          stroke={changed ? panelArt.amber : panelArt.teal}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </PanelFigure>
      <AppText
        style={{
          fontSize: 15,
          lineHeight: 20,
          fontWeight: '700',
          color: changed ? colors.flag : colors.accent,
        }}
      >
        {label}
      </AppText>
    </View>
  );
}

export function VesselChain() {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const links = [
    { icon: 'clock', title: t('learn.diabetes.chainDiabetes'), sub: t('learn.diabetes.chainOverTime') },
    { icon: 'vessels', title: t('learn.diabetes.chainVessels'), sub: t('learn.diabetes.chainVesselsSub') },
    { icon: 'rhythm', title: t('learn.diabetes.chainShape'), sub: t('learn.diabetes.chainShapeSub') },
  ] as const;
  return (
    <GraphicCard label={t('learn.diabetes.chainLabel')}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 4 }}>
        {links.map((link, index) => (
          <View
            key={link.icon}
            style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 4, minWidth: 0 }}
          >
            <View style={{ flex: 1, minWidth: 0, alignItems: 'center' }}>
              <IconTile icon={link.icon} tone="teal" solid={false} />
              <AppText
                style={{ marginTop: 8, fontSize: 15, lineHeight: 20, fontWeight: '600', textAlign: 'center' }}
              >
                {link.title}
              </AppText>
              <AppText variant="caption" tone="textDim" style={{ textAlign: 'center' }}>
                {link.sub}
              </AppText>
            </View>
            {index < links.length - 1 ? (
              <View style={{ marginTop: 11 }}>
                <ChapterIcon name="arrow" size={14} color={colors.accent} weight={2.5} />
              </View>
            ) : null}
          </View>
        ))}
      </View>
      <View style={{ height: 0.5, backgroundColor: colors.line, marginVertical: spacing.lg }} />
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <ShapeSample changed={false} label={t('learn.diabetes.sampleOne')} />
        <ShapeSample changed label={t('learn.diabetes.sampleChanged')} />
      </View>
      <AppText variant="caption" tone="textDim" style={{ marginTop: spacing.md }}>
        {t('learn.diabetes.illustrationOnly')}
      </AppText>
    </GraphicCard>
  );
}

export function LinkedPatternCard() {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  return (
    <GraphicCard>
      <View style={{ gap: spacing.md }}>
        <CardHeading
          icon="rhythm"
          tone="amber"
          title={t('learn.diabetes.linkedTitle')}
          subtitle={t('learn.diabetes.linkedSub')}
        />
        <View accessible accessibilityRole="image" accessibilityLabel={t('learn.diabetes.compareLabel')}>
          <Figure width={338} height={104}>
            <Rect x={0} y={0} width={140} height={72} rx={14} fill={colors.surface2} />
            <Path
              d={singleBeatPath(112, 60, false)}
              transform="translate(14 6)"
              fill="none"
              stroke={colors.pulse}
              strokeWidth={2.25}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <Rect
              x={198.75}
              y={0.75}
              width={138.5}
              height={70.5}
              rx={14}
              fill={colors.flagBg}
              stroke={colors.flag}
              strokeWidth={1.5}
              strokeDasharray="4 4"
            />
            <Path
              d={singleBeatPath(112, 60, true)}
              transform="translate(212 6)"
              fill="none"
              stroke={colors.flag}
              strokeWidth={2.25}
              strokeDasharray="5 4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <Circle cx={169} cy={36} r={17} fill={colors.flagBg} />
            <SvgText x={169} y={41} fill={colors.flag} fontSize={13} fontWeight="700" textAnchor="middle">
              {t('learn.diabetes.versus')}
            </SvgText>
            <G fill={colors.textDim} fontSize={12} fontWeight="600" textAnchor="middle">
              <SvgText x={70} y={88}>
                {t('learn.diabetes.yourShape')}
              </SvgText>
              <SvgText x={268} y={88}>
                {t('learn.diabetes.patternLinked')}
              </SvgText>
              <SvgText x={268} y={102}>
                {t('learn.diabetes.inResearch')}
              </SvgText>
            </G>
          </Figure>
        </View>
        <NoteBanner icon="notice" tone="amber" text={t('learn.diabetes.notATest')} />
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
          <ChapterIcon name="camera" size={18} color={colors.textDim} weight={1.9} />
          <AppText variant="caption" tone="textDim" style={{ flex: 1 }}>
            {t('learn.diabetes.needsFrames')}
          </AppText>
        </View>
      </View>
    </GraphicCard>
  );
}

export function BloodTestCard() {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const look = useToneLook();
  const sides = [
    {
      icon: 'camera',
      tone: 'neutral',
      title: t('learn.diabetes.lumenWord'),
      sub: t('learn.diabetes.lumenCan'),
    },
    { icon: 'bloodDrop', tone: 'teal', title: t('learn.diabetes.a1cTest'), sub: t('learn.diabetes.a1cOnly') },
  ] as const;
  return (
    <GraphicCard>
      <View style={{ gap: spacing.lg }}>
        <View
          accessibilityRole="list"
          accessibilityLabel={t('learn.diabetes.sidesLabel')}
          style={{ flexDirection: 'row', gap: spacing.sm }}
        >
          {sides.map((side) => (
            <View
              key={side.title}
              style={{
                flex: 1,
                minWidth: 0,
                padding: 12,
                borderRadius: 20,
                backgroundColor: look(side.tone).tint,
              }}
            >
              <IconTile icon={side.icon} tone={side.tone} />
              <AppText variant="headline" style={{ marginTop: 8 }}>
                {side.title}
              </AppText>
              <AppText variant="caption" tone="textDim" style={{ marginTop: 2 }}>
                {side.sub}
              </AppText>
            </View>
          ))}
        </View>
        <StepList
          steps={[
            { icon: 'retake', tone: 'amber', solid: false, label: t('learn.diabetes.stepRepeat') },
            { icon: 'doctor', tone: 'teal', solid: false, label: t('learn.diabetes.stepTalk') },
            { icon: 'bloodDrop', tone: 'teal', solid: true, label: t('learn.diabetes.stepA1c') },
          ]}
        />
      </View>
    </GraphicCard>
  );
}
