import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { useTheme } from '@/theme';

const PHONE_WIDTH = 18;
const PHONE_HEIGHT = 30;

function PhonePulse() {
  const { colors } = useTheme();
  return (
    <View
      style={{
        width: 40,
        height: 40,
        borderRadius: 10,
        backgroundColor: colors.surface2,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Svg width={PHONE_WIDTH} height={PHONE_HEIGHT} viewBox="0 0 18 30">
        <Rect width={18} height={30} rx={4} fill={colors.accent} />
        <Path
          d="M3 16h3l2-5 3 9 2-4h2"
          stroke={colors.surface}
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </Svg>
    </View>
  );
}

export function WidgetPromo({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, spacing, control } = useTheme();
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`${t('home.promoTitle')}. ${t('home.promoBody')}`}
          onPress={() => router.push('/settings/widgets')}
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
        >
          <PhonePulse />
          <View style={{ flex: 1 }}>
            <AppText variant="headline">{t('home.promoTitle')}</AppText>
            <AppText variant="caption" tone="textDim">
              {t('home.promoBody')}
            </AppText>
          </View>
        </PressableScale>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t('home.promoDismiss')}
          onPress={onDismiss}
          hitSlop={spacing.sm}
          style={{
            minWidth: control.minTarget,
            minHeight: control.minTarget,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="close" size={control.chevronSize} color={colors.textDim} />
        </PressableScale>
      </View>
    </Card>
  );
}
