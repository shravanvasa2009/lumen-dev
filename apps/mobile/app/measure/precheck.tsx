import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon, type IconName } from '@/components/Icon';
import { ListRow } from '@/components/ListRow';
import { NavButton } from '@/components/NavButton';
import { Screen } from '@/components/Screen';
import { SectionLabel } from '@/components/SectionLabel';
import { ContextChip } from '@/measure/ContextChip';
import { parseMode } from '@/measure/mode';
import { RestRing } from '@/measure/RestRing';
import { formatClock, REST_SECONDS, useRestTimer } from '@/measure/restTimer';
import { useTheme } from '@/theme';

type Context = 'caffeine' | 'exercise' | 'ill' | 'medication';

export default function PrecheckScreen() {
  const { t } = useTranslation();
  const { colors, spacing, control } = useTheme();
  const mode = parseMode(useLocalSearchParams<{ mode?: string }>().mode);
  const { remaining, finished, skip } = useRestTimer(REST_SECONDS);
  const [selected, setSelected] = useState<ReadonlySet<Context>>(new Set());
  const chips: readonly { context: Context; label: string; icon?: IconName }[] = [
    { context: 'caffeine', label: t('precheck.caffeine'), icon: 'cup' },
    { context: 'exercise', label: t('precheck.exercise') },
    { context: 'ill', label: t('precheck.ill') },
    { context: 'medication', label: t('precheck.medication') },
  ];
  const reminders: readonly { icon: IconName; color: string; text: string }[] = [
    { icon: 'finger', color: colors.pulse, text: t('precheck.reminderFlat') },
    { icon: 'elbow', color: colors.accent, text: t('precheck.reminderElbows') },
    { icon: 'warm', color: colors.flag, text: t('precheck.reminderWarm') },
  ];
  const toggle = (context: Context) => {
    const next = new Set(selected);
    if (!next.delete(context)) next.add(context);
    setSelected(next);
  };

  return (
    <Screen
      footer={
        <NavButton
          label={t('precheck.start')}
          href={{
            pathname: '/measure/capture',
            params: { mode, restDone: String(finished), context: [...selected].join(',') },
          }}
        />
      }
    >
      <ScrollView contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.lg }}>
        <AppText variant="title" accessibilityRole="header">
          {t('precheck.title')}
        </AppText>
        <View style={{ alignItems: 'center', gap: spacing.sm }}>
          <RestRing
            elapsed={1 - remaining / REST_SECONDS}
            clock={formatClock(remaining)}
            caption={remaining === 0 ? t('precheck.restDone') : t('precheck.rest')}
          />
          {remaining > 0 ? <Button label={t('precheck.skip')} variant="link" onPress={skip} /> : null}
        </View>
        <SectionLabel>{t('precheck.lastHours')}</SectionLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
          {chips.map(({ context, label, icon }) => (
            <ContextChip
              key={context}
              label={label}
              icon={icon}
              selected={selected.has(context)}
              onToggle={() => toggle(context)}
            />
          ))}
        </View>
        <SectionLabel>{t('precheck.reminders')}</SectionLabel>
        <Card flush>
          {reminders.map(({ icon, color, text }, index) => (
            <ListRow
              key={text}
              title={text}
              last={index === reminders.length - 1}
              leading={<Icon name={icon} size={control.chevronSize} color={color} />}
            />
          ))}
        </Card>
      </ScrollView>
    </Screen>
  );
}
