import { useLocalSearchParams } from 'expo-router';

import { FixTechniqueView } from '@/fix/FixTechniqueView';
import { parseCause } from '@/fix/causes';
import { parseMode } from '@/measure/mode';

export default function FixTechniqueScreen() {
  const params = useLocalSearchParams<{ mode?: string; cause?: string }>();
  return <FixTechniqueView mode={parseMode(params.mode)} cause={parseCause(params.cause)} />;
}
