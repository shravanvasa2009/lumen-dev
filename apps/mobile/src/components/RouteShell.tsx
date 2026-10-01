import type { ComponentProps, ReactNode } from 'react';
import { ScrollView, View } from 'react-native';

import type { EvidenceMetric } from '@/evidence';
import { useTheme } from '@/theme';

import { AppText } from './AppText';
import { EvidenceBadge } from './EvidenceBadge';
import { Screen } from './Screen';

type RouteSection = { heading: string; lines?: readonly string[]; metric?: EvidenceMetric };

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
        {sections.map(({ heading, lines = [], metric }) => (
          <View key={heading} style={{ gap: spacing.sm }}>
            <AppText variant="headline">{heading}</AppText>
            {metric ? <EvidenceBadge metric={metric} /> : null}
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
