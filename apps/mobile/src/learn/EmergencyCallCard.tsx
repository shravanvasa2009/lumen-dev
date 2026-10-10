import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme';

import { ActionButton, GlyphTile } from './ChapterParts';
import { LessonGlyph } from './LessonGlyph';
import type { GlyphName } from './LessonGlyph';

// The same Call 911 as the Get help now screen: a tel: link, with visible instructions when the phone
// (a simulator, a tablet, a phone without a SIM) cannot open the dialer.
export function useEmergencyCall() {
  const [callFailed, setCallFailed] = useState(false);
  const callEmergency = () => Linking.openURL('tel:911').catch(() => setCallFailed(true));
  return { callEmergency, callFailed };
}

type EmergencySign = { glyph: GlyphName; label: string };

export function EmergencyCallCard({
  signs,
  layout,
  showNotReading,
}: {
  signs: readonly EmergencySign[];
  layout: 'columns' | 'grid';
  showNotReading: boolean;
}) {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  const { callEmergency, callFailed } = useEmergencyCall();
  return (
    <View
      style={{
        backgroundColor: colors.alertTint,
        borderRadius: radius.card,
        padding: spacing.md,
        gap: spacing.md,
      }}
    >
      <View accessibilityRole="list" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {signs.map((sign) => (
          <View
            key={sign.label}
            style={{
              flexBasis: layout === 'columns' ? '30%' : '47%',
              flexGrow: 1,
              flexDirection: layout === 'columns' ? 'column' : 'row',
              alignItems: layout === 'columns' ? 'flex-start' : 'center',
              gap: spacing.sm,
              backgroundColor: colors.surface,
              borderRadius: radius.card - 8,
              padding: spacing.md,
            }}
          >
            <GlyphTile name={sign.glyph} tint={colors.alertTint} color={colors.alertText} size={36} />
            <AppText
              variant={layout === 'columns' ? 'caption' : 'subheadline'}
              style={{ flexShrink: 1, fontWeight: '600' }}
            >
              {sign.label}
            </AppText>
          </View>
        ))}
      </View>
      {showNotReading ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <LessonGlyph name="phoneOff" size={18} color={colors.alertText} />
          <AppText variant="caption" tone="alertText">
            {t('learn.limits.notReading')}
          </AppText>
        </View>
      ) : null}
      <ActionButton label={t('emergency.call')} glyph="call" tone="red" onPress={callEmergency} />
      {callFailed ? (
        <AppText accessibilityLiveRegion="polite" tone="alertText">
          {t('learn.doctor.callFailed')}
        </AppText>
      ) : null}
    </View>
  );
}
