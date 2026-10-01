import type { ComponentProps, ReactNode } from 'react';
import { ScrollView } from 'react-native';

import type { EvidenceMetric } from '@/evidence';
import { useTheme } from '@/theme';

import { AppText } from './AppText';
import { Card } from './Card';
import { EvidenceBadge } from './EvidenceBadge';
import { Screen } from './Screen';

type RouteSection = { heading: string; lines?: readonly string[]; metric?: EvidenceMetric };

type RouteShellProps = {
  title: string;
  subtitle?: string;
  titleTone?: ComponentProps<typeof AppText>['tone'];
  sections?: readonly RouteSection[];
  children?: ReactNode;
  headerless?: boolean;
  // Tab roots carry the Display title; every other screen uses Title.
  tabRoot?: boolean;
  footer?: ReactNode;
};

export function RouteShell({
  title,
  subtitle,
  titleTone,
  sections = [],
  children,
  headerless = false,
  tabRoot = false,
  footer,
}: RouteShellProps) {
  const { spacing } = useTheme();
  return (
    <Screen headerless={headerless || tabRoot} footer={footer}>
      <ScrollView contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.xxxl }}>
        <AppText variant={tabRoot ? 'display' : 'title'} tone={titleTone} accessibilityRole="header">
          {title}
        </AppText>
        {subtitle ? <AppText tone="textDim">{subtitle}</AppText> : null}
        {sections.map(({ heading, lines = [], metric }) => (
          <Card key={heading}>
            <AppText variant="headline">{heading}</AppText>
            {metric ? <EvidenceBadge metric={metric} /> : null}
            {lines.map((line) => (
              <AppText key={line} tone="textDim">
                {line}
              </AppText>
            ))}
          </Card>
        ))}
        {children}
      </ScrollView>
    </Screen>
  );
}
