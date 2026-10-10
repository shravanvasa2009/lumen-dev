import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme';

import { ChapterFrame, GraphicCard, SectionText } from './ChapterParts';
import type { Lesson } from './lessons';
import { Call911Button, SignPicture, type StrokeSign, strokeLetters } from './StrokeFigures';

const LETTER_FONT = { fontSize: 28, lineHeight: 34, fontWeight: '700' } as const;

export function StrokeChapter({ lesson }: { lesson: Lesson }) {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  const [intro, ...signs] = lesson.template.sections;
  const signKeys: readonly StrokeSign[] = ['balance', 'eyes', 'face', 'arm', 'speech', 'time'];
  const pictureLabels: Readonly<Record<StrokeSign, string>> = {
    balance: t('learn.ch4.artBalance'),
    eyes: t('learn.ch4.artEyes'),
    face: t('learn.ch4.artFace'),
    arm: t('learn.ch4.artArm'),
    speech: t('learn.ch4.artSpeech'),
    time: t('learn.ch4.artTime'),
  };
  return (
    <ChapterFrame lesson={lesson} tone="alert">
      {intro ? <SectionText heading={intro.heading(t)} body={intro.body(t)} /> : null}
      <GraphicCard>
        <View style={{ gap: spacing.lg }}>
          <View accessibilityRole="list" accessibilityLabel={t('learn.ch4.rowLabel')} style={{ flexDirection: 'row', gap: 6 }}>
            {signs.map((sign, index) => {
              const key = signKeys[index];
              return key ? (
                <View key={key} style={{ flex: 1, minWidth: 0, alignItems: 'center', gap: 6 }}>
                  <View
                    style={{
                      width: '100%',
                      height: 52,
                      borderRadius: 14,
                      backgroundColor: colors.alertTint,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <AppText style={[LETTER_FONT, { color: colors.alertText }]}>{strokeLetters[key]}</AppText>
                  </View>
                  <AppText
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.7}
                    tone="textDim"
                    style={{ fontSize: 11, lineHeight: 14, fontWeight: '600' }}
                  >
                    {sign.heading(t)}
                  </AppText>
                </View>
              ) : null;
            })}
          </View>
          <Call911Button />
        </View>
      </GraphicCard>
      <View accessibilityRole="list" accessibilityLabel={t('learn.ch4.listLabel')} style={{ gap: 10 }}>
        {signs.map((sign, index) => {
          const key = signKeys[index];
          if (!key) return null;
          const isTime = key === 'time';
          return (
            <View
              key={key}
              style={{
                padding: spacing.lg,
                borderRadius: radius.sheet,
                backgroundColor: isTime ? colors.alertTint : colors.surface,
                gap: spacing.md,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                <SignPicture sign={key} label={pictureLabels[key]} onTint={isTime} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <View
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 10,
                        backgroundColor: colors.alertFill,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <AppText style={{ fontSize: 22, lineHeight: 26, fontWeight: '700', color: colors.onAlertFill }}>
                        {strokeLetters[key]}
                      </AppText>
                    </View>
                    <AppText
                      variant="title"
                      accessibilityRole="header"
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.8}
                      tone={isTime ? 'alertText' : 'text'}
                      style={{ flexShrink: 1 }}
                    >
                      {sign.heading(t)}
                    </AppText>
                  </View>
                  <AppText
                    variant="subheadline"
                    style={{ marginTop: 6, fontWeight: isTime ? '600' : '400' }}
                  >
                    {sign.body(t)}
                  </AppText>
                </View>
              </View>
              {isTime ? <Call911Button /> : null}
            </View>
          );
        })}
      </View>
    </ChapterFrame>
  );
}
