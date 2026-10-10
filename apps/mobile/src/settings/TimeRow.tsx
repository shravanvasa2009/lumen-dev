import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { type ReactNode, useState } from 'react';
import { Platform, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { ListRow } from '@/components/ListRow';
import type { ClockTime } from '@/notifications/localTime';
import { useTheme } from '@/theme';

import { formatClock } from './formatClock';

type TimeRowProps = {
  title: string;
  time: ClockTime;
  languageTag: string;
  leading?: ReactNode;
  last?: boolean;
  onChange: (time: ClockTime) => void;
};

// The dial follows the clock the rows are written in: en shows "7:00 AM", es "7:00". Android takes is24Hour;
// iOS follows the locale, so both are passed.
const usesDayPeriod = (languageTag: string) =>
  new Intl.DateTimeFormat(languageTag, { hour: 'numeric' })
    .formatToParts(new Date(2000, 0, 1, 7))
    .some((part) => part.type === 'dayPeriod');

// Android shows the picker as a dialog while it is mounted; iOS shows it inline under the row until the row is
// tapped again. The date part is arbitrary: only the hour and minute are kept.
export function TimeRow({ title, time, languageTag, leading, last = false, onChange }: TimeRowProps) {
  const { colors, radius, spacing } = useTheme();
  const [open, setOpen] = useState(false);
  const pick = (picked: Date) => {
    if (Platform.OS === 'android') setOpen(false);
    onChange({ hour: picked.getHours(), minute: picked.getMinutes() });
  };
  return (
    <>
      <ListRow
        title={title}
        leading={leading}
        last={last && !open}
        expanded={open}
        onPress={() => setOpen((shown) => !shown)}
        trailing={
          <View
            style={{
              height: 34,
              justifyContent: 'center',
              paddingHorizontal: spacing.md - 1,
              borderRadius: radius.chip,
              backgroundColor: colors.surface2,
            }}
          >
            <AppText style={{ fontVariant: ['tabular-nums'] }}>{formatClock(time, languageTag)}</AppText>
          </View>
        }
      />
      {open ? (
        <DateTimePicker
          mode="time"
          value={new Date(2000, 0, 1, time.hour, time.minute)}
          onValueChange={(_event, picked) => pick(picked)}
          onDismiss={() => setOpen(false)}
          is24Hour={!usesDayPeriod(languageTag)}
          locale={languageTag}
        />
      ) : null}
    </>
  );
}
