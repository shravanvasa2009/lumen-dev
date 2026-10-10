import type { KeyboardTypeOptions } from 'react-native';
import { TextInput, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { SectionLabel } from '@/settings/SectionLabel';
import { useTheme } from '@/theme';

type TextFieldGroupProps = {
  // Doubles as the field's spoken label.
  heading: string;
  placeholder: string;
  value: string;
  onChangeText: (text: string) => void;
  keyboardType?: KeyboardTypeOptions;
  maxLength: number;
  // Shown under the field as an alert when set.
  problem?: string | null;
  // A line of help under the field.
  note?: string;
};

// A headed card holding one text field, as About you draws the doctor's phone.
export function TextFieldGroup({
  heading,
  placeholder,
  value,
  onChangeText,
  keyboardType,
  maxLength,
  problem = null,
  note,
}: TextFieldGroupProps) {
  const { colors, spacing, control } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      <SectionLabel>{heading}</SectionLabel>
      <Card flush>
        <TextInput
          accessibilityLabel={heading}
          placeholder={placeholder}
          placeholderTextColor={colors.textFaint}
          keyboardType={keyboardType}
          maxLength={maxLength}
          value={value}
          onChangeText={onChangeText}
          style={{
            minHeight: control.minTarget,
            paddingHorizontal: spacing.lg,
            fontSize: 17,
            color: colors.text,
          }}
        />
      </Card>
      {note ? (
        <AppText variant="caption" tone="textDim">
          {note}
        </AppText>
      ) : null}
      {problem ? (
        <AppText variant="caption" tone="textDim" accessibilityRole="alert">
          {problem}
        </AppText>
      ) : null}
    </View>
  );
}
