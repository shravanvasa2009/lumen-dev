import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { EvidenceBadge } from '@/components/EvidenceBadge';
import { Icon } from '@/components/Icon';
import { useTheme } from '@/theme';

import type { CheckingItem } from './checkingItems';

// A pending check shows the clock icon alone, since the row's own title already says Checking.
// Only colour and the icon change as a check fills in: nothing moves on the capture screen (ADR 0075).
export function CheckingRow({ items }: { items: readonly CheckingItem[] }) {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.md,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
        borderRadius: radius.card,
        backgroundColor: colors.surface,
        borderColor: colors.line,
        borderWidth: 1,
      }}
    >
      <AppText variant="caption" tone="textDim" style={{ paddingTop: 2 }}>
        {t('checks.checking')}
      </AppText>
      <View
        style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.lg, rowGap: spacing.sm }}
      >
        {items.map(({ id, state }) => {
          const name = {
            afib: t('checks.afib.name'),
            hrv: t('checks.hrv.name'),
            diabetes: t('checks.diabetes.name'),
          }[id];
          const word = {
            ready: t('checks.state.ready'),
            checking: t('checks.state.working'),
            unavailable: t('checks.state.unavailable'),
          }[state];
          const ready = state === 'ready';
          return (
            <View key={id} accessible accessibilityLabel={`${name}, ${word}`} style={{ gap: spacing.xs }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                <Icon
                  name={ready ? 'check' : state === 'unavailable' ? 'lock' : 'clock'}
                  size={16}
                  color={ready ? colors.accent : colors.textDim}
                />
                <AppText style={{ fontWeight: '600', color: ready ? colors.accent : colors.text }}>
                  {name}
                </AppText>
              </View>
              {state === 'checking' ? null : (
                <AppText variant="caption" tone="textDim">
                  {word}
                </AppText>
              )}
              {id === 'diabetes' ? <EvidenceBadge metric="diabetes" /> : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}
