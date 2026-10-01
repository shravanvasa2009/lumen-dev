import type { ComponentProps, ReactNode } from 'react';
import { ScrollView, View } from 'react-native';

import { useTheme } from '@/theme';

import { AppText } from './AppText';
import { Screen } from './Screen';

type RouteSection = { heading: string; lines?: readonly string[] };

type RouteShellProps = {
  title: string;
  subtitle?: string;
  titleTone?: ComponentProps<typeof AppText>['tone'];
  sections?: readonly RouteSection[];
  children?: ReactNode;
};

export function RouteShell({ title, subtitle, titleTone, sections = [], children }: RouteShellProps) {
  const { spacing } = useTheme();
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.xxxl }}>
        <AppText variant="title" tone={titleTone} accessibilityRole="header">
          {title}
        </AppText>
        {subtitle ? <AppText tone="textDim">{subtitle}</AppText> : null}
        {sections.map(({ heading, lines = [] }) => (
          <View key={heading} style={{ gap: spacing.sm }}>
            <AppText variant="headline">{heading}</AppText>
            {lines.map((line) => (
              <AppText key={line} tone="textDim">
                {line}
              </AppText>
            ))}
          </View>
        ))}
        {children}
      </ScrollView>
    </Screen>
  );
}
