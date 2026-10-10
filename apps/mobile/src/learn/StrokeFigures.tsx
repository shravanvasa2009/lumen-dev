import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { ClipPath, Circle, Defs, G, Path, Rect, Text as SvgText } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { callNumber } from '@/profile/dial';
import { useTheme } from '@/theme';

import { ChapterIcon } from './chapterIcons';
import { Figure } from './ChapterParts';

// The acronym letters are the same in both languages; only the words beside them are translated.
export type StrokeSign = 'balance' | 'eyes' | 'face' | 'arm' | 'speech' | 'time';

export const strokeLetters: Readonly<Record<StrokeSign, string>> = {
  balance: 'B',
  eyes: 'E',
  face: 'F',
  arm: 'A',
  speech: 'S',
  time: 'T',
};

// Eyeball white and iris are fixed art colours, the same in light and dark.
const eye = { white: '#FFFFFF', iris: '#6B4A2E', pupil: '#1C1C1E', shade: '#1C1C1E' } as const;

function SignArt({ sign }: { sign: StrokeSign }) {
  const { colors } = useTheme();
  const skin = colors.illustrationSkin;
  const hair = colors.illustrationHair;
  const mark = colors.alertText;
  const person = (
    <>
      <Circle cx={56} cy={24} r={11} fill={skin} />
      <Path d="M45 22C45 14 50 11 56 11S67 14 67 21C62 17 52 16 45 22Z" fill={hair} />
    </>
  );
  if (sign === 'balance')
    return (
      <>
        <Path d="M14 104H98" stroke={colors.line2} strokeWidth={3} strokeLinecap="round" />
        <G rotation={-14} origin="56, 102">
          <Circle cx={56} cy={24} r={11} fill={skin} />
          <Path d="M45 22C45 14 50 11 56 11S67 14 67 21C62 17 52 16 45 22Z" fill={hair} />
          <Rect x={45} y={38} width={22} height={36} rx={9} fill={colors.illustrationTorso} />
          <Path d="M46 44 22 56M66 44 90 34" stroke={skin} strokeWidth={7} strokeLinecap="round" />
          <Path
            d="M50 72 46 101M62 72 66 101"
            stroke={colors.illustrationDevice}
            strokeWidth={8}
            strokeLinecap="round"
          />
        </G>
        <Path
          d="M82 10a8 8 0 1 1-8 8 5 5 0 0 1 5-5 3 3 0 0 1 3 3"
          fill="none"
          stroke={mark}
          strokeWidth={2.25}
          strokeLinecap="round"
        />
        <Path
          d="M22 78c-6 4-8 10-6 16M96 72c6 4 8 10 6 16"
          fill="none"
          stroke={mark}
          strokeWidth={2.25}
          strokeLinecap="round"
          opacity={0.7}
        />
      </>
    );
  if (sign === 'eyes')
    return (
      <>
        <Defs>
          <ClipPath id="strokeEye">
            <Path d="M12 56C28 28 84 28 100 56C84 84 28 84 12 56Z" />
          </ClipPath>
        </Defs>
        <Path d="M12 56C28 28 84 28 100 56C84 84 28 84 12 56Z" fill={eye.white} />
        <G clipPath="url(#strokeEye)">
          <Circle cx={56} cy={56} r={19} fill={eye.iris} />
          <Circle cx={56} cy={56} r={8} fill={eye.pupil} />
          <Circle cx={61} cy={51} r={3} fill={eye.white} />
          <Rect x={56} y={20} width={50} height={72} fill={eye.shade} opacity={0.62} />
        </G>
        <Path
          d="M12 56C28 28 84 28 100 56C84 84 28 84 12 56Z"
          fill="none"
          stroke={hair}
          strokeWidth={2.5}
          strokeLinejoin="round"
        />
        <Path d="M56 18V94" stroke={mark} strokeWidth={2.25} strokeDasharray="4 4" strokeLinecap="round" />
      </>
    );
  if (sign === 'face')
    return (
      <>
        <Circle cx={56} cy={58} r={38} fill={skin} />
        <Path d="M18 54C18 30 34 18 56 18S94 30 94 52C84 40 70 36 56 36S28 42 18 54Z" fill={hair} />
        <Circle cx={42} cy={56} r={3.5} fill={hair} />
        <Path d="M66 58h8" stroke={hair} strokeWidth={3} strokeLinecap="round" />
        <Path
          d="M38 72C44 79 52 79 57 76C63 74 67 78 72 83"
          fill="none"
          stroke={hair}
          strokeWidth={3}
          strokeLinecap="round"
        />
        <Path
          d="M88 66V82M83.5 78 88 82.5 92.5 78"
          fill="none"
          stroke={mark}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </>
    );
  if (sign === 'arm')
    return (
      <>
        {person}
        <Rect x={45} y={38} width={22} height={38} rx={9} fill={colors.illustrationTorso} />
        <Path d="M47 44H16" stroke={skin} strokeWidth={7} strokeLinecap="round" />
        <Path d="M65 44 88 66" stroke={skin} strokeWidth={7} strokeLinecap="round" />
        <Path
          d="M50 74 48 104M62 74 64 104"
          stroke={colors.illustrationDevice}
          strokeWidth={8}
          strokeLinecap="round"
        />
        <Path
          d="M94 42V58M89.5 54 94 58.5 98.5 54"
          fill="none"
          stroke={mark}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Path d="M16 34H48" stroke={colors.textFaint} strokeWidth={1.5} strokeDasharray="3 3" />
      </>
    );
  if (sign === 'speech')
    return (
      <>
        <Circle cx={32} cy={76} r={20} fill={skin} />
        <Path d="M12 74C12 62 20 56 32 56S52 62 52 72C46 66 38 64 30 65 22 66 16 69 12 74Z" fill={hair} />
        <Circle cx={40} cy={76} r={2.5} fill={hair} />
        <Path d="M42 86c2 1 4 1 6 0" fill="none" stroke={hair} strokeWidth={2.5} strokeLinecap="round" />
        <Path
          d="M50 12H96A10 10 0 0 1 106 22V46A10 10 0 0 1 96 56H66L56 66V56H50A10 10 0 0 1 40 46V22A10 10 0 0 1 50 12Z"
          fill={colors.surface}
          stroke={colors.line}
          strokeWidth={2}
        />
        <Path
          d="M52 34c3-7 6 7 9 0s6 7 9 0 6 7 9 0 6 7 9 0"
          fill="none"
          stroke={mark}
          strokeWidth={2.5}
          strokeLinecap="round"
        />
      </>
    );
  return (
    <>
      <Circle cx={42} cy={56} r={30} fill={colors.surface} stroke={hair} strokeWidth={3} />
      <Path d="M42 32v3M42 77v3M18 56h3M63 56h3" stroke={hair} strokeWidth={2.5} strokeLinecap="round" />
      <Path d="M42 56V40M42 56l11 7" stroke={mark} strokeWidth={3} strokeLinecap="round" />
      <Circle cx={42} cy={56} r={3} fill={mark} />
      <Rect x={74} y={30} width={30} height={54} rx={7} fill={colors.illustrationDevice} />
      <Rect x={77} y={36} width={24} height={40} rx={3} fill={colors.alertFill} />
      <SvgText x={89} y={61} fill={colors.onAlertFill} fontSize={10} fontWeight="700" textAnchor="middle">
        911
      </SvgText>
    </>
  );
}

const ART_SIZE = 112;

export function SignPicture({ sign, label, onTint }: { sign: StrokeSign; label: string; onTint: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={{
        width: ART_SIZE,
        height: ART_SIZE,
        borderRadius: 20,
        overflow: 'hidden',
        backgroundColor: onTint ? colors.surface : colors.alertTint,
      }}
    >
      <Figure width={ART_SIZE} height={ART_SIZE}>
        <SignArt sign={sign} />
      </Figure>
    </View>
  );
}

export function Call911Button() {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  const [callFailed, setCallFailed] = useState(false);
  return (
    <View style={{ gap: spacing.sm }}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t('emergency.call')}
        onPress={() => void callNumber('911').then((opened) => setCallFailed(!opened))}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          height: 56,
          borderRadius: radius.pill,
          backgroundColor: colors.alertFill,
        }}
      >
        <ChapterIcon name="phone" size={20} color={colors.onAlertFill} weight={2} />
        <AppText variant="headline" style={{ color: colors.onAlertFill }}>
          {t('emergency.call')}
        </AppText>
      </PressableScale>
      {callFailed ? (
        <AppText accessibilityRole="alert" tone="alertText" style={{ textAlign: 'center' }}>
          {t('emergency.callFailed')}
        </AppText>
      ) : null}
    </View>
  );
}
