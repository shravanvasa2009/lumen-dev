import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import type { IconName } from '@/components/Icon';
import { ListRow } from '@/components/ListRow';
import { NavButton } from '@/components/NavButton';
import { Screen } from '@/components/Screen';
import { ContextRow } from '@/measure/ContextRow';
import { parseMode } from '@/measure/mode';
import { conclusiveCount, READINGS_BEFORE_COLLAPSE, ReminderRows } from '@/measure/reminders';
import { RestRing } from '@/measure/RestRing';
import { ScanChecks } from '@/measure/ScanChecks';
import { formatClock, REST_SECONDS, useRestTimer } from '@/measure/restTimer';
import { SectionLabel } from '@/settings/SectionLabel';
import { useStoredReadings } from '@/store/useStoredReadings';
import { useTheme } from '@/theme';

type Context = 'caffeine' | 'exercise' | 'ill' | 'medication';

export default function PrecheckScreen() {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const mode = parseMode(useLocalSearchParams<{ mode?: string }>().mode);
  const { remaining, finished, skip } = useRestTimer(REST_SECONDS);
  const folded = conclusiveCount(useStoredReadings()) >= READINGS_BEFORE_COLLAPSE;
  const [tipsOpen, setTipsOpen] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<Context>>(new Set());
  const contexts: readonly { context: Context; label: string; icon: IconName }[] = [
    { context: 'caffeine', label: t('precheck.caffeine'), icon: 'cup' },
    { context: 'exercise', label: t('precheck.exercise'), icon: 'dumbbell' },
    { context: 'ill', label: t('precheck.ill'), icon: 'thermometer' },
    { context: 'medication', label: t('precheck.medication'), icon: 'pill' },
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
      <Stack.Screen options={{ title: t('precheck.title') }} />
      <ScrollView contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.md }}>
        <View style={{ alignItems: 'center', gap: spacing.sm }}>
          <RestRing
            elapsed={1 - remaining / REST_SECONDS}
            clock={formatClock(remaining)}
            caption={remaining === 0 ? t('precheck.restDone') : t('precheck.rest')}
          />
          {remaining > 0 ? <Button label={t('precheck.skip')} variant="link" onPress={skip} /> : null}
        </View>
        <SectionLabel>{t('precheck.lastHours')}</SectionLabel>
        <Card flush>
          {contexts.map(({ context, label, icon }, index) => (
            <ContextRow
              key={context}
              label={label}
              icon={icon}
              selected={selected.has(context)}
              last={index === contexts.length - 1}
              onToggle={() => toggle(context)}
            />
          ))}
        </Card>
        <ScanChecks mode={mode} />
        {folded ? (
          <Card flush>
            <ListRow
              title={t('precheck.reminders')}
              chevron
              expanded={tipsOpen}
              onPress={() => setTipsOpen(!tipsOpen)}
            />
          </Card>
        ) : (
          <SectionLabel>{t('precheck.reminders')}</SectionLabel>
        )}
        {folded && !tipsOpen ? null : <ReminderRows />}
      </ScrollView>
    </Screen>
  );
}
