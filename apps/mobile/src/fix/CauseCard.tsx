import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { Icon, type IconName } from '@/components/Icon';
import { useTheme } from '@/theme';

import type { FixCause } from './causes';

const causeIcons: Record<FixCause, IconName> = {
  pressure: 'finger',
  motion: 'elbow',
  coverage: 'warm',
  coldHands: 'cup',
};

// The line break keeps the cause on its own line while the lead stays one sentence for screen readers.
function CauseHeadline({ children }: { children?: ReactNode }) {
  return (
    <AppText variant="headline">
      {'\n'}
      {children}
    </AppText>
  );
}

function whyNote(t: TFunction, cause: FixCause): string {
  switch (cause) {
    case 'motion':
      return t('fix.why.motion');
    case 'coverage':
      return t('fix.why.coverage');
    case 'coldHands':
      return t('fix.why.coldHands');
    case 'pressure':
      return t('fix.why.pressure');
  }
}

function LeadSentence({ cause }: { cause: FixCause }) {
  const components = { cause: <CauseHeadline /> };
  switch (cause) {
    case 'motion':
      return <Trans i18nKey="fix.lead.motion" components={components} />;
    case 'coverage':
      return <Trans i18nKey="fix.lead.coverage" components={components} />;
    case 'coldHands':
      return <Trans i18nKey="fix.lead.coldHands" components={components} />;
    case 'pressure':
      return <Trans i18nKey="fix.lead.pressure" components={components} />;
  }
}

export function CauseCard({ cause }: { cause: FixCause }) {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <View
          testID={`fix-cause-icon-${cause}`}
          style={{
            width: 44,
            height: 44,
            borderRadius: radius.card,
            backgroundColor: colors.flagBg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={causeIcons[cause]} size={24} color={colors.flag} />
        </View>
        <AppText variant="caption" tone="textDim" style={{ flex: 1 }}>
          <LeadSentence cause={cause} />
        </AppText>
      </View>
      <View style={{ height: 1, backgroundColor: colors.line }} />
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Icon name="hint" size={20} color={colors.textDim} />
        <AppText tone="textDim" style={{ flex: 1 }}>
          {whyNote(t, cause)}
        </AppText>
      </View>
    </Card>
  );
}
