import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { ListRow } from '@/components/ListRow';
import { useTheme } from '@/theme';

import { lessonLength, lessons } from './lessons';
import type { ReadProgress } from './readProgress';

const STATE_SIZE = 22;
const RING_RADIUS = 8.5;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;
const NUMBER_TILE = 36;

function ReadState({ percent }: { percent: number }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const label =
    percent >= 100
      ? t('learn.stateRead')
      : percent > 0
        ? t('learn.stateReading', { percent })
        : t('learn.stateNew');
  return (
    <Svg width={STATE_SIZE} height={STATE_SIZE} viewBox="0 0 22 22" accessibilityLabel={label}>
      {percent >= 100 ? (
        <>
          <Circle cx={11} cy={11} r={10} fill={colors.accent} />
          <Path
            d="M6.5 11.25l3 3 6-6.5"
            fill="none"
            stroke={colors.surface}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : percent > 0 ? (
        <>
          <Circle cx={11} cy={11} r={RING_RADIUS} fill="none" stroke={colors.line2} strokeWidth={2.5} />
          <Circle
            cx={11}
            cy={11}
            r={RING_RADIUS}
            fill="none"
            stroke={colors.accent}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeDasharray={`${(percent / 100) * RING_LENGTH} ${RING_LENGTH}`}
            transform="rotate(-90 11 11)"
          />
        </>
      ) : (
        <Circle cx={11} cy={11} r={9} fill="none" stroke={colors.textFaint} strokeWidth={1.5} />
      )}
    </Svg>
  );
}

export function ChapterList({ progress }: { progress: ReadProgress }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors } = useTheme();
  return (
    <Card flush>
      {lessons.map((lesson, index) => (
        <ListRow
          key={lesson.slug}
          leading={
            <View
              style={{
                width: NUMBER_TILE,
                height: NUMBER_TILE,
                borderRadius: 10,
                backgroundColor: colors.accentTint,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <AppText variant="headline" tone="accent">
                {index + 1}
              </AppText>
            </View>
          }
          title={lesson.title(t)}
          subtitle={lessonLength(t, lesson)}
          trailing={<ReadState percent={progress[lesson.slug] ?? 0} />}
          last={index === lessons.length - 1}
          onPress={() => router.push({ pathname: '/learn/[slug]', params: { slug: lesson.slug } })}
        />
      ))}
    </Card>
  );
}
