import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { Icon, type IconName } from '@/components/Icon';
import { useTheme } from '@/theme';

import { PostureFigure } from './PostureFigure';
import { SafetyCard } from './SafetyCard';

const FIGURE_HEIGHT = 56;
const PREVIEW = { width: 300, height: 96, flatY: 66, raisedY: 22, thresholdY: 30, standAt: 120 };
const LYING_SHARE = 1;
const STANDING_SHARE = 2;

// Five minutes lying, ten standing: the bars are as wide as the steps are long.
function Timeline() {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  const minutes = (count: number) => t('standing.minuteMark', { count });
  return (
    <Card>
      <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' }}>
        <View style={{ flex: LYING_SHARE, gap: spacing.xs }}>
          <PostureFigure posture="lying" height={FIGURE_HEIGHT} />
          <View style={{ height: 8, borderRadius: radius.pill, backgroundColor: colors.accentTint }} />
          <AppText variant="headline">{t('standing.stage.lying')}</AppText>
          <AppText variant="caption" tone="textDim">
            {minutes(5)}
          </AppText>
        </View>
        <View style={{ flex: STANDING_SHARE, gap: spacing.xs }}>
          <PostureFigure posture="standing" height={FIGURE_HEIGHT} />
          <View style={{ height: 8, borderRadius: radius.pill, backgroundColor: colors.accent }} />
          <AppText variant="headline">{t('standing.stage.standing')}</AppText>
          <AppText variant="caption" tone="textDim">
            {minutes(10)}
          </AppText>
        </View>
      </View>
      <AppText tone="textDim">{t('standing.about')}</AppText>
    </Card>
  );
}

// What the result will look like, without numbers: flat while lying, then a rise toward the line.
function RisePreview({ thresholdBpm }: { thresholdBpm: number | null }) {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const { width, height, flatY, raisedY, thresholdY, standAt } = PREVIEW;
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <Icon name="pulse" size={22} color={colors.accent} />
        <View style={{ flex: 1 }}>
          <AppText variant="headline">{t('standing.chartLabel')}</AppText>
          <AppText variant="caption" tone="textDim">
            {t('standing.measuresBody')}
          </AppText>
        </View>
      </View>
      <Svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        style={{ aspectRatio: width / height }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Line
          x1={0}
          x2={width}
          y1={thresholdY}
          y2={thresholdY}
          stroke={colors.alertFill}
          strokeWidth={1.5}
          strokeDasharray="5 4"
        />
        <Line
          x1={standAt}
          x2={standAt}
          y1={8}
          y2={height - 8}
          stroke={colors.line2}
          strokeWidth={1}
          strokeDasharray="2 4"
        />
        <Path
          d={`M0 ${flatY} L${standAt - 10} ${flatY} C${standAt} ${flatY} ${standAt + 8} ${raisedY + 14} ${standAt + 40} ${raisedY + 10} S${width - 40} ${raisedY + 2} ${width - 6} ${raisedY + 6}`}
          fill="none"
          stroke={colors.accent}
          strokeWidth={3}
          strokeLinecap="round"
        />
        <Circle cx={width - 6} cy={raisedY + 6} r={4.5} fill={colors.accent} />
      </Svg>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <AppText variant="caption" tone="textFaint">
          {t('standing.chartLying')}
        </AppText>
        <AppText variant="caption" style={{ color: colors.alertText }}>
          {thresholdBpm === null
            ? t('standing.thresholdUnknown')
            : t('standing.threshold', { bpm: thresholdBpm })}
        </AppText>
      </View>
      <AppText variant="caption" tone="textDim">
        {t('standing.scope')}
      </AppText>
    </Card>
  );
}

function Need({ icon, text }: { icon: IconName; text: string }) {
  const { colors, spacing } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
      <Icon name={icon} size={22} color={colors.accent} />
      <AppText style={{ flex: 1 }}>{text}</AppText>
    </View>
  );
}

export function StandingIntro({ thresholdBpm }: { thresholdBpm: number | null }) {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  return (
    <View style={{ gap: spacing.md }}>
      <Timeline />
      <RisePreview thresholdBpm={thresholdBpm} />
      <Card>
        <AppText variant="headline">{t('standing.needTitle')}</AppText>
        <Need icon="elbow" text={t('standing.needLie')} />
        <Need icon="hint" text={t('standing.needSteady')} />
      </Card>
      <SafetyCard title={t('standing.warning')} text={t('standing.safety')} />
    </View>
  );
}
